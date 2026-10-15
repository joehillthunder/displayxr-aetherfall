// The simulation: players, entities, orders, harvesting, construction, production, combat,
// abilities, hero levels, creeps and victory. The UI and the AI drive it through the same
// public methods (order, train, research, placeBuilding, cast).

import * as THREE from 'three';
import { unitDef, buildingDef, heroDef, creepDef, ABILITY, RESEARCH, HERO_XP, FACTIONS, HEROES, TEAM_COLORS } from './data.js';
import { makeUnitModel, makeBuildingModel, makeGoldMine, makeGeyser, makeRing, makeHealthBar } from './models.js';
import { findPath } from './path.js';
import { BLOCK, STARTS } from './world.js';
import { clamp, dist, angleTo, angleDiff } from './util.js';

export const NEUTRAL = 99;
const FLY_H = 3.2;

export class Game {
  constructor({ scene, world, fx, fog, audio, setup }) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.fog = fog;
    this.audio = audio;
    this.ents = new Map();
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.nextId = 1;
    this.time = 0;
    this.timers = [];
    this.messages = [];
    this.pings = [];
    this.selection = [];
    this.over = null;
    this.hash = new Map();
    this.pathBudget = 0;
    this.lastAlert = -99;
    this.onEvent = () => {};

    // players: 0 is the human, then the AI opponents
    this.players = setup.players.map((p, i) => ({
      id: i, faction: p.faction, heroId: p.hero, ai: i !== 0, color: TEAM_COLORS[i], start: STARTS[p.start],
      gold: 500, lumber: 200, aether: 0, supply: 0, cap: 0, alive: true, upgrades: { weapons: 0, armor: 0 },
      difficulty: p.difficulty ?? 'normal', hero: null,
      stats: { unitsTrained: 0, unitsLost: 0, kills: 0, gold: 0, lumber: 0, aether: 0, buildings: 0 },
    }));
    this.root = new THREE.Group();
    scene.add(this.root);
    this.spawnResources();
    for (const p of this.players) this.spawnStart(p);
    this.spawnCreeps();
    this.recountSupply();
  }

  // ── setup ───────────────────────────────────────────────────────────────────────────────────────
  spawnResources() {
    const w = this.world;
    for (const m of w.mines) {
      const e = this.addEnt({ type: 'mine', owner: NEUTRAL, x: m.x, z: m.z, size: 3, amount: m.amount, maxAmount: m.amount, hp: 1, maxHp: 1, name: 'Gold Mine' });
      e.model = makeGoldMine();
      e.model.rotation.y = Math.atan2(64 - m.x, 64 - m.z) + Math.PI * 0;
      this.place(e);
      w.setFootprint(e.x, e.z, 3, BLOCK.RESOURCE, e.id);
      this.resources.push(e);
    }
    for (const g of w.geysers) {
      const e = this.addEnt({ type: 'geyser', owner: NEUTRAL, x: g.x, z: g.z, size: 3, amount: g.amount, maxAmount: g.amount, hp: 1, maxHp: 1, great: g.great, name: g.great ? 'Great Aether Geyser' : 'Aether Geyser' });
      e.model = makeGeyser(g.great);
      this.place(e);
      e.plume = this.fx.addPlume(e.x, e.y + 0.15, e.z, { great: g.great });
      w.setFootprint(e.x, e.z, 3, BLOCK.RESOURCE, e.id);
      this.resources.push(e);
    }
  }

  spawnStart(p) {
    const s = p.start;
    const hall = this.createBuilding(p.id, 'hall', s.x, s.z, true);
    const mine = this.nearestRes(s.x, s.z, 'mine');
    hall.rally = mine ? { x: mine.x, z: mine.z, res: mine.id } : null;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pos = this.world.nearestOpen(s.x + Math.cos(a) * 3.2, s.z + Math.sin(a) * 3.2, 4);
      const u = this.createUnit(p.id, unitDef(p.faction, 'worker'), pos.x, pos.z);
      if (mine) this.order([u], { type: 'gather', res: mine.id });
    }
    const hp = this.world.nearestOpen(s.x + (64 - s.x) * 0.08, s.z + (64 - s.z) * 0.08 + 3, 5);
    p.hero = this.createUnit(p.id, heroDef(p.heroId), hp.x, hp.z);
    p.hero.level = 1;
  }

  spawnCreeps() {
    for (const c of this.world.camps) {
      c.creeps.forEach((k, i) => {
        const a = (i / c.creeps.length) * Math.PI * 2;
        const pos = this.world.nearestOpen(c.x + Math.cos(a) * 1.4, c.z + Math.sin(a) * 1.4, 4) ?? c;
        const u = this.createUnit(NEUTRAL, creepDef(k), pos.x, pos.z);
        u.home = { x: pos.x, z: pos.z };
        u.rot = Math.random() * 6.28;
      });
    }
  }

  // ── entities ────────────────────────────────────────────────────────────────────────────────────
  addEnt(e) {
    e.id = this.nextId++;
    e.y = this.world.heightAt(e.x, e.z);
    e.rot = e.rot ?? 0;
    e.dead = false;
    this.ents.set(e.id, e);
    return e;
  }

  place(e) {
    e.model.position.set(e.x, e.y, e.z);
    this.root.add(e.model);
  }

  teamColor(owner) { return owner === NEUTRAL ? '#b8a878' : this.players[owner].color; }

  createUnit(owner, def, x, z, opts = {}) {
    const radius = def.flying ? 0.55 : def.role === 'cavalry' || def.hero ? 0.5 : def.role === 'siege' ? 0.65 : def.look?.body === 'wyrm' ? 1.3 : def.look?.body === 'ogre' || def.look?.body === 'golem' ? 0.6 : 0.36;
    const u = this.addEnt({
      type: 'unit', owner, def, x, z, hp: def.hp, maxHp: def.hp, mana: def.maxMana ? def.maxMana * 0.5 : 0, maxMana: def.maxMana,
      order: { type: 'idle' }, path: null, cd: 0, atk: -1, carry: null, buffs: {}, abil: {}, radius, level: 0, xp: 0,
      flying: def.flying, life: opts.life ?? 0, summon: !!opts.life, scanT: Math.random() * 0.4, anim: { moving: false, attack: -1, work: false, cast: false, dead: 0 },
      hidden: false, autocast: true, visibleTo0: owner === 0,
    });
    u.model = makeUnitModel(def, this.teamColor(owner));
    u.model.root.position.set(x, u.y, z);
    this.root.add(u.model.root);
    u.bar = makeHealthBar(def.hero ? 1.3 : def.role === 'siege' || radius > 0.6 ? 1.2 : 0.8);
    u.bar.visible = false;
    this.root.add(u.bar);
    u.y = this.world.heightAt(x, z) + (u.flying ? FLY_H : 0);
    this.units.push(u);
    if (def.hero) u.level = 1;
    return u;
  }

  createBuilding(owner, type, x, z, complete = false) {
    const p = this.players[owner];
    const def = buildingDef(p.faction, type);
    const b = this.addEnt({
      type: 'building', owner, def, x, z, size: def.size, hp: complete ? def.hp : def.hp * 0.1, maxHp: def.hp,
      built: complete, progress: complete ? 1 : 0, queue: [], rally: null, cd: 0, builders: new Set(), seen: owner === 0, buffs: {},
    });
    const P = makeBuildingModel(def, this.teamColor(owner));
    b.model = P.root;
    b.parts = P;
    b.rot = owner === 0 ? 0 : 0;
    P.setProgress(b.progress);
    this.place(b);
    this.world.setFootprint(x, z, def.size, BLOCK.BUILDING, b.id);
    b.bar = makeHealthBar(def.size * 0.7);
    b.bar.visible = false;
    this.root.add(b.bar);
    if (type === 'extractor') {
      const g = this.resAt(x, z, 'geyser');
      if (g) { g.extractor = b.id; b.geyser = g.id; g.plume.strength = 0.4; g.model.visible = false; }
    }
    // push units off the footprint
    for (const u of this.units) {
      if (u.dead || u.flying || u.hidden) continue;
      if (Math.abs(u.x - x) < def.size / 2 + u.radius && Math.abs(u.z - z) < def.size / 2 + u.radius) {
        const o = this.world.nearestOpen(u.x, u.z, 6);
        if (o) { u.x = o.x; u.z = o.z; u.path = null; }
      }
    }
    if (complete) this.onBuilt(b);
    this.buildings.push(b);
    return b;
  }

  onBuilt(b) {
    b.built = true;
    b.progress = 1;
    b.parts.setProgress(1);
    const P = b.parts;
    b.smoke = (P.smoke || []).map((s) => this.fx.addSmoke(b.x + s.x, b.y + s.y, b.z + s.z, s.color ?? 0x8a8a8a));
    if (b.def.type === 'extractor') {
      const g = this.ents.get(b.geyser);
      if (g) g.plume.strength = 1.6;
      b.vent = this.fx.addPlume(b.x + P.vent.x, b.y + P.vent.y, b.z + P.vent.z, { strength: 0.5 });
    }
    this.players[b.owner].stats.buildings++;
    this.recountSupply();
    if (b.owner === 0 && this.time > 1) { this.msg(`${b.def.name} complete.`); this.audio?.play('built'); }
  }

  resAt(x, z, type) {
    return this.resources.find((r) => r.type === type && !r.dead && Math.abs(r.x - x) < 1.6 && Math.abs(r.z - z) < 1.6);
  }

  nearestRes(x, z, type, maxD = 1e9) {
    let best = null, bd = maxD;
    for (const r of this.resources) {
      if (r.dead || r.type !== type) continue;
      const d = dist(x, z, r.x, r.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // ── players and economy ─────────────────────────────────────────────────────────────────────────
  canAfford(pid, cost) { const p = this.players[pid]; return p.gold >= cost[0] && p.lumber >= cost[1] && p.aether >= cost[2]; }
  pay(pid, cost) { const p = this.players[pid]; p.gold -= cost[0]; p.lumber -= cost[1]; p.aether -= cost[2]; }
  refund(pid, cost, k = 1) { const p = this.players[pid]; p.gold += Math.floor(cost[0] * k); p.lumber += Math.floor(cost[1] * k); p.aether += Math.floor(cost[2] * k); }
  missing(pid, cost) {
    const p = this.players[pid];
    if (p.gold < cost[0]) return 'Not enough gold.';
    if (p.lumber < cost[1]) return 'Not enough lumber.';
    if (p.aether < cost[2]) return 'Not enough aether.';
    return null;
  }

  recountSupply() {
    for (const p of this.players) { p.supply = 0; p.cap = 0; }
    for (const u of this.units) if (!u.dead && u.owner !== NEUTRAL && !u.summon) this.players[u.owner].supply += u.def.supply;
    for (const b of this.buildings) {
      if (b.dead || b.owner === NEUTRAL) continue;
      const p = this.players[b.owner];
      if (b.built && b.def.supply) p.cap += b.def.supply;
      for (const q of b.queue) if (q.def?.supply) p.supply += q.def.supply;
    }
    for (const p of this.players) p.cap = Math.min(100, p.cap);
  }

  has(pid, type) { return this.buildings.some((b) => !b.dead && b.built && b.owner === pid && b.def.type === type); }
  reqsMet(pid, reqs) { return (reqs || []).every((r) => this.has(pid, r)); }
  missingReq(pid, reqs) {
    const p = this.players[pid];
    const m = (reqs || []).find((r) => !this.has(pid, r));
    return m ? `Requires ${FACTIONS[p.faction].buildings[m]}.` : null;
  }

  msg(text, kind = 'info') { this.messages.push({ text, kind, t: this.time }); this.onEvent('msg', { text, kind }); }

  // ── commands (shared by UI and AI) ──────────────────────────────────────────────────────────────
  order(units, ord, queued = false) {
    for (const u of units) {
      if (u.dead || u.type !== 'unit') continue;
      if (u.order.type === 'build' && !u.order.placed && u.order.paid) {
        this.refund(u.owner, u.order.def.cost);
      }
      const o = { ...ord };
      if (o.type === 'gather' && !u.def.worker) o.type = 'move';
      if (o.type === 'gather' && !o.phase) o.phase = u.carry?.amt > 0 ? 'drop' : 'go';
      u.order = o;
      u.path = null;
      u.atk = -1;
      u.target = null;
      u.workT = 0;
      if (u.hidden && o.type !== 'gather') this.unhide(u);
    }
  }

  carryTypeFor(r) {
    if (!r) return null;
    if (r.type === 'mine') return 'gold';
    if (r.type === 'geyser' || r.def?.type === 'extractor') return 'aether';
    if (r.tree) return 'lumber';
    return null;
  }

  /** Worker builds a building; cost is paid now and refunded if the order is cancelled. */
  placeBuilding(worker, type, x, z) {
    const p = this.players[worker.owner];
    const def = buildingDef(p.faction, type);
    const why = this.missing(worker.owner, def.cost) || this.missingReq(worker.owner, def.requires);
    if (why) return why;
    if (type === 'extractor') {
      const g = this.resAt(x, z, 'geyser');
      if (!g) return 'Must be built on an aether geyser.';
      if (g.extractor && !this.ents.get(g.extractor)?.dead) return 'That geyser already has an extractor.';
      x = g.x; z = g.z;
    } else if (!this.world.canPlace(x, z, def.size)) return 'Can\'t build there.';
    this.pay(worker.owner, def.cost);
    this.order([worker], { type: 'build', def, btype: type, x, z, paid: true, placed: false });
    return null;
  }

  train(b, key) {
    if (!b.built || b.dead) return 'Not ready.';
    if (b.queue.length >= 5) return 'Queue is full.';
    const p = this.players[b.owner];
    let def, kind = 'unit';
    if (key === 'hero') {
      def = heroDef(p.heroId);
      kind = 'hero';
      if (p.hero && !p.hero.dead) return 'Your hero is alive.';
      if (this.buildings.some((x) => x.owner === b.owner && x.queue.some((q) => q.kind === 'hero'))) return 'Already reviving.';
      const lvl = p.hero?.level ?? 1;
      def = { ...def, cost: [200 + lvl * 50, 0, 0], time: 25 + lvl * 5 };
    } else def = unitDef(p.faction, key);
    if (!b.def.trains.includes(key) && key !== 'hero') return 'Can\'t train that here.';
    const why = this.missing(b.owner, def.cost) || this.missingReq(b.owner, def.requires);
    if (why) return why;
    this.recountSupply();
    if (p.supply + def.supply > p.cap && kind !== 'hero') return p.cap >= 100 ? 'Supply limit reached.' : `Build more ${FACTIONS[p.faction].buildings.farm}s.`;
    this.pay(b.owner, def.cost);
    b.queue.push({ kind, key, def, t: 0, total: def.time });
    this.recountSupply();
    return null;
  }

  research(b, key) {
    if (!b.built) return 'Not ready.';
    const p = this.players[b.owner];
    const R = RESEARCH[key];
    const rank = p.upgrades[key] + b.queue.filter((q) => q.key === key).length;
    if (rank >= R.max) return 'Fully researched.';
    if (this.buildings.some((x) => x.owner === b.owner && x !== b && x.queue.some((q) => q.key === key))) return 'Already researching.';
    const cost = R.cost.map((c) => Math.round(c * (1 + rank * 0.6)));
    const why = this.missing(b.owner, cost);
    if (why) return why;
    if (b.queue.length >= 5) return 'Queue is full.';
    this.pay(b.owner, cost);
    b.queue.push({ kind: 'research', key, def: { cost, name: R.name }, t: 0, total: R.time * (1 + rank * 0.3) });
    return null;
  }

  cancelQueue(b, i) {
    const q = b.queue[i];
    if (!q) return;
    b.queue.splice(i, 1);
    this.refund(b.owner, q.def.cost);
    this.recountSupply();
  }

  cancelConstruction(b) {
    if (b.built || b.dead) return;
    this.refund(b.owner, b.def.cost, 0.75);
    this.destroy(b, null, true);
  }

  /** Cast a hero or unit ability. target: entity id or {x, z}. */
  cast(u, abId, target) {
    const A = ABILITY[abId];
    if (!A || u.dead) return 'Can\'t.';
    if (A.target === 'passive') return 'That ability is passive.';
    if (u.def.hero && (u.def.abilities.indexOf(abId) + 1) > u.level) return `Unlocks at level ${u.def.abilities.indexOf(abId) + 1}.`;
    if ((u.abil[abId] ?? 0) > 0) return 'Not ready yet.';
    if (u.mana < A.mana) return 'Not enough mana.';
    this.order([u], { type: 'cast', ab: abId, target });
    return null;
  }

  // ── simulation ──────────────────────────────────────────────────────────────────────────────────
  update(dt) {
    if (this.over) dt *= 0.25;
    this.time += dt;
    this.pathBudget = 16;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    this.buildHash();
    this.auraT = (this.auraT ?? 0) - dt;
    if (this.auraT <= 0) { this.auraT = 0.5; this.applyAuras(); }
    for (const u of this.units) if (!u.dead) this.updateUnit(u, dt);
    for (const b of this.buildings) if (!b.dead) this.updateBuilding(b, dt);
    this.updateDead(dt);
    this.world.updateTrees(dt);
    this.checkVictT = (this.checkVictT ?? 0) - dt;
    if (this.checkVictT <= 0) { this.checkVictT = 1; this.checkVictory(); }
  }

  buildHash() {
    const h = this.hash;
    h.clear();
    for (const u of this.units) {
      if (u.dead || u.hidden) continue;
      const k = (Math.floor(u.x / 4) << 8) | Math.floor(u.z / 4);
      let a = h.get(k);
      if (!a) h.set(k, (a = []));
      a.push(u);
    }
  }

  near(x, z, r, fn) {
    const x0 = Math.floor((x - r) / 4), x1 = Math.floor((x + r) / 4), z0 = Math.floor((z - r) / 4), z1 = Math.floor((z + r) / 4);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const a = this.hash.get((gx << 8) | gz);
      if (a) for (const u of a) if ((u.x - x) ** 2 + (u.z - z) ** 2 <= r * r) fn(u);
    }
  }

  isEnemy(a, b) { return a.owner !== b.owner; }

  canAttack(a, t) {
    if (!t || t.dead || t.hidden) return false;
    if (t.type === 'mine' || t.type === 'geyser') return false;
    if (!this.isEnemy(a, t)) return false;
    const dmg = a.type === 'building' ? a.def.attack : a.def.dmg;
    if (!dmg) return false;
    if (t.flying && a.type === 'unit' && a.def.range < 2 && !a.flying) return false;
    if (t.flying && a.def.role === 'siege') return false;
    if (a.def.worker && t.type === 'building' && false) return false;
    return true;
  }

  /** Distance from a unit to a target's edge. */
  edgeDist(u, t) {
    if (t.type === 'building' || t.type === 'mine' || t.type === 'geyser') {
      const h = t.size / 2;
      const dx = Math.max(0, Math.abs(u.x - t.x) - h), dz = Math.max(0, Math.abs(u.z - t.z) - h);
      return Math.hypot(dx, dz) - (u.radius ?? 0);
    }
    if (t.tree) return dist(u.x, u.z, t.x, t.z) - 0.5 - u.radius;
    return dist(u.x, u.z, t.x, t.z) - (t.radius ?? 0.4) - (u.radius ?? 0.4);
  }

  armorOf(u) {
    let a = u.def.armor ?? 0;
    if (u.type === 'unit' && u.owner !== NEUTRAL) a += this.players[u.owner].upgrades.armor * 2;
    if (u.def.hero) a += (u.level - 1) * 0.5;
    if (u.buffs.avatar > 0) a += 6;
    if (u.buffs.shield > 0) a += u.shieldAmt ?? 4;
    if (u.buffs.auraArmor > 0) a += 3;
    return a;
  }
  dmgOf(u) {
    if (u.type === 'building') return u.def.attack.dmg + (this.players[u.owner]?.upgrades.weapons ?? 0) * 2;
    let d = u.def.dmg;
    if (u.owner !== NEUTRAL) d += this.players[u.owner].upgrades.weapons * 2;
    if (u.def.hero) d += (u.level - 1) * 3;
    if (u.buffs.avatar > 0) d += 25;
    if (u.buffs.roar > 0) d *= 1.4;
    return d;
  }
  speedOf(u) {
    let s = u.def.speed;
    if (u.buffs.slow > 0) s *= 0.5;
    if (u.buffs.auraSpeed > 0) s *= 1.25;
    return s;
  }
  rangeOf(u) { return u.type === 'building' ? u.def.attack.range : u.def.range; }
  powerOf(u) { return 1 + 0.15 * ((u.level || 1) - 1); }

  applyAuras() {
    for (const h of this.units) {
      if (h.dead || !h.def.hero) continue;
      h.def.abilities.forEach((id, i) => {
        const A = ABILITY[id];
        if (A.kind !== 'aura' || h.level < i + 1) return;
        this.near(h.x, h.z, A.radius, (o) => {
          if (o.owner !== h.owner || o.dead) return;
          if (A.aura === 'armor') o.buffs.auraArmor = 0.8;
          if (A.aura === 'speed') { o.buffs.auraSpeed = 0.8; o.hp = Math.min(o.maxHp, o.hp + 1); }
        });
      });
    }
  }

  // ── unit update ─────────────────────────────────────────────────────────────────────────────────
  updateUnit(u, dt) {
    for (const k in u.buffs) if (u.buffs[k] > 0) u.buffs[k] -= dt;
    for (const k in u.abil) if (u.abil[k] > 0) u.abil[k] -= dt;
    if (u.buffs.avatar <= 0 && u.avatarOn) { u.avatarOn = false; u.maxHp -= 400; u.hp = Math.min(u.hp, u.maxHp); u.model.root.scale.setScalar(1); }
    // regen
    u.hp = Math.min(u.maxHp, u.hp + (u.def.regen ?? 0) * dt * (u.def.hero ? 1.5 : 0.5));
    if (u.maxMana) u.mana = Math.min(u.maxMana, u.mana + dt * (u.def.hero ? 1.2 + u.level * 0.15 : 0.8));
    if (u.life) { u.life -= dt; if (u.life <= 0) { this.kill(u, null); return; } }
    u.cd -= dt;
    u.anim.moving = false;
    u.anim.work = false;
    u.anim.cast = false;
    const stunned = u.buffs.stun > 0;
    if (stunned) { u.anim.attack = -1; this.syncModel(u, dt); return; }

    // attack swing in progress
    if (u.atk >= 0) {
      const t = this.ents.get(u.atkTarget);
      const swing = Math.min(0.55, u.def.cd * 0.45);
      const prev = u.atk;
      u.atk += dt / swing;
      if (prev < 0.45 && u.atk >= 0.45 && t && !t.dead) this.strike(u, t);
      if (u.atk >= 1) u.atk = -1;
      u.anim.attack = u.atk;
      if (u.atk >= 0) { this.faceTo(u, t?.x ?? u.x, t?.z ?? u.z, dt); this.syncModel(u, dt); return; }
    }
    u.anim.attack = -1;

    const o = u.order;
    switch (o.type) {
      case 'idle': case 'hold': this.doIdle(u, dt, o.type === 'hold'); break;
      case 'move': if (this.moveTo(u, o.x, o.z, dt, 0.3)) u.order = { type: 'idle' }; break;
      case 'amove': this.doAttackMove(u, o, dt); break;
      case 'attack': this.doAttack(u, o, dt); break;
      case 'gather': this.doGather(u, o, dt); break;
      case 'build': this.doBuild(u, o, dt); break;
      case 'construct': this.doConstruct(u, o, dt); break;
      case 'cast': this.doCast(u, o, dt); break;
      default: u.order = { type: 'idle' };
    }
    this.autocast(u);
    if (!u.flying && !u.hidden) this.separate(u, dt);
    this.syncModel(u, dt);
  }

  syncModel(u, dt) {
    const ground = this.world.heightAt(u.x, u.z);
    const target = u.flying ? Math.max(ground, 0) + FLY_H : Math.max(ground, -0.35);
    u.y += (target - u.y) * Math.min(1, dt * 10);
    const r = u.model.root;
    r.position.set(u.x, u.y, u.z);
    r.rotation.y = u.rot;
    u.anim.speedMul = this.speedOf(u) / 3;
    u.model.animate(dt, u.anim);
  }

  faceTo(u, x, z, dt) {
    if (Math.abs(x - u.x) + Math.abs(z - u.z) < 1e-3) return;
    const a = angleTo(u.x, u.z, x, z);
    u.rot += angleDiff(u.rot, a) * Math.min(1, dt * 10);
  }

  /** Step along a path to (x, z). Returns true on arrival (within `tol`). */
  moveTo(u, x, z, dt, tol = 0.4, target = null) {
    const d = dist(u.x, u.z, x, z);
    if (d <= tol) { u.path = null; return true; }
    const goalChanged = !u.pathGoal || Math.abs(u.pathGoal.x - x) + Math.abs(u.pathGoal.z - z) > 1.0;
    if (goalChanged || (!u.path && this.time >= (u.repathAt ?? 0))) {
      u.pathGoal = { x, z };
      u.pathI = 0;
      u.prog = { x: u.x, z: u.z, t: 0 };
      if (u.flying) u.path = [{ x, z }];
      else {
        if (this.pathBudget <= 0) { u.pathGoal = null; return false; }
        this.pathBudget--;
        u.path = findPath(this.world, u.x, u.z, x, z);
        u.repathAt = this.time + 0.7;
        if (!u.path.length) { u.path = null; u.stuck = (u.stuck ?? 0) + 1; return u.stuck > 2; }
      }
    }
    if (!u.path) {
      // the path ended short of the goal (blocked target, or unreachable)
      if (d <= tol + 1.5) return true;
      return false;
    }
    const wp = u.path[u.pathI];
    if (!wp) { u.path = null; if (d > tol + 1.5) u.stuck = (u.stuck ?? 0) + 1; return d < tol + 1.5 || u.stuck > 3; }
    const sp = this.speedOf(u) * dt;
    const dd = dist(u.x, u.z, wp.x, wp.z);
    this.faceTo(u, wp.x, wp.z, dt);
    if (dd <= sp) {
      u.x = wp.x; u.z = wp.z; u.pathI++;
      if (u.pathI >= u.path.length) { u.path = null; return dist(u.x, u.z, x, z) <= tol + 1.5; }
    } else {
      const nx = u.x + (wp.x - u.x) / dd * sp, nz = u.z + (wp.z - u.z) / dd * sp;
      if (!u.flying && this.world.isBlocked(Math.floor(nx), Math.floor(nz))) { u.path = null; u.pathGoal = null; return false; }
      u.x = nx; u.z = nz;
    }
    u.anim.moving = true;
    // stuck detection
    u.prog.t += dt;
    if (u.prog.t > 1.5) {
      if (dist(u.x, u.z, u.prog.x, u.prog.z) < 0.3) { u.path = null; u.pathGoal = null; u.stuck = (u.stuck ?? 0) + 1; if (u.stuck > 3) { u.stuck = 0; return true; } }
      else u.stuck = 0;
      u.prog = { x: u.x, z: u.z, t: 0 };
    }
    return false;
  }

  separate(u, dt) {
    let px = 0, pz = 0;
    this.near(u.x, u.z, 1.6, (o) => {
      if (o === u || o.flying || o.dead) return;
      const dx = u.x - o.x, dz = u.z - o.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const min = u.radius + o.radius;
      if (d < min) { const k = (min - d) / min; px += dx / d * k; pz += dz / d * k; }
    });
    if (px || pz) {
      const moving = u.anim.moving ? 1.2 : 2.4;
      const nx = u.x + px * dt * moving, nz = u.z + pz * dt * moving;
      if (!this.world.isBlocked(Math.floor(nx), Math.floor(nz))) { u.x = nx; u.z = nz; }
    }
  }

  // ── combat ──────────────────────────────────────────────────────────────────────────────────────
  findTarget(u, r) {
    let best = null, bd = 1e9;
    const consider = (o) => {
      if (!this.canAttack(u, o)) return;
      if (u.owner === 0 || o.owner === 0) { /* fair: AI also needs sight, but keep it simple */ }
      let d = this.edgeDist(u, o);
      if (o.type === 'building') d += 3; // prefer units
      if (o.def.worker) d += 0.5;
      if (d < bd && d <= r) { bd = d; best = o; }
    };
    this.near(u.x, u.z, r + 2, consider);
    for (const b of this.buildings) if (!b.dead && Math.abs(b.x - u.x) < r + 3 && Math.abs(b.z - u.z) < r + 3) consider(b);
    return best;
  }

  doIdle(u, dt, hold) {
    if (u.def.worker || !u.def.dmg) {
      if (u.def.worker && u.owner === 0) {}
      return;
    }
    u.scanT -= dt;
    if (u.scanT > 0) return;
    u.scanT = 0.4;
    // creeps: guard home, leash back
    if (u.owner === NEUTRAL && u.home) {
      if (dist(u.x, u.z, u.home.x, u.home.z) > 1.5) { u.order = { type: 'move', x: u.home.x, z: u.home.z }; return; }
      const t = this.findTarget(u, 5.5);
      if (t) u.order = { type: 'attack', target: t.id, creep: true };
      return;
    }
    const r = hold ? this.rangeOf(u) : Math.max(this.rangeOf(u) + 1.5, 6.5);
    const t = this.findTarget(u, r);
    if (t) u.order = { type: 'attack', target: t.id, auto: true, hold, from: { x: u.x, z: u.z } };
  }

  doAttackMove(u, o, dt) {
    u.scanT -= dt;
    if (u.scanT <= 0 && u.def.dmg) {
      u.scanT = 0.35;
      const t = this.findTarget(u, Math.max(this.rangeOf(u) + 1.5, 7));
      if (t) { u.order = { type: 'attack', target: t.id, auto: true, resume: { ...o } }; return; }
    }
    if (this.moveTo(u, o.x, o.z, dt, 1)) u.order = { type: 'idle' };
  }

  doAttack(u, o, dt) {
    const t = this.ents.get(o.target);
    const done = () => { u.order = o.resume ? o.resume : (o.hold ? { type: 'hold' } : { type: 'idle' }); u.path = null; };
    if (!t || t.dead || !this.canAttack(u, t)) return done();
    if (t.owner !== 0 && u.owner === 0 && t.type === 'unit' && !this.fog.visible(t.x, t.z)) return done();
    // creeps leash
    if (o.creep && u.home && dist(u.x, u.z, u.home.x, u.home.z) > 11) { u.order = { type: 'move', x: u.home.x, z: u.home.z }; u.hp = u.maxHp; return; }
    if (o.auto && o.from && !o.resume && dist(u.x, u.z, o.from.x, o.from.z) > 14) return done();
    const range = this.rangeOf(u);
    const d = this.edgeDist(u, t);
    if (d <= range + 0.15) {
      u.path = null;
      this.faceTo(u, t.x, t.z, dt);
      if (u.cd <= 0) { u.cd = u.def.cd; u.atk = 0; u.atkTarget = t.id; }
      return;
    }
    if (o.hold) return done();
    // retarget to something closer while auto-fighting
    if (o.auto) {
      u.scanT -= dt;
      if (u.scanT <= 0) { u.scanT = 0.8; const c = this.findTarget(u, Math.min(d, range + 1.5)); if (c && c !== t) o.target = c.id; }
    }
    const gx = t.type === 'unit' ? t.x : t.x, gz = t.z;
    if (u.path && u.pathGoal && dist(gx, gz, u.pathGoal.x, u.pathGoal.z) > 1.5) u.path = null;
    this.moveTo(u, gx, gz, dt, 0);
  }

  strike(u, t) {
    const dmg = this.dmgOf(u);
    const proj = u.type === 'building' ? u.def.attack.proj : u.def.proj;
    if (proj && this.rangeOf(u) > 2) {
      const from = this.muzzle(u);
      const tid = t.id;
      const last = { x: t.x, y: t.y + this.hitHeight(t), z: t.z };
      const aim = () => { const e = this.ents.get(tid); if (e && !e.dead) { last.x = e.x; last.y = e.y + this.hitHeight(e); last.z = e.z; } return last; };
      const color = proj === 'bolt' ? (u.def.hero ? 0xffe08a : 0x9fd8ff) : null;
      this.fx.shoot(proj, from, proj === 'boulder' ? { ...last } : aim, (p) => {
        const e = this.ents.get(tid);
        if (u.def.splash) this.splash(u, p.x, p.z, u.def.splash, dmg, e);
        else if (e && !e.dead) this.damage(u, e, dmg);
      }, color);
      if (this.visibleToPlayer(u)) this.audio?.play(proj === 'bullet' || proj === 'boulder' ? 'boom' : 'shoot', u);
    } else {
      if (u.def.splash) this.splash(u, t.x, t.z, u.def.splash, dmg, t);
      else this.damage(u, t, dmg);
      if (this.visibleToPlayer(u)) this.audio?.play('hit', u);
    }
  }

  muzzle(u) {
    if (u.type === 'building') { const m = u.parts.muzzle ?? [0, 3, 0]; return { x: u.x + m[0], y: u.y + m[1], z: u.z + m[2] }; }
    return { x: u.x + Math.sin(u.rot) * 0.4, y: u.y + (u.flying ? 0 : (u.model.height ?? 1.5) * 0.65), z: u.z + Math.cos(u.rot) * 0.4 };
  }
  hitHeight(t) { return t.type === 'building' ? 1.2 : t.flying ? 0 : (t.model?.height ?? 1.4) * 0.55; }

  splash(src, x, z, r, dmg, primary) {
    if (primary && !primary.dead) this.damage(src, primary, dmg);
    this.near(x, z, r, (o) => { if (o !== primary && this.isEnemy(src, o) && !o.flying) this.damage(src, o, dmg * 0.5); });
    for (const b of this.buildings) if (b !== primary && !b.dead && this.isEnemy(src, b) && Math.abs(b.x - x) < r + b.size / 2 && Math.abs(b.z - z) < r + b.size / 2) this.damage(src, b, dmg * 0.5);
  }

  damage(src, t, amount, opts = {}) {
    if (!t || t.dead) return;
    if (t.buffs?.invuln > 0) { this.fx.burst(t.x, t.y + 1, t.z, 0xfff2b0, 4, 1, 0.2, 0.3, 0); return; }
    let dmg = amount;
    if (!opts.magic) {
      const armor = t.type === 'building' ? (t.def.armor ?? 5) + (src?.def?.bldBonus > 1 ? -3 : 0) : this.armorOf(t);
      const red = armor >= 0 ? (armor * 0.06) / (1 + armor * 0.06) : -(1 - Math.pow(0.94, -armor));
      dmg *= 1 - red;
      if (t.type === 'building' && src?.def?.bldBonus) dmg *= src.def.bldBonus;
      if (src?.def?.worker && t.type === 'building') dmg *= 0.5;
    }
    t.hp -= dmg;
    t.lastHit = this.time;
    if (t.type === 'unit' && !t.def.look?.machine && Math.random() < 0.6) this.fx.blood(t.x, t.y + this.hitHeight(t), t.z, t.def.look?.body === 'undead' || t.def.faction === 'dread' ? 0xd8d4c0 : t.def.look?.body === 'treant' ? 0x6a8a3a : 0x8a1a1a);
    if (t.type === 'building') this.fx.burst(t.x + (Math.random() - 0.5) * t.size * 0.6, t.y + 1 + Math.random(), t.z + (Math.random() - 0.5) * t.size * 0.6, 0xffc080, 3, 2, 0.12, 0.4);
    // counter-attack: idle units fight back
    if (src && t.type === 'unit' && !src.dead && (t.order.type === 'idle' || (t.order.type === 'gather' && false)) && this.canAttack(t, src)) t.order = { type: 'attack', target: src.id, auto: true, from: { x: t.x, z: t.z } };
    if (src && t.owner === 0 && src.owner !== 0 && this.time - this.lastAlert > 12) {
      this.lastAlert = this.time;
      this.msg(t.type === 'building' ? 'Your base is under attack!' : 'Your forces are under attack!', 'alert');
      this.pings.push({ x: t.x, z: t.z, t: this.time });
      this.audio?.play('alert');
    }
    if (t.owner !== NEUTRAL && src && src.owner !== t.owner) this.onEvent('attacked', { victim: t, src });
    if (t.hp <= 0) this.kill(t, src);
  }

  heal(t, amount) {
    if (!t || t.dead) return;
    t.hp = Math.min(t.maxHp, t.hp + amount);
  }

  kill(t, src) {
    if (t.dead) return;
    t.dead = true;
    t.deadT = 0;
    t.hp = 0;
    if (t.type === 'building') return this.destroy(t, src);
    if (this.visibleToPlayer(t)) this.audio?.play('die', t);
    this.unhide(t);
    t.bar.visible = false;
    if (t.ring) t.ring.visible = false;
    const p = this.players[t.owner];
    if (p && !t.summon) p.stats.unitsLost++;
    if (src && src.owner !== NEUTRAL && src.owner !== t.owner) {
      const sp = this.players[src.owner];
      sp.stats.kills++;
      if (t.def.bounty) { sp.gold += t.def.bounty; if (src.owner === 0) this.fx.burst(t.x, t.y + 1.5, t.z, 0xffd040, 8, 1.5, 0.2, 0.8, 1); }
      // hero experience
      const heroes = this.units.filter((h) => !h.dead && h.def.hero && h.owner === src.owner && dist(h.x, h.z, t.x, t.z) < 16);
      const xp = (t.def.xp ?? 20) * (t.def.hero ? 2 : 1) * (t.summon ? 0.3 : 1);
      for (const h of heroes) this.giveXp(h, xp / heroes.length);
    }
    if (t.carry) t.carry = null;
    if (this.selection.includes(t)) { this.selection = this.selection.filter((s) => s !== t); this.onEvent('selection'); }
    if (t.def.worker) this.leaveConstruction(t);
    this.recountSupply();
    if (t.def.hero && t.owner !== NEUTRAL) { this.msg(t.owner === 0 ? `${t.def.name} has fallen! Revive your hero at your ${FACTIONS[p.faction].buildings.hall}.` : `Enemy hero ${t.def.name} has fallen!`, t.owner === 0 ? 'alert' : 'good'); }
  }

  giveXp(h, xp) {
    if (h.level >= HERO_XP.length) return;
    h.xp += xp;
    while (h.level < HERO_XP.length && h.xp >= HERO_XP[h.level]) {
      h.level++;
      h.maxHp += 80; h.hp = Math.min(h.maxHp, h.hp + 200);
      h.maxMana += 30; h.mana += 60;
      this.fx.column(h.x, h.y, h.z, 0xffe08a, 4, 1.2, 0.9);
      this.fx.ring(h.x, h.y, h.z, 3, 0xffe08a, 0.8);
      if (h.owner === 0) {
        const ab = h.def.abilities[h.level - 1];
        this.msg(`${h.def.name} reached level ${h.level}!${ab ? ` New ability: ${ABILITY[ab].name}.` : ''}`, 'good');
        this.audio?.play('level');
      }
    }
  }

  destroy(b, src, quiet = false) {
    b.dead = true;
    b.deadT = 0;
    b.bar.visible = false;
    if (b.ring) b.ring.visible = false;
    this.world.setFootprint(b.x, b.z, b.size, BLOCK.BUILDING);
    for (const s of b.smoke || []) this.fx.remove(s);
    this.fx.remove(b.fire);
    this.fx.remove(b.vent);
    if (b.def.type === 'extractor') {
      const g = this.ents.get(b.geyser);
      if (g) { g.extractor = null; g.plume.strength = 1; g.model.visible = true; this.world.setFootprint(g.x, g.z, 3, BLOCK.RESOURCE, g.id); }
    }
    for (const q of b.queue) if (!quiet) { /* lost */ }
    b.queue = [];
    if (!quiet) { this.fx.dust(b.x, b.y, b.z, 30, 0x7a6a5a); this.fx.burst(b.x, b.y + 1.5, b.z, 0xff9a40, 30, 4, 0.4, 1); if (this.visibleToPlayer(b)) this.audio?.play('collapse'); }
    if (src && src.owner !== NEUTRAL && src.owner !== b.owner) this.players[src.owner].stats.kills++;
    if (this.selection.includes(b)) { this.selection = this.selection.filter((s) => s !== b); this.onEvent('selection'); }
    for (const id of b.builders) { const w = this.ents.get(id); if (w && w.order.type === 'construct') w.order = { type: 'idle' }; }
    this.recountSupply();
  }

  updateDead(dt) {
    for (const list of [this.units, this.buildings]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e.dead) continue;
        e.deadT += dt;
        if (e.type === 'unit') { e.anim.dead = e.deadT / 3; e.model.animate(dt, e.anim); }
        else { e.model.position.y = e.y - e.deadT * 1.5; e.model.rotation.z = Math.sin(e.deadT * 30) * 0.02; }
        if (e.deadT > (e.type === 'unit' ? 3.2 : 2.5)) {
          this.root.remove(e.type === 'unit' ? e.model.root : e.model);
          this.root.remove(e.bar);
          if (e.ring) this.root.remove(e.ring);
          list.splice(i, 1);
          if (!(e.def?.hero)) this.ents.delete(e.id);
        }
      }
    }
  }

  // ── harvesting ──────────────────────────────────────────────────────────────────────────────────
  dropoffFor(u) {
    let best = null, bd = 1e9;
    for (const b of this.buildings) {
      if (b.dead || !b.built || b.owner !== u.owner || !b.def.dropoff) continue;
      const d = dist(u.x, u.z, b.x, b.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  hide(u) { u.hidden = true; u.model.root.visible = false; u.bar.visible = false; }
  unhide(u) { if (!u.hidden) return; u.hidden = false; u.model.root.visible = true; }

  doGather(u, o, dt) {
    let r = o.tree ? null : this.ents.get(o.res);
    // a geyser with an extractor is worked through the extractor
    if (r && r.type === 'geyser') r = r.extractor ? this.ents.get(r.extractor) : null;
    if (r && r.def?.type === 'extractor' && (r.owner !== u.owner || !r.built)) r = null;
    let tree = o.tree;
    if (o.phase === 'drop') {
      const hall = this.dropoffFor(u);
      if (!hall) { u.order = { type: 'idle' }; return; }
      if (this.edgeDist(u, hall) <= 0.6) {
        const p = this.players[u.owner];
        if (u.carry) {
          const amt = u.carry.amt;
          p[u.carry.res] += amt;
          p.stats[u.carry.res] += amt;
          if (u.owner === 0) this.onEvent('income', { res: u.carry.res, amt, x: hall.x, z: hall.z });
          u.carry = null;
          u.model.carry && (u.model.carry.visible = false);
        }
        o.phase = 'go';
        u.path = null;
        if (o.lumber && (!tree || !tree.alive)) {
          tree = o.tree = this.world.nearestTree(o.lastTree?.x ?? u.x, o.lastTree?.z ?? u.z, 25);
          if (!tree) { u.order = { type: 'idle' }; return; }
        }
        return;
      }
      this.moveTo(u, hall.x, hall.z, dt, 0);
      if (!u.path && this.edgeDist(u, hall) > 0.6 && u.stuck > 2) { u.order = { type: 'idle' }; }
      return;
    }
    // lumber
    if (o.lumber) {
      if (!tree || !tree.alive) {
        tree = o.tree = this.world.nearestTree(o.lastTree?.x ?? u.x, o.lastTree?.z ?? u.z, 25);
        if (!tree) { u.order = { type: 'idle' }; return; }
        u.path = null;
      }
      o.lastTree = { x: tree.x, z: tree.z };
      if (this.edgeDist(u, { tree: true, x: tree.x, z: tree.z }) <= 0.7) {
        u.anim.work = true;
        this.faceTo(u, tree.x, tree.z, dt);
        const before = u.workT ?? 0;
        u.workT = before + dt;
        if (Math.floor(before) !== Math.floor(u.workT)) { this.world.chopTree(tree, 0); if (this.visibleToPlayer(u)) this.audio?.play('chop', u); }
        if (u.workT >= 4.5) {
          u.workT = 0;
          this.world.chopTree(tree, 10);
          u.carry = { res: 'lumber', amt: 10 };
          o.phase = 'drop';
          u.path = null;
        }
        return;
      }
      this.moveTo(u, tree.x, tree.z, dt, 0);
      if (u.stuck > 2) { u.stuck = 0; o.tree = null; }
      return;
    }
    if (!r || r.dead) {
      // mine ran out or extractor gone: look for another of the same kind nearby
      const kind = o.kind ?? 'mine';
      const alt = kind === 'mine' ? this.nearestRes(u.x, u.z, 'mine', 30) : null;
      if (alt) { o.res = alt.id; return; }
      u.order = { type: 'idle' }; this.unhide(u); return;
    }
    o.kind = r.type === 'mine' ? 'mine' : 'aether';
    if (u.hidden) {
      u.workT += dt;
      if (u.workT >= (o.kind === 'mine' ? 1.6 : 1.2)) {
        const src = r.type === 'mine' ? r : this.ents.get(r.geyser);
        const amt = o.kind === 'mine' ? 10 : 8;
        if (src) {
          src.amount -= amt;
          if (src.amount <= 0 && r.type === 'mine') this.exhaustMine(src);
        }
        u.carry = { res: o.kind === 'mine' ? 'gold' : 'aether', amt };
        this.unhide(u);
        const hall = this.dropoffFor(u);
        // pop out on the side facing the hall
        if (hall) {
          const a = angleTo(r.x, r.z, hall.x, hall.z);
          const pos = this.world.nearestOpen(r.x + Math.sin(a) * (r.size / 2 + 0.6), r.z + Math.cos(a) * (r.size / 2 + 0.6), 4);
          if (pos) { u.x = pos.x; u.z = pos.z; }
          u.rot = a;
        }
        o.phase = 'drop';
        u.path = null;
      }
      return;
    }
    if (this.edgeDist(u, r) <= 0.7) {
      if (u.carry && u.carry.amt) { o.phase = 'drop'; return; }
      u.workT = 0;
      this.hide(u);
      return;
    }
    this.moveTo(u, r.x, r.z, dt, 0);
  }

  exhaustMine(m) {
    m.dead = true;
    this.world.setFootprint(m.x, m.z, 3, BLOCK.RESOURCE);
    this.root.remove(m.model);
    this.fx.dust(m.x, m.y, m.z, 30);
    for (const u of this.units) if (u.hidden && u.order.res === m.id) { u.workT = 99; }
    this.msg('A gold mine has collapsed.');
  }

  // ── construction ────────────────────────────────────────────────────────────────────────────────
  doBuild(u, o, dt) {
    const half = o.def.size / 2;
    const dx = Math.max(0, Math.abs(u.x - o.x) - half), dz = Math.max(0, Math.abs(u.z - o.z) - half);
    if (Math.hypot(dx, dz) <= 1.0) {
      // place it
      const ok = o.btype === 'extractor'
        ? (() => { const g = this.resAt(o.x, o.z, 'geyser'); return g && !g.extractor; })()
        : this.world.canPlace(o.x, o.z, o.def.size);
      if (!ok) {
        this.refund(u.owner, o.def.cost);
        u.order = { type: 'idle' };
        if (u.owner === 0) this.msg('Can\'t build there; something is in the way.', 'warn');
        return;
      }
      if (o.btype === 'extractor') { const g = this.resAt(o.x, o.z, 'geyser'); this.world.setFootprint(g.x, g.z, 3, BLOCK.RESOURCE); }
      const b = this.createBuilding(u.owner, o.btype, o.x, o.z, false);
      o.placed = true;
      u.order = { type: 'construct', target: b.id };
      b.builders.add(u.id);
      if (u.owner === 0) this.audio?.play('place');
      return;
    }
    this.moveTo(u, o.x, o.z, dt, 0);
    if (u.stuck > 3) { this.refund(u.owner, o.def.cost); u.order = { type: 'idle' }; if (u.owner === 0) this.msg('Can\'t reach that spot.', 'warn'); }
  }

  doConstruct(u, o, dt) {
    const b = this.ents.get(o.target);
    if (!b || b.dead || b.built) { this.leaveConstruction(u); u.order = { type: 'idle' }; this.afterBuild(u); return; }
    b.builders.add(u.id);
    if (this.edgeDist(u, b) > 0.9) { this.moveTo(u, b.x, b.z, dt, 0); return; }
    u.anim.work = true;
    this.faceTo(u, b.x, b.z, dt);
    // several builders speed it up, with diminishing returns
    const n = [...b.builders].filter((id) => { const w = this.ents.get(id); return w && !w.dead && w.order.type === 'construct' && w.order.target === b.id; }).length;
    const rate = (1 + (n - 1) * 0.6) / n;
    const dk = (dt / b.def.time) * rate * (this.players[u.owner].ai ? this.aiSpeed(u.owner) : 1);
    b.progress = Math.min(1, b.progress + dk);
    b.hp = Math.min(b.maxHp, b.hp + b.def.hp * 0.9 * dk);
    b.parts.setProgress(b.progress);
    if (Math.random() < dt * 2) this.fx.dust(b.x + (Math.random() - 0.5) * b.size, b.y, b.z + (Math.random() - 0.5) * b.size, 2);
    if (b.progress >= 1) { this.onBuilt(b); this.leaveConstruction(u); u.order = { type: 'idle' }; this.afterBuild(u); }
  }

  afterBuild(u) {
    // builders go back to work: the nearest mine
    const m = this.nearestRes(u.x, u.z, 'mine', 30);
    if (m) this.order([u], { type: 'gather', res: m.id });
  }

  leaveConstruction(u) { for (const b of this.buildings) b.builders?.delete(u.id); }

  aiSpeed(pid) { return { easy: 0.85, normal: 1, hard: 1.2 }[this.players[pid].difficulty] ?? 1; }

  // ── buildings ───────────────────────────────────────────────────────────────────────────────────
  updateBuilding(b, dt) {
    b.parts.animate(dt);
    if (!b.built) {
      if (b.hp < b.maxHp * 0.5 && !b.fire) { /* under construction: no fire */ }
      return;
    }
    // fire when badly damaged
    if (b.hp < b.maxHp * 0.45 && !b.fire) b.fire = this.fx.addFire(b.x + 0.3, b.y + 1.6, b.z - 0.2, 1 + b.size * 0.15);
    if (b.hp >= b.maxHp * 0.45 && b.fire) { this.fx.remove(b.fire); b.fire = null; }
    // production
    const q = b.queue[0];
    if (q) {
      const p = this.players[b.owner];
      if (q.kind !== 'research' && q.kind !== 'hero') {
        // supply may have dropped (farm destroyed): wait
        if (p.supply > p.cap) { q.blocked = true; return; }
      }
      q.blocked = false;
      q.t += dt * (p.ai ? this.aiSpeed(b.owner) : 1);
      if (q.t >= q.total) {
        b.queue.shift();
        if (q.kind === 'research') {
          p.upgrades[q.key]++;
          if (b.owner === 0) { this.msg(`${RESEARCH[q.key].name} rank ${p.upgrades[q.key]} researched.`, 'good'); this.audio?.play('built'); }
        } else this.spawnFrom(b, q);
      }
    }
    // towers
    if (b.def.attack) {
      b.cd -= dt;
      b.scanT = (b.scanT ?? 0) - dt;
      let t = this.ents.get(b.target);
      if (!t || t.dead || this.edgeDist({ x: b.x, z: b.z, radius: 0 }, t) > b.def.attack.range || !this.canAttack(b, t)) {
        t = null;
        if (b.scanT <= 0) {
          b.scanT = 0.4;
          let bd = 1e9;
          this.near(b.x, b.z, b.def.attack.range + 1, (o) => { if (this.canAttack(b, o)) { const d = dist(b.x, b.z, o.x, o.z); if (d < bd) { bd = d; t = o; } } });
        }
        b.target = t?.id;
      }
      if (t && b.cd <= 0) { b.cd = b.def.attack.cd; this.strike(b, t); }
    }
  }

  spawnFrom(b, q) {
    const p = this.players[b.owner];
    const ang = b.rally ? angleTo(b.x, b.z, b.rally.x, b.rally.z) : Math.PI * 0.25;
    const pos = this.world.nearestOpen(b.x + Math.sin(ang) * (b.size / 2 + 0.8), b.z + Math.cos(ang) * (b.size / 2 + 0.8), 6) ?? { x: b.x, z: b.z + b.size };
    let u;
    if (q.kind === 'hero') {
      const old = p.hero;
      u = this.createUnit(b.owner, heroDef(p.heroId), pos.x, pos.z);
      if (old) {
        u.level = old.level; u.xp = old.xp; u.maxHp = old.maxHp; u.hp = old.maxHp; u.maxMana = old.maxMana; u.mana = old.maxMana;
        this.ents.delete(old.id);
      }
      p.hero = u;
      this.fx.column(u.x, u.y, u.z, 0xffe08a, 5, 1.2, 1);
      if (b.owner === 0) this.msg(`${u.def.name} has returned!`, 'good');
    } else {
      u = this.createUnit(b.owner, q.def, pos.x, pos.z);
      p.stats.unitsTrained++;
    }
    u.rot = ang;
    if (b.rally) {
      const r = b.rally.res ? this.ents.get(b.rally.res) : null;
      if (r && !r.dead && u.def.worker) this.order([u], { type: 'gather', res: r.id });
      else if (b.rally.tree && u.def.worker) this.order([u], { type: 'gather', lumber: true, tree: b.rally.tree });
      else this.order([u], { type: 'move', x: b.rally.x, z: b.rally.z });
    }
    if (b.owner === 0) this.audio?.play('ready');
    this.recountSupply();
    this.onEvent('trained', { unit: u, building: b });
  }

  // ── abilities ───────────────────────────────────────────────────────────────────────────────────
  doCast(u, o, dt) {
    const A = ABILITY[o.ab];
    let tx, tz, te = null;
    if (A.target === 'self') { tx = u.x; tz = u.z; }
    else if (typeof o.target === 'object' && o.target !== null) { tx = o.target.x; tz = o.target.z; }
    else { te = this.ents.get(o.target); if (!te || te.dead) { u.order = { type: 'idle' }; return; } tx = te.x; tz = te.z; }
    const range = A.range ?? 0;
    const d = te ? this.edgeDist(u, te) : dist(u.x, u.z, tx, tz);
    if (A.target !== 'self' && d > range) { this.moveTo(u, tx, tz, dt, range * 0.9); return; }
    if ((u.abil[o.ab] ?? 0) > 0 || u.mana < A.mana) { u.order = o.resume ?? { type: 'idle' }; return; }
    this.faceTo(u, tx, tz, 1);
    u.mana -= A.mana;
    u.abil[o.ab] = A.cd;
    u.anim.cast = true;
    u.castFlash = 0.4;
    this.applyAbility(u, A, o.ab, te, tx, tz);
    u.order = o.resume ?? { type: 'idle' };
    u.path = null;
  }

  applyAbility(u, A, id, te, tx, tz) {
    const pw = this.powerOf(u);
    const ty = this.world.surfaceAt(tx, tz);
    const enemiesIn = (x, z, r, fn) => {
      this.near(x, z, r, (o) => { if (this.isEnemy(u, o) && o.owner !== undefined && !o.dead) fn(o); });
      for (const b of this.buildings) if (!b.dead && this.isEnemy(u, b) && b.owner !== NEUTRAL && dist(b.x, b.z, x, z) < r + b.size / 2) fn(b);
    };
    if (this.visibleToPlayer(u)) this.audio?.play('cast', u);
    const from = this.muzzle(u);
    switch (A.kind) {
      case 'heal': this.heal(te, A.amount * pw); this.fx.column(te.x, te.y, te.z, A.color, 4, 0.9, 0.6); break;
      case 'shield':
        te.buffs.shield = A.dur; te.shieldAmt = A.amount; this.heal(te, 60 * pw);
        this.fx.column(te.x, te.y, te.z, A.color, 2.5, 0.8, 0.7); this.fx.ring(te.x, te.y, te.z, 1.4, A.color, 0.6); break;
      case 'bolt': case 'stunbolt': case 'drain':
        this.fx.shoot(id === 'hammer' ? 'boulder' : 'bolt', from, () => ({ x: te.x, y: te.y + this.hitHeight(te), z: te.z }), () => {
          if (te.dead) return;
          this.damage(u, te, A.dmg * pw, { magic: true });
          if (A.stun && te.type === 'unit') te.buffs.stun = A.stun;
          if (A.kind === 'drain') { this.heal(u, A.dmg * pw); this.fx.column(u.x, u.y, u.z, A.color, 3, 0.6, 0.5); }
        }, A.color);
        break;
      case 'roots':
        if (te.type === 'unit') te.buffs.stun = A.stun;
        this.fx.burst(te.x, te.y + 0.2, te.z, A.color, 24, 1.2, 0.3, 1.2, -1);
        this.fx.ring(te.x, te.y, te.z, 1.2, A.color, A.stun);
        for (let k = 0; k < 3; k++) this.timers.push({ t: k * 0.8, fn: () => this.damage(u, te, (A.dmg * pw) / 3, { magic: true }) });
        break;
      case 'chain': {
        let cur = te, prev = from, dmg = A.dmg * pw;
        const hit = new Set();
        for (let k = 0; k <= A.bounces && cur; k++) {
          const c = cur, p0 = prev, dd = dmg;
          this.timers.push({ t: k * 0.12, fn: () => {
            if (c.dead) return;
            const to = new THREE.Vector3(c.x, c.y + this.hitHeight(c), c.z);
            if (id === 'glaive') this.fx.burst(to.x, to.y, to.z, A.color, 10, 2, 0.2, 0.4, 0);
            else this.fx.lightning(new THREE.Vector3(p0.x, p0.y, p0.z), to, A.color);
            this.damage(u, c, dd, { magic: true });
          } });
          hit.add(cur.id);
          prev = { x: cur.x, y: cur.y + this.hitHeight(cur), z: cur.z };
          let next = null, bd = 6;
          this.near(cur.x, cur.z, 6, (o) => { if (!hit.has(o.id) && this.canAttack(u, o) || (!hit.has(o.id) && this.isEnemy(u, o) && !o.dead && o.type === 'unit')) { const d = dist(cur.x, cur.z, o.x, o.z); if (d < bd) { bd = d; next = o; } } });
          cur = next;
          dmg *= 0.85;
        }
        break;
      }
      case 'stomp':
        this.fx.ring(u.x, u.y, u.z, A.radius, A.color, 0.5);
        this.fx.dust(u.x, u.y, u.z, 24);
        enemiesIn(u.x, u.z, A.radius, (o) => { this.damage(u, o, A.dmg * pw, { magic: true }); if (o.type === 'unit') o.buffs.stun = A.stun; });
        break;
      case 'nova':
        this.fx.ring(tx, ty, tz, A.radius, A.color, 0.6);
        this.fx.burst(tx, ty + 0.5, tz, A.color, 40, 4, 0.3, 0.8, 1);
        enemiesIn(tx, tz, A.radius, (o) => { this.damage(u, o, A.dmg * pw, { magic: true }); if (o.type === 'unit') o.buffs.slow = A.slow; });
        break;
      case 'aoe': {
        const kind = id === 'starfall' ? 'star' : id === 'flamestrike' ? 'fire' : id === 'shockwave' ? 'quake' : 'ice';
        if (kind === 'quake') { this.fx.ring(tx, ty, tz, A.radius, A.color, 0.7); this.fx.dust(tx, ty, tz, 40, 0x8a6a4a); this.fx.burst(tx, ty, tz, A.color, 30, 4, 0.3, 0.6); }
        else this.fx.rain(tx, ty, tz, A.radius, A.color, 1.6, kind);
        const ticks = kind === 'quake' ? 1 : 4;
        for (let k = 0; k < ticks; k++) this.timers.push({ t: kind === 'quake' ? 0 : 0.3 + k * 0.35, fn: () => enemiesIn(tx, tz, A.radius, (o) => this.damage(u, o, (A.dmg * pw) / ticks, { magic: true })) });
        break;
      }
      case 'summon': {
        for (let k = 0; k < A.count; k++) {
          const a = u.rot + (k - (A.count - 1) / 2) * 0.9;
          const pos = this.world.nearestOpen(u.x + Math.sin(a) * 1.8, u.z + Math.cos(a) * 1.8, 4) ?? { x: u.x, z: u.z };
          const s = this.createUnit(u.owner, creepDef(A.unit), pos.x, pos.z, { life: A.life });
          s.rot = u.rot;
          this.fx.burst(pos.x, this.world.heightAt(pos.x, pos.z) + 0.6, pos.z, A.color, 18, 2, 0.3, 0.8);
          if (u.order.resume) s.order = { ...u.order.resume };
        }
        break;
      }
      case 'buff':
        if (A.buff === 'roar') {
          this.fx.ring(u.x, u.y, u.z, A.radius, A.color, 0.7);
          this.near(u.x, u.z, A.radius, (o) => { if (o.owner === u.owner) { o.buffs.roar = A.dur; this.fx.burst(o.x, o.y + 1.4, o.z, A.color, 5, 1, 0.15, 0.5, 0); } });
        } else {
          u.buffs[A.buff] = A.dur;
          if (A.buff === 'avatar' && !u.avatarOn) { u.avatarOn = true; u.maxHp += 400; u.hp += 400; u.model.root.scale.setScalar(1.45); }
          this.fx.column(u.x, u.y, u.z, A.color, 3, 0.8, 0.9);
        }
        break;
      case 'reveal':
        if (u.owner === 0) this.fog.reveals.push({ x: tx, z: tz, r: A.radius, until: this.time + A.dur });
        this.fx.column(tx, ty, tz, A.color, 6, 1.2, 0.6);
        this.fx.ring(tx, ty, tz, A.radius, A.color, 1.2);
        break;
      default: break;
    }
  }

  /** Units with spells (and AI heroes) cast on their own. */
  autocast(u) {
    if (!u.maxMana || u.owner === NEUTRAL || u.hidden) return;
    const isAIHero = u.def.hero && this.players[u.owner].ai;
    const spells = u.def.hero ? (isAIHero ? u.def.abilities.slice(0, u.level) : []) : (u.def.spell ? [u.def.spell] : []);
    if (!spells.length || u.order.type === 'cast') return;
    u.acT = (u.acT ?? Math.random()) - 1 / 60;
    if (u.acT > 0) return;
    u.acT = 0.5;
    if (!u.autocast) return;
    for (const id of spells) {
      const A = ABILITY[id];
      if (A.target === 'passive' || (u.abil[id] ?? 0) > 0 || u.mana < A.mana) continue;
      const range = (A.range ?? 4) + 1;
      if (A.target === 'ally') {
        let best = null, bk = 0.72;
        this.near(u.x, u.z, range, (o) => { if (o.owner === u.owner && !o.dead && o.type === 'unit' && !o.def.look?.machine) { const k = o.hp / o.maxHp; if (A.kind === 'shield' ? (this.time - (o.lastHit ?? -9) < 2 && !(o.buffs.shield > 0) && k < 0.95) : k < bk) { bk = k; best = o; } } });
        if (best) { this.order([u], { type: 'cast', ab: id, target: best.id, resume: u.order.type === 'cast' ? null : { ...u.order } }); return; }
      } else {
        const t = this.findTarget(u, A.kind === 'summon' || A.target === 'self' ? 6 : range);
        if (!t) continue;
        if (A.kind === 'reveal') continue;
        if (A.target === 'self' && A.kind === 'buff' && u.hp > u.maxHp * 0.6 && A.buff !== 'roar') continue;
        const target = A.target === 'point' ? { x: t.x, z: t.z } : A.target === 'self' ? null : t.id;
        this.order([u], { type: 'cast', ab: id, target, resume: { ...u.order } });
        return;
      }
    }
  }

  // ── victory ─────────────────────────────────────────────────────────────────────────────────────
  checkVictory() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const any = this.buildings.some((b) => !b.dead && b.owner === p.id);
      if (!any) {
        p.alive = false;
        if (p.id !== 0) this.msg(`${FACTIONS[p.faction].name} has been defeated!`, 'good');
        for (const u of this.units) if (u.owner === p.id && !u.dead) this.kill(u, null);
      }
    }
    if (this.over) return;
    if (!this.players[0].alive) { this.over = 'defeat'; this.onEvent('over', 'defeat'); }
    else if (this.players.every((p) => p.id === 0 || !p.alive)) { this.over = 'victory'; this.onEvent('over', 'victory'); }
  }

  visibleToPlayer(e) { return e.owner === 0 || this.fog.visible(e.x, e.z); }

  sightSources(pid) {
    const out = [];
    for (const u of this.units) if (!u.dead && u.owner === pid) out.push({ x: u.x, z: u.z, r: u.def.sight });
    for (const b of this.buildings) if (!b.dead && b.owner === pid) out.push({ x: b.x, z: b.z, r: b.built ? b.def.sight : 4 });
    return out;
  }
}
