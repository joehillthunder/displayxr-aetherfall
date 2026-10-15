// Computer opponents. Each AI runs a simple economy (workers on gold, lumber and aether, farms
// ahead of supply), follows a build plan, trains a mixed army, hunts creeps with its hero for
// experience, defends its base and sends growing attack waves.

import { buildingDef, unitDef, FACTIONS } from './data.js';
import { NEUTRAL } from './game.js';
import { dist } from './util.js';

const PLAN = ['barracks', 'farm', 'extractor', 'tower', 'farm', 'sanctum', 'workshop', 'farm', 'barracks', 'tower', 'farm', 'farm'];
const MIX = { melee: 3, ranged: 3, cavalry: 2, caster: 1.4, siege: 0.9, flyer: 1.1 };
const DIFF = {
  easy:   { firstWave: 420, gap: 200, wave0: 8, waveGrow: 4, workers: 12 },
  normal: { firstWave: 300, gap: 150, wave0: 12, waveGrow: 5, workers: 15 },
  hard:   { firstWave: 210, gap: 110, wave0: 14, waveGrow: 6, workers: 18 },
};

export class AI {
  constructor(game, pid) {
    this.g = game;
    this.pid = pid;
    this.p = game.players[pid];
    this.D = DIFF[this.p.difficulty] ?? DIFF.normal;
    this.t = 1 + pid * 0.3;
    this.wave = 0;
    this.nextAttack = this.D.firstWave;
    this.attacking = false;
    this.creepT = 60;
    if (this.p.difficulty === 'hard') { this.p.gold += 300; this.p.lumber += 150; }
  }

  update(dt) {
    if (!this.p.alive) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const g = this.g, pid = this.pid;
    const mine = g.units.filter((u) => !u.dead && u.owner === pid);
    this.workers = mine.filter((u) => u.def.worker);
    this.army = mine.filter((u) => !u.def.worker && !u.summon);
    this.blds = g.buildings.filter((b) => !b.dead && b.owner === pid);
    this.hall = this.blds.find((b) => b.def.type === 'hall');
    if (!this.hall) { this.allIn(); return; }
    this.economy();
    this.build();
    this.military();
    this.defend();
    this.offense();
  }

  count(type, includeBuilding = true) {
    let n = this.blds.filter((b) => b.def.type === type && (includeBuilding || b.built)).length;
    n += this.workers.filter((w) => w.order.type === 'build' && w.order.btype === type).length;
    return n;
  }

  economy() {
    const g = this.g;
    const job = (w) => (w.order.type !== 'gather' ? 'idle' : w.order.lumber ? 'lumber' : ({ mine: 'gold', rock: 'stone' }[g.ents.get(w.order.res)?.type] ?? 'aether'));
    const counts = { gold: 0, lumber: 0, aether: 0, stone: 0, idle: 0 };
    for (const w of this.workers) if (w.order.type === 'gather' || w.order.type === 'idle') counts[job(w)]++;
    const extractor = this.blds.find((b) => b.def.type === 'extractor' && b.built);
    const rock = g.nearestRes(this.hall.x, this.hall.z, 'rock', 30);
    const want = { gold: 7, lumber: 4 + (this.count('workshop') ? 1 : 0), aether: extractor ? 3 : 0, stone: rock ? (this.p.stone < 120 ? 3 : 1) : 0 };
    for (const w of this.workers) {
      if (w.order.type !== 'idle') continue;
      const need = ['gold', 'lumber', 'aether', 'stone'].sort((a, b) => (counts[a] - want[a]) - (counts[b] - want[b]))[0];
      if (need === 'stone' && rock) { g.order([w], { type: 'gather', res: rock.id }); counts.stone++; continue; }
      if (need === 'gold') {
        const m = g.nearestRes(this.hall.x, this.hall.z, 'mine', 40);
        if (m) { g.order([w], { type: 'gather', res: m.id }); counts.gold++; }
      } else if (need === 'lumber') {
        const t = g.world.nearestTree(this.hall.x, this.hall.z, 30);
        if (t) { g.order([w], { type: 'gather', lumber: true, tree: t }); counts.lumber++; }
      } else if (extractor) { g.order([w], { type: 'gather', res: extractor.id }); counts.aether++; }
    }
    // rebalance: move gold workers to aether and lumber as those jobs open up
    const spare = () => this.workers.find((x) => job(x) === 'gold' && !x.hidden && !x.carry);
    if (extractor && counts.aether < want.aether && counts.gold > 4) {
      const w = spare();
      if (w) { g.order([w], { type: 'gather', res: extractor.id }); counts.gold--; counts.aether++; }
    }
    if (counts.lumber < want.lumber && counts.gold > 3) {
      const w = spare(), t = w && g.world.nearestTree(this.hall.x, this.hall.z, 30);
      if (t) { g.order([w], { type: 'gather', lumber: true, tree: t }); counts.gold--; }
    }
    if (rock && counts.stone < want.stone && counts.gold > 3) {
      const w = spare();
      if (w) g.order([w], { type: 'gather', res: rock.id });
    }
    if (this.workers.length < this.D.workers && this.hall.queue.length < 2) g.train(this.hall, 'worker');
    if ((!this.p.hero || this.p.hero.dead) && this.hall.queue.length < 3) g.train(this.hall, 'hero');
  }

