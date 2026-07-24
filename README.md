# RIFT CLASH

A browser-based real-time strategy game (StarCraft-style) built with plain HTML5 canvas and vanilla
JavaScript — no build step, no frameworks, no dependencies. Build a base, gather resources, grow an
army, and destroy the enemy. Play solo against AI or online against other people.

**▶ Play:** _paste your live link here after deploying, e.g._ `https://rift-clash.onrender.com`

Works in any modern browser and is touch-friendly for iPad and tablets.

---

## Features

- **Two factions**, each with a distinct look and playstyle:
  - **Forge** — machines. 10 units (worker, infantry, ranged, air, transport, more) and a full tech
    tree of buildings. Angular metal aesthetic.
  - **Gloop** — an acid swarm. Combat units self-heal over time and their attacks stack **acid**
    (armor shred + damage-over-time), so it needs no dedicated healers. Organic, blobby look.
- **7 shared upgrades** researched mid-game (reinforced rounds, alloy plating, overdrive, and more).
- **Fog of war** — per-player vision; enemy units and buildings are hidden in the dark.
- **Modes & maps** — 1v1 and 2v2 (team) across 3 maps with randomized spawns.
- **Online multiplayer** — an authoritative Node server runs the match for up to 4 players; empty
  seats are filled by AI.
- Energy/abilities, minimap, control groups, camera pan, construction cancel + refund, and hover
  tooltips on every command.

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
| `config.js` | All balance numbers, colors, unit/building/race/upgrade definitions |
| `maps.js` | Map and game-mode definitions |
| `entities.js` | Unit / Building / resource nodes; combat, abilities, acid/regen, movement, gathering |
| `game.js` | Game state, economy, supply, placement, fog, win/lose logic |
| `ai.js` | Faction-agnostic enemy AI driven by each race's role map |
| `renderer.js` | All canvas drawing — sprites, fog, effects, minimap |
| `input.js` | Mouse / touch / keyboard → game commands |
| `ui.js` | HUD, selection panel, command buttons, tooltips |
| `main.js` | Entry point, start screen, offline start, online lobby, frame loop |
| `net_core.js` | DOM-free command/serialize/snapshot logic (shared by server + client) |
| `net.js` | Browser WebSocket client and command routing |
| `server.js` | Zero-dependency Node static server + WebSocket + authoritative 30 Hz simulation |

Everything is namespaced under the global `window.RC`.

---

## Architecture notes

- **Race system:** each faction defines a `core`, `worker`, buildable list, and an AI role map, so
  adding a faction is mostly data + sprites — the AI code needs no changes.
- **Online model:** the server runs the real game; clients send commands by entity id and render
  snapshots, each keeping its own selection, camera, and fog. Snapshots reuse entity instances by id
  so the renderer and UI stay unchanged online.
