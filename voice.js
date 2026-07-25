// RIFT CLASH — Voice chat (browser only)
// ---------------------------------------------------------------------------
// Peer-to-peer voice between everyone in a room, over WebRTC. The audio never
// touches the game server — the server only relays the handshake (offer, answer,
// ICE candidates), so a call costs it nothing but a few small JSON messages and
// the voice keeps working at whatever latency the two players have to each other
// rather than to Oregon.
//
// Up to 4 players share a room, so this is a full mesh: at most 3 connections
// each, 6 in a full room. Mesh is the wrong shape for a big call and the right
// one for this size — no media server to run, no extra hop.
//
// Who calls whom: the player with the LOWER client id always sends the offer.
// Without a rule like that, both sides offer at the same moment and the
// negotiation collides ("glare") and neither connects.
//
// Honest limits:
//   - The mic needs a secure context. On https (Render) it works; opened from a
//     plain file:// or over http on a LAN IP the browser refuses, and we say so
//     instead of failing silently.
//   - STUN only, no TURN. That covers most home networks. Two players both
//     behind a symmetric NAT (some corporate/mobile networks) will fail to
//     connect, and there is nothing the client can do about it without a relay
//     server — the UI reports it rather than spinning forever.
window.RC = window.RC || {};

RC.Voice = (function () {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const SPEAK_ON = 0.045;      // RMS above which we call it "talking"
  const SPEAK_OFF = 0.028;     // and below which we stop (hysteresis, or it flickers)
  const CONNECT_TIMEOUT = 15000;

  let myId = null;
  let send = null;             // injected: RC.NetClient.send
  let stream = null;           // our microphone
  let joined = false;          // we are in the voice channel
  let micOn = true;            // mic live vs muted (still joined)
  let audioCtx = null;
  let meterTimer = null;
  let lastError = '';
  const peers = new Map();     // peerId -> { pc, el, name, state, analyser, data, speaking }
  let listeners = [];

  function on(fn) { listeners.push(fn); }
  function fire() { for (const fn of listeners) { try { fn(); } catch (e) {} } }

  function supported() {
    return !!(typeof navigator !== 'undefined' && navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia && typeof RTCPeerConnection !== 'undefined');
  }
  // getUserMedia is blocked outside a secure context, and the failure is opaque —
  // check up front so we can explain it instead of showing "permission denied".
  function secure() {
    try { return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1'; }
    catch (e) { return false; }
  }
  function unavailableReason() {
    if (!supported()) return 'This browser has no microphone support.';
    if (!secure()) return 'Voice needs a secure connection (https). Open the game from its web address, not a local file.';
    return '';
  }

  // ── Mic ──────────────────────────────────────────────
  async function getMic() {
    if (stream) return stream;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    return stream;
  }
  function stopMic() {
    if (!stream) return;
    stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    stream = null;
  }

  // ── Level metering (for the "who is talking" dot) ────
  function ensureCtx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
  }
  function meterFor(mediaStream) {
    const ac = ensureCtx();
    if (!ac || !mediaStream || !mediaStream.getAudioTracks().length) return null;
    try {
      const src = ac.createMediaStreamSource(mediaStream);
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return { an, data: new Uint8Array(an.fftSize) };
    } catch (e) { return null; }
  }
  function rms(m) {
    if (!m) return 0;
    m.an.getByteTimeDomainData(m.data);
    let sum = 0;
    for (let i = 0; i < m.data.length; i++) { const v = (m.data[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / m.data.length);
  }
  let localMeter = null, localSpeaking = false;
  function startMeters() {
    if (meterTimer) return;
    meterTimer = setInterval(() => {
      let changed = false;
      const lv = (micOn && localMeter) ? rms(localMeter) : 0;
      const nowLocal = localSpeaking ? lv > SPEAK_OFF : lv > SPEAK_ON;
      if (nowLocal !== localSpeaking) { localSpeaking = nowLocal; changed = true; }
      for (const p of peers.values()) {
        const v = p.meter ? rms(p.meter) : 0;
        const now = p.speaking ? v > SPEAK_OFF : v > SPEAK_ON;
        if (now !== p.speaking) { p.speaking = now; changed = true; }
      }
      if (changed) fire();
    }, 140);
  }
  function stopMeters() { if (meterTimer) { clearInterval(meterTimer); meterTimer = null; } }

  // ── Peer connections ─────────────────────────────────
  function makePeer(peerId, name) {
    let p = peers.get(peerId);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { id: peerId, name: name || ('Player ' + peerId), pc, el: null, meter: null,
          speaking: false, state: 'connecting', failedAt: 0 };
    peers.set(peerId, p);

    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.onicecandidate = e => {
      if (e.candidate && send) send({ t: 'rtc', to: peerId, kind: 'ice', ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    };
    pc.ontrack = e => {
      const ms = (e.streams && e.streams[0]) || new MediaStream([e.track]);
      attachAudio(p, ms);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') p.state = 'connected';
      else if (s === 'failed') { p.state = 'failed'; p.failedAt = Date.now(); }
      else if (s === 'disconnected') p.state = 'reconnecting';
      else if (s === 'closed') p.state = 'closed';
      fire();
    };
    // watchdog — a connection that never comes up should say so, not spin forever
    setTimeout(() => {
      if (peers.get(peerId) === p && p.state === 'connecting') { p.state = 'failed'; fire(); }
    }, CONNECT_TIMEOUT);
    return p;
  }

  function attachAudio(p, ms) {
    if (!p.el) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.muted = false;
      el.setAttribute('data-voice-peer', String(p.id));
      const sink = document.getElementById('voice-sink') || document.body;
      sink.appendChild(el);
      p.el = el;
    }
    p.el.srcObject = ms;
    const play = p.el.play();
    if (play && play.catch) play.catch(() => { /* autoplay blocked until a gesture; the mic button is one */ });
    p.meter = meterFor(ms);
    p.state = 'connected';
    fire();
  }

  function dropPeer(peerId) {
    const p = peers.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch (e) {}
    if (p.el) { try { p.el.srcObject = null; p.el.remove(); } catch (e) {} }
    peers.delete(peerId);
    fire();
  }

  // Lower id offers. Both sides applying the same rule means exactly one offer.
  function shouldOffer(peerId) { return myId != null && myId < peerId; }

  async function startOffer(peerId, name) {
    const p = makePeer(peerId, name);
    try {
      const offer = await p.pc.createOffer({ offerToReceiveAudio: true });
      await p.pc.setLocalDescription(offer);
      send({ t: 'rtc', to: peerId, kind: 'offer', sdp: p.pc.localDescription });
    } catch (e) { p.state = 'failed'; lastError = e.message; fire(); }
  }

  // ── Signalling in ────────────────────────────────────
  async function onSignal(m) {
    if (!joined || m.from == null) return;
    const p = peers.get(m.from) || makePeer(m.from, m.fromName);
    try {
      if (m.kind === 'offer') {
        await p.pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        send({ t: 'rtc', to: m.from, kind: 'answer', sdp: p.pc.localDescription });
      } else if (m.kind === 'answer') {
        if (p.pc.signalingState !== 'stable') await p.pc.setRemoteDescription(new RTCSessionDescription(m.sdp));
      } else if (m.kind === 'ice' && m.ice) {
        try { await p.pc.addIceCandidate(new RTCIceCandidate(m.ice)); } catch (e) { /* candidate arrived before the answer — safe to drop */ }
      }
    } catch (e) { lastError = e.message; p.state = 'failed'; fire(); }
  }

  // The room's voice roster: who has their mic on. Connect to the new ones, drop
  // anyone who left or turned voice off.
  function setRoster(list) {
    if (!joined) return;
    const want = new Map();
    (list || []).forEach(x => { if (x.id !== myId) want.set(x.id, x.name); });
    for (const id of [...peers.keys()]) if (!want.has(id)) dropPeer(id);
    for (const [id, name] of want) {
      if (!peers.has(id)) {
        if (shouldOffer(id)) startOffer(id, name);
        else makePeer(id, name);          // wait for their offer
      } else {
        peers.get(id).name = name;
      }
    }
    fire();
  }

  // ── Public controls ──────────────────────────────────
  function init(id, sendFn) { myId = id; send = sendFn; }

  async function join() {
    lastError = '';
    const why = unavailableReason();
    if (why) { lastError = why; fire(); return false; }
    try {
      await getMic();
    } catch (e) {
      lastError = (e && e.name === 'NotAllowedError')
        ? 'Microphone permission was refused. Allow it in the browser and try again.'
        : 'No microphone available (' + ((e && e.message) || 'unknown') + ').';
      fire();
      return false;
    }
    const ac = ensureCtx();
    if (ac && ac.state === 'suspended') { try { await ac.resume(); } catch (e) {} }
    localMeter = meterFor(stream);
    joined = true; micOn = true;
    setMicEnabled(true);
    startMeters();
    if (send) send({ t: 'voiceJoin' });
    fire();
    return true;
  }

  function leave() {
    if (send && joined) send({ t: 'voiceLeave' });
    joined = false;
    for (const id of [...peers.keys()]) dropPeer(id);
    stopMeters();
    stopMic();
    localMeter = null; localSpeaking = false;
    fire();
  }

  function setMicEnabled(on) {
    micOn = !!on;
    if (stream) stream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    if (!micOn) localSpeaking = false;
    fire();
  }
  function toggleMic() { setMicEnabled(!micOn); return micOn; }

  // Deafen — stop hearing everyone without giving up our own mic.
  let deaf = false;
  function setDeaf(on) {
    deaf = !!on;
    for (const p of peers.values()) if (p.el) p.el.muted = deaf;
    fire();
  }
  function toggleDeaf() { setDeaf(!deaf); return deaf; }

  function status() {
    return {
      supported: supported(), secure: secure(), reason: unavailableReason(),
      joined, micOn, deaf, error: lastError, myId,
      speaking: joined && micOn && localSpeaking,
      peers: [...peers.values()].map(p => ({ id: p.id, name: p.name, state: p.state, speaking: p.speaking })),
    };
  }

  return { init, join, leave, toggleMic, setMicEnabled, toggleDeaf, setDeaf,
           onSignal, setRoster, status, on, get joined() { return joined; } };
})();
