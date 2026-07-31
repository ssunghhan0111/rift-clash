# Hero redesign — five heroes, race-free, yours to keep

Status: **design agreed, not yet built.** The only piece that has shipped is the
start-screen hero (`Renderer.drawHeroIdle` + `#hero-stage` in `index.html`, fed by
`heroPick()` in `main.js`). Everything below is the plan the rest of the work follows.

What changed from the previous revision of this document, and why:

| Decision | Previous | Now |
| --- | --- | --- |
| Roster | 3 heroes, one bound per race | **5 heroes, none bound to any race** |
| Persistent power | undecided | **two-track: Mastery persists and grants no stats; Match Level grants stats and resets** |
| Hero slots | unlock over time | **all 5 unlocked from the start, freely toggled** |
| Currency | none | **Stars, paid at the end of every match** |
| Cosmetics | palette only | **hat / costume / shoes / palette, shared inventory, equipped per hero** |

---

## 1. What we want, and why it fights itself

Two goals, pulling in opposite directions:

- **Come back tomorrow.** The hero should be *yours* — it should remember what it
  learned, and be visibly further along than it was last week.
- **Play with anyone.** A friend who started today should be able to queue with a player
  who has 200 matches, and the match should be about who plays better.

These only conflict when what persists is **power**. They don't conflict at all when what
persists is **choice**. So that is the line the whole design is drawn along:

> **Breadth persists. Budget doesn't.**
>
> Playing more gives you *more things to pick from*, and *more ways to look*. It never
> gives you *more points to spend* or *bigger numbers*.

A veteran and a rookie both bring one Q, one E, one ultimate and two upgrade slots into
every match. The veteran has thirty options to fill those five slots from; the rookie has
eight. The veteran's advantage is knowing which five to pick — which is knowledge, not
stats, and knowledge is what we actually want to reward.

---

## 2. Two tracks, and the word "level" means two things

This is the single most important section in the document, because "the hero levels up"
is true twice over and the two are not the same number. Name them differently in code,
in the UI and in conversation, or they will be confused forever.

| | **Match Level** | **Mastery** |
| --- | --- | --- |
| Range | 1 → 10 | 1 → 30, **per hero** |
| Earned from | enemies dying near the hero, in match | XP paid out at the end of every match |
| Persists? | **no — resets to 1 every match** | **yes — this is the thing you come back to** |
| Changes hp / dmg / armor? | **yes — the only thing that does** | **never** |
| Also changes | Q/E/R numbers via `dmgPerLevel`, `shieldPerLevel`, `countPerLevel` | which Q/E/R variants and which ultimate upgrades you may *choose* from, plus cosmetics |
| Lives in | `Unit.level` / `Unit.xp` (`entities.js`) | `riftclash_heroes` in `localStorage` |

Match Level is exactly today's system and we are **not touching it**:
`RC.HERO.xpBase/xpStep/killXp/killXpPerSupply/workerXp/heroXp/xpRange` in `config.js`,
awarded by `Game._awardKillXp()` in `game.js` (which already finds the nearest enemy hero
within `xpRange` and calls `gainXp`), applied by `Unit.gainXp()` and `def.grow` in
`entities.js`, with the three ultimate upgrades arriving at `RC.HERO.upLevels = [3, 6, 9]`.
It is already good and it is already balanced.

Mastery is a **new, separate number** that lives in the profile and **never enters the
simulation.** `Unit` must not be able to read it. If a reviewer can find a code path from
Mastery to a stat, the design has been violated. That single rule is what lets a Mastery-28
Rook and a Mastery-1 Rook queue against each other without a matchmaking bracket, which
matters enormously when the online population is small.

### So what does "the skills level up" mean?

Both, and the UI should say which:

- **In a match**, each of the three skills gets stronger every Match Level. Already built
  — `Unit.effSkill()` scales Q/E by `dmgPerLevel` / `shieldPerLevel`, `Unit.effSig()`
  scales the ultimate and merges whichever upgrades are held. Show it as **"Rank 4/10"**
  on each skill button so growth is visible while playing.
