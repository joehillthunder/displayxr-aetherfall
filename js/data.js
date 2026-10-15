// Every faction, unit, building, hero and ability in Aetherfall. All names and lore are original.
//
// Units share seven roles (worker, melee, ranged, cavalry, caster, siege, flyer) with base stats.
// Each faction tilts those stats with its own modifiers, so the five races play differently while
// the balance stays readable. Costs are [gold, lumber, aether, stone]; stone is optional (0).

export const RES = ['gold', 'lumber', 'aether', 'stone'];

const ROLE = {
  worker:  { hp: 220, armor: 0, dmg: 6,  range: 0.9, cd: 1.4, speed: 3.3, sight: 7,  cost: [75, 0, 0],      supply: 1, time: 12 },
  melee:   { hp: 440, armor: 2, dmg: 13, range: 1.0, cd: 1.3, speed: 3.0, sight: 8,  cost: [135, 0, 0],     supply: 2, time: 16 },
  ranged:  { hp: 300, armor: 0, dmg: 17, range: 6.5, cd: 1.5, speed: 3.0, sight: 9,  cost: [130, 20, 0],    supply: 2, time: 17, proj: 'arrow' },
  cavalry: { hp: 760, armor: 3, dmg: 26, range: 1.3, cd: 1.4, speed: 4.4, sight: 9,  cost: [245, 60, 0, 10],    supply: 4, time: 24 },
  caster:  { hp: 320, armor: 0, dmg: 9,  range: 6.0, cd: 1.8, speed: 3.0, sight: 9,  cost: [150, 30, 40],   supply: 2, time: 20, mana: 200, proj: 'bolt' },
  siege:   { hp: 650, armor: 2, dmg: 70, range: 10,  cd: 3.5, speed: 2.2, sight: 10, cost: [220, 60, 75, 30],   supply: 3, time: 30, proj: 'boulder', splash: 2.2, bldBonus: 2.5 },
  flyer:   { hp: 520, armor: 1, dmg: 22, range: 3.5, cd: 1.6, speed: 5.0, sight: 11, cost: [260, 40, 100],  supply: 4, time: 30, flying: true, proj: 'bolt' },
};
export const ROLES = Object.keys(ROLE);

const BUILD = {
  hall:      { hp: 1700, size: 4, cost: [385, 185, 0, 60], time: 60, supply: 15, trains: ['worker'], dropoff: true, sight: 12, armor: 5 },
  farm:      { hp: 500,  size: 2, cost: [80, 20, 0],   time: 20, supply: 8, sight: 6, armor: 5 },
  barracks:  { hp: 1200, size: 3, cost: [160, 60, 0, 20],  time: 35, trains: ['melee', 'ranged', 'cavalry'], sight: 8, armor: 5 },
  sanctum:   { hp: 900,  size: 3, cost: [150, 100, 0, 20], time: 35, trains: ['caster', 'flyer'], requires: ['barracks'], sight: 8, armor: 5 },
  workshop:  { hp: 900,  size: 3, cost: [140, 140, 0, 40], time: 35, trains: ['siege'], research: ['weapons', 'armor'], requires: ['barracks'], sight: 8, armor: 5 },
  tower:     { hp: 650,  size: 2, cost: [110, 80, 0, 50],  time: 25, sight: 11, armor: 5, attack: { dmg: 22, range: 8.5, cd: 1.3, proj: 'arrow' } },
  extractor: { hp: 750,  size: 3, cost: [100, 50, 0],  time: 25, onGeyser: true, sight: 7, armor: 5 },
};
export const BUILD_ORDER = ['hall', 'farm', 'barracks', 'extractor', 'sanctum', 'workshop', 'tower'];

// Unit requirements beyond "the building that trains it".
const UNIT_REQ = { cavalry: ['sanctum'], flyer: ['extractor'], siege: ['extractor'] };

export const RESEARCH = {
  weapons: { name: 'Forged Weapons', cost: [150, 100, 25], time: 40, max: 2, desc: '+2 attack for all your troops per rank.', icon: '⚔' },
  armor:   { name: 'Tempered Armor', cost: [150, 100, 25], time: 40, max: 2, desc: '+2 armor for all your troops per rank.', icon: '🛡' },
};

