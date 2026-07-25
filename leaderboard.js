// RIFT CLASH — global Survival leaderboard (client)
// Talks to the server's /api/scores + /api/score endpoints over plain HTTP, so it
// works in both solo and online co-op Survival. When the game is opened straight
// from a file (file://) there is no server, so every call degrades to "unavailable"
// and the rest of the game carries on exactly as before.
window.RC = window.RC || {};

RC.Leaderboard = (function () {
  const NAME_KEY = 'riftclash_name';
  const TIMEOUT = 7000;

  // Only meaningful when served over http(s) — opening index.html directly has no API.
  function available() {
    try { return location.protocol === 'http:' || location.protocol === 'https:'; }
    catch (e) { return false; }
  }

  function getName() {
    try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }
  function setName(n) {
    try { window.localStorage.setItem(NAME_KEY, String(n || '').slice(0, 14)); } catch (e) {}
  }

  // Same character rule the server enforces, applied up front so the box shows
  // the player exactly what will be saved.
  function cleanName(s) {
    return String(s == null ? '' : s)
      .replace(/[^\p{L}\p{N} _\-.!]/gu, '')
      .replace(/\s+/g, ' ')
      .slice(0, 14);
  }

  function request(url, opts) {
    if (!available()) return Promise.reject(new Error('offline'));
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, TIMEOUT);
    const o = Object.assign({ signal: ctl ? ctl.signal : undefined }, opts || {});
    return fetch(url, o)
      .then(r => r.json().then(j => {
        if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status));
        return j;
      }))
      .finally(() => clearTimeout(timer));
  }

  // Top rows for a difficulty → { diff, rows: [{name, score, wave, kills, race, mode, at}] }
  function top(diff, limit) {
    return request('/api/scores?diff=' + encodeURIComponent(diff || 'medium') +
                   '&limit=' + (limit || 25));
  }

  // Submit a finished run → { ok, rank, improved, score, name, rows }
  function submit(run) {
    const name = cleanName(run.name) || 'Anonymous';
    setName(name);
    return request('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        diff: run.diff || 'medium',
        wave: run.wave || 0,
        kills: run.kills || 0,
        race: run.race || 'forge',
        mode: run.mode || 'solo',
      }),
    });
  }

  return { available, top, submit, getName, setName, cleanName };
})();