- **Between matches**, Mastery unlocks **variants** of each skill — a second Ground Slam
  that trades damage for a longer leap, a Venom Spray that trades the puddle for an
  instant hit. Same energy cost, same cooldown, same power budget, different *shape*.
  Show it as **"Mastery 12 · next unlock at 14"** in the Hero Bay.

Roughly one unlock every two Mastery levels, so there is always a next thing:

- **Skill variants** — sidegrades on an equal budget, per slot.
- **Ultimate upgrade cards** — today each hero has exactly three (`sig.ups`) and gets all
  three by Match Level 9. Widen to six or seven per hero and let the player bring **two**.
  Now "Bulwark" is a build, not a script.
- **Cosmetic unlocks** — items that Mastery grants directly rather than charging Stars for,
  so a player who never spends still sees their hero change.

---

## 3. The roster — five heroes, no faction

Five heroes, five jobs, no overlap. Names are deliberately one syllable and race-neutral:
they must not read as Forge, Gloop or Aether, because any of them can deploy with any of
the three.

| | Hero | Job | The one-line fantasy |
| --- | --- | --- | --- |
| 1 | **ROOK** | Anchor | Stand in front of the thing you cannot afford to lose. |
| 2 | **THORN** | Reaper | Feed on the fight and outlast it. |
| 3 | **PRISM** | Weaver | Be where the fight isn't, and stop it where it is. |
| 4 | **EMBER** | Kindler | Make ground the enemy cannot stand on. |
| 5 | **VALE** | Mender | Keep the army alive through the push that should have killed it. |

Every hero has the same shape, which is the shape the code already has
(`def.skills = [q, e, sig]`, built by the loop at the bottom of the units table in
`config.js`):

- **Q** — cheap, short cooldown, pressed constantly.
- **E** — the tactical answer, medium cost and cooldown.
- **R** — the **signature / ultimate**, the only ability that does not run on a cooldown.
  It charges from *fighting* (`RC.HERO.chargeIdle / chargeDealt / chargeTaken / chargeKill`),
  and it carries the upgrades.

### 1 · ROOK — the Anchor

```
hp 620   dmg 22   range 30   cd 1.0   speed 78   r 22   armor 3   energy 200
grow { hp: 70, dmg: 4, armor: 0.5 }
passive  guardaura { armor: 2, radius: 170, thorns: 0.2 }
```

- **Q · Ground Slam** (45 energy, 9s) — leaps 190 into the fight and lands hard enough to
  freeze everything within 150 for 1.1s. *Kid line: "Jumps in and freezes everyone!"*
- **E · Hold the Line** (50 energy, 14s) — plants a banner for 5s. Enemies inside 200 are
  slowed 40%; allies inside gain +3 armor. *Kid line: "Plants a flag — your team gets
  tougher, theirs gets slower!"*
- **R · Bulwark** — throws a shield dome (900 + 80/level) over the crystal for 6s.
  Upgrades: **Wider Dome** (allies inside get a third of it), **Longer Hold** (+3s),
  **Shatter** (detonates when it ends).

Note the deliberate change from the old Warden: E is no longer a shockwave measured from
the crystal, because that answered the same question as the ultimate. A hero whose E and
R both mean "the crystal is about to die" wastes a button.

### 2 · THORN — the Reaper

```
hp 500   dmg 18   range 120  cd 1.0   speed 84   r 21   armor 1   energy 220   regen 4
grow { hp: 55, dmg: 4, armor: 0.4 }
passive  lifesteal { pct: 0.3 }
```

- **Q · Venom Spray** (40 energy, 8s) — wide spray, light on impact, but what it coats
  keeps dying for six seconds.
- **E · Devour** (50 energy, 12s) — rips into everything within 165 and feeds; the more it
  hits, the more it heals (capped at 4 targets).
- **R · Hatch the Brood** — splits the ground and hatches 5 (+0.4/level, max 12) temporary
  minions. Upgrades: **Bigger Brood** (+3), **Acid Babies** (burst on death),
  **Angry Brood** (faster, hits much harder).