// ── abilities ─────────────────────────────────────────────────────────────────────────────────────
// kind: heal | bolt | stunbolt | drain | chain | stomp | nova | aoe | summon | buff | aura | reveal | blink | raise | roots | shield
export const ABILITY = {
  mend:      { name: 'Radiant Mend', kind: 'heal', target: 'ally', mana: 65, cd: 6, range: 7, amount: 220, icon: '✚', color: 0xffe9a0, desc: 'Heals a friendly unit with a column of light.' },
  aegis:     { name: 'Aegis of Dawn', kind: 'buff', target: 'self', mana: 75, cd: 30, dur: 6, buff: 'invuln', icon: '◈', color: 0xfff2b0, desc: 'A golden shell makes the hero immune to all damage.' },
  devotion:  { name: 'Banner of Devotion', kind: 'aura', target: 'passive', aura: 'armor', amount: 3, radius: 8, icon: '⚑', color: 0xffd36a, desc: 'Passive: nearby allies gain +3 armor.' },
  frostnova: { name: 'Frost Nova', kind: 'nova', target: 'enemy', mana: 90, cd: 9, range: 8, radius: 3, dmg: 90, slow: 4, icon: '❄', color: 0x9fe6ff, desc: 'Blasts a target with ice, damaging and slowing everything nearby.' },
  arcane:    { name: 'Arcane Lance', kind: 'bolt', target: 'enemy', mana: 60, cd: 5, range: 9, dmg: 120, icon: '✦', color: 0xc48bff, desc: 'A spear of raw arcana.' },
  elemental: { name: 'Call Tidespirit', kind: 'summon', target: 'self', mana: 125, cd: 25, unit: 'tidespirit', count: 1, life: 60, icon: '≈', color: 0x5fc8ff, desc: 'Summons a water spirit that fights for 60 seconds.' },
  shockwave: { name: 'Earthsplitter', kind: 'aoe', target: 'point', mana: 100, cd: 10, range: 8, radius: 3.2, dmg: 140, icon: '⚡', color: 0xe8a050, desc: 'Cracks the ground at a point, damaging all enemies there.' },
  stomp:     { name: 'War Stomp', kind: 'stomp', target: 'self', mana: 90, cd: 9, radius: 3.6, dmg: 60, stun: 2.2, icon: '⊛', color: 0xd9a066, desc: 'Stuns and damages nearby enemies.' },
  roar:      { name: 'Battle Roar', kind: 'buff', target: 'self', mana: 70, cd: 20, dur: 15, buff: 'roar', radius: 8, icon: '❢', color: 0xff6040, desc: 'Nearby allies deal +40% damage for 15 seconds.' },
  chain:     { name: 'Storm Chain', kind: 'chain', target: 'enemy', mana: 110, cd: 8, range: 8, dmg: 95, bounces: 4, icon: 'ϟ', color: 0x9fd0ff, desc: 'Lightning leaps between up to 5 enemies.' },
  wolves:    { name: 'Spirit Wolves', kind: 'summon', target: 'self', mana: 100, cd: 25, unit: 'spiritwolf', count: 2, life: 50, icon: '☾', color: 0x8fb4ff, desc: 'Calls two ghostly wolves for 50 seconds.' },
  farsight:  { name: 'Far Sight', kind: 'reveal', target: 'point', mana: 50, cd: 15, range: 200, radius: 12, dur: 12, icon: '◉', color: 0x9fe0ff, desc: 'Reveals any area of the map for 12 seconds.' },
  glaive:    { name: 'Moon Glaive', kind: 'chain', target: 'enemy', mana: 70, cd: 6, range: 8, dmg: 80, bounces: 3, icon: '☽', color: 0xd8e6ff, desc: 'A spinning glaive bounces between enemies.' },
  starfall:  { name: 'Starfall', kind: 'aoe', target: 'point', mana: 150, cd: 18, range: 9, radius: 4.2, dmg: 220, icon: '✶', color: 0xbfc8ff, desc: 'Stars rain on an area, crushing everything under them.' },
  owl:       { name: 'Owl Scout', kind: 'reveal', target: 'point', mana: 40, cd: 12, range: 200, radius: 10, dur: 15, icon: '⌖', color: 0xe6d8ff, desc: 'An owl reveals a distant area for 15 seconds.' },
  roots:     { name: 'Grasping Roots', kind: 'roots', target: 'enemy', mana: 75, cd: 8, range: 7, dmg: 90, stun: 3, icon: '❦', color: 0x7fd068, desc: 'Roots bind an enemy in place and damage it.' },
  treants:   { name: 'Force of the Grove', kind: 'summon', target: 'self', mana: 120, cd: 25, unit: 'treantling', count: 3, life: 45, icon: '♣', color: 0x8fd060, desc: 'Three treants pull free of the earth for 45 seconds.' },
  rejuv:     { name: 'Rejuvenation', kind: 'heal', target: 'ally', mana: 60, cd: 5, range: 7, amount: 260, icon: '❀', color: 0x9ff08a, desc: 'Restores a friendly unit with living sap.' },
  deathcoil: { name: 'Grave Coil', kind: 'drain', target: 'enemy', mana: 75, cd: 6, range: 8, dmg: 110, icon: '☠', color: 0x9fff7a, desc: 'A coil of death damages an enemy and heals the hero.' },
  unholy:    { name: 'Dread Aura', kind: 'aura', target: 'passive', aura: 'speed', amount: 0.25, radius: 8, icon: '⚚', color: 0x7aff9a, desc: 'Passive: nearby allies move 25% faster and regenerate.' },
  raise:     { name: 'Raise the Fallen', kind: 'summon', target: 'self', mana: 90, cd: 18, unit: 'skeleton', count: 3, life: 45, icon: '✝', color: 0xcfe0b0, desc: 'Three skeletons claw out of the ground for 45 seconds.' },
  blizzard:  { name: 'Winter\'s Grasp', kind: 'aoe', target: 'point', mana: 120, cd: 14, range: 9, radius: 3.8, dmg: 180, icon: '❅', color: 0xc8f0ff, desc: 'A storm of ice shards batters an area.' },
  siphon:    { name: 'Soul Siphon', kind: 'drain', target: 'enemy', mana: 70, cd: 6, range: 7, dmg: 120, icon: '♆', color: 0x8affd0, desc: 'Drains life from an enemy into the hero.' },
  hammer:    { name: 'Thunder Hammer', kind: 'stunbolt', target: 'enemy', mana: 75, cd: 8, range: 7, dmg: 100, stun: 2, icon: '⚒', color: 0x9fd8ff, desc: 'Hurls a hammer that damages and stuns.' },
  clap:      { name: 'Thunderclap', kind: 'stomp', target: 'self', mana: 90, cd: 9, radius: 3.6, dmg: 70, stun: 1.6, icon: '◎', color: 0xbfe0ff, desc: 'Slams the ground, stunning nearby enemies.' },
  avatar:    { name: 'Stoneskin Avatar', kind: 'buff', target: 'self', mana: 120, cd: 40, dur: 18, buff: 'avatar', icon: '⛰', color: 0xd8c8a0, desc: 'Grows huge: +6 armor, +25 damage and +400 health.' },
  flamestrike: { name: 'Forgefire', kind: 'aoe', target: 'point', mana: 110, cd: 12, range: 8, radius: 3.2, dmg: 170, icon: '♨', color: 0xff8a30, desc: 'A pillar of forge flame scorches an area.' },
  runeward:  { name: 'Rune Ward', kind: 'shield', target: 'ally', mana: 60, cd: 8, range: 7, dur: 12, amount: 5, icon: 'ᚱ', color: 0xffb060, desc: 'A glowing rune gives an ally +5 armor and heals it.' },
  golem:     { name: 'Forge Golem', kind: 'summon', target: 'self', mana: 140, cd: 30, unit: 'irongolem', count: 1, life: 70, icon: '⚙', color: 0xd09a60, desc: 'Builds an iron golem that fights for 70 seconds.' },
  // unit spells (autocast by casters)
  u_heal:    { name: 'Mending Prayer', kind: 'heal', target: 'ally', mana: 40, cd: 4, range: 6, amount: 120, icon: '✚', color: 0xffe9a0, desc: 'Heals a wounded ally. Cast automatically.', auto: true },
  u_chain:   { name: 'Crackling Bolt', kind: 'chain', target: 'enemy', mana: 70, cd: 8, range: 7, dmg: 60, bounces: 2, icon: 'ϟ', color: 0x9fd0ff, desc: 'Lightning that jumps to 3 enemies. Cast automatically.', auto: true },
  u_roots:   { name: 'Thornbind', kind: 'roots', target: 'enemy', mana: 60, cd: 10, range: 6, dmg: 40, stun: 2.5, icon: '❦', color: 0x7fd068, desc: 'Binds an enemy in thorns. Cast automatically.', auto: true },
  u_raise:   { name: 'Bone Call', kind: 'summon', target: 'self', mana: 75, cd: 14, unit: 'skeleton', count: 2, life: 35, icon: '✝', color: 0xcfe0b0, desc: 'Raises two skeletons in battle. Cast automatically.', auto: true },
  u_shield:  { name: 'Runic Bulwark', kind: 'shield', target: 'ally', mana: 40, cd: 6, range: 6, dur: 12, amount: 4, icon: 'ᚱ', color: 0xffb060, desc: 'Grants an ally +4 armor. Cast automatically.', auto: true },
};

