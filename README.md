# RIFT CLASH

A browser-based real-time strategy game (StarCraft-style) built with plain HTML5 canvas and vanilla
JavaScript — no build step, no frameworks, no dependencies. Build a base, gather resources, grow an
army, and destroy the enemy. Play solo against AI or online against other people.

**▶ Play:** _paste your live link here after deploying, e.g._ `https://rift-clash.onrender.com`

Works in any modern browser and is touch-friendly for iPad and tablets.

---

## Features

- **Three factions**, each with a distinct look and playstyle:
  - **Forge** — machines. Worker, infantry, siege, air, transport and a full tech tree, with
    Patch Bot / Pulse Coil support. Angular metal aesthetic.
  - **Gloop** — an acid swarm. Combat units self-heal over time and their attacks stack **acid**
    (armor shred + damage-over-time), so it needs no dedicated healers. Organic, blobby look.
  - **Aether** — every unit carries a recharging plasma shield that soaks damage before health,
    and combat units **warp in at any forward Warp Conduit** instead of walking from base.
- **Heroes** — one per faction, gaining XP and levels through a match, with an ultimate that
  unlocks at level 6. Live in offline and online play alike.
- **7 shared upgrades** researched mid-game (reinforced rounds, alloy plating, overdrive, and more).
- **Tactical terrain** — high ground, forest cover, marsh, hollows and rift vents change a fight.
- **Fog of war** — per-player vision; enemy units and buildings are hidden in the dark.
- **Modes & maps** — 1v1 and 2v2 across six planets, co-op Survival against endless waves, and a
  **Daily Challenge** that is the same seed and twist for everybody.
- **An introduction film** — a wordless ~2:45 3D short that plays once, the first time a player
  names themselves, and is replayable any time from the start screen. It opens on why the Rift
  Crystal matters and what came through the tear, then gives each of the five heroes a chapter
  seen **from inside their own eyes**: their base, their workers, the buildings that make an army,
  the moment they point it at the enemy, and the ultimate they spend. No subtitles and no
  narration — only a name card per hero — so it needs no reading and no translation.
- **Online multiplayer** — an authoritative Node server runs the match for up to 4 players; empty
  seats are filled by AI. **A dropped player's seat is held for 90 seconds** and their client
  rejoins on its own — a refresh mid-match rejoins too.
- **Text chat** in the lobby and in the match, plus peer-to-peer **voice chat** with per-player
  mute and a host switch to turn voice off for a whole game.
- **World leaderboard** for Survival, per difficulty and for the daily. Runs are opened with the
  server and checked against the wave director's own pacing before they are accepted.
- Energy/abilities, minimap, control groups, camera pan and zoom, construction cancel + refund,
  and hover tooltips on every command.

---

## Running it

### Single-player (no server)
Open `index.html` in a browser and press **Start Battle**. It uses ordinary `<script>` tags (not ES
modules), so it even runs straight from `file://`.

### Online multiplayer (local network or hosted)
The included server serves the game files **and** runs the match:

```bash
node server.js            # optional: PORT=9000 node server.js
```

Then open the printed `http://<your-ip>:<port>` on each device on the same Wi-Fi and choose
**Online (LAN)**. The first player to join is the host and starts the match.

Only Node's standard library is used — there is nothing to `npm install`.

#### Server environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `DATA_DIR` | next to `server.js` | Where `scores.json` lives. On a host with an ephemeral filesystem this **must** point at a persistent volume or the leaderboard is wiped by every redeploy. |
| `RUN_SECRET` | random per boot | HMAC key for Survival run tokens. Set it in production, or runs opened before a restart cannot be posted after it. |
| `ALLOWED_ORIGINS` | same host as the request | Comma-separated origins allowed to open a WebSocket. The default is right for a single-domain deployment. |

See `PUBLISH_GUIDE.md` for click-by-click hosting instructions.

---

## Deploying online

Because the server reads the host's `PORT` automatically and the client uses secure `wss://` over
HTTPS, the whole project can be hosted as-is on any Node platform that supports WebSockets. See
**PUBLISH_GUIDE.md** for click-by-click instructions (recommended: Render's free tier). `package.json`
already defines the start command:

```json
"scripts": { "start": "node server.js" }
```

---

## Controls

**Mouse / keyboard**

| Input | Action |
|---|---|
| Left click / drag | Select unit(s) |
| Right click | Move · attack · gather · assist build (rally point when a building is selected) |
| Arrow keys / screen edge | Pan camera |
| Space | Jump to base |
| S | Stop · F | Find idle worker · P | Pause |
| Q / W | Train from selected building |
| Shift + click | Add to selection · place buildings continuously |
| Ctrl+1–4 / 1–4 | Set / recall control groups |
| Enter | Open chat (online) · Esc closes it |
| + / − / 0 | Zoom in · out · reset |
| H | Select hero · A | Attack-move |

Keys typed into a text box are never treated as game commands.

**Touch (iPad / tablet)**

- Tap to select, drag a box to select several.
- Tap the ground to move, tap an enemy to attack.
- Use the on-screen command buttons to build and train; press and hold a button to read what it does.
- Drag the minimap or screen edges to move the camera.

---

## Project structure

| File | Responsibility |
|---|---|
| `index.html` | DOM shell, CSS, start screen, lobby, script includes |
| `intro.js` | The introduction film — a ~2:45 real-time 3D short played once on first launch |
| `vendor/three.min.js` | three.js r149, vendored and loaded lazily by `intro.js` only |
| `config.js` | All balance numbers, colors, unit/building/race/upgrade definitions |
| `maps.js` | Map and game-mode definitions |
| `entities.js` | Unit / Building / resource nodes; combat, abilities, acid/regen, movement, gathering |
| `game.js` | Game state, economy, supply, placement, fog, win/lose logic |
| `ai.js` | Faction-agnostic enemy AI driven by each race's role map |
| `renderer.js` | All canvas drawing — sprites, fog, effects, minimap |
| `input.js` | Mouse / touch / keyboard → game commands |
| `ui.js` | HUD, selection panel, command buttons, tooltips |
| `main.js` | Entry point, start screen, offline start, online lobby, chat, reconnect, frame loop |
| `net_core.js` | DOM-free command/serialize/snapshot logic (shared by server + client) |
| `net.js` | Browser WebSocket client and command routing |
| `server.js` | Zero-dependency Node static server + WebSocket + authoritative 30 Hz simulation, abuse limits, leaderboard API |
| `privacy.html`, `terms.html` | Privacy policy and terms of service, linked from the start screen |

Everything is namespaced under the global `window.RC`.

---

## Architecture notes

- **Race system:** each faction defines a `core`, `worker`, buildable list, and an AI role map, so
  adding a faction is mostly data + sprites — the AI code needs no changes.
- **Online model:** the server runs the real game; clients send commands by entity id and render
  snapshots, each keeping its own selection, camera, and fog. Snapshots reuse entity instances by id
  so the renderer and UI stay unchanged online.