**Open item, small but real:** today the Matriarch hatches `globling`, which is a Gloop
unit. A race-free hero cannot summon a faction unit — it would look wrong in a Forge army
and it would quietly hand Gloop's roster to everybody. Add a neutral `thornling` unit def
that belongs to the hero, not to a race.

### 3 · PRISM — the Weaver

```
hp 440   dmg 26   range 95   cd 0.95  speed 88   r 22   armor 2   shield 320   energy 220
grow { hp: 45, dmg: 5, armor: 0.4, shield: 55 }
passive  shieldaura { sps: 10, radius: 170 }
```

- **Q · Phase Shift** (35 energy, 7s) — folds space 265 forward and comes out with its
  shield restored (+120, +16/level).
- **E · Static Prison** (55 energy, 13s) — snaps a lattice shut around a knot of enemies
  within 175, freezing every one for 1.8s.
- **R · Rift Nova** — radiant shockwave measured **from the crystal**, damaging and
  hurling enemies away from it. Upgrades: **Wider Nova**, **Warding Nova** (heals and
  shields allies caught in it), **Rift Mire** (the ground stays churned, slow lasts 4s).

### 4 · EMBER — the Kindler *(new kit)*

```
hp 460   dmg 20   range 150  cd 1.1   speed 82   r 20   armor 1   energy 210
grow { hp: 50, dmg: 5, armor: 0.3 }
passive  scorch — the hero's own attacks stack a burn (4 dmg/s, 4s, max 3 stacks)
```

- **Q · Cinder Line** (40 energy, 8s) — lays a burning line 300 long and 60 wide toward
  the cursor: 30 on contact (+3/level), then 8/s for 4s to anything standing in it.
  *Kid line: "Draws a line of fire — don't step on it!"*
- **E · Flare** (45 energy, 12s) — marks a 180 circle for 6s. Enemies inside take **+25%
  damage from every source** and are revealed. *Kid line: "Paints the bad guys — everyone
  hits them harder!"*
- **R · Firestorm** — an 8s, 220-radius fire pool at the target: 26 dmg/s. This is the
  wave-clear ultimate and the lane-denial ultimate at once. Upgrades: **Wildfire**
  (+40% radius, spreads to whatever leaves it), **Long Burn** (+4s), **Backdraft**
  (anything leaving the pool takes a burst and is slowed).

Ember is the one hero that needs mechanics the game does not have yet: a **persistent
ground hazard** (the pool and the line, which tick on whoever is standing in them) and a
**damage-amplification debuff** (Flare). Both are small — a hazard list on `Game` ticked
once a frame, and a multiplier read in the damage path — but they are new code, so Ember
is the hero to build **last** of the five.

### 5 · VALE — the Mender *(new kit)*

```
hp 470   dmg 16   range 110  cd 1.05  speed 90   r 20   armor 1   energy 240
grow { hp: 55, dmg: 3, armor: 0.3 }
passive  mendaura — allies within 175 heal 5/s (non-stacking; see §4)
```

- **Q · Mend Pulse** (40 energy, 7s) — heals every ally within 190 for 60 (+8/level), and
  **repairs buildings too**, including the crystal. *Kid line: "Heals your whole team —
  and fixes the crystal!"*
- **E · Slipstream** (45 energy, 13s) — allies within 200 get +35% move speed for 4s and
  are **cleansed** of slow and freeze. The counter-play button against Rook's Q and
  Prism's E, and the reason a Vale army can disengage.
- **R · Sanctuary** — 6s, 280 radius at the target point: allies inside take 35% less
  damage and heal 20/s, and the first lethal hit on each ally instead leaves it at 1 hp.
  Upgrades: **Wide Sanctuary** (+35% radius), **Longer Grace** (+3s), **Rally** (allies
  inside also gain +25% attack speed).

Vale is the hero that makes co-op Survival feel different rather than just harder, which
is where a large share of playtime already goes.

### What the five buy us

