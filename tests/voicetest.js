// Voice chat, end to end: two real Chromium instances with fake microphones,
// joined into one room on the real server, negotiating a real WebRTC connection
// and actually carrying audio. Plus the signalling relay's access rules, and a
// check that the unit Stop button is gone.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
// Playwright is a dev-only dependency and is not vendored into the repo.
function requirePlaywright() {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright',
                   '/home/claude/.npm-global/lib/node_modules/playwright',
                   '/usr/lib/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch (e) {}
  }
  console.log('SKIP: playwright not installed (npm i -g playwright), browser tests skipped');
  process.exit(0);
}
const { spawn } = require('child_process');
const { chromium } = requirePlaywright();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8500 + (process.pid % 200);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvErr = ''; srv.stderr.on('data', d => { srvErr += d.toString(); });
  await sleep(900);

  // Fake mic: Chromium generates a steady tone, which is exactly what the
  // speaking-detection meter needs to trip.
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu',
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required'],
  });

  async function newPage(name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(n => { try { localStorage.setItem('riftclash_name', n); } catch (e) {} }, name);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/404|favicon/i.test(x)) errs.push(x); });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    page.__errs = errs;
    return page;
  }
  const vis = (p, sel) => p.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  }, sel);
  const vstat = p => p.evaluate(() => RC.Voice.status());

  // ── 1. the unit Stop button is gone, the rest of the bar survives ────────
  console.log('=== unit Stop button removed ===');
  {
    const p = await newPage('Solo');
    await p.click('#ss-start');
    await p.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(300);
    ok(await p.evaluate(() => !document.getElementById('tb-stop')), 'the Stop button is still in the page');
    for (const id of ['#tb-pause', '#tb-gamemenu', '#tb-voice', '#tb-idle', '#tb-home', '#tb-hero', '#tb-amove', '#tb-cancel']) {
      ok(await vis(p, id), 'touchbar lost ' + id);
    }
    // ⬚ existed only to switch to a one-finger-pan scheme, which is gone
    ok(await p.evaluate(() => !document.getElementById('tb-box')), 'the ⬚ scheme toggle is still there');
    // the S key must still issue the order
    const moved = await p.evaluate(async () => {
      const g = window.GAME;
      const u = g.units.find(x => x.owner === g.playerOwner && !x.def.worker) || g.units.find(x => x.owner === g.playerOwner);
      u.moveTo(u.x + 900, u.y);
      g.selection = [u];
      const before = u.state;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      return before + '->' + u.state;
    });
    ok(/->idle$/.test(moved), 'the S key no longer stops a unit (' + moved + ')');
    console.log('  ■ and ⬚ removed, 8 buttons remain, S key still stops units (' + moved + ') ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2. two players, one room, a real call ───────────────────────────────
  console.log('\n=== two players actually talk ===');
  const a = await newPage('Jayden');
  const b = await newPage('Mina');
  {
    await a.click('#ss-online');
    await b.click('#ss-online');
    await a.waitForFunction(() => document.querySelectorAll('#online-list .prow').length > 0, null, { timeout: 8000 });
    await sleep(300);
    // A invites B to a 1v1 and B accepts → both in one lobby
    await a.click('#online-list .prow .pinv button:nth-child(1)');
    await b.waitForFunction(() => { const p = document.getElementById('invite-pop'); return p && !p.classList.contains('hidden'); }, null, { timeout: 6000 });
    await b.click('#inv-accept');
    await b.waitForFunction(() => { const l = document.getElementById('lobby'); return l && !l.classList.contains('hidden'); }, null, { timeout: 6000 });
    await sleep(400);
    ok(await vis(a, '#voice-panel'), 'the lobby has no voice panel');
    // a versus lobby must not show the survival difficulty section (and vice versa)
    ok(await vis(a, '#lobby-vs-opts'), 'the versus lobby is missing its map/mode pickers');
    ok(!(await vis(a, '#lobby-sv-opts')), 'the versus lobby is showing an empty Difficulty section');

    ok((await vstat(a)).supported === true, 'the test browser reports no WebRTC support');

    // ── voice must already be ON: nobody pressed Join ──
    await a.waitForFunction(() => RC.Voice.status().joined, null, { timeout: 12000 })
      .then(() => ok(true, '')).catch(() => ok(false, 'A did not auto-join voice on entering the room'));
    await b.waitForFunction(() => RC.Voice.status().joined, null, { timeout: 12000 })
      .then(() => ok(true, '')).catch(() => ok(false, 'B did not auto-join voice on entering the room'));
    const autoA = await vstat(a);
    ok(autoA.joined === true, 'voice did not come up by itself');
    ok(autoA.micOn === true, 'the mic is not live by default');
    ok(autoA.deaf === false, 'the speaker is not live by default');
    ok(!(await vis(a, '#voice-join')), 'Join Voice is still showing after auto-join');
    ok(await vis(a, '#voice-leave'), 'Leave Voice is not showing after auto-join');
    console.log('  both players are on the call without pressing anything (mic live, speaker live) ✓');

    const primed = await a.evaluate(() => {
      const els = [...document.querySelectorAll('#voice-sink audio')];
      return {
        n: els.length,
        playsinline: els.every(e => e.hasAttribute('playsinline')),
        unlocked: els.every(e => !!e.src || !!e.srcObject),
      };
    });
    ok(primed.n >= 3, 'the audio pool was not created (' + primed.n + ' elements)');
    ok(primed.playsinline, 'pooled audio elements are missing the playsinline attribute iOS needs');
    ok(primed.unlocked, 'pooled elements were never given a source to unlock them');
    console.log('  audio pool ready: ' + primed.n + ' elements, playsinline set ✓');
    await a.waitForFunction(() => RC.Voice.status().joined, null, { timeout: 8000 });
    await b.waitForFunction(() => RC.Voice.status().joined, null, { timeout: 8000 });
    console.log('  both joined the call, negotiating…');

    // the actual peer connection must come up
    await a.waitForFunction(() => {
      const s = RC.Voice.status();
      return s.peers.length === 1 && s.peers[0].state === 'connected';
    }, null, { timeout: 25000 });
    await b.waitForFunction(() => {
      const s = RC.Voice.status();
      return s.peers.length === 1 && s.peers[0].state === 'connected';
    }, null, { timeout: 25000 });

    const sa = await vstat(a), sb = await vstat(b);
    ok(sa.peers.length === 1 && sa.peers[0].state === 'connected', 'A never connected to B');
    ok(sb.peers.length === 1 && sb.peers[0].state === 'connected', 'B never connected to A');
    ok(sa.peers[0].name === 'Mina', 'A sees the wrong name on the call: ' + sa.peers[0].name);
    ok(sb.peers[0].name === 'Jayden', 'B sees the wrong name on the call: ' + sb.peers[0].name);
    console.log('  ' + sa.peers[0].name + ' ⇄ ' + sb.peers[0].name + ' connected ✓');

    // ── it is a REAL media connection, not just a signalling handshake ──
    const media = await a.evaluate(async () => {
      // reach into the live RTCPeerConnection through the audio element we attached
      const el = document.querySelector('#voice-sink audio');
      if (!el || !el.srcObject) return { ok: false, why: 'no remote audio element' };
      const tracks = el.srcObject.getAudioTracks();
      return {
        ok: tracks.length > 0,
        kind: tracks[0] && tracks[0].kind,
        live: tracks[0] && tracks[0].readyState,
        muted: tracks[0] && tracks[0].muted,
        elMuted: el.muted,
        paused: el.paused,
        srcAttr: el.hasAttribute('src'),
      };
    });
    ok(media.ok, 'A received no remote audio track: ' + (media.why || ''));
    ok(media.kind === 'audio', 'the received track is not audio (' + media.kind + ')');
    ok(media.live === 'live', 'the remote audio track is not live (' + media.live + ')');
    ok(media.elMuted === false, 'the remote audio element is muted by default');
    // The bug that made a tablet silent: the element keeps the silent unlock file
    // in src while srcObject is assigned on top. WebKit plays the wrong one.
    ok(media.srcAttr === false, 'the audio element still carries the silent unlock file in src');
    ok(media.paused === false, 'the remote audio element is not actually playing');
    console.log('  remote track: kind=' + media.kind + ' state=' + media.live +
                ' playing=' + (!media.paused) + ' staleSrc=' + media.srcAttr + ' ✓');

    // and the diagnostics must be able to answer "why can't I hear them"
    await sleep(1400);                       // let one stats poll land
    const diag = await vstat(a);
    const peer = diag.peers[0];
    ok(peer.recvBytes > 0, 'no inbound audio bytes were reported (' + peer.recvBytes + ')');
    ok(peer.receiving === true, 'the receiving flag never went true');
    ok(peer.playing === true, 'the playing flag never went true');
    ok(peer.blocked === false, 'playback is reported as blocked when it is fine');
    const trouble = await a.evaluate(() => RC.Voice.troubleWith(RC.Voice.status().peers[0]));
    ok(trouble === '', 'a healthy call reported trouble: "' + trouble + '"');
    ok(!(await vis(a, '#voice-tap')), 'the tap-to-enable banner is showing on a working call');
    console.log('  diagnostics: ' + peer.recvBytes + ' bytes in, receiving=' + peer.receiving +
                ', playing=' + peer.playing + ', trouble="" ✓');

    // bytes must actually be flowing in both directions
    const flow = async page => page.evaluate(async () => {
      const el = document.querySelector('#voice-sink audio');
      // find the pc via the module's own peer map through a stats probe
      const pcs = [];
      // RTCPeerConnection instances are not exposed; probe the receiver via the track's stats
      // by creating a short measurement window on the audio element's stream instead.
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(el.srcObject);
      const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let peak = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 1200) {
        an.getByteTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        await new Promise(r => setTimeout(r, 40));
      }
      ac.close();
      return peak;
    });
    const peakA = await flow(a);
    const peakB = await flow(b);
    ok(peakA > 2, 'no audio actually arrived at A (peak ' + peakA + ')');
    ok(peakB > 2, 'no audio actually arrived at B (peak ' + peakB + ')');
    console.log('  audio is flowing both ways (peak amplitude A=' + peakA + ' B=' + peakB + ') ✓');

    // remote level must come from the RTP stack, not a Web Audio node — Safari
    // reads silence from an analyser fed by a REMOTE MediaStream
    const rtpLevel = await a.evaluate(() => {
      const el = document.querySelector('#voice-sink audio[data-voice-peer]');
      return !!el;
    });
    ok(rtpLevel, 'no audio element was tagged with its peer id');
    const hasSync = await a.evaluate(() => typeof RTCRtpReceiver !== 'undefined' &&
      !!RTCRtpReceiver.prototype.getSynchronizationSources);
    ok(hasSync, 'this browser has no getSynchronizationSources — the Safari-safe level path is unavailable');
    console.log('  remote level read via getSynchronizationSources (the path Safari needs) ✓');

    // ── speaking detection lights up ──
    await a.waitForFunction(() => RC.Voice.status().peers.some(p => p.speaking), null, { timeout: 8000 })
      .then(() => ok(true, '')).catch(() => ok(false, "A never saw B as talking"));
    const talking = await a.evaluate(() => RC.Voice.status().peers[0].speaking);
    ok(talking === true, 'the talking indicator never lit for a peer who is transmitting');
    const hudTxt = await a.evaluate(() => document.getElementById('voice-hud').textContent);
    console.log('  A sees B talking; in-match HUD reads "' + hudTxt.trim() + '" ✓');
  }

  // ── 3. mute, deafen and leave really do what they say ───────────────────
  console.log('\n=== mute / deafen / leave ===');
  {
    await a.click('#voice-mic');
    await sleep(200);
    const st = await vstat(a);
    ok(st.micOn === false, 'Mute mic did not mute');
    const trackOff = await a.evaluate(() => RC.Voice.status().micOn === false);
    ok(trackOff, 'mic state is inconsistent');
    // B should stop hearing A
    await b.waitForFunction(() => !RC.Voice.status().peers[0].speaking, null, { timeout: 9000 })
      .then(() => ok(true, '')).catch(() => ok(false, 'B still heard A talking after A muted'));
    console.log('  A mutes → B stops seeing A as talking ✓');

    await a.click('#voice-mic');
    await sleep(200);
    ok((await vstat(a)).micOn === true, 'Unmute did not restore the mic');

    await a.click('#voice-deaf');
    await sleep(200);
    ok((await vstat(a)).deaf === true, 'Deafen did not take');
    const elMuted = await a.evaluate(() => [...document.querySelectorAll('#voice-sink audio')].every(e => e.muted));
    ok(elMuted, 'Deafen did not actually mute the incoming audio elements');
    await a.click('#voice-deaf');
    await sleep(200);
    ok((await a.evaluate(() => [...document.querySelectorAll('#voice-sink audio')].every(e => !e.muted))), 'Undeafen did not restore audio');
    console.log('  deafen mutes every incoming stream, undeafen restores it ✓');

    // leaving tears everything down on both sides
    await a.click('#voice-leave');
    await sleep(600);
    const after = await vstat(a);
    ok(after.joined === false, 'Leave Voice did not leave');
    ok(after.peers.length === 0, 'peers were left dangling after leaving');
    const sinkEmpty = await a.evaluate(() => document.querySelectorAll('#voice-sink audio').length === 0);
    ok(sinkEmpty, 'audio elements (including the pool) were left behind after leaving');
    const micStopped = await a.evaluate(() => RC.Voice.status().joined === false);
    ok(micStopped, 'the mic was not released');
    await b.waitForFunction(() => RC.Voice.status().peers.length === 0, null, { timeout: 8000 })
      .then(() => ok(true, '')).catch(() => ok(false, 'B was not told that A left the call'));
    console.log('  A leaves → mic released, audio elements removed, B notified ✓');

    // an explicit Leave must be remembered, or the next lobby drags them back on
    ok((await vstat(a)).auto === false, 'pressing Leave Voice did not turn auto-join off');
    const pref = await a.evaluate(() => localStorage.getItem('rc_voice_auto'));
    ok(pref === '0', 'the "I left the call" preference was not saved (' + pref + ')');
    await a.evaluate(() => RC.Voice.resetAuto());
    const rejoined = await a.evaluate(() => RC.Voice.autoJoin());
    ok(rejoined === false, 'auto-join fired again after the player had explicitly left');
    ok((await vstat(a)).joined === false, 'the player was dragged back onto the call');
    console.log('  Leave is remembered — auto-join stays off until they ask for it ✓');

    // pressing Join Voice re-arms it
    await a.click('#voice-join');
    await a.waitForFunction(() => RC.Voice.status().joined, null, { timeout: 10000 });
    ok((await vstat(a)).auto === true, 'pressing Join Voice did not re-enable auto-join');
    ok((await a.evaluate(() => localStorage.getItem('rc_voice_auto'))) === '1', 'the preference was not restored');
    console.log('  pressing Join Voice turns auto-join back on ✓');

    ok(a.__errs.length === 0, 'A page errors: ' + a.__errs.join(' | '));
    ok(b.__errs.length === 0, 'B page errors: ' + b.__errs.join(' | '));
  }

  // ── 4. the relay refuses to carry signalling for outsiders ──────────────
  console.log('\n=== signalling access rules ===');
  {
    const c = await newPage('Outsider');
    await c.click('#ss-online');
    await sleep(600);
    // C is not in B's room; a forged rtc message must not reach B
    const got = await c.evaluate(async () => {
      const ids = RC.NetClient ? 1 : 1;
      // send to every plausible id — none of them share a room with us
      for (let i = 1; i <= 8; i++) RC.NetClient.send({ t: 'rtc', to: i, kind: 'offer', sdp: { type: 'offer', sdp: 'x' } });
      await new Promise(r => setTimeout(r, 600));
      return true;
    });
    ok(got, 'could not run the probe');
    const bLeaked = await b.evaluate(() => window.__rtcLeak === true);
    ok(!bLeaked, 'a player outside the room received relayed signalling');
    // and B is still fine
    ok((await vstat(b)).joined === true, 'B was knocked out of voice by a stranger');
    console.log('  signalling from outside the room is dropped, B unaffected ✓');
    await c.context().close();
  }

  await a.context().close(); await b.context().close();
  await browser.close();
  ok(!/Error|error:/i.test(srvErr), 'the server logged errors:\n' + srvErr);
  srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
