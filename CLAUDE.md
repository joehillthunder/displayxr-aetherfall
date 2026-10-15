# CLAUDE.md

Aetherfall: Realms at War, a classic-style fantasy RTS for glasses-free 3D (DisplayXR inline-3D
SDK) that also runs in 2D in any browser. Live at https://joehillthunder.github.io/displayxr-aetherfall/.

## Ground rules

- **Original IP only.** The game is inspired by Warcraft but must never use Blizzard names, heroes,
  places, lore or art (no "Warcraft", "Azeroth", "Thrall", "vespene", etc.). The third resource is
  **aether**. Keep new races, units and abilities original.
- **No build step.** Plain ES modules served as static files. three.js 0.161 and
  `@displayxr/inline3d` 1.45.1 come from jsDelivr through the import map in `index.html`. Don't add
  bundlers, npm dependencies or asset files: all models are procedural.
- **Deploy = push to `main`.** GitHub Pages serves the main branch root (`.nojekyll`, no Actions
  workflow; the `gh` token lacks the `workflow` scope). Pushing publishes the live game.
- Match the existing style: 2-space indent, single quotes, short section banners
  (`// ── name ───`), a header comment per module explaining *why*.

## Layout

| File | Role |
|---|---|
| `index.html` | HUD, start menu, help and end screens, all CSS, import map |
| `js/main.js` | Boot, menu, match set-up, day/night lighting, frame loop, URL params |
| `js/data.js` | Factions, unit roles, buildings, heroes, abilities, creeps. **Balance lives here.** |
| `js/world.js` | 128 × 128 m map: height field, roads, water, cliffs, trees, mines, geysers, camps |
| `js/models.js` | Procedural models + `animate(dt, state)`; per-style building builders in `BUILDERS` |
| `js/game.js` | Simulation: orders, harvesting, construction, production, combat, abilities, XP, victory |
| `js/ai.js` | Computer opponents (economy, build plan, army mix, creeping, waves) |
| `js/ui.js` | Camera, picking, selection, command card, build ghost, HUD panels, minimap |
| `js/fx.js` | Point particles, aether plumes, projectiles, spell effects |
| `js/fog.js` | Fog-of-war grid + `applyFog(material)` shader injection used by every world material |
| `js/path.js` | Grid A* (8-way, 16384-node cap) with line-of-sight smoothing |
| `js/stage.js` | DisplayXR stage: woven `addScene` with a camera rig (attach pattern), mono fallback |
| `js/audio.js` | Synthesised WebAudio sound effects |

## How things fit

- One grid cell = 1 m. Buildings of odd size are centred on `.5` coordinates, even sizes on
  integers (`world.canPlace` / `setFootprint`). Blocking flags are in `BLOCK`.
- The UI and the AI drive the game through the same public methods: `order`, `placeBuilding`,
  `train`, `research`, `cast`, `cancelQueue`. Add new player actions there, not in the UI.
- Player 0 is the human; `NEUTRAL = 99` owns creeps, mines and geysers. All players are mutually
  hostile (free-for-all).
- New unit role or faction: add it in `data.js` (stats, names, `look`), make sure
  `models.js` can build its `look`, give it an icon in `ui.js` `iconFor`, and add it to `MIX` in
  `ai.js`. New building type: `BUILD` in `data.js`, a builder for **each** style in `BUILDERS`,
  `BLD_ICON` and the build-menu lists in `ui.js`, and the AI `PLAN`.
- New world materials must go through `applyFog` (or `M()` in `models.js`) so fog of war darkens them.

## Gotchas

- Map generation must keep every base connected: forests and rock outcrops can wall a base in.
  Roads (`makeRoads` in `world.js`) clear trees and flatten outcrops; check connectivity with
  `findPath` between all `STARTS` after changing terrain generation.
- The starting hall's supply (15) must exceed 5 workers + the hero (5), or the player can't train.
- `moveTo` repaths only when the goal moves > 1 m or after `repathAt`; a per-frame `pathBudget`
  caps A* calls. Don't repath every frame.
- Buildings have `buffs: {}` too; ability code must check `te.type === 'unit'` before stunning.
- Stereo: renderer pixel ratio stays 1, the canvas is double-width when woven, and the per-eye
  width is capped (`maxEyeW`, set by the Quality menu). Particle size uses `uViewH = canvas.height`.

## Running and testing

There's no Python on this PC. Use the portable Node from a session scratchpad (or any Node 22+)
to serve the folder statically, e.g. a tiny `http.createServer` script, then open it in Chrome.

Useful URL params: `?auto` (skip the menu), `faction=<id>`, `hero=<id>`, `seed=<n>`, `opp=1-3`,
`diff=easy|normal|hard`, `fog=0`, `speed=<k>` (sim speed), `mono` (force 2D), `depth=0-2`,
`quality=high|medium|low`.

- `window.aetherfall` exposes `{ game, ui, world, fog, fx, stage, ais }` for console and CDP tests.
- **Syntax check:** copy `js/*.js` into a temp folder with `{"type":"module"}` and run
  `node --check` on each.
- **Headless:** Chrome `--headless=new --remote-debugging-port=<p> --use-angle=d3d11`, then
  evaluate expressions and capture screenshots over CDP (Node 22 has a global `WebSocket`).
- **Full-match regression:** with `?auto&speed=4`, run
  `(await import('/js/ai.js')).AI` → `aetherfall.ais.push(new AI(aetherfall.game, 0))` so two AIs
  play. Within ~10 game minutes expect creep kills, hero levels, units lost on both sides and
  `game.over` set, with no exceptions.
- **Real 3D:** run the DisplayXR Browser
  (`C:\Program Files\DisplayXR\Browser\chrome.exe --user-data-dir=<scratch> --enable-logging --v=0`)
  and grep `chrome_debug.log` for `[aetherfall] firstWoven {"woven":true,"confirmed":true}` and the
  periodic `frames=` lines. Screenshots of the woven panel come out blank, so trust the log.

## DisplayXR HQ homepage

The game has a room in the Arcade wing of https://joehillthunder.github.io/ (repo
`joehillthunder/joehillthunder.github.io`: `home/demos.js` entry `aetherfall` and the
`aetherfall` set piece in `home/office.js`). That checkout is shared with other sessions; edit it
from your own git worktree based on `origin/main` and don't touch others' uncommitted changes.