No two heroes answer "a big push is landing on my crystal" the same way: Rook absorbs it,
Prism removes it from the area, Ember denies the ground it is standing on, Vale outlasts
it, Thorn trades bodies with it. That is the test a five-hero roster has to pass — five
buttons that all mean "win the fight" is one hero with five costumes.

---

## 4. Decoupling the hero from the race

Right now `RC.RACES[x].hero` binds warden→forge, matriarch→gloop, archon→aether, and
`matriarch` / `archon` carry a `race:` tag on their unit defs. `game.js` spawns
`RC.UNITS[rdef.hero]` at two sites (`game.js:613` and `game.js:673`). Four things need
attention when any hero can deploy with any race:

**1 · Aura stacking.** Prism's passive is `shieldaura`, and so is the Aether Ardent's — a
Prism in an Aether army used to double-dip. Same shape for Vale's `mendaura` beside a
Forge Patch Bot. The rule shipped as a general one rather than a hero special case:
**auras with the same `passive.id` do not stack — the strongest instance wins.**

The implementation is the idiom `guardaura` already used. An aura no longer applies its
effect directly; it writes a short-lived field with `Math.max` (`auraShield`, `auraHeal`,
`auraArmor`) and the *recipient's* own `tickStatus` spends it. Two sources set the same
field and the stronger one wins, and nothing has to remember to clean up when a source
dies or walks away. Vale's `mendaura` is also on the `HEAL_AURA` list, so healers still
never heal each other — a hero and a Patch Bot mending each other is the same closed loop
that once filled the population cap with immortal medics.

**2 · Palette.** Heroes are currently coloured from the race tint. A Rook in Gloop colours
needs a full nine-key palette or `softGlow` throws — see the comment on `raceFaceColors()`
in `renderer.js`, which is where this bit us before. The rule already adopted in
`heroIdleColors()`, which the in-match path must copy:

> **The hero owns `body` / `light` / `dark` / `trim` / `ink`.
> The race owns `steel` / `eye` / `opticRGB` / `psi`.**

The hero stays recognisably itself while the hardware reads as the right faction, and the
palette is built by mutating a known-complete object rather than assembled from scratch.

**3 · Spawn sites.** The three spawn calls read `rdef.hero`. They became
`this.heroFor(owner)`: the profile pick for a human seat (handed in by `setHeroPick`), and
for a bot the hero matching its personality via `RC.AI_PERSONA_HERO` — so the label the
player already saw on the pre-game screen is borne out by what walks onto the map, rather
than contradicted by a coin flip. Anything unrecognised resolves through `RC.resolveHero`
rather than throwing, which is also how a stored `warden` from an old save still lands on
Rook.

**4 · Summons.** See the `thornling` note above. Anything a hero creates must be as
race-free as the hero.

**5 · Art.** `drawUnitSprite()` in `renderer.js` dispatches on `u.type`. Rook, Thorn and
Prism inherit the existing `drawWarden` / `drawMatriarch` / `drawArchon` bodies directly;
Ember and Vale are two new draw functions in the same procedural style (`rrect` / `arc` /
`optic` against the nine-key palette). All five have `HERO_TINT` entries — without one,
`heroIdleColors()` falls back to Rook's tint and two heroes silently render identically.

Ember and Vale are drawn as opposites on purpose: Ember is squat and heavy with a long
barrel and the fire visible *inside* the body, Vale is tall and mostly empty space with a
lantern out front instead of a gun. A support you need to protect has to be findable in a
crowd at a glance.

---

## 5. Modes decide normalization

There is no single right answer for "should Mastery carry in", because Survival and a
ranked ladder want opposite things. So it is a per-mode decision, and it is the mode's job
to say so on the button.

| Mode | Mastery | Loadout |
| --- | --- | --- |
| Solo, Co-op, Survival, Daily, Crystal Guard, Campaign | full, uncapped | yours |
| **Public versus** | irrelevant — everything unlocked and pickable for everyone | free pick from the full pool |
| **Private / friend lobby** | host toggle, default **Level Sync** | yours, with substitution |

The grind therefore pays off across most of the game's content. Only the competitive slice
is flattened, and it is flattened **up** — everyone gets everything, nobody is missing tools.