// ── factions ──────────────────────────────────────────────────────────────────────────────────────
// look: model parameters read by models.js. mods: stat multipliers on the base roles.
export const FACTIONS = {
  valemark: {
    name: 'Kingdom of Valemark', short: 'Valemark', race: 'Humans',
    lore: 'Knights and farmers of the river valleys. Stone keeps, blue-slate roofs and long memories of the last war. Their clerics answer wounds with light, and their griffin riders guard the passes.',
    style: 'valemark', color: '#4f8fe8',
    mods: { hp: 1, dmg: 1, speed: 1, armor: 0, cost: 1, range: 0, regen: 0 },
    trait: 'Balanced. Clerics heal, knights are the strongest cavalry.',
    look: { body: 'human', skin: 0xe8b894, cloth: 0x8a6a4a, metal: 0xc8ced8, hair: 0x6a4428 },
    units: {
      worker:  { name: 'Peasant', look: { weapon: 'pick', helm: 'none', cloth: 0x9a7a52 } },
      melee:   { name: 'Footman', look: { weapon: 'sword', shield: 'kite', helm: 'kettle' } },
      ranged:  { name: 'Longbowman', look: { weapon: 'bow', helm: 'hood', cloth: 0x4f6a3a } },
      cavalry: { name: 'Knight', look: { weapon: 'lance', shield: 'kite', helm: 'great', mount: 'horse' } },
      caster:  { name: 'Cleric', spell: 'u_heal', look: { weapon: 'staff', helm: 'hood', cloth: 0xf2ead8, robe: true } },
      siege:   { name: 'Aether Ballista', look: { machine: 'ballista' } },
      flyer:   { name: 'Griffin Rider', look: { weapon: 'hammer', helm: 'winged', flyer: 'griffin' } },
    },
    buildings: { hall: 'Town Hall', farm: 'Farmstead', barracks: 'Barracks', sanctum: 'Arcane Sanctum', workshop: 'Siege Workshop', tower: 'Guard Tower', extractor: 'Aether Refinery' },
    heroes: ['paladin', 'archmage'],
  },
  ironfang: {
    name: 'Ironfang Clans', short: 'Ironfang', race: 'Orcs',
    lore: 'Green-skinned clans of the red badlands who rode out of the dust storms on giant wolves. They value strength, honour and the spirits of storm and stone.',
    style: 'ironfang', color: '#d8502f',
    mods: { hp: 1.12, dmg: 1.06, speed: 0.98, armor: 0, cost: 1.02, range: 0, regen: 0 },
    trait: 'Tough. Extra health and damage; shamans throw chain lightning.',
    look: { body: 'orc', skin: 0x6f9a48, cloth: 0x7a4a2a, metal: 0x8a8070, hair: 0x1a1410 },
    units: {
      worker:  { name: 'Laborer', look: { weapon: 'pick', helm: 'none' } },
      melee:   { name: 'Ravager', look: { weapon: 'axe', helm: 'horned', shoulders: true } },
      ranged:  { name: 'Spearhurler', look: { weapon: 'spear', helm: 'band', proj: 'spear' } },
      cavalry: { name: 'Wolf Raider', look: { weapon: 'axe', helm: 'horned', mount: 'wolf' } },
      caster:  { name: 'Stormcaller', spell: 'u_chain', look: { weapon: 'totem', helm: 'skull', robe: true, cloth: 0x5a3a24 } },
      siege:   { name: 'Bonecrusher', look: { machine: 'catapult' } },
      flyer:   { name: 'Wyvern Rider', look: { weapon: 'spear', helm: 'band', flyer: 'wyvern' } },
    },
    buildings: { hall: 'Great Hall', farm: 'Burrow', barracks: 'War Camp', sanctum: 'Spirit Lodge', workshop: 'Beastforge', tower: 'Watch Tower', extractor: 'Aether Pump' },
    heroes: ['warlord', 'farseer'],
  },
  sylvan: {
    name: 'Sylvan Court', short: 'Sylvan', race: 'Elves',
    lore: 'Immortal wardens of the moonlit forests. Their halls are living trees, their archers never miss twice, and the ancient treants of the deep grove march when called.',
    style: 'sylvan', color: '#8fd060',
    mods: { hp: 0.92, dmg: 1, speed: 1.1, armor: 0, cost: 1, range: 1, regen: 0.4 },
    trait: 'Swift. Faster units, longer bow range; druids root enemies.',
    look: { body: 'elf', skin: 0xb8a0d8, cloth: 0x3a5a4a, metal: 0xc8d8e0, hair: 0xe0e8f8 },
    units: {
      worker:  { name: 'Glimmer', look: { body: 'wisp' } },
      melee:   { name: 'Glaive Warden', look: { weapon: 'glaive', helm: 'crest' } },
      ranged:  { name: 'Moon Archer', look: { weapon: 'bow', helm: 'hood', cloth: 0x2a4a5a } },
      cavalry: { name: 'Stag Rider', look: { weapon: 'spear', helm: 'crest', mount: 'stag' } },
      caster:  { name: 'Grove Druid', spell: 'u_roots', look: { weapon: 'staff', helm: 'antler', robe: true, cloth: 0x4a6a3a } },
      siege:   { name: 'Ancient Treant', look: { body: 'treant', proj: 'boulder' } },
      flyer:   { name: 'Moonhawk Rider', look: { weapon: 'bow', helm: 'hood', flyer: 'hawk' } },
    },
    buildings: { hall: 'Tree of Ages', farm: 'Moonwell', barracks: 'Hunter\'s Lodge', sanctum: 'Grove of Dreams', workshop: 'Root of Ancients', tower: 'Sentinel Spire', extractor: 'Aether Bloom' },
    heroes: ['huntress', 'keeper'],
  },
  dread: {
    name: 'Dread Legion', short: 'Dread', race: 'Undead',
    lore: 'A tide of the restless dead bound to a frozen crown. Bone spires rise wherever the Legion camps, and the necromancers raise every soldier who falls, friend or foe.',
    style: 'dread', color: '#9a6ad8',
    mods: { hp: 0.95, dmg: 1, speed: 1, armor: 0, cost: 0.9, range: 0, regen: 1.2 },
    trait: 'Relentless. Cheaper troops that regenerate; necromancers raise skeletons.',
    look: { body: 'undead', skin: 0xd8d4c0, cloth: 0x3a3048, metal: 0x5a5e6a, hair: 0x000000 },
    units: {
      worker:  { name: 'Gravebound', look: { weapon: 'pick', helm: 'hood', cloth: 0x3a3a3a } },
      melee:   { name: 'Bone Legionnaire', look: { weapon: 'sword', shield: 'round', helm: 'kettle' } },
      ranged:  { name: 'Bone Archer', look: { weapon: 'bow', helm: 'hood' } },
      cavalry: { name: 'Death Rider', look: { weapon: 'scythe', helm: 'great', mount: 'bonehorse' } },
      caster:  { name: 'Necromancer', spell: 'u_raise', look: { body: 'human', skin: 0xc8c0b0, weapon: 'staff', helm: 'hood', robe: true, cloth: 0x2a2038 } },
      siege:   { name: 'Bone Golem', look: { body: 'golem', golem: 'bone' } },
      flyer:   { name: 'Gargoyle', look: { flyer: 'gargoyle', rider: false } },
    },
    buildings: { hall: 'Necropolis', farm: 'Ossuary', barracks: 'Barrow Pit', sanctum: 'Temple of Shadows', workshop: 'Bone Forge', tower: 'Spirit Spire', extractor: 'Aether Siphon' },
    heroes: ['deathknight', 'wraithqueen'],
  },
  deepforge: {
    name: 'Deepforge Holds', short: 'Deepforge', race: 'Dwarves',
    lore: 'Mountain clans who dig the deepest mines and brew the strongest ale. Their rune priests carve wards into stone, and their steam cannons were the first machines ever fed with aether.',
    style: 'deepforge', color: '#e8a040',
    mods: { hp: 1.08, dmg: 1, speed: 0.92, armor: 1, cost: 1.04, range: 0.5, regen: 0 },
    trait: 'Sturdy. +1 armor everywhere; riflemen and cannons outrange others.',
    look: { body: 'dwarf', skin: 0xe0a882, cloth: 0x6a3a2a, metal: 0xb08850, hair: 0xb8582a },
    units: {
      worker:  { name: 'Miner', look: { weapon: 'pick', helm: 'mining' } },
      melee:   { name: 'Shieldbearer', look: { weapon: 'hammer', shield: 'round', helm: 'horned' } },
      ranged:  { name: 'Rifleman', look: { weapon: 'rifle', helm: 'cap', proj: 'bullet' } },
      cavalry: { name: 'Ram Rider', look: { weapon: 'axe', helm: 'horned', mount: 'ram' } },
      caster:  { name: 'Runepriest', spell: 'u_shield', look: { weapon: 'hammer', helm: 'none', robe: true, cloth: 0x8a5a2a } },
      siege:   { name: 'Steam Cannon', look: { machine: 'cannon' } },
      flyer:   { name: 'Gyrocopter', look: { flyer: 'gyro' } },
    },
    buildings: { hall: 'Hold Gate', farm: 'Brewhouse', barracks: 'Muster Hall', sanctum: 'Rune Forge', workshop: 'Steamworks', tower: 'Cannon Tower', extractor: 'Aether Drill' },
    heroes: ['thane', 'runesmith'],
  },
};
export const FACTION_IDS = Object.keys(FACTIONS);