  builder() {
    return this.workers.find((w) => w.order.type === 'gather' && !w.hidden && !w.carry && !w.order.lumber) ?? this.workers.find((w) => w.order.type === 'gather' && !w.hidden) ?? this.workers.find((w) => w.order.type === 'idle');
  }

  build() {
    const g = this.g, p = this.p;
    // finish anything whose builder was killed or pulled away
    for (const b of this.blds) {
      if (b.built) continue;
      const active = [...b.builders].some((id) => { const w = g.ents.get(id); return w && !w.dead && w.order.type === 'construct' && w.order.target === b.id; });
      if (!active) { const w = this.builder(); if (w) g.order([w], { type: 'construct', target: b.id }); }
    }
    // farms ahead of supply
    const farmsGoing = this.blds.some((b) => b.def.type === 'farm' && !b.built) || this.workers.some((w) => w.order.type === 'build' && w.order.btype === 'farm');
    if (p.cap - p.supply < 6 && p.cap < 100 && !farmsGoing) {
      if (this.place('farm')) return;
    }
    // next plan step
    const seen = {};
    for (const type of PLAN) {
      seen[type] = (seen[type] ?? 0) + 1;
      if (this.count(type) >= seen[type]) continue;
      if (type === 'farm') continue; // farms come from the supply rule
      const def = buildingDef(p.faction, type);
      if (!g.reqsMet(this.pid, def.requires)) return;
      if (g.canAfford(this.pid, def.cost)) this.place(type);
      return;
    }
  }

  place(type) {
    const g = this.g;
    const w = this.builder();
    if (!w) return false;
    const def = buildingDef(this.p.faction, type);
    if (!g.canAfford(this.pid, def.cost)) return false;
    let spot;
    if (type === 'extractor') {
      const gy = g.resources.filter((r) => r.type === 'geyser' && !r.dead && !r.extractor && !r.great).sort((a, b) => dist(a.x, a.z, this.hall.x, this.hall.z) - dist(b.x, b.z, this.hall.x, this.hall.z))[0];
      if (!gy || dist(gy.x, gy.z, this.hall.x, this.hall.z) > 20) return false;
      spot = { x: gy.x, z: gy.z };
    } else spot = this.findSpot(def.size, type === 'tower');
    if (!spot) return false;
    return g.placeBuilding(w, type, spot.x, spot.z) === null;
  }