**Public versus** shows the entire pool for your hero in the pre-game screen. A player on
their first match has the same menu as a player on their thousandth. This is the
League/Dota/Overwatch answer, it is boring on purpose, and it removes the matchmaking
constraint entirely.

**Friend lobby: Level Sync**, default on. The lobby computes
`syncTier = min(mastery over all human players)`. Picks unlocked at that tier are kept;
picks that are not are substituted for the nearest unlocked equivalent, and the lobby says
so plainly: *"Rift Mire → Wider Nova (synced to Ada's tier)"*. Silent substitution is worse
than the imbalance it fixes. The host can turn it off for a casual game; when off, each
player's Mastery shows next to their name.

Because Mastery grants no stats, **Level Sync off is not actually unfair** — one player
just has access to toys the other doesn't. That is a far smaller problem than a Mastery-30
hero with 30% more hp, and it is why this design can afford an "off" switch at all.

---

## 6. Stars — the currency

A Star payout at the end of **every** match, win or lose, spent on cosmetics only. Never
on power: the moment Stars buy stats, every balance guarantee in section 2 is void.

### Payout

```
finished the match                      +3
won                                     +5
survival: per 2 waves survived          +1   (cap +12)
peak Match Level reached, per 2 levels  +1   (cap +5)
crystal never dropped below half        +3
first finished match of the day        +10
                                        ─────
per-match cap                            30
```

Rules the formula has to satisfy, and why each clause is there:

- **Losing pays.** `recordMatchEnd()` already pays match XP on a loss for exactly this
  reason: a player who is only rewarded for winning stops playing the first time they meet
  an opponent they can't beat.
- **Performance is capped and shallow.** The gap between a great match and a poor one is
  about 2×, not 10×. A steep performance curve turns a cosmetic economy into a
  skill-gated one, and the players who most need a reason to come back are the ones losing.
- **The daily bonus is the biggest single line.** Returning tomorrow should beat grinding
  tonight. This is the clause that does the retention work.
- **Nothing scales with match length.** Otherwise the optimal play is to stall a won game,
  which is the single most corrosive incentive an RTS economy can have.
- **Practice and tutorial matches pay nothing** — `recordMatchEnd()` already returns early
  on `game.practice`, so this is free.

Rough pricing, tuned so a first cosmetic lands within two or three sessions:
palette 25★ · hat 40–90★ · shoes 40–90★ · costume 90–250★.

### Where it lives

```js
riftclash_wallet = {
  stars: 340,                                  // spendable balance
  earned: 1180,                                // lifetime, for achievements
  owned: ['hat.crown', 'suit.ranger', 'shoe.tread', 'pal.ember'],
  daily: 20364,                                // UTC day number of the last daily bonus
}
```

Paid out inside `RC.Profile.recordMatchEnd()`, which is already the one function that
knows a match ended and is already called from exactly one place (`main.js:2123`).
Extend its return value to `{ profile, xpGained, levelUp, unlocked, stars, starLines[] }`
so the end screen can show the payout **itemised** — "+5 won, +3 crystal held, +10 first
today". A number that appears with no breakdown teaches the player nothing about what to
do again next match.

---

## 7. Cosmetics — hat, costume, shoes, palette

**Inventory is shared across the account. Equipment is per hero.** Buy the crown once;
decide separately whether Rook or Vale wears it. This is the setting that lets all five
heroes look like someone's without demanding five times the Stars, and it means every
purchase stays useful after the player switches favourites.

### The rule: unlock, never auto-replace

A level-up must not silently change how the hero looks. If Rook becomes something else at
Mastery 10 without asking, the player loses the version they liked at 5, and a reward that
takes something away reads as a punishment. Levelling and buying drop new options **into
the drawer**; the player decides what to wear. Same principle as the loadout — breadth,
not replacement.

The cost of that rule is that a freely-chosen look no longer signals progress. Pay it back
with a marker that is *not the hero itself*: the plate under the menu hero, or the ring it
stands on.

### How it renders — one item, five heroes

