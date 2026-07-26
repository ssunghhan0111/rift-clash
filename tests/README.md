# RIFT CLASH — tests

Every harness drives the **real** modules. Nothing here reimplements game logic:
if a test passes, the shipped code did the thing.

```bash
npm test              # everything (needs Playwright for the browser half)
npm run test:sim      # headless only — no browser needed
npm run test:browser  # real Chromium, real WebSockets, real WebRTC
```

| suite | what it covers |
|---|---|
| `wavecheck.js` | Survival difficulty curve, daily twists, seeded reproducibility |
| `simtest.js` | Full survival runs on every difficulty and every daily twist |
| `sighttest.js` | Per-unit sight, auto-engagement, the leash, worker behaviour |
| `reachtest.js` | Every ground unit can actually damage every building |
| `planettest.js` | All six maps: spawn clearance, reachability, netcode |
| `lobbytest.js` | Presence and invites over a real server and real WebSockets |
| `uitest.js` | Nickname, pause toggle, end-match dialog, invites in two browsers |
| `devtest.js` | Dev mode is off by default and gated behind the credit taps |
| `touchtest.js` | Two-finger-only camera on tablets, mouse untouched on PC |
| `fstest.js` | Fullscreen by default, the toggle, and a remembered opt-out |
| `voicetest.js` | Two browsers holding a real WebRTC call with audio flowing |
| `sharetest.js` | The share card renders and the `?join=` deep link works |
| `herotest.js` | Heroes in every mode incl. online: skills, cooldowns, casting |
| `shots.js` | Renders each planet to `shots/` for eyeballing (not a test) |

## Notes

- The browser suites need Playwright and a Chromium build. They **skip cleanly**
  (exit 0 with a SKIP line) if Playwright is not installed, so `npm test` still
  runs the headless half on a bare machine.
  Point `PLAYWRIGHT_PATH` at an install, or `npm i -g playwright`.
- `voicetest.js` launches Chromium with a fake microphone
  (`--use-fake-device-for-media-stream`) so it can verify audio really flows.
- Each suite starts its own server on its own port, so they can be run in any
  order and never collide.

## Bugs these caught

Worth knowing what they are for. All of these were live in shipped code:

- **Melee units could not damage buildings at all.** Reach against a building was
  measured off the bounding radius while collision used the rectangle, so
  Globlings, Bloats, Ardents, Shieldbearers and the Warden hero walked up to a
  Core or the Rift Crystal and stood there forever. 24 of 105 unit/building
  pairs affected (`reachtest.js`).
- **Both 1v1 spawns on Pluto sat inside the Deep Snow band**, so every Pluto
  match had both players permanently at 55% move speed in their own base
  (`planettest.js`).
- **Dev mode re-enabled itself on every page load** from a localStorage flag
  (`devtest.js`).
- **The Skyfall daily twist did the opposite of its description**, delaying every
  unit type by six waves instead of bringing air in early (`wavecheck.js`).
- **Hero level, xp and cooldowns were never serialized**, so online clients saw
  every hero as level 1 (`simtest.js` netcode checks).
- **Heroes were switched off in online matches entirely** — every other mode had
  them (`herotest.js`).
- **The Survival ally never defended the Rift Crystal.** The horde has no base,
  so the AI's attack wave looked for the nearest enemy core, found none, sent the
  army to its own core and left it there. About one run in twenty died on wave 1
  to two Globlings with a full allied army standing in its base (`sighttest.js`).
