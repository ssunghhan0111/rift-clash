// RIFT CLASH — Kids-mode safety rules (pure logic, DOM-free; shared by server + client)
// ---------------------------------------------------------------------------
// Crystal Guard is played by children, and everything in this file exists because
// the grown-up online stack is not safe to point at them unchanged:
//
//   · a kids room must never appear in PUBLIC matchmaking. You play with someone
//     you already know, reached by a four-letter code you were told out loud.
//   · a kids room must never carry FREE TEXT. Not because children write anything
//     alarming, but because the strangers a public listing would have introduced
//     them to might, and because a typed box cannot be moderated by anybody here.
//     Free text is replaced by a fixed phrase list — see QUICKCHAT — which is
//     also simply better on a tablet, where typing is the slowest thing you can
//     ask a seven-year-old to do mid-raid.
//   · a kids room must never open a MICROPHONE.
//   · a child must not be asked to invent a public display name. Generated names
//     cannot leak a real one, and a reroll button is more fun than a text box.
//
// The client enforces all of this by not drawing the controls, and the SERVER
// enforces it again by refusing the messages — because "the client doesn't show
// that button" is not a safety property. Both halves read this one file, so the
// rule and its enforcement cannot drift apart.
//
// COPPA note: these are the mechanics that let Crystal Guard be listed on the
// portals that reach children (Poki, CrazyGames, Coolmath). Weakening any of them
// is a distribution decision, not just a product one.
window.RC = window.RC || {};

RC.KidSafe = (function () {

  // ── Quick chat ────────────────────────────────────────────────────────────
  // Sixteen phrases, arranged as four rows of four so the whole thing is one
  // glanceable grid rather than a list to read. Every phrase is something a
  // player might actually need mid-build; none of them can be aimed at a person.
  // Order matters — it is the on-screen order, and muscle memory forms on it.
  const QUICKCHAT = [
    { id: 'hi',    ic: '👋', msg: 'Hello!' },
    { id: 'yes',   ic: '👍', msg: 'Okay!' },
    { id: 'no',    ic: '🙅', msg: 'No thanks' },
    { id: 'help',  ic: '🙏', msg: 'Help over here!' },

    { id: 'build', ic: '🧱', msg: "I'll build here" },
    { id: 'fix',   ic: '🔧', msg: "I'll fix it" },
    { id: 'save',  ic: '💎', msg: 'Save the shards' },
    { id: 'wall',  ic: '🏰', msg: 'Nice wall!' },

    { id: 'come',  ic: '⚔️', msg: "They're coming!" },
    { id: 'ready', ic: '✅', msg: "I'm ready" },
    { id: 'wait',  ic: '⏳', msg: 'Wait for me' },
    { id: 'look',  ic: '👀', msg: 'Look at this!' },

    { id: 'nice',  ic: '⭐', msg: 'Great job!' },
    { id: 'win',   ic: '🎉', msg: 'We did it!' },
    { id: 'oops',  ic: '😅', msg: 'Oops!' },
    { id: 'bye',   ic: '👋', msg: 'Bye!' },
  ];

  const BY_ID = {};
  QUICKCHAT.forEach(q => { BY_ID[q.id] = q; });

  // Returns the canonical phrase for an id, or null. The server sends the phrase
  // ITSELF rather than trusting a client-supplied string, so a modified client can
  // pick which of the sixteen to say and nothing else.
  function quickChat(id) {
    const q = BY_ID[String(id || '')];
    return q ? (q.ic + '  ' + q.msg) : null;
  }
  function isQuickChat(id) { return !!BY_ID[String(id || '')]; }

  // ── Generated names ───────────────────────────────────────────────────────
  // Adjective + animal + two digits. Both lists are deliberately gentle and
  // concrete: a child should recognise every word, and no combination should be
  // able to read as an insult when it lands next to another player's name.
  const ADJ = [
    'Brave', 'Sunny', 'Clever', 'Speedy', 'Mighty', 'Happy', 'Lucky', 'Bouncy',
    'Cosmic', 'Sparkly', 'Turbo', 'Jolly', 'Bright', 'Swift', 'Zippy', 'Cheery',
    'Fluffy', 'Rocket', 'Thunder', 'Frosty', 'Golden', 'Wobbly', 'Silly', 'Noble',
  ];
  const ANIMAL = [
    'Otter', 'Panda', 'Tiger', 'Fox', 'Badger', 'Puffin', 'Gecko', 'Moose',
    'Dragon', 'Narwhal', 'Sloth', 'Hedgehog', 'Falcon', 'Walrus', 'Koala', 'Yeti',
    'Wombat', 'Penguin', 'Lynx', 'Toucan', 'Beaver', 'Mantis', 'Bison', 'Newt',
  ];

  // `rand` is injectable so tests can pin the output; defaults to Math.random.
  function makeName(rand) {
    const r = rand || Math.random;
    const a = ADJ[Math.floor(r() * ADJ.length) % ADJ.length];
    const b = ANIMAL[Math.floor(r() * ANIMAL.length) % ANIMAL.length];
    const n = 10 + Math.floor(r() * 90) % 90;
    // 14 is the cap everywhere else (RC.Leaderboard.cleanName, the server's
    // sanitizeName). "Sparkly" + "Hedgehog" + 2 digits would overflow it, so the
    // animal is what gives way — the adjective is the part that feels chosen.
    let name = a + b + n;
    if (name.length > 14) name = a + b.slice(0, Math.max(3, 14 - a.length - 2)) + n;
    return name.slice(0, 14);
  }

  // ── The gate itself ───────────────────────────────────────────────────────
  // One predicate, read by every caller on both sides, so "is this a kids room"
  // is never re-derived from a differently-spelled flag.
  function isKids(gameMode) { return gameMode === 'kids'; }

  // What a kids room is not allowed to do. Returned as data rather than as four
  // separate exported booleans so a new restriction is added in one place and
  // every consumer sees it.
  function rules(gameMode) {
    const kids = isKids(gameMode);
    return {
      kids,
      allowPublic: !kids,      // may the room be listed in public matchmaking?
      allowFreeText: !kids,    // may a player send an arbitrary chat string?
      allowVoice: !kids,       // may a player open a microphone?
      allowFreeName: !kids,    // may a player type their own display name?
    };
  }

  return {
    QUICKCHAT, quickChat, isQuickChat,
    ADJ, ANIMAL, makeName,
    isKids, rules,
  };
})();