// ── heroes ────────────────────────────────────────────────────────────────────────────────────────
// Heroes are the "starting characters": the player picks one per faction before the match.
export const HEROES = {
  paladin:     { faction: 'valemark', name: 'Ser Aldric', title: 'Paladin of the Dawn', ranged: false, hp: 780, mana: 240, dmg: 26, armor: 5, speed: 3.2, abilities: ['mend', 'aegis', 'devotion'], look: { weapon: 'warhammer', shield: 'kite', helm: 'great', cape: true, metal: 0xe8d090 }, blurb: 'A holy knight who keeps his soldiers alive.' },
  archmage:    { faction: 'valemark', name: 'Elowen Vale', title: 'Archmage of the Spire', ranged: true, proj: 'bolt', hp: 560, mana: 340, dmg: 22, armor: 2, speed: 3.2, abilities: ['arcane', 'frostnova', 'elemental'], look: { weapon: 'staff', helm: 'wizard', robe: true, cloth: 0x3a4aa8, cape: true, hair: 0xd8c8a8 }, blurb: 'A battle mage of frost and arcana.' },
  warlord:     { faction: 'ironfang', name: 'Grosh Ironfang', title: 'Warlord of the Clans', ranged: false, hp: 860, mana: 220, dmg: 30, armor: 4, speed: 3.2, abilities: ['shockwave', 'stomp', 'roar'], look: { weapon: 'greataxe', helm: 'horned', shoulders: true, cape: true }, blurb: 'A towering chieftain who breaks lines.' },
  farseer:     { faction: 'ironfang', name: 'Ma\'kesh', title: 'Farseer of the Storm', ranged: true, proj: 'bolt', hp: 600, mana: 320, dmg: 22, armor: 3, speed: 3.4, abilities: ['chain', 'wolves', 'farsight'], look: { weapon: 'totem', helm: 'wolfpelt', robe: true, cloth: 0x4a5a7a, mount: 'wolf' }, blurb: 'A storm shaman who rides a great wolf.' },
  huntress:    { faction: 'sylvan', name: 'Lyrae Moonshadow', title: 'Warden of the Night', ranged: true, proj: 'glaive', hp: 640, mana: 260, dmg: 24, armor: 4, speed: 3.6, abilities: ['glaive', 'owl', 'starfall'], look: { weapon: 'glaive', helm: 'crest', mount: 'stag', cape: true }, blurb: 'A swift hunter who strikes from shadow.' },
  keeper:      { faction: 'sylvan', name: 'Thalanor Oakheart', title: 'Keeper of the Grove', ranged: true, proj: 'bolt', hp: 620, mana: 320, dmg: 22, armor: 3, speed: 3.4, abilities: ['roots', 'rejuv', 'treants'], look: { weapon: 'staff', helm: 'antler', robe: true, cloth: 0x3a6a2a, centaur: true }, blurb: 'Half stag, half elf: the voice of the forest.' },
  deathknight: { faction: 'dread', name: 'Lord Varek', title: 'Death Knight', ranged: false, hp: 760, mana: 260, dmg: 28, armor: 5, speed: 3.6, abilities: ['deathcoil', 'unholy', 'raise'], look: { body: 'human', skin: 0xa8b0b8, weapon: 'runeblade', helm: 'great', mount: 'bonehorse', cape: true, metal: 0x30343c }, blurb: 'A fallen knight on a skeletal steed.' },
  wraithqueen: { faction: 'dread', name: 'Morwen the Pale', title: 'Queen of Frost', ranged: true, proj: 'bolt', hp: 560, mana: 340, dmg: 24, armor: 2, speed: 3.2, abilities: ['siphon', 'frostnova', 'blizzard'], look: { weapon: 'staff', helm: 'crown', robe: true, cloth: 0x2a4a6a, cape: true }, blurb: 'A lich queen who freezes whole armies.' },
  thane:       { faction: 'deepforge', name: 'Brunhild Stonebeard', title: 'Thane of the Deep', ranged: false, hp: 820, mana: 240, dmg: 27, armor: 6, speed: 3.0, abilities: ['hammer', 'clap', 'avatar'], look: { weapon: 'warhammer', helm: 'horned', shoulders: true, cape: true, hair: 0xd8a040 }, blurb: 'A mountain warrior with a storm-forged hammer.' },
  runesmith:   { faction: 'deepforge', name: 'Durgan Ashforge', title: 'Master Runesmith', ranged: true, proj: 'bolt', hp: 620, mana: 300, dmg: 23, armor: 4, speed: 3.0, abilities: ['flamestrike', 'runeward', 'golem'], look: { weapon: 'hammer', helm: 'mining', robe: true, cloth: 0x7a3a1a, hair: 0x5a3a2a }, blurb: 'A forge priest who builds golems from iron.' },
};

