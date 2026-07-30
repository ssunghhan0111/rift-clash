# Hero redesign — persistent heroes without broken matchmaking

Status: **design agreed, not yet built.** The start-screen hero (`Renderer.drawHeroIdle`)
is the only piece that has shipped. Everything below is the plan the rest of the work
follows.

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
> Playing more gives you *more things to pick from*. It never gives you *more points to
> spend* or *bigger numbers*.

A veteran and a rookie both bring one Q, one E, one ultimate and two upgrade slots into
every match. The veteran has thirty options to fill those five slots from; the rookie has
eight. The veteran's advantage is knowing which five to pick — which is knowledge, not
stats, and knowledge is what we actually want to reward.

---

## 2. Three buckets

Everything a hero has today gets sorted into exactly one of these. The middle column is
the whole answer to "how do we balance different levels".

| Bucket | Persists between matches? | Changes hp / dmg / armor? |
| --- | --- | --- |
| **Mastery** — 1–30, per hero. Unlocks skill variants, ultimate upgrade cards, cosmetics, hero slots | **yes** | **no** |
| **Loadout** — which Q, which E, which 2-of-3 ultimate upgrades you bring | **yes** (it's a saved choice) | **no** — sidegrades on an equal budget |
| **Match Level** — 1–10, today's `RC.HERO` system, XP from nearby kills | **no, resets every match** | **yes — this is the only thing that does** |

Match Level stays exactly as it is now: `RC.HERO.xpBase/xpStep/killXp`, `def.grow`,
upgrades at `RC.HERO.upLevels = [3, 6, 9]`. Every hero in every match starts at level 1
and climbs on its own merits. That is already a good system and it is already balanced —
we are not touching it.

Mastery is a **new, separate number** that lives in the profile and never enters the
simulation. `Unit` should not be able to read it. If a reviewer can find a code path from
Mastery to a stat, the design has been violated.

### What Mastery actually unlocks

Roughly one unlock every two levels, so there is always a next thing:

- **Skill variants.** A second Ground Slam that trades damage for a longer leap. A Venom
  Spray that trades the puddle for an instant hit. Same energy cost, same cooldown, same
  power budget — a different *shape*.
- **Ultimate upgrade cards.** Today each hero has exactly three (`sig.ups`) and you get
  all three by level 9. Widen this to six or seven per hero and let the player bring
  **two**. Now "Bulwark" is a build, not a script.
- **Cosmetics.** Palettes, trails, victory poses, a title under the name plate. Zero
  balance cost, high retention value, and the menu hero is already a display case for it.
- **Hero slots.** Start with one hero, unlock the second and third. Mastery is per hero,
  so switching means starting that hero's *options* over — but never your *power*.

---

## 3. Modes decide normalization

There is no single right answer for "should levels carry in", because Survival and a
ranked ladder want opposite things. So it is a per-mode decision, and it is the mode's
job to say so on the button.

| Mode | Mastery | Loadout |
| --- | --- | --- |
| **Solo, Co-op, Survival, Daily, Crystal Guard, Campaign** | full, uncapped | yours |
| **Public versus** | irrelevant — everything unlocked and pickable for everyone | free pick from the full pool |
| **Private / friend lobby** | host toggle, default **Level Sync** | yours, with substitution |

Note what this buys: **the grind pays off across most of the game's content.** Survival,
the Daily, the campaign and Crystal Guard are where a player spends the majority of their
time, and in all of them the hero is fully theirs. Only the competitive slice is flattened,
and it is flattened *up* — everyone gets everything, nobody is missing tools.

### Public versus: flat, and flat upward

In a public match, the pre-game screen shows the **entire** pool for your hero and you
pick five slots freely. A player on their first match has the same menu as a player on
their thousandth.

This is the League/Dota/Overwatch answer and it is boring on purpose. It also removes the
matchmaking constraint entirely — we never have to bracket by hero level, which matters a
lot when the online population is small and any extra bracketing means longer queues.

### Friend lobby: Level Sync

Default on. The lobby computes `syncTier = min(mastery over all human players)` and every
player plays as if they were at that tier:

- Loadout picks that are unlocked at `syncTier` are kept as-is.
- Picks that are **not** yet unlocked at that tier are substituted for the nearest
  unlocked equivalent, and the lobby says so plainly: *"Rift Mire → Wider Nova (synced to
  Ada's tier)"*. Silent substitution is worse than the imbalance it fixes.

The host can turn Level Sync off for a casual game. When it is off the lobby shows each
player's Mastery next to their name, so nobody is surprised.

Because Mastery grants no stats, **Level Sync off is not actually unfair** — it just means
one player has access to toys the other doesn't. That's a much smaller problem than a
level 30 hero with 30% more hp, and it is why this design has a safe "off" switch at all.

---

## 4. If we ever do want real power to carry in

We decided not to. If that changes, do **not** just let the numbers diverge — add these
four levers at the same time, and cap the total spread at about **10%**:

1. **XP catch-up.** In-match hero XP rate scales with the Mastery gap, so the weaker hero
   reaches level 10 by roughly minute six. The advantage becomes early *tempo*, which is
   recoverable, instead of a ceiling, which is not.
2. **Bounty.** Killing a higher-Mastery hero pays more shards and more signature charge.
   Being stronger should make you a bigger prize.
3. **Shard handicap.** The lower player starts with extra shards per tier of gap. This is
   the right lever for an RTS specifically: economy converts into army, so a hero gap gets
   paid back as an army gap in the other direction.
4. **Revive tax.** Higher Mastery costs more to revive. `revive.cost` /
   `revive.costPerLevel` already exist in each hero def, so this is nearly free to build.

Ten percent is deliberate: large enough that a player feels their progress, small enough
that it loses to a better opening.

---

## 5. The Hero Bay tab

A fourth top-level destination on the start screen, beside the game modes. Four sections:

**Hero** — the three heroes as cards, with the menu-hero animation as the preview for the
selected one. Shows Mastery, next unlock, and lifetime record with that hero.

**Loadout** — five slots: Q, E, R, and two upgrade sockets. Each slot opens a drawer of
everything unlocked for it, with locked entries visible and greyed showing the Mastery
level they arrive at. **Seeing what you don't have yet is most of the pull** — an empty
drawer that fills up silently gives a player nothing to want.

**Talents** — the "add/subtract" surface. A small fixed pool of points (same for everyone,
always) spent on flavour: +cast range vs. +cast radius, energy regen vs. bigger energy
pool. Respec is **free and instant**. Charging for respec punishes exactly the
experimentation the tab exists to encourage.

**Cosmetics** — palettes and poses. Purely visual, applies to the menu hero immediately so
the change is felt before the next match.

Rules that keep the tab honest:

- Every slot has a default. A player who never opens the Bay gets a sane hero.
- The point pool never grows with Mastery. Only the menu you spend it from grows.
- Changes save immediately and apply to the *next* match, never mid-match.

---

## 6. Decoupling the hero from the race

Right now `RC.RACES[x].hero` binds warden→forge, matriarch→gloop, archon→aether, and
`matriarch` / `archon` carry a `race:` tag on their unit defs. `game.js` spawns
`RC.UNITS[rdef.hero]` in three places (start, versus setup, and Crystal Guard). Once any
hero can deploy with any race, three things need attention:

**Aura stacking.** `archon.passive` is `shieldaura`, and so is the Aether Ardent's. An
Archon in an Aether army double-dips. Same shape for `warden.passive.guardaura` against
any future armour aura. Fix: auras of the same `passive.id` do not stack — strongest
instance wins. This is a rule the sim should enforce generally, not a special case for
heroes.

**Palette.** Heroes are currently coloured from the race tint. A Warden in Gloop colours
needs a full nine-key palette or `softGlow` throws — see the comment on `raceFaceColors()`
in `renderer.js`, which is where this bit us before. The rule adopted in
`heroIdleColors()` and which the in-match path should copy: **the hero owns
body/light/dark/trim/ink, the race owns steel/eye/opticRGB/psi.** The hero stays
recognisably itself while the hardware reads as the right faction, and the palette is
built by mutating a known-complete object rather than assembled from scratch.

**Spawn sites.** The three spawn calls read `rdef.hero`. They become "the owner's chosen
hero", which for AI players is a pick (personality-flavoured is a nice touch — an
aggressive persona takes the Matriarch) and for humans comes from the profile.

