# RIFT CLASH — project handoff

Updated 26 July 2026. Paste this into a new chat to pick the project up cold.

Source of truth on disk: `C:\Users\sungh\Documents\rift-clash\files\`

---

## Standing instructions — please keep following these

1. **Every code update ends with a GitHub commit message.** Not optional. Write it
   as a real commit message: a subject line, then a body explaining *why*, with the
   measured numbers where there are any.
2. **Be honest, including about your own work.** When asked for an opinion, give the
   real one and push back. If a test passed for the wrong reason, say so. If a change
   you made turned out not to help, say that too and revert it rather than shipping it
   with a nice-sounding comment. This has happened more than once and it mattered.
3. **Deliver every changed file with `SendUserFile`, then write it back to the device**
   with `device_commit_files` to `~/Documents/rift-clash/files/`. Both steps, every time.
4. **Prove changes with tests that fail on the old code.** A test that passes before
   and after proves nothing. Several times the first version of a test was checked
   against the pre-fix code and turned out to be testing nothing — that has to be
   caught, not glossed over.

---

## What the game is

A browser RTS. Plain HTML5 canvas plus vanilla JS: **no build step, no npm
dependencies, nothing to compile**. Everything hangs off `window.RC`. The server is
zero-dependency Node — static files, a hand-rolled RFC6455 WebSocket, an
authoritative 30 Hz simulation, and a small leaderboard REST API.

Script load order in `index.html` matters; modules assume their dependencies already
exist. `config.js` is first.

### Files

| file | what it is |
|---|---|
| `config.js` | Every balance number. 27 units, 3 factions, all buildings, zoom band, pop cap |
| `entities.js` | Unit and Building classes: combat, auto-engagement, abilities, heroes |
| `game.js` | The sim. Owns players, resources, supply, vision, survival hookup, the run log |
| `renderer.js` | All drawing. Camera transform, terrain, units, fog, minimap, illusions |
| `input.js` | Mouse, touch, keyboard, camera, zoom, selection, orders |
| `ai.js` | Per-owner AI: economy, production, attack waves, survival defence |
| `survival.js` | Wave composition, difficulty curve, spawn cadence, the pacing floor |
| `net_core.js` | Shared netcode: command application, snapshot serialize/apply |
| `server.js` | Static server, WebSocket, rooms, presence, invites, chat, voice relay, reconnect, leaderboard |
| `net.js` | Browser WebSocket client with automatic reconnection |
| `main.js` | Entry point, start screen, lobby, nickname, chat, resume, deep links |
| `ui.js` | HUD, command panel, selection panel, hero skill panel, end screen |
| `voice.js` | WebRTC mesh voice chat, per-player mute |
| `maps.js` | Six planets |
| `privacy.html`, `terms.html` | Privacy policy and terms, linked from the start screen |
| `fullscreen.js`, `share.js`, `dev.js`, `daily.js`, `audio.js`, `pathfind.js`, `leaderboard.js` | as named |

Six maps: Earth, Scorch, Pluto, Mars (`rust`), Jupiter (`storm`), Saturn (`ring`).

---

## Invariants — breaking any of these breaks the game quietly

- **Per-room isolation.** AI memory lives on `game._ai`, survival state on `game._sv`,
  and `RC.CFG.WORLD_W/H` are set per room per tick. **Never put mutable game state in
  module scope** — the server runs several rooms in one process and they would share it.
- **The client is not trusted.** Leaderboard runs must be OPENED with the server
  (`/api/run/start`) and their pacing is checked on submit; the Daily Challenge day is
  stamped server-side.
- **The pacing floor lives in `survival.js`, not the server.** `RC.Survival.minSpacing()`
  is built from that file's own `SPAWN_STEP` and `GAP`. The server used to keep copies of
  those constants with a "must match survival.js" comment; that is exactly the duplication
  that drifts. Do not re-introduce it.
- **Cosmetic client state must never touch the sim.** Screen shake shifts the drawn
  frame, not `g.camera`. Zoom lives on `g.camera.z` and the server never reads the
  camera at all.
- **The dev-mode passcode must never appear in plaintext in any served file.** Only
  the FNV-1a hash: `CODE_HASH = 1028267028`. (Dev mode is offline-only, and a
  fast-forwarded run can no longer reach the world board — the wall-clock check refuses it.)
- **`net_core.js` runs on both sides.** Any wire-format change is automatically
  consistent between server and client because they load the same file — but it means
  a half-deployed change breaks everything. Deploy server and client together.
- **`server.js`, `package.json`, `scores.json` and `tests/` are never served.** If you add
  something that must not reach players, add it to `PRIVATE_FILES` / `PRIVATE_DIRS`.

---

## Tests

```bash
npm test              # everything
npm run test:sim      # headless only, no browser needed
npm run test:browser  # real Chromium, real WebSockets, real WebRTC
```

**2,158 checks across 16 suites, all passing** as of this handoff.

| suite | checks | covers |
|---|---|---|
| `wavecheck.js` | 791 | Survival difficulty curve, daily twists, seeded reproducibility |
| `simtest.js` | 70 | Full survival runs on every difficulty and twist |
| `sighttest.js` | 86 | Per-unit sight, auto-engagement, the leash, the survival ally |
| `reachtest.js` | 105 | Every ground unit can damage every building |
| `planettest.js` | 628 | All six maps: spawn clearance, reachability, netcode |
| `hardentest.js` | 59 | **Pure Node.** Abuse limits, leaderboard run tokens + pacing (incl. all 7 daily twists), reconnect, chat, voice policy, DATA_DIR |
| `lobbytest.js` | 38 | Presence and invites over a real server |
| `uitest.js` | 63 | Nickname, pause toggle, end-match dialog, invites |
| `devtest.js` | 30 | Dev mode off by default, gated behind the credit taps |
| `touchtest.js` | 17 | Two-finger-only camera on tablets |
| `fstest.js` | 28 | Fullscreen default, toggle, remembered opt-out |
| `voicetest.js` | 72 | Two browsers on a real WebRTC call with audio flowing |
| `sharetest.js` | 57 | Share card renders, `?join=` deep link works |
| `herotest.js` | 39 | Heroes in every mode including online |
| `zoomtest.js` | 39 | Wheel + pinch zoom, anchoring, clicks while zoomed, pop cap |
| `resumetest.js` | 36 | Reconnect banner + auto-rejoin, refresh mid-match, chat UI, voice defaults, the typing guard |

Every suite drives the **real** modules — nothing reimplements game logic. Each
browser suite starts its own server on its own port (`8xxx + process.pid % N`) so
they can run in any order. Each has a `requirePlaywright()` shim that exits 0 with a
SKIP line when Playwright is absent, so `npm test` still works on a bare machine.
`hardentest.js` needs no browser at all.

Playwright/Chromium in this environment: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Never run `playwright install`.

Non-determinism note: the sim uses `Math.random`, so survival outcome checks vary
run to run. `sighttest.js` had a 1-in-20 flake that turned out to be a **real bug**,
not test noise. If a sim assertion fails intermittently, sample it 40+ times before
dismissing it.

---

## Bugs found and fixed (all were live in shipped code)

Worth reading — these are the shapes of mistake this codebase makes.

- **Melee units could not damage buildings at all.** Reach was measured off the
  bounding radius while collision used the rectangle. 24 of 105 unit/building pairs.
- **Both Pluto 1v1 spawns sat inside the Deep Snow band**, so every Pluto match had
  both players permanently at 55% move speed in their own base.
- **The Skyfall daily twist did the opposite of its description**, delaying every unit
  type six waves instead of bringing air units early.
- **Dev mode re-enabled itself on every page load** from a localStorage flag.
- **Hero level, xp and cooldowns were never serialized**, so online clients saw every
  hero as level 1. Heroes were also switched off in online matches entirely.
- **The Survival ally never defended the Rift Crystal.** About 1 run in 20 died on
  wave 1 with a full allied army standing in its own base.
- Tablet couldn't hear PC: the iOS audio unlock left a silent WAV in `el.src`.
- Lobby section toggles never worked: inline `display:flex` with no `.hidden` CSS rule.
- **The world leaderboard accepted a bare POST.** One request could put the maximum
  possible score (1,050,000) on the board, and because only a HIGHER score replaces a
  name's row it could never be displaced. See below.
- **The server never answered a WebSocket close frame.** A browser that closed cleanly
  sat in `CLOSING` until its own timeout, so its `onclose` never fired. Invisible until
  there was a reconnect that depended on it — and then it silently stopped the client
  from ever noticing it had dropped.
- **Keys typed into a text field were also fed to the game as hotkeys.** Typing "pause"
  pressed P, A, U, S, E. Latent while there was nothing to type into; a launch blocker
  the moment chat existed.

---

## Feature history, in build order

Passive-income/virality advice → survival difficulty curve reshaped → per-unit sight
with auto-engagement and a leash → pause/play toggle, stop→restart-or-quit dialog,
online presence with invites and nicknames → three new planets → a full weather system,
**built then removed on request** → unit-stop button removed → WebRTC voice chat →
dev mode gated behind five taps plus a passcode → icons, manifest, Open Graph card →
share card and `?join=CODE` deep link → touch camera confined to two fingers →
fullscreen by default → heroes enabled online → pop cap 100 + zoom → **launch-safety
pass: reconnect, leaderboard integrity, server hardening, voice policy, text chat,
privacy policy and terms.**

### The launch-safety pass in detail

**Reconnect.** The server holds a dropped seat for 90 seconds (`RESUME_GRACE_MS`),
running its army with the AI in the meantime, and hands it back on proof of a token
issued at match start. The client keeps that token in `sessionStorage`, so a refresh or
an accidental back-navigation rejoins too, and `net.js` retries on a backoff by itself.
A room with no clients keeps ticking while any seat is still reserved; a sweeper releases
expired seats and cleans up.

**Leaderboard integrity.** A run is opened with `POST /api/run/start`, which returns an
HMAC-signed single-use token with a 6-hour TTL. On submit the server checks the token,
then checks the wave log: wave N cannot start before wave N−1 has finished spawning plus
the between-wave gap (`RC.Survival.minSpacing`), and the run cannot claim more game time
than has passed on the wall clock since the token was issued. Online co-op runs are
simulated by the server, so it issues its own backdated token with its own wave log.
The daily twists that change wave size or the gap (Blitz cuts it to 30%, Elite Guard
shrinks the waves) are reconstructed for the day the run was *started* on — a fixed floor
rejected honest runs on two days in seven, and `hardentest.js` checks all seven.

**Persistence.** `DATA_DIR` points the score file at a persistent volume. Without it the
server logs `[not persistent — set DATA_DIR]` at boot.

**Server hardening.** Declared frame length and buffered bytes are both bounded (a 4 GB
declared frame used to be buffered until the process died); per-socket message token
bucket; caps on total sockets, sockets per IP, total rooms, rooms per client, room
creation rate, queued commands and chat rate; `Origin` check on the upgrade;
`server.js`, `package.json`, `scores.json` and `tests/` are no longer served.

**Voice policy.** Auto-join is now **private and invited rooms only** — a public room is
strangers, and a live microphone is not something to hand strangers uninvited. Per-player
mute (local, private, survives a peer reconnecting), and a host switch that turns voice
off for a whole room.

**Text chat.** Lobby panel and an in-match overlay (Enter opens, Esc closes), relayed by
the server to the room only, control characters stripped, rate limited. Not stored.

### Earlier, still true

**Population cap 30 → 100.** CPU was never the problem. Bandwidth was: `net_core.js` was
slimmed first — type ids and unit states travel as integers, and any field at its default
is omitted. **155 → 78 bytes per unit, a 51% cut, loss-free.**

**Zoom.** `g.camera.z`, client-only, preserved across `reset()`. `ZOOM_MIN 0.72`,
`ZOOM_MAX 1.30`. **Every world-space pass culls against the world span (`canvas / zoom`),
not the canvas size** — miss one and an unpainted band appears down the right-hand side.

Also tried and **reverted**: widening the AI's supply buffer for the higher cap. Zero
gain across 8 AI-vs-AI runs — the AI is gated on shard income, not the buffer.

---

## Open items, most important first

1. **The AI cannot play.** `AI_WORKER_CAP` is 8 regardless of the 100 pop cap. Measured
   over a 20-minute AI-vs-AI match: never a ninth worker, 5–70 shards for the entire
   game, **zero upgrades researched** (the research branch needs 200 spare shards it
   never has). Across 42 AI-vs-AI 1v1s every single match was decided between 243 s and
   650 s, median ~285 s — the air tier, the upgrade tree and hero levels 6–10 are content
   the opponent never reaches. Fix by scaling the AI constants off a difficulty preset the
   way `survival.js` already does with its `DIFF` table, and let the AI expand to a second
   shard cluster. Prove it with old-AI vs new-AI, 20 runs.
2. **Snapshot compression.** The WebSocket does not negotiate `permessage-deflate`.
   Measured at 420 units: snapshot **32.2 kB raw → 4.4 kB deflated (13.6%) at 0.56 ms**,
   i.e. **482 kB/s → 66 kB/s per client**, or 1.9 MB/s → 264 kB/s for a full 2v2 room.
   Compress once per snapshot and write the same buffer to every socket (the broadcast
   already frames once — see `broadcastSnapshot`). This is a bigger win than delta
   encoding and does not change the wire format.
3. **The tick is O(n²).** At 420 units a full `update()` is 6.56 ms, of which
   `findNearestEnemy` across all units is **4.91 ms**. `separate()` is 0.99 ms,
   `serialize()` 0.08 ms. A uniform spatial grid bucketed by owner (the `VIS_CELL` grid is
   the model) turns each query from "scan every unit" into "scan nine cells".
4. **No counter system.** Every unit can shoot every unit; only towers gate air
   (`def.air`), so a melee Globling attacks a Hoverwing. Damage is `max(1, dmg − armor)`
   with no damage or armour types. "Build more of the cost-efficient thing" beats reading
   what the opponent built.
5. **RTS quality of life.** No shift-queued orders, no double-click to select all of a
   type, only four control groups with no double-tap-to-centre, no select-all-army, no
   surrender, no idle-worker count.
6. **The Daily Challenge is buried** inside the Survival tab. It is the best retention
   hook in the game and should be on the front page every day.
7. **No analytics of any kind**, so there is no way to know how many people open the
   link, press Start, or finish a first match.
8. **iOS-specific voice fixes have never run on real hardware.** Playwright's WebKit is
   not iOS Safari. Everything there is reasoned, not proven.
9. **The privacy policy and terms carry a `[add a contact email before launch]`
   placeholder** in both files. Replace it before the link goes public.

---

## Environment notes

- `POP_CAP: 100`, `WORLD_W: 3200`, `WORLD_H: 2400`, `TILE: 40`.
- Zoom keys `+` `-` `0`; camera `arrows`; `space` = own core; `f` = idle worker;
  `h` = hero; `a` = attack-move; `p` = pause; `1`–`4` = control groups;
  `Enter` = chat (online), `Esc` closes it.
- Server env: `PORT`, `DATA_DIR`, `RUN_SECRET`, `ALLOWED_ORIGINS`. See `PUBLISH_GUIDE.md`.
- Dev mode: five taps on `#ss-credit`, then the passcode. Never persisted — it lasts
  for one page load. The `?dev=` URL back door was removed.
- Voice: STUN only, no TURN. Lower client id offers, to avoid SDP glare.