// ── neutral creeps and summons ────────────────────────────────────────────────────────────────────
export const CREEPS = {
  kobold:     { name: 'Tunnel Kobold', hp: 240, armor: 0, dmg: 9,  range: 1, cd: 1.3, speed: 3, sight: 6, xp: 30, bounty: 12, look: { body: 'kobold', weapon: 'pick' } },
  spider:     { name: 'Thicket Spider', hp: 330, armor: 1, dmg: 14, range: 1.2, cd: 1.4, speed: 3.4, sight: 7, xp: 40, bounty: 16, look: { body: 'spider' } },
  ogre:       { name: 'Hill Ogre', hp: 900, armor: 2, dmg: 32, range: 1.4, cd: 1.8, speed: 2.8, sight: 7, xp: 90, bounty: 40, look: { body: 'ogre', weapon: 'club' } },
  direwolf:   { name: 'Dire Wolf', hp: 360, armor: 1, dmg: 15, range: 1.1, cd: 1.1, speed: 4.2, sight: 8, xp: 40, bounty: 16, look: { body: 'wolf' } },
  wyrm:       { name: 'Aether Wyrm', hp: 2600, armor: 5, dmg: 55, range: 4, cd: 2.0, speed: 2.6, sight: 9, xp: 400, bounty: 250, proj: 'breath', splash: 2.5, look: { body: 'wyrm' } },
  // summons
  tidespirit: { name: 'Tidespirit', hp: 520, armor: 1, dmg: 22, range: 5, cd: 1.5, speed: 3, sight: 8, proj: 'bolt', look: { body: 'elemental', color: 0x4fb8ff } },
  spiritwolf: { name: 'Spirit Wolf', hp: 360, armor: 1, dmg: 16, range: 1.1, cd: 1.1, speed: 4.4, sight: 8, look: { body: 'wolf', ghost: 0x8fb4ff } },
  treantling: { name: 'Treant', hp: 380, armor: 2, dmg: 14, range: 1.1, cd: 1.4, speed: 3, sight: 7, look: { body: 'treant', small: true } },
  skeleton:   { name: 'Risen Skeleton', hp: 220, armor: 1, dmg: 11, range: 1, cd: 1.3, speed: 3, sight: 7, look: { body: 'undead', weapon: 'sword', helm: 'none', skin: 0xe0dccc, cloth: 0x2a2a2a } },
  irongolem:  { name: 'Forge Golem', hp: 1100, armor: 5, dmg: 34, range: 1.4, cd: 1.6, speed: 2.6, sight: 7, look: { body: 'golem', golem: 'iron' } },
};

