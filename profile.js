// RIFT CLASH — local player profile
// ---------------------------------------------------------------------------
// A tiny, purely client-side record of what you've done: matches played, your
// win/loss per faction, and your best Survival wave per difficulty. Lives in
// localStorage, so it survives across sessions on the same browser and costs the
// server nothing. Everything degrades gracefully if storage is unavailable.
window.RC = window.RC || {};

RC.Profile = (function () {
  const KEY = 'riftclash_profile';
  const HERO_KEY = 'riftclash_hero';       // the id of the hero currently picked
  const HEROES_KEY = 'riftclash_heroes';   // per-hero Mastery, cosmetics, record
  const WALLET_KEY = 'riftclash_wallet';   // Stars and the shared cosmetic inventory

  function read(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, v) { try { window.localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  // ── Per-hero record ────────────────────────────────────────────────────────
  // Mastery is the number that PERSISTS, and the one rule that governs it is that it
  // must never reach the simulation — see HERO_DESIGN.md §2 and the note on RC.MASTERY.
  // Nothing in this file is imported by entities.js or game.js, and that is deliberate:
  // the separation is structural, not a promise.
  //
  // All five heroes exist from the first launch. There are no hero slots to unlock, so a
  // hero with no entry here has simply never been played.
  function blankHero() {
    return {
      mastery: 1, xp: 0, matches: 0, wins: 0,
      cosmetics: { hat: 'none', suit: 'none', shoes: 'none', palette: 'none' },
      // What this hero brings. Absent means "the default", which is exactly the hero
      // everyone had before loadouts existed — see RC.defaultLoadout.
      loadout: null,
    };
  }
  function heroes() {
    const raw = read(HEROES_KEY, {});
    const out = {};
    for (const id of RC.HEROES) {
      const b = blankHero(), h = raw[id] || {};
      out[id] = {
        mastery: Math.max(1, Math.min(RC.MASTERY.maxLevel, h.mastery | 0 || 1)),
        xp: Math.max(0, h.xp | 0),
        matches: h.matches | 0,
        wins: h.wins | 0,
        cosmetics: Object.assign(b.cosmetics, h.cosmetics || {}),
        loadout: h.loadout || null,
      };
    }
    return out;
  }
  function saveHeroes(h) { write(HEROES_KEY, h); }

  // Which hero the player deploys. Resolved through RC.resolveHero so a stored id from
  // before the roster was renamed still lands on the right hero instead of throwing.
  function heroPick() {
    let id = null;
    try { id = window.localStorage.getItem(HERO_KEY); } catch (e) {}
    return RC.resolveHero(id);
  }
  function setHeroPick(id) {
    const ok = RC.resolveHero(id);
    try { window.localStorage.setItem(HERO_KEY, ok); } catch (e) {}
    return ok;
  }

  // XP needed to go from `level` to `level + 1`. Linear, not exponential: a player who
  // plays twice as much should be roughly twice as far along.
  function masteryToNext(level) {
    const M = RC.MASTERY;
    return M.xpBase + Math.max(0, level - 1) * M.xpStep;
  }
  // Add XP to one hero, rolling levels. Returns { levels, mastery } so the end screen can
  // announce what changed. Capped at maxLevel, where XP simply stops accruing.
  function addMasteryXp(rec, xp) {
    const M = RC.MASTERY;
    let levels = 0;
    rec.xp += Math.max(0, xp | 0);
    while (rec.mastery < M.maxLevel && rec.xp >= masteryToNext(rec.mastery)) {
      rec.xp -= masteryToNext(rec.mastery);
      rec.mastery++; levels++;
    }
    if (rec.mastery >= M.maxLevel) rec.xp = 0;
    return { levels, mastery: rec.mastery };
  }

  // ── Wallet ─────────────────────────────────────────────────────────────────
  // Stars and the cosmetic inventory. The inventory is SHARED across the account and
  // equipment is per hero (stored on the hero above), so buying the crown once lets any
  // of the five wear it — five heroes' worth of personality without five times the cost.
  function blankWallet() { return { stars: 0, earned: 0, owned: [], daily: -1 }; }
  function wallet() {
    const w = read(WALLET_KEY, null) || blankWallet();
    return {
      stars: Math.max(0, w.stars | 0),
      earned: Math.max(0, w.earned | 0),
      owned: Array.isArray(w.owned) ? w.owned.slice() : [],
      daily: (w.daily == null ? -1 : w.daily | 0),
    };
  }
  function saveWallet(w) { write(WALLET_KEY, w); }

  // A 'none' item is owned by everyone and is never in the list — otherwise every new
  // player would start with four rows of inventory that mean "no hat".
  function owns(slot, id) {
    if (!id || id === 'none') return true;
    const item = RC.cosmetic(slot, id);
    if (!item || item.stars === 0) return true;
    if (wallet().owned.indexOf(slot + '.' + id) >= 0) return true;
    // Mastery gives some things outright, so a player who never spends a Star still
    // watches their hero change. Checked against the HIGHEST Mastery on the account
    // rather than per hero: the inventory has always been shared, and an item that
    // appeared and disappeared as you switched heroes would read as a bug.
    return giftedIds().indexOf(slot + '.' + id) >= 0;
  }
  function topMastery() {
    const hs = heroes();
    let top = 1;
    for (const id of RC.HEROES) top = Math.max(top, hs[id].mastery | 0);
    return top;
  }
  function giftedIds() {
    return RC.masteryGifts(topMastery()).map(g => g.slot + '.' + g.id);
  }

  // Buy an item into the shared inventory. Returns { ok, reason, stars }.
  // Deliberately does NOT equip it: buying and wearing are separate decisions, and a
  // purchase that silently changed how a hero looked would be a surprise, not a reward.
  function buy(slot, id) {
    const item = RC.cosmetic(slot, id);
    if (!item || item.id !== id) return { ok: false, reason: 'unknown', stars: wallet().stars };
    if (owns(slot, id)) return { ok: false, reason: 'owned', stars: wallet().stars };
    const w = wallet();
    if (w.stars < item.stars) return { ok: false, reason: 'poor', stars: w.stars };
    w.stars -= item.stars;
    w.owned.push(slot + '.' + id);
    saveWallet(w);
    return { ok: true, stars: w.stars };
  }

  // Equip an owned item on one hero. Refuses silently-wrong input rather than storing it:
  // a cosmetics field holding an id the player never bought would re-appear as a free
  // item the next time the shop checked ownership.
  function equip(heroId, slot, id) {
    const hid = RC.resolveHero(heroId);
    if (RC.COSMETIC_SLOTS.indexOf(slot) < 0) return false;
    if (!owns(slot, id)) return false;
    const item = RC.cosmetic(slot, id);
    const all = heroes();
    all[hid].cosmetics[slot] = item.id;
    saveHeroes(all);
    return true;
  }
  // What this hero is actually wearing — filtered through ownership on the way out.
  //
  // equip() already refuses an unowned item, so in normal play this filter never fires.
  // It fires when the stored data and the wallet disagree, which happens two ways that
  // both matter: someone edited localStorage, or we retired an item that players had
  // equipped. Without the filter the first is a free cosmetic and the second is an item
  // the shop says you must buy while the hero is visibly already wearing it.
  //
  // Filtered on READ rather than repaired on load, so retiring an item temporarily is
  // not the same as confiscating it: put it back in the shop and the hero is wearing it
  // again, exactly as the player left it.
  // ── The loadout ───────────────────────────────────────────────────────────
  //
  // Always read through RC.validLoadout, never raw. A stored loadout can outlive the
  // Mastery that earned it (nothing ever takes Mastery away, but a build can retire an
  // option), and it can outlive the option itself — so what comes back out is always
  // something this hero may legally bring right now, substituted rather than refused.
  function loadoutOf(heroId) {
    const id = RC.resolveHero(heroId);
    const rec = heroes()[id];
    return RC.validLoadout(id, rec.mastery, rec.loadout);
  }
  function setLoadout(heroId, lo) {
    const id = RC.resolveHero(heroId);
    const hs = heroes();
    hs[id].loadout = RC.validLoadout(id, hs[id].mastery, lo);
    saveHeroes(hs);
    return hs[id].loadout;
  }
  // One slot at a time, which is how the Hero Bay actually changes it.
  function setSlot(heroId, slot, id) {
    const cur = loadoutOf(heroId);
    if (slot === 'q' || slot === 'e') cur[slot] = id;
    else {
      // An upgrade socket: toggle it in or out, keeping at most upSlots.
      const i = cur.ups.indexOf(id);
      if (i >= 0) cur.ups.splice(i, 1);
      else {
        cur.ups.push(id);
        while (cur.ups.length > RC.LOADOUT.upSlots) cur.ups.shift();
      }
    }
    return setLoadout(heroId, cur);
  }

  function cosmeticsOf(heroId) {
    const cos = heroes()[RC.resolveHero(heroId)].cosmetics;
    const out = {};
    for (const slot of RC.COSMETIC_SLOTS) {
      const id = cos[slot];
      out[slot] = owns(slot, id) ? id : 'none';
    }
    return out;
  }

  function blank() {
    return {
      matches: 0, wins: 0, losses: 0,
      faction: { forge: { w: 0, l: 0 }, gloop: { w: 0, l: 0 }, aether: { w: 0, l: 0 } },
      bestWave: { easy: 0, medium: 0, insane: 0 },
      daily: { day: -1, wave: 0 },     // best wave on TODAY's daily (day = UTC day number)
      // ── Progression ──
      // All of the above was counted and then never spent on anything: you finished a
      // match and nothing you earned outlived it. These feed RC.Progress (levels and
      // the achievement checklist) and are deliberately *variety* counters — wins keyed
      // by planet, by bot personality, by difficulty — so the rewards pull a player
      // around the game instead of letting them grind one map forever.
      xp: 0,
      mapWins: {},        // mapId    -> wins
      foeWins: {},        // personaId-> wins  ('balanced' when the bot had no personality)
      diffWins: {},       // easy|normal|hard -> wins
      coop: 0,            // online co-op survival runs finished
      online: 0,          // online versus matches finished
      streak: { cur: 0, best: 0 },
      earned: [],         // achievement ids already awarded (so each only announces once)
    };
  }

  function get() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return blank();
      const p = JSON.parse(raw), b = blank();
      return {
        matches: p.matches | 0, wins: p.wins | 0, losses: p.losses | 0,
        faction: Object.assign(b.faction, p.faction || {}),
        bestWave: Object.assign(b.bestWave, p.bestWave || {}),
        daily: Object.assign(b.daily, p.daily || {}),
        // Anyone who played before progression existed keeps their record and simply
        // starts at level 1 — every one of these falls back to the blank default.
        xp: p.xp | 0,
        mapWins: Object.assign({}, p.mapWins || {}),
        foeWins: Object.assign({}, p.foeWins || {}),
        diffWins: Object.assign({}, p.diffWins || {}),
        coop: p.coop | 0,
        online: p.online | 0,
        streak: Object.assign(b.streak, p.streak || {}),
        earned: Array.isArray(p.earned) ? p.earned.slice() : [],
      };
    } catch (e) { return blank(); }
  }
  function save(p) { try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function reset() { save(blank()); }

  // Call once when a match ends (game.over just became set). Returns the updated profile.
  // Practice/tutorial matches and matches with no result are ignored.
  // Returns { profile, xpGained, levelUp, unlocked[] } so the end screen can show what
  // the match was worth. Losing still pays — a kid who only gets rewarded for winning
  // stops playing the moment they hit an opponent they can't beat.
  // ── Star payout ────────────────────────────────────────────────────────────
  // Returns { stars, lines[] } — the total AND the itemised breakdown, because a number
  // that appears with no explanation teaches the player nothing about what to do again
  // next match. Every clause is capped; see the note on RC.STARS for why each exists,
  // and in particular why nothing here scales with how long the match ran.
  //
  // Split out from recordMatchEnd so it can be tested against a plain object instead of
  // a live Game — the payout rules are exactly the kind of thing that rots quietly.
  function starPayout(game, opts) {
    const S = RC.STARS;
    const o = opts || {};
    const lines = [];
    const add = (n, why) => { if (n > 0) { lines.push({ stars: n, why }); } };

    add(S.finish, 'Match finished');
    if (game.over === 'win') add(S.win, 'Victory');
    if (game.survival) {
      add(Math.min(S.waveCap, Math.floor((game.survivalWave || 0) / 2) * S.wavePer2), 'Waves survived');
    }
    // The hero's peak MATCH level — the resetting one. Rewarding the persistent number
    // here would pay the player for progress they already made, every match, forever.
    add(Math.min(S.levelCap, Math.floor((o.heroLevel || 1) / 2) * S.levelPer2), 'Hero reached level ' + (o.heroLevel || 1));
    if (o.crystalHeld) add(S.crystalHeld, 'Objective held');

    let total = lines.reduce((a, l) => a + l.stars, 0);
    total = Math.min(S.cap, total);
    // The daily bonus is added AFTER the cap on purpose: it is the clause that rewards
    // coming back rather than grinding, so it must not be the thing the cap eats.
    const w = wallet();
    const day = RC.Daily ? RC.Daily.dayNumber() : Math.floor(Date.now() / 86400000);
    if (w.daily !== day) { total += S.daily; lines.push({ stars: S.daily, why: 'First match today' }); }
    return { stars: total, lines, day };
  }

  function recordMatchEnd(game) {
    if (!game || game.practice || !game.over) return null;
    const p = get();
    const beforeLevel = RC.Progress ? RC.Progress.levelOf(p.xp).level : 1;
    const won = game.over === 'win';
    let xp = 0;
    p.matches++;
    if (game.survival) {
      const diff = game.survivalDiff || 'medium';
      if (!(diff in p.bestWave)) p.bestWave[diff] = 0;
      const wave = game.survivalWave || 0;
      if (wave > p.bestWave[diff]) p.bestWave[diff] = wave;
      if (game.daily && RC.Daily) {
        const day = RC.Daily.dayNumber();
        if (p.daily.day !== day) { p.daily.day = day; p.daily.wave = 0; }
        if (wave > p.daily.wave) p.daily.wave = wave;
      }
      if (RC.online) p.coop++;
      xp = 20 + wave * 6;                       // survival pays per wave survived
    } else {
      const race = (game._racePick && game._racePick[game.playerOwner]) || 'forge';
      if (!p.faction[race]) p.faction[race] = { w: 0, l: 0 };
      if (RC.online) p.online++;
      if (won) {
        p.wins++; p.faction[race].w++;
        const mapId = game.mapDef && game.mapDef.id;
        if (mapId) p.mapWins[mapId] = (p.mapWins[mapId] || 0) + 1;
        const diff = game.aiDiff || 'normal';
        p.diffWins[diff] = (p.diffWins[diff] || 0) + 1;
        // Which personality did we actually beat? Any enemy bot's is representative.
        let foe = 'balanced';
        for (const k in (game.aiPersona || {})) {
          const per = game.aiPersona[k];
          if (per && per.id) { foe = per.id; break; }
        }
        p.foeWins[foe] = (p.foeWins[foe] || 0) + 1;
        p.streak.cur++;
        if (p.streak.cur > p.streak.best) p.streak.best = p.streak.cur;
        xp = 100 + (diff === 'hard' ? 60 : diff === 'normal' ? 30 : 0);
      } else if (game.over === 'lose') {
        p.losses++; p.faction[race].l++;
        p.streak.cur = 0;
        xp = 35;                                // showing up still counts for something
      }
    }
    p.xp += xp;
    let gained = xp;
    // Newly completed achievements — recorded here so each is announced exactly once.
    let unlocked = [];
    if (RC.Progress) {
      unlocked = RC.Progress.check(p).filter(a => p.earned.indexOf(a.id) < 0);
      unlocked.forEach(a => { p.earned.push(a.id); p.xp += a.xp || 0; gained += a.xp || 0; });
    }
    save(p);
    const afterLevel = RC.Progress ? RC.Progress.levelOf(p.xp).level : 1;

    // ── Mastery and Stars ────────────────────────────────────────────────────
    // Both are paid to the hero the player actually DEPLOYED, and both pay on a loss for
    // the same reason profile XP does: a player rewarded only for winning stops playing
    // the first time they meet someone better.
    //
    // Note what Mastery does NOT do here — it does not touch a single field the
    // simulation reads. It is a number in localStorage that unlocks options.
    const heroUnit = game.heroOf && game.heroOf[game.playerOwner];
    const heroId = RC.resolveHero((heroUnit && heroUnit.type) || heroPick());
    const all = heroes();
    const rec = all[heroId];
    const M = RC.MASTERY;
    let mXp = M.matchXp + (won ? M.winBonus : 0);
    if (game.survival) mXp = M.matchXp + (game.survivalWave || 0) * M.wavePer;
    rec.matches++;
    if (won) rec.wins++;
    const mastery = addMasteryXp(rec, mXp);
    saveHeroes(all);

    // The crystal bonus asks "was the objective ever in real danger?", so it reads the
    // objective's health at the END. A mode with no crystal cannot lose one, and paying
    // it out there would make the bonus free in half the game.
    const crys = game.crystal;
    const crystalHeld = !!(crys && crys.maxHp && crys.hp >= crys.maxHp * 0.5);
    const pay = starPayout(game, { heroLevel: (heroUnit && heroUnit.level) || 1, crystalHeld });
    const w = wallet();
    w.stars += pay.stars;
    w.earned += pay.stars;
    w.daily = pay.day;
    saveWallet(w);

    return {
      profile: p, xpGained: gained, levelUp: afterLevel > beforeLevel ? afterLevel : 0, unlocked,
      hero: heroId, heroXp: mXp, mastery: mastery.mastery, masteryUp: mastery.levels,
      stars: pay.stars, starLines: pay.lines, starTotal: w.stars,
    };
  }

  // Best wave the player has reached on TODAY's daily (0 if they haven't run it today).
  function dailyBest() {
    const p = get();
    if (RC.Daily && p.daily.day === RC.Daily.dayNumber()) return p.daily.wave;
    return 0;
  }

  return {
    get, save, reset, recordMatchEnd, dailyBest,
    // Heroes
    heroes, saveHeroes, heroPick, setHeroPick, masteryToNext, addMasteryXp,
    loadoutOf, setLoadout, setSlot, topMastery, giftedIds,
    // Stars & cosmetics
    wallet, saveWallet, owns, buy, equip, cosmeticsOf, starPayout,
  };
})();