---

## 7. Data model

Client, `localStorage`, alongside `riftclash_profile`:

```js
riftclash_hero    = 'warden'            // current pick — already read by main.js
riftclash_heroes  = {
  warden:    { mastery: 12, xp: 3140, loadout: { q:'slam',  e:'shock',  ups:['wide','shatter'] }, talents:{...} },
  matriarch: { mastery: 3,  xp: 240,  loadout: { q:'spray', e:'devour', ups:['many'] },           talents:{...} },
}
```

Mastery XP is awarded by `RC.Profile.recordMatchEnd()`, which already computes match XP
and already pays out on a loss — heroes should follow the same rule for the same reason.

**Server authority.** Per `CLAUDE.md`: the server is the authority on anything a client
could lie about. A client that reports "my hero is Mastery 30" is claiming an *unlock set*,
not a stat, so the worst case is cosmetic plus access to a variant it hasn't earned — but
the lobby should still validate the claimed loadout against the claimed Mastery and
substitute anything inconsistent, exactly as Level Sync does. Client-side locking is
explanation, never enforcement.

---

## 8. Build order

Each step is shippable on its own and leaves the game in a working state.

1. ~~**Menu hero.**~~ Done. `Renderer.drawHeroIdle` + `#hero-stage`, reading a stored pick
   with the race's hero as fallback, so the menu already reads from the future source of
   truth.
2. **Decouple.** Hero pick moves out of `RC.RACES`. Aura-stacking rule, split palette,
   three spawn sites. No new UI — the pick is still implicit. This is the risky change and
   it wants to land alone.
3. **Persist.** `riftclash_heroes` in the profile, Mastery XP on match end, Mastery shown
   on the menu under the hero. Still no loadout — Mastery is only a number and cosmetics
   at this point.
4. **Hero Bay, read-only.** The tab, showing hero, Mastery, unlocks earned and unlocks
   ahead. Nothing selectable yet. Ships the *pull* before the complexity.
5. **Loadout.** Slots become selectable. Widen `sig.ups` per hero from three to six.
   Substitution logic.
6. **Level Sync.** Lobby toggle, tier computation, visible substitution. Public versus
   switches to full-pool-unlocked at the same time.
7. **Talents and cosmetics.** The long tail, added continuously.

Steps 1–3 are worth doing even if the rest is never built: they give the hero an identity
and a number that grows, which is most of the retention, at almost none of the balance risk.