// ── builders: definitions with faction modifiers applied ──────────────────────────────────────────
const round5 = (v) => Math.round(v / 5) * 5;

export function unitDef(faction, role) {
  const F = FACTIONS[faction], R = ROLE[role], U = F.units[role], M = F.mods;
  const look = { ...F.look, ...U.look };
  return {
    key: `${faction}:${role}`, kind: 'unit', faction, role, name: U.name, spell: U.spell,
    hp: Math.round(R.hp * M.hp), maxMana: R.mana || 0, armor: R.armor + M.armor, dmg: Math.round(R.dmg * M.dmg),
    range: R.range + (R.range > 3 ? M.range : 0), cd: R.cd, speed: R.speed * M.speed, sight: R.sight,
    cost: R.cost.map((c) => round5(c * M.cost)), supply: R.supply, time: R.time, regen: M.regen,
    proj: look.proj || R.proj, splash: R.splash || 0, bldBonus: R.bldBonus || 1, flying: !!R.flying,
    worker: role === 'worker', requires: UNIT_REQ[role] || [], look,
    xp: Math.round((R.cost[0] + R.cost[1] + R.cost[2] * 2) / 4),
  };
}

export function buildingDef(faction, type) {
  const F = FACTIONS[faction], B = BUILD[type];
  return {
    key: `${faction}:${type}`, kind: 'building', faction, type, name: F.buildings[type], ...B,
    cost: B.cost.map((c) => round5(c * F.mods.cost)), requires: B.requires || [], trains: B.trains || [],
    research: B.research || [], style: F.style,
  };
}