The heroes are not sprite sheets. `drawWarden` / `drawMatriarch` / `drawArchon` build the
whole unit procedurally out of `rrect` / `arc` / `visorSlit` calls against a nine-key
palette, and all three go through `drawUnitSprite`, so a change lands in the menu, the
selection portrait and the match at once.

The mistake to avoid is writing a hat into each hero's draw function: five heroes × three
slots × N items is a combinatorial trap, and it is why most procedural cosmetic systems
die at item eight. Instead, each hero has a **rig** — a handful of anchor points in the
hero's own local space, in units of `R`:

```js
HERO_RIG.rook = {
  head:  { x, y, r },           // where a hat sits and how big
  torso: { x, y, w, h },        // the box a costume is laid over
  feet: [{ x, y, r }, ...],     // one entry per foot — Thorn has six
}
```

Cosmetic items are then **generic draw functions of a rig anchor plus the palette**, and
one hat draws correctly on all five heroes for free. `drawMenuWave()` already works this
way — it is drawn over the sprite rather than inside each hero — so the pattern was
already established in the file.

**Shipped differently from the plan:** the rig is a lookup table beside the draw
functions, not a value each draw function returns. `drawUnitSprite` runs for every unit
every frame, and allocating an anchor object per sprite per frame to serve the handful
that are wearing anything is a poor trade. The anchors are converted to pixels once, in
`drawCosmetics`, so no item function ever has to remember to multiply by `R`.

`drawCosmetics` is called twice around the body — `'under'` for the costume, `'over'` for
shoes and hat — so a cloak sits behind the hero and a crown in front of it, from one
function rather than two that could drift apart about which slot draws when.

Three tiers, cheapest first:

**Palette swaps — effectively free.** The hero/race colour split is already enforced by
`heroIdleColors()`. A skin is one object. Recolouring the optic alone changes Rook's whole
read — a hot red visor and a cold blue one are different characters for zero draw code.

**Rig-anchored items — the bulk of the shop.** Hats, boots, capes, shoulder pieces. One
function each, drawn at the anchor, scaled by `R`. This is where the effort belongs.

**Feature parameters — cheap and high-impact.** Each hero's identity features are already
loops driven by constants (crest count, horn count, plate count). Promote those to
cosmetic values and a five-horn Thorn or six-plate Prism becomes a config entry — real
silhouette change, no new geometry.

### The trap: ownership must stay readable

In an RTS a player has to tell their units from the enemy's instantly, and player colour
plus race tint are what does that today. Give players free rein over colour and someone
will build a Rook that reads as the opponent's.

So cosmetics must not touch the channels carrying ownership. Either restrict skins to
accent channels only, or let them run at full strength on the menu and clamp them toward
player colour in-match.

**Decided before the first skin shipped**, which is what mattered: retrofitting the
constraint later means invalidating cosmetics players have already earned, and that is the
one class of change players genuinely resent.

It lives in `applyCosmeticPalette(c, cos, strength)`, and `strength` is the whole rule in
one argument. `heroIdleColors` passes **1** — on the menu there is no enemy to be confused
with, so the skin is exactly the colour the player bought. `unitColors` passes
`RC.COSMETIC_SAFE` (0.55), so in a match the same skin is blended only part of the way
from the player's colour. Applied inside `unitColors` rather than at each call site, so
the battlefield, the portrait and every other in-match path get the clamp and none of them
can forget it.

One more guard on the way out: `Profile.cosmeticsOf` filters what a hero is wearing
through what the wallet actually owns. `equip()` already refuses an unowned item, so in
normal play it never fires — it fires when the save and the wallet disagree, which happens
if someone edits localStorage or if we retire an item players had equipped. It filters on
**read** rather than repairing the save, so pulling an item from the shop temporarily is
not the same as confiscating it.

---

## 8. The start screen and the Hero Bay

### Start screen — the hero is the front page

`#hero-stage` already renders the picked hero idling and waving. It gains, directly under
the canvas:

- **A five-hero toggle row.** Five small portraits; clicking one switches the pick,
  re-renders the stage instantly, and writes `riftclash_hero`. Each shows its own Mastery
  badge, so the row itself shows what the player has invested in.
