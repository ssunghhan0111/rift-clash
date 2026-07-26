// RIFT CLASH — Client-side network layer (browser only)
window.RC = window.RC || {};

RC.online = false;                 // true while in an online match/lobby

RC.NetClient = (function () {
  let ws = null;
  let lastUrl = '';
  let wanted = false;              // we want to be connected (false after an explicit close)
  let retryT = null, retryN = 0;
  const handlers = {};             // type -> fn ; plus __open/__close/__error

  // Backoff for automatic reconnection. Fast at first — a wifi blip usually comes
  // back within a second or two and a player mid-match should not sit staring at a
  // banner — then slower, so a genuinely dead server is not hammered.
  const RETRY_MS = [400, 800, 1500, 2500, 4000, 6000];

  function open(url) {
    lastUrl = url || lastUrl;
    try { ws = new WebSocket(lastUrl); } catch (e) { fire('__error'); scheduleRetry(); return; }
    ws.onopen = () => { retryN = 0; fire('__open'); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } const h = handlers[m.t]; if (h) h(m); };
    ws.onclose = () => { ws = null; fire('__close'); scheduleRetry(); };
    ws.onerror = () => fire('__error');
  }

  function connect(url) { wanted = true; retryN = 0; clearRetry(); open(url); }

  // Automatic reconnection is only armed while somebody actually wants the socket
  // AND has asked for retries (see setRetry). Menu screens do not retry: there the
  // player can simply press Online again.
  let retryEnabled = false;
  function setRetry(on) { retryEnabled = !!on; if (!on) clearRetry(); }
  function clearRetry() { if (retryT) { clearTimeout(retryT); retryT = null; } }
  function scheduleRetry() {
    if (!wanted || !retryEnabled || retryT) return;
    const wait = RETRY_MS[Math.min(retryN, RETRY_MS.length - 1)];
    retryN++;
    fire('__retry', { attempt: retryN, wait });
    retryT = setTimeout(() => { retryT = null; if (wanted && retryEnabled) open(); }, wait);
  }

  function fire(t, m) { const h = handlers[t]; if (h) h(m); }
  function on(t, fn) { handlers[t] = fn; }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function close() {
    wanted = false; retryEnabled = false; clearRetry(); retryN = 0;
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} ws = null; }
  }
  return { connect, on, send, close, setRetry,
           get connected() { return !!ws && ws.readyState === 1; },
           get retrying() { return !!retryT; },
           get attempts() { return retryN; } };
})();

// Route a game command: apply locally when offline, send to the server when online.
RC.cmd = function (game, cmd) {
  if (RC.online) RC.NetClient.send({ t: 'cmd', c: cmd });
  else RC.Net.applyCommand(game, game.playerOwner, cmd);
};