  findSpot(s, forward) {
    const g = this.g, h = this.hall;
    const mine = g.nearestRes(h.x, h.z, 'mine', 25);
    const gy = g.nearestRes(h.x, h.z, 'geyser', 25);
    const toC = Math.atan2(64 - h.z, 64 - h.x);
    const snap = (v) => (s % 2 ? Math.floor(v) + 0.5 : Math.round(v));
    for (let r = forward ? 8 : 5; r < 16; r += 1) {
      const n = Math.ceil(r * 3);
      for (let i = 0; i < n; i++) {
        const a = forward ? toC + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) / n) * Math.PI : (i / n) * Math.PI * 2 + this.pid;
        const x = snap(h.x + Math.cos(a) * r), z = snap(h.z + Math.sin(a) * r);
        if (!g.world.canPlace(x, z, s + 2)) continue;
        if (mine && segDist(x, z, h.x, h.z, mine.x, mine.z) < s / 2 + 2.2) continue;
        if (gy && segDist(x, z, h.x, h.z, gy.x, gy.z) < s / 2 + 2.2) continue;
        return { x, z };
      }
    }
    return null;
  }

  military() {
    const g = this.g, p = this.p;
    // save up to bring a fallen hero back before spending on more troops
    const hero = p.hero;
    if (hero?.dead && p.gold < 200 + (hero.level ?? 1) * 50 + 20) return;
    const prod = this.blds.filter((b) => b.built && b.def.trains.length && b.def.type !== 'hall');
    // save for the next building in the plan early on
    const reserve = this.army.length > 6 ? 0 : 120;
    for (const b of prod) {
      if (b.queue.length >= 2) continue;
      const opts = b.def.trains.filter((r) => g.reqsMet(this.pid, unitDef(p.faction, r).requires));
      if (!opts.length) continue;
      let total = 0;
      for (const r of opts) total += MIX[r] ?? 1;
      let pick = Math.random() * total, role = opts[0];
      for (const r of opts) { pick -= MIX[r] ?? 1; if (pick <= 0) { role = r; break; } }
      const def = unitDef(p.faction, role);
      if (p.gold - def.cost[0] < reserve) continue;
      g.train(b, role);
    }
    const ws = this.blds.find((b) => b.built && b.def.type === 'workshop');
    if (ws && ws.queue.length === 0 && this.army.length > 8 && p.gold > 500) g.research(ws, Math.random() < 0.5 ? 'weapons' : 'armor');
  }

  defend() {
    const g = this.g;
    let threat = null;
    for (const b of this.blds) {
      g.near(b.x, b.z, 13, (o) => { if (!threat && o.owner !== this.pid && o.owner !== NEUTRAL && !o.dead) threat = o; });
      if (threat) break;
    }
    if (!threat) { this.defending = false; return; }
    this.defending = true;
    const idle = this.army.filter((u) => u.order.type !== 'attack' && (dist(u.x, u.z, threat.x, threat.z) < 40 || !this.attacking));
    if (idle.length) g.order(idle, { type: 'amove', x: threat.x, z: threat.z });
  }

  offense() {
    const g = this.g;
    const supply = this.army.reduce((s, u) => s + u.def.supply, 0);
    const size = this.D.wave0 + this.wave * this.D.waveGrow;
    if (this.attacking) {
      if (this.army.length < 3) { this.attacking = false; this.nextAttack = g.time + this.D.gap; this.rally(); }
      else {
        // keep pushing: send idle units after the current target
        const t = this.target();
        if (t) { const idle = this.army.filter((u) => u.order.type === 'idle'); if (idle.length) g.order(idle, { type: 'amove', x: t.x, z: t.z }); }
      }
      return;
    }
    if (g.time >= this.nextAttack && supply >= size) {
      const t = this.target();
      if (!t) return;
      this.attacking = true;
      this.wave++;
      const force = this.army.concat(this.p.hero && !this.p.hero.dead ? [this.p.hero] : []);
      g.order(force, { type: 'amove', x: t.x, z: t.z });
      if (t.owner === 0) g.msg(`${FACTIONS[this.p.faction].name} is marching on your base!`, 'alert');
      return;
    }
    // between waves: hunt creeps for hero experience
    this.creepT -= 1;
    const hero = this.p.hero;
    if (this.creepT <= 0 && hero && !hero.dead && this.army.length >= 4 && !this.defending) {
      this.creepT = 45;
      const camp = this.nearestCamp(this.army.length >= 14);
      if (camp) g.order(this.army.concat([hero]), { type: 'amove', x: camp.x, z: camp.z });
    } else if (this.creepT === 20 && !this.defending) this.rally();
  }

  rally() {
    const h = this.hall;
    if (!h) return;
    const x = h.x + (64 - h.x) * 0.15, z = h.z + (64 - h.z) * 0.15;
    const idle = this.army.filter((u) => u.order.type === 'idle' || u.order.type === 'amove');
    if (idle.length) this.g.order(idle, { type: 'amove', x, z });
  }

  nearestCamp(allowBoss) {
    const g = this.g, h = this.hall;
    let best = null, bd = 1e9;
    for (const u of g.units) {
      if (u.dead || u.owner !== NEUTRAL || !u.home || u.summon) continue;
      if (u.def.key === 'creep:wyrm' && !allowBoss) continue;
      const d = dist(h.x, h.z, u.x, u.z);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  target() {
    const g = this.g;
    // the human player first, then any other living opponent
    const enemies = g.players.filter((p) => p.id !== this.pid && p.alive);
    enemies.sort((a, b) => (a.id === 0 ? -1 : 0) - (b.id === 0 ? -1 : 0));
    for (const e of enemies) {
      const bs = g.buildings.filter((b) => !b.dead && b.owner === e.id);
      if (!bs.length) continue;
      const from = this.hall ?? this.army[0];
      bs.sort((a, b) => dist(a.x, a.z, from.x, from.z) - dist(b.x, b.z, from.x, from.z));
      return bs[0];
    }
    return null;
  }

  allIn() {
    const t = this.target();
    if (!t) return;
    const idle = this.army.filter((u) => u.order.type === 'idle');
    if (idle.length) this.g.order(idle, { type: 'amove', x: t.x, z: t.z });
  }
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