- **A Mastery bar** under the name plate, with "Mastery 12 · next unlock at 14".
- **The Star balance**, top-right of the stage, next to a shop entry point.

The hero the player is looking at when they press Play is the hero they deploy. No separate
confirmation step — the front page *is* the pick.

### Hero Bay — four sections

**Hero** — the five as cards, with the menu-hero animation as the preview for the selected
one. Mastery, next unlock, and lifetime record with that hero.

**Loadout** — five slots: Q, E, R and two upgrade sockets. Each opens a drawer of
everything unlocked for it, **with locked entries visible and greyed, showing the Mastery
level they arrive at.** Seeing what you don't have yet is most of the pull; a drawer that
fills up silently gives a player nothing to want.

**Wardrobe** — hat / costume / shoes / palette for the selected hero, drawn from the shared
inventory, applied to the menu hero immediately so the change is felt before the next
match. Unowned items shown with their Star price.

**Talents** — the long tail. A small fixed pool of points, **the same for everyone at every
Mastery**, spent on flavour: +cast range vs +cast radius, energy regen vs bigger energy
pool. Respec is free and instant; charging for respec punishes exactly the experimentation
the tab exists to encourage.

Rules that keep the Bay honest:

- Every slot has a default. A player who never opens the Bay gets a sane hero.
- The point pool never grows with Mastery. Only the menu you spend it from grows.
- Changes save immediately and apply to the *next* match, never mid-match.

---

## 9. Data model

Client, `localStorage`, alongside `riftclash_profile`:

```js
riftclash_hero   = 'rook'                      // current pick, read through RC.resolveHero
riftclash_heroes = {
  rook:  { mastery: 12, xp: 3140, matches: 61, wins: 38,
           cosmetics: { hat: 'crown', suit: 'plate', shoes: 'tread', palette: 'gold' } },
  thorn: { mastery: 3, xp: 240, ... },
  prism: { ... }, ember: { ... }, vale: { ... },
}
riftclash_wallet = {
  stars: 340,          // spendable
  earned: 1180,        // lifetime, for achievements later
  owned: ['hat.crown', 'suit.plate', ...],     // SHARED across all five heroes
  daily: 20364,        // UTC day number of the last daily bonus
}
```

`loadout` and `talents` are not in the shape yet — they arrive with §10 step 8. Everything
above falls back to a blank default the way `Profile.get()` already does, so a player who
played before this shipped keeps their record and starts every hero at Mastery 1.

All five keys exist from the first launch — there are no locked heroes, so a missing key
means "never played", not "not owned". Every field falls back to a blank default exactly
the way `Profile.get()` already does, so a player who played before this shipped keeps
their record and simply starts every hero at Mastery 1.

**Mastery XP is awarded to the hero the player actually deployed**, inside
`recordMatchEnd()`, using the same "losing still pays" rule as profile XP.

**Server authority.** `server.js` runs the authoritative 30 Hz simulation, so the server is
the authority on anything a client could lie about. A client claiming "my hero is Mastery 30" is claiming an *unlock set*, not
a stat, so the worst case is cosmetic plus access to a variant it hasn't earned — but the
lobby should still validate the claimed loadout against the claimed Mastery and substitute
anything inconsistent, exactly as Level Sync does. **Client-side locking is explanation,
never enforcement.**

---

## 10. Build order

Each step was shippable on its own and left the game in a working state. Steps 1–7 are
done; each is marked with the tests that hold it up.

1. ~~**Menu hero.**~~ `Renderer.drawHeroIdle` + `#hero-stage`, reading a stored pick.

2. ~~**Decouple.**~~ The pick left `RC.RACES`; `Game.heroFor(owner)` replaced `rdef.hero`
   at all three spawn sites; the aura non-stacking rule; the split palette; the neutral
   `thornling`; warden/matriarch/archon renamed to rook/thorn/prism with `RC.HERO_ALIAS`
   so an old stored pick still resolves.
   *Held by:* `roster_test` — all five heroes spawn with all three factions, a Prism in an
   Aether army does not double-dip the shield aura, no faction can build a thornling.

