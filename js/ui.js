// Player interface: RTS camera, selection (click, box, double-click, control groups), smart
// right-click orders, targeting modes (attack-move, cast, rally, build placement with a ghost),
// the HUD (resources, selection panel, command card, messages), tooltips and the minimap.

import * as THREE from 'three';
import { ABILITY, RESEARCH, FACTIONS, HEROES, unitDef, buildingDef, heroDef, HERO_XP } from './data.js';
import { makeRing, makeBuildingModel } from './models.js';
import { N, BLOCK } from './world.js';
import { NEUTRAL } from './game.js';
import { fmt, clamp, dist } from './util.js';

const $ = (id) => document.getElementById(id);

// ── icons ─────────────────────────────────────────────────────────────────────────────────────────
const HERO_ICON = { paladin: '🛡️', archmage: '🧙', warlord: '🪓', farseer: '⚡', huntress: '🌙', keeper: '🦌', deathknight: '💀', wraithqueen: '❄️', thane: '🔨', runesmith: '🔥' };
const CREEP_ICON = { kobold: '🕯️', spider: '🕷️', ogre: '👹', direwolf: '🐺', wyrm: '🐲', tidespirit: '💧', spiritwolf: '🐺', treantling: '🌱', skeleton: '☠️', irongolem: '⚙️' };
const MOUNT_ICON = { horse: '🐎', wolf: '🐺', stag: '🦌', ram: '🐏', bonehorse: '💀' };
const FLY_ICON = { griffin: '🦅', wyvern: '🐉', hawk: '🦉', gargoyle: '🦇', gyro: '🚁' };
const BLD_ICON = { hall: '🏰', farm: '🌾', barracks: '🏛️', sanctum: '🔮', workshop: '⚙️', tower: '🗼', extractor: '💠' };
const FARM_ICON = { valemark: '🌾', ironfang: '🛖', sylvan: '🌙', dread: '⚱️', deepforge: '🍺' };
export function iconFor(def, ent) {
  if (ent?.type === 'mine') return '💰';
  if (ent?.type === 'geyser') return '💠';
  if (ent?.type === 'rock') return '🪨';
  if (!def) return '?';
  if (def.kind === 'building') return def.type === 'farm' ? FARM_ICON[def.faction] : BLD_ICON[def.type];
  if (def.hero) return HERO_ICON[def.heroId];
  if (def.creep) return CREEP_ICON[def.key.split(':')[1]] ?? '👾';
  const L = def.look;
  if (L.flyer) return FLY_ICON[L.flyer];
  if (L.mount) return MOUNT_ICON[L.mount];
  if (L.machine) return { ballista: '🎯', catapult: '☄️', cannon: '💣' }[L.machine];
  if (L.body === 'treant') return '🌳';
  if (L.body === 'golem') return '🦴';
  if (L.body === 'wisp') return '✨';
  return { worker: '⛏️', melee: '⚔️', ranged: L.weapon === 'rifle' ? '🎯' : L.weapon === 'spear' ? '🔱' : '🏹', caster: '🔮' }[def.role] ?? '⚔️';
}

const costHtml = (c) => [['💰', c[0]], ['🪵', c[1]], ['💠', c[2]], ['🪨', c[3]]].filter(([, v]) => v > 0).map(([i, v]) => `<span class="cost">${i} ${v}</span>`).join(' ');

export class UI {
  constructor({ stage, game, world, fog, audio, canvas }) {
    Object.assign(this, { stage, game, world, fog, audio, canvas });
    // frame the hall and its gold mine, nudged up so the bottom HUD doesn't cover them
    const st = game.players[0].start;
    const mine = game.nearestRes(st.x, st.z, 'mine', 20) ?? st;
    const cx = (st.x + mine.x) / 2, cz = (st.z + mine.z) / 2;
    this.camT = { x: cx, z: cz + 3, dist: 30, pitch: 0.98, yaw: 0, gy: world.heightAt(st.x, st.z) };
    this.keys = new Set();
    this.mode = null; // targeting mode
    this.cardMode = 'main';
    this.groups = {};
    this.mouse = { x: 0, y: 0, inside: false };
    this.hover = null;
    this.ray = new THREE.Raycaster();
    this.v = new THREE.Vector3();
    this.ghosts = {};
    this.lastClick = { t: 0, id: null };
    this.lastGroupKey = { k: null, t: 0 };
    this.msgEls = [];
    this.selKey = '';
    this.cardKey = '';
    this.paused = false;
    this.edgePan = true;
    this.bindInput();
    this.buildMinimapBase();
    game.onEvent = (type, data) => this.onGameEvent(type, data);
    this.refreshSelection();
  }

  get sel() { return this.game.selection; }
  set sel(v) { this.game.selection = v; }

  // ── camera ──────────────────────────────────────────────────────────────────────────────────────
  updateCamera(dt) {
    const c = this.camT;
    let px = 0, pz = 0;
    if (this.keys.has('ArrowLeft')) px -= 1;
    if (this.keys.has('ArrowRight')) px += 1;
    if (this.keys.has('ArrowUp')) pz -= 1;
    if (this.keys.has('ArrowDown')) pz += 1;
    const edge = this.edgePan && this.mouse.inside && !this.drag && document.hasFocus();
    if (edge) {
      const r = this.canvas.getBoundingClientRect();
      if (this.mouse.x < 8) px -= 1; else if (this.mouse.x > r.width - 8) px += 1;
      if (this.mouse.y < 8) pz -= 1; else if (this.mouse.y > r.height - 8) pz += 1;
    }
    const sp = c.dist * 1.1 * dt;
    c.x = clamp(c.x + px * sp, 4, N - 4);
    c.z = clamp(c.z + pz * sp, 6, N + 4);
    if (this.zoomTo != null) { c.dist += (this.zoomTo - c.dist) * Math.min(1, dt * 10); if (Math.abs(this.zoomTo - c.dist) < 0.05) this.zoomTo = null; }
    const gy = this.world.heightAt(clamp(c.x, 0, N), clamp(c.z, 0, N));
    c.gy += (Math.max(0, gy) - c.gy) * Math.min(1, dt * 4);
    const cam = this.stage.cam;
    // tilt toward top-down as you zoom out, toward the horizon as you zoom in
    const pitch = c.pitch + (c.dist - 32) * 0.006;
    const h = Math.sin(pitch) * c.dist, back = Math.cos(pitch) * c.dist;
    cam.position.set(c.x + Math.sin(c.yaw) * back, c.gy + h, c.z + Math.cos(c.yaw) * back);
    cam.lookAt(c.x, c.gy, c.z);
    cam.updateMatrixWorld();
    this.stage.focusDist = c.dist;
  }

  centerOn(x, z) { this.camT.x = x; this.camT.z = z + 2; }

