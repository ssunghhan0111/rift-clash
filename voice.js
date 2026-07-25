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

  // iOS only lets a media element play if a user gesture unlocked it, and the
  // remote track does not arrive until several seconds after the button press.
  // So we create and unlock a small pool of <audio> elements DURING the click and
  // hand them out later when tracks show up. A tiny silent WAV is enough to unlock.
  const SILENT_WAV = 'data:audio/wav;base64,UklGRqQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  const POOL_SIZE = 3;         // room cap is 4, so at most 3 remote voices

  let myId = null;
  let send = null;             // injected: RC.NetClient.send
  let stream = null;           // our microphone
  let joined = false;          // we are in the voice channel
  let micOn = true;            // mic live vs muted (still joined)
  let audioCtx = null;
  let deaf = false;            // declared up here: attachAudio applies it to new elements
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
        const v = remoteLevel(p);
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

  // ── Audio element pool (the iOS unlock) ──────────────
  let pool = [];
  let needsGesture = false;    // a play() was refused; retry on the next tap
  function makeAudioEl() {
    const el = document.createElement('audio');
    el.autoplay = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');        // older WebKit reads the attribute, not the property
    el.setAttribute('autoplay', '');
    el.muted = false;
    el.volume = 1;
    const sink = document.getElementById('voice-sink') || document.body;
    sink.appendChild(el);
    return el;
  }
  // Must be called synchronously inside the click that starts voice.
  function primePool() {
    while (pool.length < POOL_SIZE) {
      const el = makeAudioEl();
      try {
        el.src = SILENT_WAV;
        const pr = el.play();
        if (pr && pr.catch) pr.catch(() => {});
      } catch (e) {}
      pool.push(el);
    }
  }
  function takeEl() {
    for (const el of pool) if (!el.srcObject && !el.__inUse) { el.__inUse = true; return el; }
    const el = makeAudioEl(); el.__inUse = true; pool.push(el);
    return el;
  }
  function releaseEl(el) {
    if (!el) return;
    try { el.srcObject = null; } catch (e) {}
    el.__inUse = false;
  }
  // If the browser refused to start playback, the very next tap anywhere retries it.
  function armGestureRetry() {
    if (needsGesture) return;
    needsGesture = true;
    const retry = () => {
      needsGesture = false;
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('touchend', retry, true);
      if (audioCtx && audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
      for (const p of peers.values()) {
        if (p.el && p.el.srcObject && p.el.paused) { const pr = p.el.play(); if (pr && pr.catch) pr.catch(() => {}); }
      }
      fire();
    };
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('touchend', retry, true);
    fire();
  }

  function attachAudio(p, ms) {
    if (!p.el) { p.el = takeEl(); p.el.setAttribute('data-voice-peer', String(p.id)); }
    p.el.srcObject = ms;
    p.el.muted = deaf;
    const play = p.el.play();
    if (play && play.catch) play.catch(() => armGestureRetry());
    // Local metering uses Web Audio; for REMOTE streams Safari is unreliable there,
    // so this analyser is only a fallback — see remoteLevel().
    p.meter = meterFor(ms);
    p.state = 'connected';
    fire();
  }

  // How loud a peer is right now. Preferred source is the level the RTP stack
  // already reports (works on Safari/iOS, where a Web Audio node fed from a remote
  // MediaStream often reads pure silence); the analyser is the fallback.
  function remoteLevel(p) {
    try {
      const rs = p.pc.getReceivers ? p.pc.getReceivers() : [];
      for (const r of rs) {
        if (!r || !r.track || r.track.kind !== 'audio' || !r.getSynchronizationSources) continue;
        const src = r.getSynchronizationSources();
        if (src && src.length && typeof src[0].audioLevel === 'number') return src[0].audioLevel;
      }
    } catch (e) { /* fall through to the analyser */ }
    return p.meter ? rms(p.meter) : 0;
  }

  function dropPeer(peerId) {
    const p = peers.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch (e) {}
    releaseEl(p.el);          // back to the pool — recreating it would lose the iOS unlock
    p.el = null;
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

  // ── Auto-join ────────────────────────────────────────
  // Voice comes up by itself when you enter a room: mic live, speaker live. The
  // one thing that must NOT happen is dragging someone back onto a call they
  // deliberately left, so pressing Leave Voice is remembered and turns auto-join
  // off until they press Join Voice again.
  const AUTO_KEY = 'rc_voice_auto';
  function autoWanted() {
    try { return window.localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; }
  }
  function setAutoWanted(on) {
    try { window.localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) {}
  }
  let autoTried = false;
  function resetAuto() { autoTried = false; }      // called when entering a new room
  // Returns false without fuss when it can't or shouldn't fire — the Join button
  // stays there as the manual path.
  async function autoJoin() {
    if (joined || autoTried || !autoWanted() || unavailableReason()) return false;
    autoTried = true;
    const okJoin = await join(true);
    // A failed automatic attempt must not leave a red error sitting on screen —
    // the player never asked for anything yet. The button explains itself.
    if (!okJoin && lastError && /permission/i.test(lastError)) lastError = '';
    fire();
    return okJoin;
  }

  // ── Public controls ──────────────────────────────────
  function init(id, sendFn) { myId = id; send = sendFn; }

  async function join(isAuto) {
    lastError = '';
    const why = unavailableReason();
    if (why) { lastError = why; fire(); return false; }
    // Do this FIRST: we are inside the click here, and everything after the first
    // await has lost the user gesture as far as iOS is concerned.
    ensureCtx();
    primePool();
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
    joined = true;
    micOn = true;                       // mic live on join
    setDeaf(false);                     // and speaker live
    if (!isAuto) { setAutoWanted(true); autoTried = true; }
    setMicEnabled(true);
    startMeters();
    if (send) send({ t: 'voiceJoin' });
    fire();
    return true;
  }

  function leave(explicit) {
    if (explicit) setAutoWanted(false);        // they chose to hang up — respect it
    if (send && joined) send({ t: 'voiceLeave' });
    joined = false;
    for (const id of [...peers.keys()]) dropPeer(id);
    stopMeters();
    stopMic();
    for (const el of pool) { try { el.srcObject = null; el.removeAttribute('src'); el.load(); el.remove(); } catch (e) {} }
    pool = [];
    needsGesture = false;
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
  function setDeaf(on) {
    deaf = !!on;
    for (const p of peers.values()) if (p.el) p.el.muted = deaf;
    for (const el of pool) if (!el.__inUse) el.muted = deaf;
    fire();
  }
  function toggleDeaf() { setDeaf(!deaf); return deaf; }

  function status() {
    return {
      supported: supported(), secure: secure(), reason: unavailableReason(),
      joined, micOn, deaf, error: lastError, myId, needsGesture, auto: autoWanted(),
      speaking: joined && micOn && localSpeaking,
      peers: [...peers.values()].map(p => ({ id: p.id, name: p.name, state: p.state, speaking: p.speaking })),
    };
  }

  return { init, join, autoJoin, resetAuto, leave, toggleMic, setMicEnabled, toggleDeaf, setDeaf,
           onSignal, setRoster, status, on, get joined() { return joined; } };
})();
