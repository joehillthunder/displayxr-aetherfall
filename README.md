# Aetherfall: Realms at War

A classic-style fantasy real-time strategy game for glasses-free 3D. Pick one of five realms and
one of ten heroes, mine gold, cut lumber, quarry stone, capture glowing aether gas from geysers, build a town, train an
army and raze every enemy stronghold. In glasses-free 3D on a Leia display through
[DisplayXR](https://displayxr.org), and in 2D in any browser.

**Play:** https://joehillthunder.github.io/displayxr-aetherfall/

Aetherfall is an original game inspired by the classic real-time strategy genre (base building,
four resources, hero units, neutral creep camps). Its races, heroes, units, places and lore are
all its own.

## Realms and heroes

| Realm | Race | Style | Heroes |
|---|---|---|---|
| Kingdom of Valemark | Humans | Balanced; clerics heal, knights are the strongest cavalry | Ser Aldric (Paladin), Elowen Vale (Archmage) |
| Ironfang Clans | Orcs | Tough; extra health and damage, chain lightning | Grosh Ironfang (Warlord), Ma'kesh (Farseer on a wolf) |
| Sylvan Court | Elves | Swift; faster units, longer bow range, rooting druids | Lyrae Moonshadow (Huntress), Thalanor Oakheart (Keeper) |
| Dread Legion | Undead | Relentless; cheaper troops that regenerate, raised skeletons | Lord Varek (Death Knight), Morwen the Pale (Lich Queen) |
| Deepforge Holds | Dwarves | Sturdy; +1 armor, riflemen and cannons outrange others | Brunhild Stonebeard (Thane), Durgan Ashforge (Runesmith) |

Every realm has a worker, infantry, a ranged unit, cavalry, a spellcaster, an aether-fed siege
engine and a flyer, plus seven buildings: hall, supply building, barracks, sanctum, workshop,
tower and the aether extractor. Heroes level up to 6 from kills and unlock an ability at levels 1,
2 and 3 (heals, stuns, chain lightning, star and ice storms, summons, auras, reveal).

## Resources

- **Gold** from mines. Workers go inside and come out with 10 gold.
- **Lumber** from trees. Trees shake as they're chopped and fall when they run out.
- **Aether** from geysers: swirling plumes of glowing particles that rise out of the screen in 3D.
  Build your extractor on the geyser by your base; the plume roars brighter once it's tapped.
  Siege engines (with glowing aether canisters), flyers and spellcasters cost aether. The Great
  Aether Geyser in the middle of the map is guarded by the Aether Wyrm.

- **Stone** from rock piles. Workers quarry it with a pick, out in the open. Halls, towers,
  barracks and workshops need it.

## Skills

Every character has one-key skills. Select units and press a letter or number:

| Skill | Keys | Who | What happens |
|---|---|---|---|
| Chop Wood | `C` or `1` | workers | each worker walks to the nearest tree, chops it and carries the logs home |
| Mine Gold | `G` or `2` | workers | to the nearest gold mine; they come back with a sack of gold |
| Gather Rocks | `K` or `3` | workers | to the nearest rock pile; they quarry stone blocks |
| Capture Gas | `X` or `4` | workers | to your nearest extractor; they come out holding a glowing aether crystal |
| Fight | `F` or `5` | everyone | charge the nearest enemy in sight |

Workers visibly carry what they gathered. The number keys trigger skills until you assign that
number to a control group with `Ctrl`+number.

## Sound

Every sound is synthesised live (no audio files), with reverb and left/right panning by where it
happens on screen. Geysers bubble, hiss and erupt, and a tapped geyser has a pump chugging away;
axes thock and trees creak and crash; picks clink on rock; gold jingles, logs clunk and aether
chimes as they're dropped off; swords clang, axes thud, bows twang, rifles crack and cannons
boom; each spell has its own sound (lightning crackle, shattering ice, a healing choir, falling
stars). Units answer in their race's voice (gruff orcs, airy elves, whispering undead), birds
sing by day and crickets by night, and a generative modal tune plays, adding war drums when
battle is near. `🔊` toggles sound effects and `🎵` the music.

## Graphics

HDR bloom (glowing aether, spells, windows and sigils), a sky reflection map for metal, brick,
plank, shingle and bark detail on every building, wind-swept grass, drifting cloud shadows,
depth-tinted water with foam at the shoreline, geyser eruptions that fountain out of the screen,
fireflies at night, sparks when blades hit armour, and a day/night cycle. The Quality menu (high,
medium, low) sets bloom, MSAA, shadows, grass density and particle counts.

## The world

A 128 x 128 m map for up to four players: four corner bases, four edge expansions guarded by ogre
camps, more creep camps between them (kobolds, spiders, dire wolves), a lake ring with four fords
around the central plateau, forests, ponds, rocky outcrops, dirt roads that always connect every
base, fog of war, a day/night cycle, shadows and water. Each realm's ground looks different around
its base: blight for the Dread Legion, moss for the Sylvan Court, red dust for the Ironfang Clans.

## How to play

| | |
|---|---|
| Select | Left-click, drag a box, Shift+click to add, double-click or Ctrl+click for all of a type on screen |
| Command | Right-click: move, attack, gather, resume a building, set a rally point |
| Attack-move, Move, Stop, Hold | `A` `M` `S` `H` |
| Hero abilities | `Q` `W` `E` |
| Workers | `G` gather, `B` build, `V` advanced build, `R` return cargo |
| Buildings | `Q` `W` `E` `R` train, `A` `S` research, `T` rally, `H` revive hero |
| Camera | Arrow keys, screen edges, middle-drag, wheel to zoom, the minimap |
| Groups | `Ctrl`+`1`–`9` to set, `1`–`9` to select, twice to jump there |
| Shortcuts | `F1` hero, `Backspace` hall, `Space` last alert, `P` pause, `?` help |

Opponents (1 to 3), their realm, difficulty, the map seed and fog of war are set in the start menu.

## 3D

One persistent canvas, woven by the DisplayXR inline-3D SDK when the browser and display support
it. A camera rig hangs off the RTS camera (attach pattern); convergence sits on the ground under
the camera target, so units and buildings stand just in front of the glass, flyers and aether
plumes come out of it, and the far side of the battlefield recedes. The **Depth** slider scales
the stereo, and **2D/3D** switches the lens in the DisplayXR Browser.

URL options: `?mono` forces 2D, `?depth=0-2`, `?quality=high|medium|low`, `?seed=<n>`,
`?faction=<id>&hero=<id>&auto` skips the menu, `?opp=1-3`, `?diff=easy|normal|hard`, `?fog=0`.

## Code

Static ES modules, no build step: three.js 0.161 and `@displayxr/inline3d` 1.45.1 from jsDelivr.
Every model is procedural (no asset files).

| File | |
|---|---|
| `js/data.js` | Realms, units, buildings, heroes, abilities, creeps |
| `js/world.js` | Height field, water, roads, forests, mines, geysers, creep camps |
| `js/models.js` | Procedural unit, mount, flyer, siege, building and resource models with animation |
| `js/game.js` | Simulation: orders, harvesting, construction, production, combat, abilities, heroes |
| `js/ai.js` | Computer opponents |
| `js/ui.js` | Camera, selection, command card, build placement, HUD, minimap |
| `js/fx.js` | Particles, aether plumes, projectiles, spell effects |
| `js/audio.js` | Synthesised sound effects, voices, ambience and generative music |
| `js/fog.js`, `js/path.js`, `js/stage.js` | Fog of war + surface-detail shaders, A*, the DisplayXR stage with per-eye bloom |

Apache-2.0.
