// RIFT CLASH — Client-side network layer (browser only)
window.RC = window.RC || {};

RC.online = false;                 // true while in an online match/lobby

RC.NetClient = (function () {
  let ws = null;
  const handlers = {};             // type -> fn ; plus __open/__close/__error
  function connect(url) {
    try { ws = new WebSocket(url); } catch (e) { fire('__error'); return; }
    ws.onopen = () => fire('__open');
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } const h = handlers[m.t]; if (h) h(m); };
    ws.onclose = () => fire('__close');
    ws.onerror = () => fire('__error');
  }
  function fire(t, m) { const h = handlers[t]; if (h) h(m); }
  function on(t, fn) { handlers[t] = fn; }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function close() { if (ws) { try { ws.close(); } catch (e) {} ws = null; } }
  return { connect, on, send, close, get connected() { return ws && ws.readyState === 1; } };
})();

// Route a game command: apply locally when offline, send to the server when online.
RC.cmd = function (game, cmd) {
  if (RC.online) RC.NetClient.send({ t: 'cmd', c: cmd });
  else RC.Net.applyCommand(game, game.playerOwner, cmd);
};