  // ── picking ─────────────────────────────────────────────────────────────────────────────────────
  ndc(mx, my) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1);
  }

  groundAt(mx, my) {
    this.ray.setFromCamera(this.ndc(mx, my), this.stage.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let t = 0, prev = 0;
    const w = this.world;
    for (; t < 400; t += 0.6) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= Math.max(-0.12, w.heightAt(x, z))) break;
      prev = t;
    }
    let a = prev, b = t;
    for (let i = 0; i < 8; i++) {
      const m = (a + b) / 2;
      const x = o.x + d.x * m, y = o.y + d.y * m, z = o.z + d.z * m;
      if (y <= Math.max(-0.12, w.heightAt(x, z))) b = m; else a = m;
    }
    return { x: o.x + d.x * b, z: o.z + d.z * b };
  }

  screenOf(x, y, z) {
    const r = this.canvas.getBoundingClientRect();
    this.v.set(x, y, z).project(this.stage.cam);
    return { x: (this.v.x + 1) / 2 * r.width, y: (1 - this.v.y) / 2 * r.height, z: this.v.z };
  }

  pxPerMetre(x, y, z) {
    const cam = this.stage.cam;
    const d = cam.position.distanceTo(this.v.set(x, y, z));
    const r = this.canvas.getBoundingClientRect();
    return r.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d);
  }

  visible(e) {
    if (e.dead || e.hidden) return false;
    if (e.type === 'unit') return e.owner === 0 || this.fog.visible(e.x, e.z);
    if (e.type === 'building') return e.owner === 0 || e.seen;
    return this.fog.isExplored(e.x, e.z);
  }

  pick(mx, my) {
    const g = this.game;
    let best = null, bs = 1e9;
    for (const u of g.units) {
      if (!this.visible(u)) continue;
      const h = u.model.height ?? 1.5;
      const s = this.screenOf(u.x, u.y + h * 0.45, u.z);
      if (s.z > 1) continue;
      const ppm = this.pxPerMetre(u.x, u.y, u.z);
      const rad = Math.max(10, (u.radius + h * 0.3) * ppm);
      const d = Math.hypot(s.x - mx, s.y - my);
      if (d < rad && d / rad < bs) { bs = d / rad; best = u; }
    }
    if (best) return best;
    const gp = this.groundAt(mx, my);
    for (const b of [...g.buildings, ...g.resources]) {
      if (!this.visible(b)) continue;
      if (Math.abs(gp.x - b.x) < b.size / 2 + 0.2 && Math.abs(gp.z - b.z) < b.size / 2 + 0.2) return b;
      const s = this.screenOf(b.x, b.y + 1.6, b.z);
      const rad = b.size * 0.45 * this.pxPerMetre(b.x, b.y, b.z);
      if (Math.hypot(s.x - mx, s.y - my) < rad) return b;
    }
    return null;
  }

  treeAt(gp) {
    const w = this.world;
    let best = null, bd = 1.1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = Math.floor(gp.x) + dx, cz = Math.floor(gp.z) + dz;
      if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
      const ti = w.treeAt[cz * N + cx];
      if (ti < 0) continue;
      const t = w.trees[ti];
      const d = Math.hypot(t.x - gp.x, t.z - gp.z);
      if (t.alive && d < bd && this.fog.isExplored(t.x, t.z)) { bd = d; best = t; }
    }
    return best;
  }

  // ── input ───────────────────────────────────────────────────────────────────────────────────────
  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    cv.addEventListener('pointerenter', () => { this.mouse.inside = true; });
    cv.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomTo = clamp((this.zoomTo ?? this.camT.dist) * (e.deltaY > 0 ? 1.12 : 0.89), 12, 70);
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => this.onDouble(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
    // minimap
    const mm = $('minimap');
    const mmPos = (e) => { const r = mm.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * N, z: (e.clientY - r.top) / r.height * N }; };
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    mm.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();
      const p = mmPos(e);
      if (e.button === 2) { this.smartOrder(p, null, e.shiftKey); this.flash(p); return; }
      if (this.mode && this.mode.kind !== 'build') { this.applyMode(p, null, e.shiftKey); return; }
      this.centerOn(p.x, p.z);
      this.mmDrag = true;
      mm.setPointerCapture(e.pointerId);
    });
    mm.addEventListener('pointermove', (e) => { if (this.mmDrag) { const p = mmPos(e); this.centerOn(p.x, p.z); } });
    mm.addEventListener('pointerup', () => { this.mmDrag = false; });
    // command card clicks
    $('cmd').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      this.audio.unlock();
      this.runCmd(+b.dataset.i);
    });
    $('cmd').addEventListener('pointerover', (e) => {
      const b = e.target.closest('button[data-i]');
      this.showTip(b ? this.card[+b.dataset.i] : null, b);
    });
    $('cmd').addEventListener('pointerleave', () => this.showTip(null));
    $('sel').addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { const b = this.sel[0]; this.game.cancelQueue(b, +q.dataset.q); this.audio.play('click'); return; }
      const s = e.target.closest('[data-sel]');
      if (s) { const ent = this.game.ents.get(+s.dataset.sel); if (ent) { this.sel = e.shiftKey ? this.sel.filter((x) => x !== ent) : [ent]; this.refreshSelection(); } }
    });
  }

  onDown(e) {
    this.audio.unlock();
    this.canvas.focus();
    const mx = e.offsetX, my = e.offsetY;
    if (e.button === 1) { this.pan = { x: e.clientX, y: e.clientY, cx: this.camT.x, cz: this.camT.z }; e.preventDefault(); return; }
    if (e.button === 2) {
      if (this.mode) { this.setMode(null); return; }
      const gp = this.groundAt(mx, my);
      this.smartOrder(gp, this.pick(mx, my), e.shiftKey, this.treeAt(gp));
      return;
    }
    if (e.button !== 0) return;
    if (this.mode) {
      const gp = this.groundAt(mx, my);
      this.applyMode(gp, this.pick(mx, my), e.shiftKey, this.treeAt(gp));
      return;
    }
    this.drag = { x0: mx, y0: my, x1: mx, y1: my, shift: e.shiftKey, ctrl: e.ctrlKey };
  }

  onMove(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    if (this.pan) {
      const k = this.camT.dist / r.height * 1.6;
      this.camT.x = clamp(this.pan.cx - (e.clientX - this.pan.x) * k, 4, N - 4);
      this.camT.z = clamp(this.pan.cz - (e.clientY - this.pan.y) * k, 6, N + 4);
      return;
    }
    if (this.drag) {
      this.drag.x1 = this.mouse.x; this.drag.y1 = this.mouse.y;
      const d = this.drag, box = $('box');
      if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6) {
        box.style.display = 'block';
        box.style.left = Math.min(d.x0, d.x1) + 'px'; box.style.top = Math.min(d.y0, d.y1) + 'px';
        box.style.width = Math.abs(d.x1 - d.x0) + 'px'; box.style.height = Math.abs(d.y1 - d.y0) + 'px';
      }
    }
  }

  onUp(e) {
    if (e.button === 1) { this.pan = null; return; }
    if (!this.drag || e.button !== 0) return;
    const d = this.drag;
    this.drag = null;
    $('box').style.display = 'none';
    if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6) this.boxSelect(d);
    else this.clickSelect(d.x0, d.y0, d.shift, d.ctrl);
  }

  onDouble(e) {
    const ent = this.pick(e.offsetX, e.offsetY);
    if (ent && ent.owner === 0) this.selectSameOnScreen(ent);
  }

  clickSelect(mx, my, shift, ctrl) {
    const ent = this.pick(mx, my);
    if (!ent) { if (!shift) { this.sel = []; this.refreshSelection(); } return; }
    if (ctrl && ent.owner === 0) { this.selectSameOnScreen(ent); return; }
    if (shift && ent.owner === 0 && ent.type === 'unit' && this.sel.every((s) => s.owner === 0 && s.type === 'unit')) {
      this.sel = this.sel.includes(ent) ? this.sel.filter((s) => s !== ent) : [...this.sel, ent].slice(0, 24);
    } else this.sel = [ent];
    this.audio.play('click');
    if (ent.owner === 0 && ent.type === 'unit') this.audio.voice(ent.def.faction, 'sel', !!ent.def.hero);
    this.refreshSelection();
  }

  selectSameOnScreen(ent) {
    const r = this.canvas.getBoundingClientRect();
    const list = (ent.type === 'unit' ? this.game.units : this.game.buildings).filter((u) => {
      if (u.dead || u.hidden || u.owner !== 0 || u.def.key !== ent.def.key) return false;
      const s = this.screenOf(u.x, u.y, u.z);
      return s.x >= 0 && s.y >= 0 && s.x <= r.width && s.y <= r.height && s.z < 1;
    });
    this.sel = list.slice(0, 24);
    this.refreshSelection();
  }

  boxSelect(d) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const inBox = (e, h = 0.5) => { const s = this.screenOf(e.x, e.y + h, e.z); return s.z < 1 && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1; };
    let list = this.game.units.filter((u) => !u.dead && !u.hidden && u.owner === 0 && inBox(u));
    // prefer fighting units over workers when the box has both
    if (list.some((u) => !u.def.worker) && list.some((u) => u.def.worker)) list = list.filter((u) => !u.def.worker);
    if (!list.length) list = this.game.buildings.filter((b) => !b.dead && b.owner === 0 && inBox(b, 1)).slice(0, 1);
    list.sort((a, b) => (b.def.hero ? 1 : 0) - (a.def.hero ? 1 : 0));
    this.sel = d.shift ? [...new Set([...this.sel.filter((s) => s.type === 'unit' && s.owner === 0), ...list])].slice(0, 24) : list.slice(0, 24);
    if (this.sel[0]?.type === 'unit') this.audio.voice(this.sel[0].def.faction, 'sel', !!this.sel[0].def.hero);
    this.refreshSelection();
  }

  myUnits() { return this.sel.filter((s) => s.type === 'unit' && s.owner === 0 && !s.dead); }

  /** Right-click: attack enemies, gather resources, resume construction, follow-move. */
  smartOrder(gp, ent, shift, tree) {
    const g = this.game;
    const units = this.myUnits();
    const blds = this.sel.filter((s) => s.type === 'building' && s.owner === 0);
    if (!units.length) {
      for (const b of blds) {
        if (!b.def.trains.length && b.def.type !== 'hall') continue;
        if (ent && (ent.type === 'mine' || ent.type === 'rock' || ent.def?.type === 'extractor')) b.rally = { x: ent.x, z: ent.z, res: ent.id };
        else if (tree) b.rally = { x: tree.x, z: tree.z, tree };
        else b.rally = { x: gp.x, z: gp.z };
        this.flash(gp);
      }
      return;
    }
    if (ent && ent.owner !== 0 && ent.owner !== undefined && ent.type !== 'mine' && ent.type !== 'geyser' && ent.type !== 'rock') {
      g.order(units, { type: 'attack', target: ent.id });
      this.flash({ x: ent.x, z: ent.z }, 'attack');
      this.audio.play('order'); this.ack();
      return;
    }
    const workers = units.filter((u) => u.def.worker), others = units.filter((u) => !u.def.worker);
    let workersHandled = false;
    if (workers.length) {
      if (ent && (ent.type === 'mine' || ent.type === 'rock')) { g.order(workers, { type: 'gather', res: ent.id }); workersHandled = true; }
      else if (ent && (ent.type === 'geyser' || ent.def?.type === 'extractor')) {
        const ex = ent.type === 'geyser' ? g.ents.get(ent.extractor) : ent;
        if (ex && ex.owner === 0 && ex.built) { g.order(workers, { type: 'gather', res: ex.id }); workersHandled = true; }
        else if (ex && ex.owner === 0 && !ex.built) { g.order(workers, { type: 'construct', target: ex.id }); workersHandled = true; }
        else if (!ex) { this.message('Build an extractor on the geyser first.', 'warn'); workersHandled = true; }
      } else if (tree) { g.order(workers, { type: 'gather', lumber: true, tree }); workersHandled = true; }
      else if (ent && ent.type === 'building' && ent.owner === 0 && !ent.built) { g.order(workers, { type: 'construct', target: ent.id }); workersHandled = true; }
      else if (ent && ent.type === 'building' && ent.owner === 0 && ent.def.dropoff) {
        for (const w of workers) if (w.carry) g.order([w], { ...w.order, type: 'gather', phase: 'drop', res: w.order.res, lumber: w.order.lumber, tree: w.order.tree });
        workersHandled = workers.every((w) => w.carry);
      }
    }
    const movers = workersHandled ? others : units;
    if (movers.length) this.groupMove(movers, gp, 'move');
    this.flash(gp);
    this.audio.play('order'); this.ack();
  }

  /** Spread a group around the target point so they don't all fight for one cell. */
  groupMove(units, gp, type) {
    const n = units.length;
    if (n === 1) { this.game.order(units, { type, x: gp.x, z: gp.z }); return; }
    const cols = Math.ceil(Math.sqrt(n));
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.x; cz += u.z; }
    cx /= n; cz /= n;
    const a = Math.atan2(gp.x - cx, gp.z - cz);
    const sorted = [...units].sort((p, q) => (p.def.range > 3 ? 1 : 0) - (q.def.range > 3 ? 1 : 0));
    sorted.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const ox = (c - (cols - 1) / 2) * 1.1, oz = -r * 1.1;
      const x = gp.x + ox * Math.cos(a) + oz * Math.sin(a);
      const z = gp.z - ox * Math.sin(a) + oz * Math.cos(a);
      const p = u.flying ? { x, z } : (this.world.isBlocked(Math.floor(x), Math.floor(z)) ? this.world.nearestOpen(x, z, 3) ?? gp : { x, z });
      this.game.order([u], { type, x: p.x, z: p.z });
    });
  }

  /** A selected unit answers an order in its race's voice. */
  ack() {
    const u = this.myUnits()[0];
    if (u) this.audio.voice(u.def.faction, 'ok', !!u.def.hero);
  }

  /** Little rings on the targets a skill sent units to. */
  flashSkill(units) {
    const seen = new Set();
    for (const u of units) {
      const o = u.order;
      const t = o.tree ?? this.game.ents.get(o.res ?? o.target);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      this.flash({ x: t.x, z: t.z }, o.type === 'attack' ? 'attack' : 'move');
    }
  }

  setMode(m) {
    this.mode = m;
    for (const g of Object.values(this.ghosts)) g.visible = false;
    this.canvas.style.cursor = m ? 'crosshair' : 'default';
    $('modehint').textContent = m ? m.hint ?? '' : '';
    $('modehint').style.display = m ? 'block' : 'none';
    if (!m && this.cardMode !== 'main' && !this.sel.some((s) => s.def?.worker)) this.cardMode = 'main';
    this.cardKey = '';
  }

  applyMode(gp, ent, shift, tree) {
    const m = this.mode, g = this.game;
    const units = this.myUnits();
    if (m.kind === 'amove') { if (ent && ent.owner !== 0 && ent.owner !== undefined && ent.type !== 'mine' && ent.type !== 'geyser') g.order(units, { type: 'attack', target: ent.id }); else this.groupMove(units, gp, 'amove'); this.flash(gp, 'attack'); }
    else if (m.kind === 'move') { this.groupMove(units, gp, 'move'); this.flash(gp); }
    else if (m.kind === 'gather') { this.smartOrder(gp, ent, shift, tree); }
    else if (m.kind === 'rally') { for (const b of this.sel) if (b.type === 'building') b.rally = ent?.type === 'mine' ? { x: ent.x, z: ent.z, res: ent.id } : tree ? { x: tree.x, z: tree.z, tree } : { x: gp.x, z: gp.z }; this.flash(gp); }
    else if (m.kind === 'cast') {
      const A = ABILITY[m.ab];
      let target = null;
      if (A.target === 'point') target = { x: gp.x, z: gp.z };
      else if (A.target === 'enemy') { if (!ent || ent.owner === 0 || ent.type === 'mine' || ent.type === 'geyser') { this.message('Target an enemy.', 'warn'); return; } target = ent.id; }
      else if (A.target === 'ally') { if (!ent || ent.owner !== 0 || ent.type !== 'unit') { this.message('Target a friendly unit.', 'warn'); return; } target = ent.id; }
      const err = g.cast(m.caster, m.ab, target);
      if (err) { this.message(err, 'warn'); this.audio.play('error'); }
      else this.audio.play('order'); this.ack();
    } else if (m.kind === 'build') {
      const w = this.builderFor(gp);
      if (!w) { this.message('Select a worker.', 'warn'); return; }
      const p = this.snapBuild(m.type, gp);
      const err = g.placeBuilding(w, m.type, p.x, p.z);
      if (err) { this.message(err, 'warn'); this.audio.play('error'); return; }
      this.audio.play('place');
      if (shift) return;
    }
    this.setMode(null);
    this.cardMode = 'main';
  }

  builderFor(gp) {
    const ws = this.myUnits().filter((u) => u.def.worker);
    ws.sort((a, b) => (a.order.type === 'build' ? 1 : 0) - (b.order.type === 'build' ? 1 : 0) || dist(a.x, a.z, gp.x, gp.z) - dist(b.x, b.z, gp.x, gp.z));
    return ws[0];
  }

  snapBuild(type, gp) {
    const s = buildingDef(this.game.players[0].faction, type).size;
    if (type === 'extractor') {
      const gy = this.game.nearestRes(gp.x, gp.z, 'geyser', 4);
      if (gy) return { x: gy.x, z: gy.z, ok: !gy.extractor };
      return { x: gp.x, z: gp.z, ok: false };
    }
    const x = s % 2 ? Math.floor(gp.x) + 0.5 : Math.round(gp.x);
    const z = s % 2 ? Math.floor(gp.z) + 0.5 : Math.round(gp.z);
    return { x, z, ok: this.world.canPlace(x, z, s) && this.fog.isExplored(x, z) };
  }

  ghost(type) {
    if (this.ghosts[type]) return this.ghosts[type];
    const def = buildingDef(this.game.players[0].faction, type);
    const P = makeBuildingModel(def, this.game.players[0].color);
    const okM = new THREE.MeshBasicMaterial({ color: 0x40ff70, transparent: true, opacity: 0.4, depthWrite: false });
    const badM = new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.4, depthWrite: false });
    P.root.traverse((m) => { if (m.isMesh) { m.material = okM; m.castShadow = false; } });
    P.scaffold.visible = false;
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(def.size, def.size), okM);
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = 0.08;
    P.root.add(foot);
    P.root.userData = { okM, badM, def };
    this.stage.scene.add(P.root);
    this.ghosts[type] = P.root;
    return P.root;
  }

  updateGhost() {
    if (this.mode?.kind !== 'build' || !this.mouse.inside) { for (const g of Object.values(this.ghosts)) g.visible = false; return; }
    const gp = this.groundAt(this.mouse.x, this.mouse.y);
    const p = this.snapBuild(this.mode.type, gp);
    const gh = this.ghost(this.mode.type);
    gh.visible = true;
    gh.position.set(p.x, this.world.heightAt(p.x, p.z), p.z);
    const okNow = p.ok && this.game.canAfford(0, gh.userData.def.cost);
    const m = okNow ? gh.userData.okM : gh.userData.badM;
    gh.traverse((o) => { if (o.isMesh) o.material = m; });
  }

  flash(p, kind = 'move') {
    const y = this.world.surfaceAt(p.x, p.z);
    this.game.fx.ring(p.x, y, p.z, 0.9, kind === 'attack' ? 0xff4030 : 0x40ff70, 0.45);
  }

  // ── keyboard ────────────────────────────────────────────────────────────────────────────────────
  onKey(e) {
    if (document.body.classList.contains('in-menu')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key;
    if (k.startsWith('Arrow')) { this.keys.add(k); e.preventDefault(); return; }
    if (k === 'Escape') {
      if (this.mode) this.setMode(null);
      else if (this.cardMode !== 'main') { this.cardMode = 'main'; this.cardKey = ''; }
      else { const b = this.sel[0]; if (b?.type === 'building' && b.owner === 0 && !b.built) this.game.cancelConstruction(b); }
      return;
    }
    if (k === 'F1') { e.preventDefault(); const h = this.game.players[0].hero; if (h && !h.dead) { if (this.sel.length === 1 && this.sel[0] === h) this.centerOn(h.x, h.z); this.sel = [h]; this.refreshSelection(); } return; }
    if (k === 'Backspace') { e.preventDefault(); const h = this.game.buildings.find((b) => !b.dead && b.owner === 0 && b.def.type === 'hall'); if (h) { this.centerOn(h.x, h.z); this.sel = [h]; this.refreshSelection(); } return; }
    if (k === ' ') { e.preventDefault(); const p = this.game.pings[this.game.pings.length - 1]; if (p) this.centerOn(p.x, p.z); return; }
    if (k === '+' || k === '=') { this.zoomTo = clamp(this.camT.dist * 0.85, 12, 70); return; }
    if (k === '-' || k === '_') { this.zoomTo = clamp(this.camT.dist * 1.15, 12, 70); return; }
    if (k === 'p' || k === 'P' || k === 'F10' || k === 'Pause') { e.preventDefault(); this.togglePause(); return; }
    if (k === '?') { $('help').classList.toggle('show'); return; }
    if (/^[0-9]$/.test(k)) {
      if (e.ctrlKey) { e.preventDefault(); this.groups[k] = this.sel.filter((s) => s.owner === 0).map((s) => s.id); this.message(`Group ${k} set.`); return; }
      const ids = this.groups[k];
      if (!ids) {
        // no group on this number yet: it triggers the skill with that number (1 chop, 2 mine, 3 rocks, 4 gas, 5 fight)
        this.card = this.buildCard();
        const si = this.card.findIndex((c) => c && c.alt === k);
        if (si >= 0) { e.preventDefault(); this.runCmd(si); }
        return;
      }
      const list = ids.map((id) => this.game.ents.get(id)).filter((x) => x && !x.dead);
      if (!list.length) return;
      const now = performance.now();
      if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 350) this.centerOn(list[0].x, list[0].z);
      this.lastGroupKey = { k, t: now };
      this.sel = list;
      this.refreshSelection();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const key = k.toUpperCase();
    this.card = this.buildCard(); // never act on a card left over from the previous selection
    const i = this.card.findIndex((c) => c && c.key === key);
    if (i >= 0) { e.preventDefault(); this.runCmd(i); }
  }

  togglePause() {
    this.paused = !this.paused;
    $('pause').classList.toggle('show', this.paused);
  }

  // ── command card ────────────────────────────────────────────────────────────────────────────────
  buildCard() {
    const g = this.game, p = g.players[0];
    const sel = this.sel.filter((s) => !s.dead);
    const cards = new Array(12).fill(null);
    const put = (slot, c) => { cards[slot] = c; };
    if (!sel.length || sel[0].owner !== 0) return cards;
    const first = sel[0];
    if (first.type === 'building') {
      const b = first;
      if (!b.built) { put(11, { key: 'ESCAPE', label: 'Cancel', icon: '✖', tip: 'Cancel construction and recover 75% of the cost.', run: () => g.cancelConstruction(b) }); return cards; }
      const keys = ['Q', 'W', 'E', 'R'];
      b.def.trains.forEach((role, i) => {
        const def = unitDef(p.faction, role);
        const why = g.missingReq(0, def.requires);
        put(i, { key: keys[i], label: def.name, icon: iconFor(def), cost: def.cost, supply: def.supply, tip: roleTip(role, def), disabled: why, run: () => this.err(g.train(b, role)) });
      });
      if (b.def.type === 'hall') {
        const h = p.hero;
        const H = HEROES[p.heroId];
        if (!h || h.dead) {
          const lvl = h?.level ?? 1;
          put(3, { key: 'H', label: `Revive ${H.name}`, icon: HERO_ICON[p.heroId], cost: [200 + lvl * 50, 0, 0], tip: `Bring ${H.name} back at level ${lvl}.`, run: () => this.err(g.train(b, 'hero')) });
        }
      }
      (b.def.research || []).forEach((key, i) => {
        const R = RESEARCH[key];
        const rank = p.upgrades[key];
        const cost = R.cost.map((c) => Math.round(c * (1 + rank * 0.6)));
        put(4 + i, { key: ['A', 'S'][i], label: `${R.name} ${rank + 1}`, icon: R.icon, cost, tip: R.desc + ` (rank ${rank}/${R.max})`, disabled: rank >= R.max ? 'Fully researched.' : null, run: () => this.err(g.research(b, key)) });
      });
      if (b.def.trains.length || b.def.type === 'hall') put(8, { key: 'T', label: 'Set Rally', icon: '⚑', tip: 'Where new units go. Right-click the ground, a mine or a tree with this building selected also sets it.', run: () => this.setMode({ kind: 'rally', hint: 'Click to set the rally point' }) });
      return cards;
    }
    const units = sel.filter((s) => s.type === 'unit');
    const workers = units.filter((u) => u.def.worker);
    if (this.cardMode === 'build' || this.cardMode === 'build2') {
      const list = this.cardMode === 'build' ? [['hall', 'H'], ['farm', 'F'], ['barracks', 'B'], ['extractor', 'E'], ['tower', 'T']] : [['sanctum', 'S'], ['workshop', 'W']];
      list.forEach(([type, key], i) => {
        const def = buildingDef(p.faction, type);
        const why = g.missingReq(0, def.requires);
        put(i, { key, label: def.name, icon: iconFor(def), cost: def.cost, tip: bldTip(type, def, p.faction), disabled: why, run: () => {
          const m = g.missing(0, def.cost);
          if (m) { this.err(m); return; }
          this.setMode({ kind: 'build', type, hint: `Place ${def.name} (Shift to place several, right-click to cancel)` });
        } });
      });
      put(11, { key: 'ESCAPE', label: 'Back', icon: '↩', tip: 'Back to the main commands.', run: () => { this.cardMode = 'main'; this.setMode(null); } });
      return cards;
    }
    const skill = (kind) => () => {
      const err = g.skill(units, kind);
      if (err) this.err(err);
      else { this.audio.voice(units[0].def.faction, 'ok', !!units[0].def.hero); this.flashSkill(units, kind); }
    };
    put(0, { key: 'M', label: 'Move', icon: '➜', tip: 'Move, ignoring enemies on the way.', run: () => this.setMode({ kind: 'move', hint: 'Click where to move' }) });
    put(1, { key: 'S', label: 'Stop', icon: '■', tip: 'Stop all orders.', run: () => g.order(units, { type: 'idle' }) });
    put(2, { key: 'H', label: 'Hold', icon: '⛉', tip: 'Hold position: fight only what comes into range.', run: () => g.order(units, { type: 'hold' }) });
    put(3, { key: 'A', label: 'Attack', icon: '⚔', tip: 'Attack a target, or attack-move: fight everything on the way.', run: () => this.setMode({ kind: 'amove', hint: 'Click a target or a place to attack-move' }) });
    const hero = units.find((u) => u.def.hero);
    if (hero && units.length <= 12) {
      hero.def.abilities.forEach((id, i) => {
        const A = ABILITY[id];
        const locked = hero.level < i + 1;
        const cd = hero.abil[id] ?? 0;
        put(4 + i, { key: ['Q', 'W', 'E'][i], label: A.name, icon: A.icon, mana: A.mana, tip: `${A.desc}${A.target === 'passive' ? '' : `<br>Mana ${A.mana}, cooldown ${A.cd}s.`} Unlocks at hero level ${i + 1}.`, disabled: locked ? `Unlocks at level ${i + 1}.` : A.target === 'passive' ? null : hero.mana < A.mana ? 'Not enough mana.' : null, cd: cd > 0 ? cd / A.cd : 0, passive: A.target === 'passive',
          run: () => this.startCast(hero, id) });
      });
    } else {
      const caster = units.find((u) => u.def.spell);
      if (caster) {
        const id = caster.def.spell, A = ABILITY[id];
        put(4, { key: 'Q', label: A.name, icon: A.icon, mana: A.mana, tip: `${A.desc}<br>Mana ${A.mana}.`, cd: (caster.abil[id] ?? 0) / A.cd, run: () => this.startCast(caster, id) });
      }
    }
    // every unit can fight: charge the nearest enemy in sight
    put(7, { key: 'F', alt: '5', label: 'Fight', icon: '⚔️', tip: 'Skill: charge the nearest enemy you can see. Press F or 5.', run: skill('fight') });
    if (workers.length) {
      // worker skills: one key sends every selected worker to the nearest resource of that kind
      put(4, { key: 'C', alt: '1', label: 'Chop Wood', icon: '🪓', tip: 'Skill: chop the nearest tree for lumber and carry it home. Press C or 1.', run: skill('chop') });
      put(5, { key: 'G', alt: '2', label: 'Mine Gold', icon: '⛏️', tip: 'Skill: mine gold from the nearest gold mine. Press G or 2.', run: skill('mine') });
      put(6, { key: 'K', alt: '3', label: 'Gather Rocks', icon: '🪨', tip: 'Skill: quarry stone from the nearest rock pile. Stone builds halls, towers and fortified buildings. Press K or 3.', run: skill('rock') });
      put(8, { key: 'X', alt: '4', label: 'Capture Gas', icon: '💠', tip: 'Skill: capture aether gas at your nearest extractor (build one on a geyser first). Press X or 4.', run: skill('gas') });
      put(9, { key: 'B', label: 'Build', icon: '🔨', tip: 'Basic structures.', run: () => { this.cardMode = 'build'; this.cardKey = ''; } });
      put(10, { key: 'V', label: 'Advanced', icon: '🏗', tip: 'Advanced structures.', run: () => { this.cardMode = 'build2'; this.cardKey = ''; } });
      put(11, workers.some((w) => w.carry)
        ? { key: 'R', label: 'Return', icon: '↩', tip: 'Carry resources back to the hall.', run: () => { for (const w of workers) if (w.carry) g.order([w], { ...w.order, type: 'gather', phase: 'drop' }); } }
        : { key: 'F', alt: '5', label: 'Fight', icon: '⚔️', tip: 'Skill: charge the nearest enemy you can see. Press F or 5.', run: skill('fight') });
      if (cards[11].label === 'Fight') cards[7] = null;
    }
    return cards;
  }

  startCast(u, id) {
    const A = ABILITY[id];
    if (A.target === 'passive') { this.message(`${A.name} is always active.`); return; }
    if (A.target === 'self') { this.err(this.game.cast(u, id, null)); return; }
    if (u.def.hero && u.level < u.def.abilities.indexOf(id) + 1) { this.err('Not unlocked yet.'); return; }
    if (u.mana < A.mana) { this.err('Not enough mana.'); return; }
    this.setMode({ kind: 'cast', ab: id, caster: u, hint: `${A.name}: click ${A.target === 'point' ? 'a place' : A.target === 'ally' ? 'a friendly unit' : 'an enemy'}` });
  }

  err(msg) { if (msg) { this.message(msg, 'warn'); this.audio.play('error'); } else this.audio.play('click'); }

  runCmd(i) {
    const c = this.card?.[i];
    if (!c) return;
    if (c.disabled) { this.err(c.disabled); return; }
    c.run();
    this.cardKey = '';
  }

  renderCard() {
    this.card = this.buildCard();
    const sig = this.card.map((c) => c ? `${c.key}|${c.label}|${!!c.disabled}|${(c.cd ?? 0).toFixed(2)}|${c.cost?.join(',')}|${this.affordable(c)}` : '-').join(';') + this.cardMode + (this.mode?.kind ?? '');
    if (sig === this.cardKey) return;
    this.cardKey = sig;
    $('cmd').innerHTML = this.card.map((c, i) => {
      if (!c) return '<div class="slot"></div>';
      const poor = c.cost && !this.affordable(c);
      const active = this.mode && ((this.mode.kind === 'build' && c.label === buildingDef(this.game.players[0].faction, this.mode.type).name) || (this.mode.kind === 'cast' && c.label === ABILITY[this.mode.ab]?.name) || (this.mode.kind === 'amove' && c.key === 'A') || (this.mode.kind === 'move' && c.key === 'M'));
      return `<button data-i="${i}" class="${c.disabled ? 'off' : ''} ${poor ? 'poor' : ''} ${active ? 'active' : ''} ${c.passive ? 'passive' : ''}">
        <span class="ic">${c.icon}</span><span class="hk">${c.key === 'ESCAPE' ? 'Esc' : c.key}${c.alt ? `<em>${c.alt}</em>` : ''}</span>
        ${c.cd > 0 ? `<span class="cdv" style="height:${Math.round(c.cd * 100)}%"></span>` : ''}
        <span class="lb">${c.label}</span></button>`;
    }).join('');
  }

  affordable(c) { return !c.cost || this.game.canAfford(0, c.cost); }

  showTip(c, el) {
    const tip = $('tip');
    if (!c) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<b>${c.label}</b> <span class="hk2">[${c.key === 'ESCAPE' ? 'Esc' : c.key}${c.alt ? ' or ' + c.alt : ''}]</span>
      ${c.cost ? `<div>${costHtml(c.cost)}${c.supply ? ` <span class="cost">👥 ${c.supply}</span>` : ''}</div>` : ''}
      ${c.mana ? `<div><span class="cost mana">◆ ${c.mana} mana</span></div>` : ''}
      <div class="tipd">${c.tip ?? ''}</div>${c.disabled ? `<div class="tipw">${c.disabled}</div>` : ''}`;
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - 290, r.left - 100)) + 'px';
    tip.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  }

  // ── selection panel ─────────────────────────────────────────────────────────────────────────────
  refreshSelection() {
    this.sel = this.sel.filter((s) => !s.dead);
    if (!this.sel.some((s) => s.def?.worker)) this.cardMode = 'main';
    if (this.mode && this.mode.kind !== 'build') this.setMode(null);
    for (const e of [...this.game.units, ...this.game.buildings, ...this.game.resources]) if (e.ring) e.ring.visible = false;
    for (const e of this.sel) {
      if (!e.ring) {
        const r = e.type === 'unit' ? e.radius + 0.15 : e.size * 0.62;
        e.ring = makeRing(r, e.owner === 0 ? 0x40ff60 : e.owner === NEUTRAL ? 0xf0d040 : 0xff4030);
        this.game.root.add(e.ring);
      }
      e.ring.visible = true;
    }
    this.selKey = '';
    this.cardKey = '';
    this.renderSel();
    this.renderCard();
  }

  renderSel() {
    const sel = this.sel.filter((s) => !s.dead);
    const el = $('sel');
    if (!sel.length) {
      const p = this.game.players[0];
      const F = FACTIONS[p.faction];
      const key = 'none' + p.supply + p.cap;
      if (key === this.selKey) return;
      this.selKey = key;
      el.innerHTML = `<div class="empty"><b>${F.name}</b><br><span>${F.race}. ${F.trait}</span><br><small>Left-click to select, drag to box-select, right-click to command. Press ? for help.</small></div>`;
      return;
    }
    if (sel.length > 1) {
      const key = 'multi' + sel.map((s) => s.id + ':' + Math.round(s.hp / s.maxHp * 20)).join(',');
      if (key === this.selKey) return;
      this.selKey = key;
      el.innerHTML = `<div class="multi">${sel.map((s) => `<div class="mini" data-sel="${s.id}" title="${s.def.name}"><span>${iconFor(s.def, s)}</span><i style="width:${Math.round(s.hp / s.maxHp * 100)}%;background:${hpColor(s.hp / s.maxHp)}"></i></div>`).join('')}</div>`;
      return;
    }
    const e = sel[0];
    const g = this.game;
    let html = '';
    if (e.type === 'rock') {
      html = `<div class="por">🪨</div><div class="info"><b>${e.name}</b><div class="row">🪨 Stone left: ${fmt(e.amount)}</div>
        <div class="row small">Workers quarry 10 stone per trip with a pick. Select workers and press K or 3.</div></div>`;
    } else if (e.type === 'mine' || e.type === 'geyser') {
      html = `<div class="por">${iconFor(null, e)}</div><div class="info"><b>${e.name}</b><div class="row">${e.type === 'mine' ? '💰 Gold' : '💠 Aether'} left: ${fmt(e.amount)}</div>
        <div class="row small">${e.type === 'geyser' ? (e.extractor ? 'An extractor is drawing aether from it.' : 'Build an extractor here, then send workers to it.') : 'Workers carry 10 gold per trip.'}</div></div>`;
    } else if (e.type === 'building') {
      const pct = Math.round(e.progress * 100);
      const q = e.queue;
      html = `<div class="por">${iconFor(e.def)}</div><div class="info"><b>${e.def.name}</b> <small>${e.owner === 0 ? '' : this.ownerName(e.owner)}</small>
        ${bar(e.hp, e.maxHp, 'hp')}
        ${!e.built ? `<div class="row">Under construction ${pct}%</div>${bar(e.progress, 1, 'build')}` : ''}
        ${e.built && e.def.supply ? `<div class="row small">Provides ${e.def.supply} supply.</div>` : ''}
        ${e.built && e.def.attack ? `<div class="row small">Damage ${Math.round(g.dmgOf(e))}, range ${e.def.attack.range}.</div>` : ''}
        ${e.def.type === 'extractor' ? `<div class="row small">💠 ${fmt(g.ents.get(e.geyser)?.amount ?? 0)} aether left.</div>` : ''}
        ${e.def.dropoff ? `<div class="row small">Workers bring resources here.</div>` : ''}
        ${q.length && e.owner === 0 ? `<div class="queue">${q.map((it, i) => `<div class="qi" data-q="${i}" title="Click to cancel">${it.kind === 'research' ? RESEARCH[it.key].icon : it.kind === 'hero' ? HERO_ICON[g.players[0].heroId] : iconFor(it.def)}${i === 0 ? `<i style="width:${Math.round(it.t / it.total * 100)}%"></i>` : ''}</div>`).join('')}</div>${q[0].blocked ? '<div class="row warn">Waiting for supply.</div>' : ''}` : ''}
        </div>`;
    } else {
      const d = e.def;
      const lvl = d.hero ? `<span class="lvl">Level ${e.level}</span>` : '';
      const next = d.hero && e.level < HERO_XP.length ? HERO_XP[e.level] : null;
      const buffs = Object.entries(e.buffs).filter(([, v]) => v > 0).map(([k]) => ({ stun: '💫 Stunned', slow: '🐌 Slowed', roar: '❢ Battle Roar', avatar: '⛰ Avatar', invuln: '◈ Immune', shield: 'ᚱ Warded', auraArmor: '⚑ Devotion', auraSpeed: '⚚ Dread Aura' }[k])).filter(Boolean);
      html = `<div class="por">${iconFor(d)}</div><div class="info"><b>${d.name}</b> ${lvl} <small>${d.title ?? (e.owner === 0 ? FACTIONS[d.faction]?.race ?? '' : this.ownerName(e.owner))}</small>
        ${bar(e.hp, e.maxHp, 'hp')}${e.maxMana ? bar(e.mana, e.maxMana, 'mana') : ''}
        ${next ? `<div class="xp"><i style="width:${Math.round((e.xp - HERO_XP[e.level - 1]) / (next - HERO_XP[e.level - 1]) * 100)}%"></i><span>XP ${Math.floor(e.xp)} / ${next}</span></div>` : ''}
        <div class="stats"><span title="Damage">⚔ ${Math.round(g.dmgOf(e))}</span><span title="Armor">🛡 ${Math.round(g.armorOf(e) * 10) / 10}</span><span title="Range">➶ ${d.range > 2 ? d.range : 'melee'}</span><span title="Speed">➜ ${g.speedOf(e).toFixed(1)}</span>${d.flying ? '<span>🪽 flying</span>' : ''}</div>
        ${e.carry ? `<div class="row small">Carrying ${e.carry.amt} ${e.carry.res}.</div>` : ''}
        ${e.life ? `<div class="row small">Summoned: ${Math.ceil(e.life)}s left.</div>` : ''}
        ${buffs.length ? `<div class="row small">${buffs.join(' · ')}</div>` : ''}
        <div class="row small dim">${this.orderText(e)}</div></div>`;
    }
    if (html === this.selKey) return;
    this.selKey = html;
    el.innerHTML = `<div class="single">${html}</div>`;
  }

  ownerName(o) { return o === NEUTRAL ? 'Neutral creep' : `${FACTIONS[this.game.players[o].faction].short} (enemy)`; }

  orderText(u) {
    const o = u.order;
    if (u.owner !== 0) return '';
    switch (o.type) {
      case 'gather': return o.lumber ? 'Chopping wood' : ({ mine: 'Mining gold', rock: 'Gathering rocks' }[this.game.ents.get(o.res)?.type] ?? 'Capturing aether gas');
      case 'build': return `Going to build ${o.def.name}`;
      case 'construct': return 'Constructing';
      case 'attack': return 'Attacking';
      case 'amove': return 'Attack-moving';
      case 'move': return 'Moving';
      case 'hold': return 'Holding position';
      case 'cast': return `Casting ${ABILITY[o.ab].name}`;
      default: return 'Idle';
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────────────────────────
  updateHUD(dayK) {
    const p = this.game.players[0];
    $('r-gold').textContent = fmt(p.gold);
    $('r-lumber').textContent = fmt(p.lumber);
    $('r-aether').textContent = fmt(p.aether);
    $('r-stone').textContent = fmt(p.stone);
    $('r-supply').textContent = `${p.supply}/${p.cap}`;
    $('r-supply').parentElement.classList.toggle('full', p.supply >= p.cap);
    const t = Math.floor(this.game.time);
    $('clock').textContent = `${dayK > 0.5 ? '☀️' : '🌙'} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const idle = this.game.units.filter((u) => !u.dead && u.owner === 0 && u.def.worker && u.order.type === 'idle').length;
    const ib = $('idle');
    ib.style.display = idle ? 'flex' : 'none';
    ib.textContent = `⛏️ ${idle} idle`;
  }

  selectIdleWorker() {
    const list = this.game.units.filter((u) => !u.dead && u.owner === 0 && u.def.worker && u.order.type === 'idle');
    if (!list.length) return;
    this.idleI = ((this.idleI ?? -1) + 1) % list.length;
    const u = list[this.idleI];
    this.sel = [u];
    this.centerOn(u.x, u.z);
    this.refreshSelection();
  }

  message(text, kind = 'info') {
    const box = $('msgs');
    const d = document.createElement('div');
    d.className = 'msg ' + kind;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 5000);
    setTimeout(() => d.remove(), 6000);
  }

  onGameEvent(type, data) {
    if (type === 'msg') this.message(data.text, data.kind);
    else if (type === 'selection') this.refreshSelection();
    else if (type === 'over') this.onOver?.(data);
  }

  // ── per-frame overlay update ────────────────────────────────────────────────────────────────────
  update(dt, dayK) {
    this.updateCamera(dt);
    this.updateGhost();
    const cam = this.stage.cam;
    const g = this.game;
    // hover
    this.hoverT = (this.hoverT ?? 0) - dt;
    if (this.hoverT <= 0 && this.mouse.inside && !this.drag) { this.hoverT = 0.1; this.hover = this.pick(this.mouse.x, this.mouse.y); this.canvas.style.cursor = this.mode ? 'crosshair' : this.hover && this.hover.owner !== 0 && this.hover.owner !== undefined && this.hover.type !== 'mine' && this.hover.type !== 'geyser' && this.sel.some((s) => s.owner === 0 && s.type === 'unit') ? 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27%3E%3Cpath d=%27M3 3l8 3-3 2 9 9-2 2-9-9-2 3z%27 fill=%27%23f44%27 stroke=%27%23000%27/%3E%3C/svg%3E") 3 3, pointer' : 'default'; }
    // units: visibility, bars, rings
    for (const u of g.units) {
      if (u.dead) continue;
      const vis = u.owner === 0 || g.fog.visible(u.x, u.z);
      u.model.root.visible = vis && !u.hidden;
      const show = vis && !u.hidden && (this.sel.includes(u) || u === this.hover || u.hp < u.maxHp - 0.5 || u.def.hero);
      u.bar.visible = show;
      if (show) {
        u.bar.position.set(u.x, u.y + (u.model.height ?? 1.6) * (u.avatarOn ? 1.45 : 1) + 0.35, u.z);
        u.bar.quaternion.copy(cam.quaternion);
        u.bar.set(u.hp / u.maxHp, u.maxMana ? u.mana / u.maxMana : null);
      }
      if (u.ring?.visible) { u.ring.position.set(u.x, this.world.surfaceAt(u.x, u.z) + 0.07, u.z); u.ring.visible = vis && !u.hidden; }
    }
    for (const b of g.buildings) {
      if (b.dead) continue;
      if (!b.seen && g.fog.visible(b.x, b.z)) b.seen = true;
      b.model.visible = b.owner === 0 || b.seen;
      const show = b.model.visible && (this.sel.includes(b) || b === this.hover || b.hp < b.maxHp - 1 || !b.built);
      b.bar.visible = show;
      if (show) {
        b.bar.position.set(b.x, b.y + 3.6 + (b.def.type === 'tower' || b.def.type === 'hall' ? 1.4 : 0), b.z);
        b.bar.quaternion.copy(cam.quaternion);
        b.bar.set(b.hp / b.maxHp, !b.built ? b.progress : (b.queue[0] ? b.queue[0].t / b.queue[0].total : null));
      }
      if (b.ring?.visible) b.ring.position.set(b.x, b.y + 0.08, b.z);
    }
    for (const r of g.resources) if (r.ring?.visible) r.ring.position.set(r.x, r.y + 0.08, r.z);
    this.hudT = (this.hudT ?? 0) - dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      this.updateHUD(dayK);
      if (this.sel.some((s) => s.dead)) this.refreshSelection();
      this.renderSel();
      this.renderCard();
      this.drawMinimap();
    }
  }

  // ── minimap ─────────────────────────────────────────────────────────────────────────────────────
  buildMinimapBase() {
    const w = this.world;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, b = w.block[i], h = w.heightAt(x + 0.5, z + 0.5);
      let col;
      if (b & BLOCK.WATER) col = [40, 90, 130];
      else if (b & BLOCK.TREE) col = [34, 74, 34];
      else if (b & BLOCK.CLIFF) col = h > 5 ? [200, 200, 205] : [110, 100, 88];
      else { const k = clamp(h / 3, 0, 1); col = [86 + k * 30, 120 + k * 20, 60]; }
      img.data.set([...col, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    this.mmBase = c;
    this.mmFog = document.createElement('canvas');
    this.mmFog.width = this.mmFog.height = N;
    this.mmFogImg = this.mmFog.getContext('2d').createImageData(N, N);
  }

  drawMinimap() {
    const cv = $('minimap'), ctx = cv.getContext('2d');
    const S = cv.width / N;
    const g = this.game, w = this.world;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mmBase, 0, 0, cv.width, cv.height);
    // felled trees show as ground
    ctx.fillStyle = 'rgb(96,126,62)';
    for (const t of w.trees) if (!t.alive) ctx.fillRect(t.cx * S, t.cz * S, S, S);
    for (const r of g.resources) {
      if (r.dead || !this.fog.isExplored(r.x, r.z)) continue;
      ctx.fillStyle = r.type === 'mine' ? '#ffd040' : r.type === 'rock' ? '#c8c2b8' : (r.great ? '#d0a0ff' : '#5ff0ff');
      ctx.fillRect((r.x - r.size / 2) * S, (r.z - r.size / 2) * S, r.size * S, r.size * S);
    }
    for (const b of g.buildings) {
      if (b.dead || !(b.owner === 0 || b.seen)) continue;
      ctx.fillStyle = g.teamColor(b.owner);
      ctx.fillRect((b.x - b.size / 2) * S, (b.z - b.size / 2) * S, b.size * S, b.size * S);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeRect((b.x - b.size / 2) * S, (b.z - b.size / 2) * S, b.size * S, b.size * S);
    }
    for (const u of g.units) {
      if (u.dead || u.hidden) continue;
      if (u.owner !== 0 && !this.fog.visible(u.x, u.z)) continue;
      ctx.fillStyle = this.sel.includes(u) ? '#ffffff' : g.teamColor(u.owner);
      const s = u.def.hero ? 3.2 : 2;
      ctx.fillRect(u.x * S - s / 2 * S * 0.6, u.z * S - s / 2 * S * 0.6, s * S * 0.6, s * S * 0.6);
    }
    // fog overlay
    if (this.fog.enabled) {
      const d = this.mmFogImg.data;
      for (let i = 0; i < N * N; i++) { d[i * 4 + 3] = this.fog.vis[i] ? 0 : this.fog.explored[i] ? 110 : 235; }
      this.mmFog.getContext('2d').putImageData(this.mmFogImg, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.mmFog, 0, 0, cv.width, cv.height);
    }
    // pings
    const now = g.time;
    for (const p of g.pings) {
      const age = now - p.t;
      if (age > 4) continue;
      ctx.strokeStyle = `rgba(255,60,40,${1 - age / 4})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x * S, p.z * S, (4 + (age * 8) % 10) * S, 0, Math.PI * 2); ctx.stroke();
    }
    // camera view
    const r = this.canvas.getBoundingClientRect();
    const corners = [[0, 0], [r.width, 0], [r.width, r.height], [0, r.height]].map(([x, y]) => this.groundAt(x, y));
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x * S, c.z * S) : ctx.moveTo(c.x * S, c.z * S)));
    ctx.closePath();
    ctx.stroke();
  }
}

function bar(v, max, kind) {
  const k = clamp(v / max, 0, 1);
  const label = kind === 'build' ? '' : `${Math.ceil(v)} / ${Math.ceil(max)}`;
  return `<div class="bar ${kind}"><i style="width:${Math.round(k * 100)}%;${kind === 'hp' ? `background:${hpColor(k)}` : ''}"></i><span>${label}</span></div>`;
}
const hpColor = (k) => (k > 0.6 ? '#3fcf4f' : k > 0.3 ? '#e8b820' : '#e8402a');

function roleTip(role, def) {
  const what = {
    worker: 'Harvests gold, lumber and aether and builds structures.',
    melee: 'Sturdy front-line infantry.',
    ranged: 'Attacks from range; can hit flying units.',
    cavalry: 'Fast, heavily armoured mounted warrior.',
    caster: 'Spellcaster; casts its spell automatically.',
    siege: 'Aether-fed siege engine: huge damage to buildings, splash. Can\'t hit flyers.',
    flyer: 'Flies over trees, cliffs and water; only ranged attacks can reach it.',
  }[role];
  return `${what}<br>HP ${def.hp}, damage ${def.dmg}, armor ${def.armor}${def.range > 2 ? `, range ${def.range}` : ''}.`;
}

function bldTip(type, def, faction) {
  const what = {
    hall: 'Trains workers and revives your hero. Workers return resources here.',
    farm: `Provides ${def.supply} supply.`,
    barracks: `Trains ${['melee', 'ranged', 'cavalry'].map((r) => FACTIONS[faction].units[r].name).join(', ')}.`,
    sanctum: `Trains ${FACTIONS[faction].units.caster.name} and ${FACTIONS[faction].units.flyer.name}. Unlocks cavalry.`,
    workshop: `Builds ${FACTIONS[faction].units.siege.name}; researches weapon and armor upgrades.`,
    tower: 'Defensive tower that shoots at enemies in range.',
    extractor: 'Built on an aether geyser. Workers draw aether from it, needed for siege, flyers and spellcasters.',
  }[type];
  return `${what}<br>HP ${def.hp}, build time ${def.time}s.`;
}