3. ~~**Two new heroes.**~~ Ember and Vale: unit defs, `HERO_TINT`, two draw functions, and
   the one genuinely new mechanic — `Game.hazards` + `_tickHazards`, which Rook's banner
   and Vale's sanctuary then reused.
   *Held by:* `roster_test` — the fire burns enemies and never allies, Flare's amp reaches
   the tower/ability damage path, Mend Pulse repairs buildings, Slipstream cleanses,
   Sanctuary's save fires once and then lets go.

4. ~~**Persist.**~~ `riftclash_heroes`, Mastery XP paid in `recordMatchEnd` on a loss as
   well as a win, Mastery under the menu hero.
   *Held by:* `roster_test` — Mastery survives a reload, and a Mastery-30 hero and a
   Mastery-1 hero have identical hp, armour, damage and ultimate.

5. ~~**Toggle.**~~ The five-hero row, per-hero Mastery badges, instant re-render.
   *Held by:* `heroui_test` — five cards in roster order in a real browser, clicking one
   persists the pick, and that hero is the one that spawns.

6. ~~**Stars.**~~ Wallet, payout in `recordMatchEnd`, itemised on the end screen.
   *Held by:* `roster_test` — pays on a loss, the daily bonus lands exactly once per UTC
   day, and a 500-wave run is still capped.

7. ~~**Cosmetics.**~~ `HERO_RIG` anchors, generic hat/suit/shoes layer, the wardrobe,
   per-hero equipment against a shared inventory, and the ownership clamp.
   *Held by:* `heroui_test` and `roster_test` — buying does not silently dress anyone, the
   same crown fits a second hero for free, and an equipped-but-unowned item does not render.

**Still to build:**

8. **Hero Bay + Loadout.** Skill variants per slot, `sig.ups` widened from three to six
   with two brought, substitution logic, then Level Sync in the lobby and
   full-pool-unlocked in public versus (§5).

9. **Talents.** The long tail, added continuously.

Note what steps 2–7 already buy without any of step 8: five heroes, an identity, a number
that grows and something to spend it on — which is most of the retention, at none of the
balance risk.

### Two things step 8 will have to deal with

- **`RC.MASTERY` unlocks nothing yet.** Mastery is currently a number that grows and gates
  nothing, because the things it is meant to gate (variants, the sixth and seventh `ups`)
  do not exist. That is honest as far as it goes, but it is a promise the UI is already
  making — "next unlock at 14" has nothing behind it until step 8 lands.
- **Online seats carry the pick, but nothing validates the LOADOUT yet.** The client
  sends `{t:'hero'}` on connect and on every change, and the server passes it through
  `RC.resolveHero` before storing it — a client can send anything, and an unknown id has
  to become the default at the door rather than at the spawn site. Once loadouts exist,
  the lobby must validate a claimed loadout against a claimed Mastery and substitute
  anything inconsistent, exactly as Level Sync does (§5). Client-side locking is
  explanation, never enforcement.

---

## 11. If we ever do want real power to carry in

We decided not to (section 2). If that changes, do **not** just let the numbers diverge —
add these four levers at the same time and cap the total spread at about **10%**:

1. **XP catch-up.** In-match hero XP rate scales with the Mastery gap, so the weaker hero
   reaches Match Level 10 by roughly minute six. The advantage becomes early *tempo*, which
   is recoverable, instead of a ceiling, which is not.
2. **Bounty.** Killing a higher-Mastery hero pays more shards and more signature charge.
   Being stronger should make you a bigger prize.
3. **Shard handicap.** The lower player starts with extra shards per tier of gap. This is
   the right lever for an RTS specifically: economy converts into army, so a hero gap gets
   paid back as an army gap in the other direction.
4. **Revive tax.** Higher Mastery costs more to revive. `revive.cost` /
   `revive.costPerLevel` already exist on every hero def, so this is nearly free to build.

Ten percent is deliberate: large enough that a player feels their progress, small enough
that it loses to a better opening.
