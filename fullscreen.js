// RIFT CLASH — Fullscreen
// ---------------------------------------------------------------------------
// Fullscreen is the DEFAULT here, but a browser will not grant it on page load —
// the Fullscreen API only works inside a user gesture. So "default" means: the
// very first tap or key press arms it, and from then on it stays on across menus,
// matches and returns to the menu until the player says otherwise.
//
// The one rule that matters: an explicit exit is remembered. If the player leaves
// fullscreen — with the button, with Esc, or with F11 — we do NOT drag them back
// in on their next click. Nothing is more hostile than a page that keeps grabbing
// the whole screen. The preference is persisted, and the button is the way back.
//
// Not every browser has it. iPhone Safari has no Fullscreen API at all; there the
// answer is "Add to Home Screen", which the manifest already handles. The button
// hides itself rather than sitting there doing nothing.
window.RC = window.RC || {};

RC.Fullscreen = (function () {
  const KEY = 'rc_fullscreen';
  let listeners = [];
  let armed = false;
  let selfInitiated = false;     // we asked for this change, so do not treat it as a player exit

  function el() { return document.documentElement; }

  function supported() {
    const e = el();
    return !!(e && (e.requestFullscreen || e.webkitRequestFullscreen ||
                    e.mozRequestFullScreen || e.msRequestFullscreen));
  }
  function isOn() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement ||
              document.mozFullScreenElement || document.msFullscreenElement);
  }
  // Already fullscreen without the API: an iOS home-screen app, or a browser in
  // F11 mode where the viewport fills the screen. Nothing to do in that case.
  function standalone() {
    try {
      return !!(window.navigator.standalone ||
                (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
                (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    } catch (e) { return false; }
  }

  // Touch/handheld heuristic — decides whether going fullscreen should ALSO lock the
  // screen to landscape (a phone held in portrait should rotate into the game).
  function isHandheld() {
    try {
      return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
             ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    } catch (e) { return false; }
  }
  // Best-effort landscape lock. Only attempted on handhelds, and only works while
  // fullscreen; silently ignored where unsupported (desktop, iPhone Safari, etc.).
  function lockLandscape() {
    if (!isHandheld()) return;
    try {
      const so = window.screen && window.screen.orientation;
      if (so && so.lock) { const p = so.lock('landscape'); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }

  function wanted() {
    try { return window.localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
  }
  function setWanted(on) {
    try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  }

  function on(fn) { listeners.push(fn); }
  function fire() { for (const fn of listeners) { try { fn(); } catch (e) {} } }

  // Best effort throughout: a blocked request must never throw into the caller.
  function enter(explicit) {
    if (explicit) setWanted(true);
    if (!supported() || isOn()) { fire(); return false; }
    const e = el();
    const req = e.requestFullscreen || e.webkitRequestFullscreen ||
                e.mozRequestFullScreen || e.msRequestFullscreen;
    if (!req) { fire(); return false; }
    selfInitiated = true;
    try {
      const p = req.call(e, { navigationUI: 'hide' });
      // On success also rotate/lock to landscape on phones & tablets; on failure
      // fall back exactly as before (clear the flag and notify listeners).
      if (p && p.then) p.then(() => lockLandscape(), () => { selfInitiated = false; fire(); });
      else lockLandscape();
    } catch (err) { selfInitiated = false; }
    return true;
  }
  function exit(explicit) {
    if (explicit) setWanted(false);
    if (!isOn()) { fire(); return false; }
    const ex = document.exitFullscreen || document.webkitExitFullscreen ||
               document.mozCancelFullScreen || document.msExitFullscreen;
    if (!ex) { fire(); return false; }
    selfInitiated = true;
    try {
      const p = ex.call(document);
      if (p && p.catch) p.catch(() => { selfInitiated = false; fire(); });
    } catch (err) { selfInitiated = false; }
    return true;
  }
  function toggle() {
    // Always explicit — this is only ever called from a button.
    if (isOn()) { exit(true); return false; }
    enter(true);
    return true;
  }

  // Call from inside a gesture (a match starting, a button press). Honours the
  // remembered preference, so it is a no-op for someone who opted out.
  function enterIfWanted() {
    if (!wanted() || standalone()) return false;
    return enter(false);
  }

  // "Fullscreen by default": the first gesture anywhere on the page arms it.
  // Fires once, then unhooks itself.
  function armFirstGesture() {
    if (armed || !wanted() || !supported() || standalone()) return;
    armed = true;
    const go = () => {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      enterIfWanted();
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }

  // The player can leave fullscreen with Esc or F11 without touching our button.
  // Treat that as an opt-out and remember it, or the next click would yank them
  // straight back in.
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, () => {
      if (!isOn() && !selfInitiated) setWanted(false);
      selfInitiated = false;
      fire();
    }));

  function status() {
    return { supported: supported(), on: isOn(), wanted: wanted(), standalone: standalone() };
  }

  return { supported, isOn, standalone, wanted, setWanted, enter, exit, toggle,
           enterIfWanted, armFirstGesture, status, on };
})();
