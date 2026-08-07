// RIFT CLASH — Read-aloud for Crystal Guard (browser only)
// ---------------------------------------------------------------------------
// The reward screen asks a child to choose between three cards in about four
// seconds. That works if the cards can be UNDERSTOOD in four seconds, and for a
// six- or seven-year-old a sentence like "All your fighters take less damage"
// cannot be — not because the idea is hard, but because reading it is.
//
// So the cards can speak. This wraps window.speechSynthesis, which every modern
// browser ships and which costs nothing, needs no asset, no network and no
// dependency — the same constraints the rest of this project runs under.
//
// Everything here is BEST EFFORT and silent on failure. A browser with no speech
// engine, no installed voice, a rejected autoplay policy or a thrown error must
// leave the game playing exactly as it did before; speech is an aid laid on top
// of a UI that already works without it, never a channel something is only
// available through. That is also why nothing here is ever awaited.
//
// It is OFF by default. A game that starts talking on its own is a game a parent
// turns off in a shared room, and an accessibility feature nobody asked for is
// still a surprise. The kids HUD shows a 🔊 toggle; the choice persists.
window.RC = window.RC || {};

RC.KidVoice = (function () {
  const KEY = 'riftclash_readaloud';
  let on = false;
  let voice = null;
  let picked = false;

  function synth() {
    try { return window.speechSynthesis || null; } catch (e) { return null; }
  }
  function supported() { return !!(synth() && typeof window.SpeechSynthesisUtterance === 'function'); }

  try { on = window.localStorage.getItem(KEY) === '1'; } catch (e) { on = false; }

  // ── Voice selection ───────────────────────────────────────────────────────
  // getVoices() is famously empty on first call in some browsers and populates
  // asynchronously, so this runs again on voiceschanged and on every speak()
  // until it finds something. Preference order is deliberate: a local voice does
  // not go to the network mid-raid, and an en-GB/en-US voice reads the card text
  // (which is written in English) correctly.
  function pickVoice() {
    const s = synth();
    if (!s || picked) return;
    let list = [];
    try { list = s.getVoices() || []; } catch (e) { return; }
    if (!list.length) return;
    const score = v => {
      let n = 0;
      if (v.localService) n += 4;
      const lang = (v.lang || '').toLowerCase();
      if (lang.indexOf('en') === 0) n += 3;
      // Named voices that tend to be the clearer ones where they exist. Absent
      // everywhere else, in which case this term simply contributes nothing.
      if (/samantha|daniel|karen|google uk|google us/i.test(v.name || '')) n += 2;
      return n;
    };
    list = list.slice().sort((a, b) => score(b) - score(a));
    voice = list[0] || null;
    picked = !!voice;
  }
  if (supported()) {
    try {
      pickVoice();
      const s = synth();
      if (s && 'onvoiceschanged' in s) s.addEventListener('voiceschanged', () => { picked = false; pickVoice(); });
    } catch (e) {}
  }

  // ── Speaking ──────────────────────────────────────────────────────────────
  function cancel() {
    try { const s = synth(); if (s) s.cancel(); } catch (e) {}
  }

  // Emoji and symbols are stripped: a screen reader voice pronouncing "shield
  // selector" in the middle of a sentence is worse than silence. Only the words.
  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/[\p{Extended_Pictographic}←-⇿☀-➿️‍]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  // `speak` always cancels what is already being said. Two cards read over each
  // other is noise, and a child tapping through three cards fast should hear the
  // one they are on, not a queue draining behind them.
  function speak(text, opts) {
    if (!on || !supported()) return false;
    const words = clean(text);
    if (!words) return false;
    try {
      pickVoice();
      cancel();
      const u = new window.SpeechSynthesisUtterance(words);
      if (voice) u.voice = voice;
      // Slightly slow and slightly high: the pace a person reading to a child
      // uses. Default rate is noticeably fast for a listener who is also looking
      // at a wave timer.
      u.rate = (opts && opts.rate) || 0.92;
      u.pitch = (opts && opts.pitch) || 1.08;
      u.volume = 1;
      u.lang = (voice && voice.lang) || 'en-US';
      synth().speak(u);
      return true;
    } catch (e) { return false; }
  }

  // A card is a name and an effect, said as one sentence with a pause between —
  // "Sharper Shots. All your fighters hit harder." Reads better than two separate
  // utterances, which the engine renders with a gap long enough to feel broken.
  function speakCard(card) {
    if (!card) return false;
    const name = card.name || '';
    const desc = card.desc || '';
    return speak(name + (name && desc ? '. ' : '') + desc);
  }

  function enabled() { return on && supported(); }
  function set(v) {
    on = !!v;
    try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    if (!on) cancel();
    return on;
  }
  function toggle() { return set(!on); }

  return { supported, enabled, set, toggle, speak, speakCard, cancel };
})();