export function heroDef(id) {
  const H = HEROES[id], F = FACTIONS[H.faction];
  const look = { ...F.look, ...H.look, hero: true };
  return {
    key: `hero:${id}`, kind: 'unit', hero: true, heroId: id, faction: H.faction, role: 'hero', name: H.name, title: H.title,
    hp: H.hp, maxMana: H.mana, armor: H.armor, dmg: H.dmg, range: H.ranged ? 6 : 1.3, cd: 1.6, speed: H.speed, sight: 11,
    cost: [425, 100, 0], supply: 5, time: 35, regen: 1 + F.mods.regen, proj: H.ranged ? H.proj : null, splash: 0, bldBonus: 1,
    flying: false, abilities: H.abilities, look, xp: 200,
  };
}

export function creepDef(id) {
  const C = CREEPS[id];
  return {
    key: `creep:${id}`, kind: 'unit', creep: true, faction: 'neutral', role: 'creep', name: C.name,
    hp: C.hp, maxMana: 0, armor: C.armor, dmg: C.dmg, range: C.range, cd: C.cd, speed: C.speed, sight: C.sight,
    cost: [0, 0, 0], supply: 0, regen: 0.5, proj: C.proj || null, splash: C.splash || 0, bldBonus: 1, flying: false,
    look: { ...C.look }, xp: C.xp || 20, bounty: C.bounty || 0,
  };
}

export const HERO_XP = [0, 200, 500, 900, 1400, 2000];
export const TEAM_COLORS = ['#3f8fff', '#e0402f', '#a45ae8', '#f0c020'];
