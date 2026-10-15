// The world model: a 128 x 128 m map with a height field, water, cliffs, forests, gold mines,
// aether geysers and creep camps. One grid cell is 1 m. The map is laid out for up to four
// players in the corners, with four expansions on the edges and the Great Aether Geyser on a
// plateau in the middle, ringed by a lake with four fords and guarded by the Aether Wyrm.

import * as THREE from 'three';
import { makeNoise, rng, clamp, smooth, lerp } from './util.js';
import { applyFog, fogUniforms } from './fog.js';

export const N = 128;
const RES = 2; // height samples per metre
const HN = N * RES + 1;

export const BLOCK = { WATER: 1, CLIFF: 2, TREE: 4, BUILDING: 8, RESOURCE: 16 };

export const STARTS = [
  { x: 22, z: 106 },
  { x: 106, z: 22 },
  { x: 22, z: 22 },
  { x: 106, z: 106 },
];
const EXPANSIONS = [
  { x: 64, z: 13 }, { x: 64, z: 115 }, { x: 13, z: 64 }, { x: 115, z: 64 },
];
const CENTER = { x: 64, z: 64 };

const GLSL_NOISE = `
  float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fhash(i), fhash(i + vec2(1, 0)), f.x), mix(fhash(i + vec2(0, 1)), fhash(i + vec2(1, 1)), f.x), f.y);
  }`;

export class World {
  constructor(seed, startStyles) {
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.r = rng(seed * 7 + 3);
    this.h = new Float32Array(HN * HN);
    this.block = new Uint8Array(N * N);
    this.owner = new Int32Array(N * N).fill(-1); // entity id occupying a cell (buildings/resources)
    this.treeAt = new Int32Array(N * N).fill(-1);
    this.trees = []; // {x, z, wood, type, alive}
    this.mines = []; // {x, z}
    this.geysers = []; // {x, z, great}
    this.camps = []; // {x, z, creeps: [...]}
    this.startStyles = startStyles; // style per start index (for ground tint), may contain nulls
    this.group = new THREE.Group();
    this.roads = makeRoads();
    this.buildHeights();
    this.classify();
    this.placeResources();
    this.placeTrees();
  }

  // ── terrain ─────────────────────────────────────────────────────────────────────────────────────
  rawHeight(x, z) {
    const n = this.noise;
    let h = n.fbm(x * 0.03, z * 0.03, 4) * 1.3 + 0.6;
    // rocky outcrops: a few sharp cliffs out in the wilds
    const ridge = 1 - Math.abs(n.fbm(x * 0.045 + 40, z * 0.045 - 17, 3));
    // roads keep every base, expansion and ford connected: no outcrops on them
    const road = smooth(clamp((this.roadDist(x, z) - 3) / 5, 0, 1));
    h += Math.max(0, ridge - 0.87) * 34 * road;
    // map border mountains
    const edge = Math.min(x, z, N - x, N - z);
    if (edge < 7) h += (7 - edge) * (7 - edge) * 0.32 + 1.2 * (1 - edge / 7);
    // central lake ring with fords, plateau inside
    const dx = x - CENTER.x, dz = z - CENTER.z;
    const d = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx);
    let ford = 0;
    for (let k = 0; k < 4; k++) {
      const da = Math.abs(((a - k * Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      ford = Math.max(ford, 1 - smooth(clamp(da / 0.17, 0, 1)));
    }
    const ring = 1 - smooth(clamp(Math.abs(d - 16.5) / 4.5, 0, 1));
    h = lerp(h, lerp(-2.4, 0.15, ford), ring);
    if (d < 12.5) h = lerp(h, 1.6 + n(x * 0.2, z * 0.2) * 0.2, 1 - smooth(clamp((d - 9) / 3.5, 0, 1)));
    // small ponds
    for (const p of this.ponds || []) {
      const pd = Math.hypot(x - p.x, z - p.z);
      if (pd < p.r + 3) h = lerp(h, -1.6, 1 - smooth(clamp((pd - p.r + 1.5) / 3, 0, 1)));
    }
    // flatten player bases and expansions
    for (const s of STARTS) h = flatten(h, x, z, s, 15, 0.7);
    for (const s of EXPANSIONS) h = flatten(h, x, z, s, 9, 0.7);
    return h;
  }

  buildHeights() {
    const r = this.r;
    this.ponds = [];
    for (let i = 0; i < 4; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const p = { x: r.range(20, 108), z: r.range(20, 108), r: r.range(2.5, 4) };
        const far = [...STARTS, ...EXPANSIONS].every((s) => Math.hypot(s.x - p.x, s.z - p.z) > 20) && Math.hypot(p.x - 64, p.z - 64) > 26 && this.roadDist(p.x, p.z) > p.r + 6;
        if (far) { this.ponds.push(p); break; }
      }
    }
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) this.h[j * HN + i] = this.rawHeight(i / RES, j / RES);
  }

  heightAt(x, z) {
    const fx = clamp(x * RES, 0, HN - 1.001), fz = clamp(z * RES, 0, HN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h = this.h;
    return lerp(lerp(h[j * HN + i], h[j * HN + i + 1], u), lerp(h[(j + 1) * HN + i], h[(j + 1) * HN + i + 1], u), v);
  }

  /** Ground height including water surface (for flyers' shadows, effects, etc.). */
  surfaceAt(x, z) { return Math.max(this.heightAt(x, z), 0); }

  classify() {
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const c = this.heightAt(x + 0.5, z + 0.5);
      let slope = 0;
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) slope = Math.max(slope, Math.abs(this.heightAt(x + ox, z + oz) - c) * 2);
      let b = 0;
      if (c < -0.35) b |= BLOCK.WATER;
      if (slope > 1.1 || x < 2 || z < 2 || x > N - 3 || z > N - 3) b |= BLOCK.CLIFF;
      this.block[z * N + x] = b;
    }
  }

  // ── resources and creep camps ───────────────────────────────────────────────────────────────────
  placeResources() {
    const toCenter = (s, d) => {
      const dx = CENTER.x - s.x, dz = CENTER.z - s.z, L = Math.hypot(dx, dz);
      return { x: dx / L * d, z: dz / L * d };
    };
    for (const s of STARTS) {
      // gold mine off to one side, geyser to the other, both toward the map corner
      const out = toCenter(s, -1);
      const side = { x: -out.z, z: out.x };
      this.mines.push({ x: Math.round(s.x + out.x * 9 + side.x * 4) + 0.5, z: Math.round(s.z + out.z * 9 + side.z * 4) + 0.5, amount: 12000 });
      this.geysers.push({ x: Math.round(s.x + out.x * 4 - side.x * 9) + 0.5, z: Math.round(s.z + out.z * 4 - side.z * 9) + 0.5, amount: 6000 });
    }
    for (const s of EXPANSIONS) {
      const out = toCenter(s, -1);
      const side = { x: -out.z, z: out.x };
      this.mines.push({ x: Math.round(s.x + out.x * 3 + side.x * 5) + 0.5, z: Math.round(s.z + out.z * 3 + side.z * 5) + 0.5, amount: 9000 });
      this.geysers.push({ x: Math.round(s.x + out.x * 3 - side.x * 5) + 0.5, z: Math.round(s.z + out.z * 3 - side.z * 5) + 0.5, amount: 5000 });
      const c = toCenter(s, 7);
      this.camps.push({ x: s.x + c.x, z: s.z + c.z, creeps: ['ogre', 'kobold', 'kobold'] });
    }
    this.geysers.push({ x: CENTER.x + 0.5, z: CENTER.z + 0.5, amount: 20000, great: true });
    this.mines.push({ x: CENTER.x + 0.5, z: CENTER.z - 6.5, amount: 15000 });
    this.camps.push({ x: CENTER.x, z: CENTER.z + 4.5, creeps: ['wyrm'] });
    // camps between bases and expansions
    const between = [[STARTS[0], EXPANSIONS[2]], [STARTS[0], EXPANSIONS[1]], [STARTS[1], EXPANSIONS[0]], [STARTS[1], EXPANSIONS[3]],
      [STARTS[2], EXPANSIONS[0]], [STARTS[2], EXPANSIONS[2]], [STARTS[3], EXPANSIONS[1]], [STARTS[3], EXPANSIONS[3]]];
    const kinds = [['direwolf', 'direwolf'], ['spider', 'spider', 'kobold'], ['kobold', 'kobold', 'kobold'], ['spider', 'direwolf']];
    between.forEach(([a, b], i) => {
      let x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      x += (CENTER.x - x) * 0.18; z += (CENTER.z - z) * 0.18;
      this.camps.push({ x, z, creeps: kinds[i % kinds.length] });
    });
    for (const c of this.camps) {
      // nudge camps onto open ground
      const p = this.nearestOpen(c.x, c.z, 6);
      if (p) { c.x = p.x; c.z = p.z; }
    }
  }

  placeTrees() {
    const r = this.r, n = this.noise;
    const keepOut = [];
    for (const s of STARTS) keepOut.push({ x: s.x, z: s.z, r: 14 });
    for (const s of EXPANSIONS) keepOut.push({ x: s.x, z: s.z, r: 8 });
    for (const m of this.mines) keepOut.push({ x: m.x, z: m.z, r: 4 });
    for (const g of this.geysers) keepOut.push({ x: g.x, z: g.z, r: g.great ? 6 : 4 });
    for (const c of this.camps) keepOut.push({ x: c.x, z: c.z, r: 4 });
    keepOut.push({ x: CENTER.x, z: CENTER.z, r: 22 });
    // lumber groves behind each base, so every player has wood close by
    const groves = STARTS.map((s) => {
      const dx = s.x < 64 ? -1 : 1, dz = s.z < 64 ? -1 : 1;
      return [{ x: s.x + dx * 4 - dz * 13, z: s.z + dz * 13 + dx * 2, r: 6 }, { x: s.x + dx * 13, z: s.z - dz * 5, r: 5 }];
    }).flat();
    for (let z = 2; z < N - 2; z++) for (let x = 2; x < N - 2; x++) {
      const i = z * N + x;
      if (this.block[i] & (BLOCK.WATER)) continue;
      const cx = x + 0.5, cz = z + 0.5;
      const h = this.heightAt(cx, cz);
      if (h < 0.1) continue;
      let p = 0;
      const f = n.fbm(cx * 0.07 + 11, cz * 0.07 - 5, 3);
      if (f > 0.08) p = 0.55 + f;
      const edge = Math.min(cx, cz, N - cx, N - cz);
      if (edge < 13) p = Math.max(p, 0.85);
      for (const g of groves) if (Math.hypot(cx - g.x, cz - g.z) < g.r) p = 0.95;
      if (p <= 0) continue;
      if (this.roadDist(cx, cz) < 2.8) continue;
      if (keepOut.some((k) => Math.hypot(cx - k.x, cz - k.z) < k.r) && !groves.some((g) => Math.hypot(cx - g.x, cz - g.z) < g.r && Math.hypot(cx - g.x, cz - g.z) < g.r)) continue;
      if (keepOut.some((k) => Math.hypot(cx - k.x, cz - k.z) < Math.min(k.r, 10))) continue;
      if (r() > p) continue;
      if (this.block[i] & BLOCK.CLIFF && edge > 4 && r() < 0.6) continue;
      const type = h > 3.2 || n(cx * 0.1, cz * 0.1) > 0.15 ? 0 : (n(cx * 0.13 + 7, cz * 0.13) > 0.1 ? 2 : 1);
      this.treeAt[i] = this.trees.length;
      this.trees.push({ x: cx + r.range(-0.2, 0.2), z: cz + r.range(-0.2, 0.2), cx: x, cz: z, wood: 60, type, alive: true, s: r.range(0.8, 1.25), rot: r() * 6.28 });
      this.block[i] |= BLOCK.TREE;
    }
  }

  /** Distance to the nearest road (segments between bases, expansions, fords and the centre). */
  roadDist(x, z) {
    let best = 1e9;
    for (const [a, b] of this.roads) {
      const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L, 0, 1);
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (d < best) best = d;
    }
    return best;
  }

  // ── grid helpers ────────────────────────────────────────────────────────────────────────────────
  isBlocked(cx, cz, flying = false) {
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return true;
    if (flying) return false;
    return this.block[cz * N + cx] !== 0;
  }

  nearestOpen(x, z, maxR = 10) {
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let r = 0; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (this.isBlocked(cx + dx, cz + dz)) continue;
        const d = Math.hypot(cx + dx + 0.5 - x, cz + dz + 0.5 - z);
        if (d < bd) { bd = d; best = { x: cx + dx + 0.5, z: cz + dz + 0.5 }; }
      }
      if (best) return best;
    }
    return null;
  }

  /** Can a footprint of size s be placed with its centre at (x, z)? */
  canPlace(x, z, s, opts = {}) {
    const x0 = Math.round(x - s / 2), z0 = Math.round(z - s / 2);
    let hmin = 1e9, hmax = -1e9;
    for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
      const cx = x0 + dx, cz = z0 + dz;
      if (cx < 2 || cz < 2 || cx >= N - 2 || cz >= N - 2) return false;
      const b = this.block[cz * N + cx];
      if (opts.geyser ? (b & ~BLOCK.RESOURCE) : b) return false;
      const h = this.heightAt(cx + 0.5, cz + 0.5);
      hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
    }
    return hmax - hmin < 0.9;
  }

  setFootprint(x, z, s, flag, id) {
    const x0 = Math.round(x - s / 2), z0 = Math.round(z - s / 2);
    for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
      const i = (z0 + dz) * N + x0 + dx;
      if (i < 0 || i >= N * N) continue;
      if (id === undefined) { this.block[i] &= ~flag; this.owner[i] = -1; }
      else { this.block[i] |= flag; this.owner[i] = id; }
    }
  }

  // ── rendering ───────────────────────────────────────────────────────────────────────────────────
  buildMeshes(quality) {
    this.buildTerrainMesh();
    this.buildWater();
    this.buildTreeMeshes();
    this.buildRocks();
    return this.group;
  }

  groundTint(x, z) {
    // faction ground near each start: blight for the Dread, lush moss for Sylvan, red dust for Ironfang
    let tint = null, k = 0;
    this.startStyles.forEach((st, i) => {
      if (!st) return;
      const s = STARTS[i];
      const d = Math.hypot(x - s.x, z - s.z);
      const w = 1 - smooth(clamp((d - 9) / 9, 0, 1));
      if (w > k) { k = w; tint = st; }
    });
    return { tint, k };
  }

  buildTerrainMesh() {
    const SEG = N * RES;
    const geo = new THREE.PlaneGeometry(N, N, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    geo.translate(N / 2, 0, N / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), t = new THREE.Color();
    const n = this.noise;
    const C = {
      grass: new THREE.Color(0x5c8a34), grass2: new THREE.Color(0x86a546), moss: new THREE.Color(0x3f6a2c),
      dirt: new THREE.Color(0x8c6a42), rock: new THREE.Color(0x7d766c), rock2: new THREE.Color(0x5e5850),
      sand: new THREE.Color(0xc9b27a), wet: new THREE.Color(0x3e5a54), snow: new THREE.Color(0xe8ecf0),
      aether: new THREE.Color(0x6a5aa0),
      blight: new THREE.Color(0x4a3c52), sylvan: new THREE.Color(0x3a7a4a), ironfang: new THREE.Color(0xa0583a),
      valemark: new THREE.Color(0x7a9a46), deepforge: new THREE.Color(0x8a7a62),
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.h[Math.round(z * RES) * HN + Math.round(x * RES)];
      pos.setY(i, h);
      const sl = Math.max(Math.abs(this.heightAt(x + 0.5, z) - this.heightAt(x - 0.5, z)), Math.abs(this.heightAt(x, z + 0.5) - this.heightAt(x, z - 0.5)));
      const g = n.fbm(x * 0.12, z * 0.12, 3);
      c.copy(C.grass).lerp(C.grass2, clamp(g * 1.5 + 0.5, 0, 1));
      const forest = n.fbm(x * 0.07 + 11, z * 0.07 - 5, 3);
      if (forest > 0.05) c.lerp(C.moss, clamp((forest - 0.05) * 3, 0, 0.7));
      // dirt patches and worn ground around bases and mines
      const dn = n.fbm(x * 0.09 - 30, z * 0.09 + 12, 3);
      let dirtK = clamp((dn - 0.15) * 3, 0, 0.7);
      for (const s of STARTS) { const d = Math.hypot(x - s.x, z - s.z); dirtK = Math.max(dirtK, (1 - smooth(clamp((d - 4) / 8, 0, 1))) * 0.55); }
      for (const m of this.mines) { const d = Math.hypot(x - m.x, z - m.z); dirtK = Math.max(dirtK, (1 - smooth(clamp((d - 2) / 3, 0, 1))) * 0.85); }
      // worn dirt roads
      const rd = this.roadDist(x, z) + n(x * 0.4, z * 0.4) * 0.8;
      dirtK = Math.max(dirtK, (1 - smooth(clamp((rd - 0.8) / 1.6, 0, 1))) * 0.6);
      c.lerp(C.dirt, dirtK);
      const { tint, k } = this.groundTint(x, z);
      if (tint) c.lerp(C[tint === 'dread' ? 'blight' : tint], k * 0.55);
      // aether-touched centre
      const dc = Math.hypot(x - CENTER.x, z - CENTER.z);
      c.lerp(C.aether, (1 - smooth(clamp((dc - 3) / 9, 0, 1))) * 0.45);
      for (const gy of this.geysers) { const d = Math.hypot(x - gy.x, z - gy.z); c.lerp(C.aether, (1 - smooth(clamp((d - 1.5) / 3, 0, 1))) * 0.5); }
      // sand at the shore, wet ground below the waterline
      if (h < 0.3) c.lerp(C.sand, clamp((0.3 - h) * 2.5, 0, 1));
      if (h < -0.2) c.lerp(C.wet, clamp((-0.2 - h) * 1.2, 0, 1));
      // rock on slopes, snow on the high border peaks
      if (sl > 0.35) c.lerp(t.copy(C.rock).lerp(C.rock2, clamp(g + 0.5, 0, 1)), clamp((sl - 0.35) * 2.2, 0, 1));
      if (h > 6) c.lerp(C.snow, clamp((h - 6) / 3, 0, 0.9));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = applyFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 'terrain', (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('uniform sampler2D uFog;', 'uniform sampler2D uFog;\n' + GLSL_NOISE)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float gr = fnoise(vWPos.xz * 3.1) * 0.55 + fnoise(vWPos.xz * 11.0) * 0.3 + fnoise(vWPos.xz * 0.6) * 0.3;
          diffuseColor.rgb *= 0.78 + 0.36 * gr;`);
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.terrain = mesh;
    this.group.add(mesh);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(N, N, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(N / 2, -0.12, N / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...fogUniforms, uSun: { value: new THREE.Vector3(0.5, 0.8, 0.3) }, uDay: { value: 1 } },
      vertexShader: `
        uniform float uWorldSize; varying vec3 vW; varying vec2 vFogUv;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vFogUv = w.xz / uWorldSize; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform sampler2D uFog; uniform float uTime; uniform vec3 uSun; uniform float uDay; varying vec3 vW; varying vec2 vFogUv;
        ${GLSL_NOISE}
        void main() {
          vec2 p = vW.xz;
          float w1 = fnoise(p * 0.9 + vec2(uTime * 0.35, uTime * 0.2));
          float w2 = fnoise(p * 2.3 - vec2(uTime * 0.25, -uTime * 0.4));
          vec3 n = normalize(vec3((w1 - 0.5) * 0.5 + (w2 - 0.5) * 0.3, 1.0, (w2 - 0.5) * 0.5));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 deep = vec3(0.05, 0.22, 0.32), shallow = vec3(0.16, 0.52, 0.58);
          vec3 col = mix(deep, shallow, w1 * 0.6 + 0.2);
          col = mix(col, vec3(0.62, 0.78, 0.92) * uDay, fres * 0.55);
          vec3 h = normalize(normalize(uSun) + v);
          col += vec3(1.0, 0.95, 0.8) * pow(max(dot(n, h), 0.0), 140.0) * 1.6 * uDay;
          col += smoothstep(0.78, 0.95, w2) * 0.12;
          vec2 fv = texture2D(uFog, vFogUv).rg;
          col *= mix(0.07, mix(0.42, 1.0, fv.r), fv.g);
          gl_FragColor = vec4(col, 0.82);
          #include <colorspace_fragment>
        }`,
    });
    this.waterMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  buildTreeMeshes() {
    // Three tree species as instanced trunk + crown pairs; instance colours give each tree its own shade.
    const species = [
      { // pine: stacked cones
        trunk: new THREE.CylinderGeometry(0.1, 0.16, 1.2, 6).translate(0, 0.6, 0),
        crown: mergeCones(), color: 0x2f5a2e,
      },
      { // oak: lumpy round crown
        trunk: new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6).translate(0, 0.7, 0),
        crown: lumpy(new THREE.IcosahedronGeometry(1.05, 1), 0.18, 3).translate(0, 2.0, 0), color: 0x4f8a34,
      },
      { // silverbark: tall, slender, lavender-tinted canopy
        trunk: new THREE.CylinderGeometry(0.08, 0.13, 2.0, 6).translate(0, 1.0, 0),
        crown: lumpy(new THREE.IcosahedronGeometry(0.85, 1), 0.15, 9).scale(0.9, 1.3, 0.9).translate(0, 2.6, 0), color: 0x6a8a5a,
      },
    ];
    const trunkMat = applyFog(new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.9 }), 'tree');
    const crownMat = applyFog(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), 'tree');
    this.treeMeshes = species.map((sp, k) => {
      const list = this.trees.filter((t) => t.type === k);
      const trunks = new THREE.InstancedMesh(sp.trunk, trunkMat, Math.max(1, list.length));
      const crowns = new THREE.InstancedMesh(sp.crown, crownMat, Math.max(1, list.length));
      trunks.castShadow = crowns.castShadow = true;
      crowns.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      const c = new THREE.Color();
      list.forEach((t, i) => {
        t.mesh = k; t.inst = i;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        s.setScalar(t.s);
        p.set(t.x, this.heightAt(t.x, t.z) - 0.05, t.z);
        m.compose(p, q, s);
        trunks.setMatrixAt(i, m);
        crowns.setMatrixAt(i, m);
        c.set(sp.color).offsetHSL(this.r.range(-0.03, 0.03), this.r.range(-0.1, 0.1), this.r.range(-0.07, 0.07));
        crowns.setColorAt(i, c);
      });
      trunks.count = crowns.count = list.length;
      this.group.add(trunks, crowns);
      return { trunks, crowns };
    });
  }

  /** Shake a tree when chopped; fell it (scale to zero) when its wood runs out. */
  chopTree(t, amount) {
    t.wood -= amount;
    t.shake = 0.35;
    if (t.wood <= 0 && t.alive) {
      t.alive = false;
      this.block[t.cz * N + t.cx] &= ~BLOCK.TREE;
      this.treeAt[t.cz * N + t.cx] = -1;
      t.fall = 1;
      this.fallingTrees = this.fallingTrees || [];
      this.fallingTrees.push(t);
    }
    if (!this.shaking) this.shaking = new Set();
    this.shaking.add(t);
  }

  updateTrees(dt) {
    if (!this.shaking?.size) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const tilt = new THREE.Quaternion();
    for (const t of this.shaking) {
      const tm = this.treeMeshes[t.mesh];
      if (t.alive) {
        t.shake = Math.max(0, t.shake - dt);
        tilt.setFromEuler(new THREE.Euler(Math.sin(t.shake * 40) * t.shake * 0.12, 0, 0));
        s.setScalar(t.s);
        if (t.shake <= 0) this.shaking.delete(t);
      } else {
        t.fall = Math.max(0, t.fall - dt * 1.2);
        tilt.setFromEuler(new THREE.Euler((1 - t.fall) * 1.45, 0, 0));
        s.setScalar(t.s * Math.min(1, t.fall * 3));
        if (t.fall <= 0) this.shaking.delete(t);
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot).multiply(tilt);
      p.set(t.x, this.heightAt(t.x, t.z) - 0.05, t.z);
      m.compose(p, q, s);
      tm.trunks.setMatrixAt(t.inst, m);
      tm.crowns.setMatrixAt(t.inst, m);
      tm.trunks.instanceMatrix.needsUpdate = tm.crowns.instanceMatrix.needsUpdate = true;
    }
  }

  nearestTree(x, z, maxR = 30) {
    let best = null, bd = maxR;
    const cx = Math.floor(x), cz = Math.floor(z), R = Math.ceil(maxR);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const i = (cz + dz) * N + cx + dx;
      if (cz + dz < 0 || cz + dz >= N || cx + dx < 0 || cx + dx >= N) continue;
      const ti = this.treeAt[i];
      if (ti < 0) continue;
      const t = this.trees[ti];
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd && this.hasOpenNeighbour(t.cx, t.cz)) { bd = d; best = t; }
    }
    return best;
  }

  hasOpenNeighbour(cx, cz) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.isBlocked(cx + dx, cz + dz)) return true;
    return false;
  }

  buildRocks() {
    // Scattered boulders and grass tufts for detail (decoration only).
    const r = this.r;
    const rockGeo = lumpy(new THREE.IcosahedronGeometry(0.5, 0), 0.25, 4);
    const rockMat = applyFog(new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.95, flatShading: true }), 'rock');
    const tuftGeo = new THREE.ConeGeometry(0.12, 0.45, 4).translate(0, 0.2, 0);
    const tuftMat = applyFog(new THREE.MeshStandardMaterial({ color: 0x6fa040, roughness: 0.9, flatShading: true }), 'tuft');
    const rocks = [], tufts = [];
    for (let i = 0; i < 700; i++) {
      const x = r.range(3, N - 3), z = r.range(3, N - 3);
      const b = this.block[Math.floor(z) * N + Math.floor(x)];
      if (b & (BLOCK.WATER | BLOCK.TREE)) continue;
      if (STARTS.some((s) => Math.hypot(s.x - x, s.z - z) < 12)) continue;
      if (this.heightAt(x, z) < 0.1) continue;
      (r() < 0.25 ? rocks : tufts).push({ x, z, s: r.range(0.5, 1.6), rot: r() * 6.28 });
    }
    const make = (geo, mat, list, shadow) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      list.forEach((o, i) => {
        q.setFromEuler(new THREE.Euler(0, o.rot, 0));
        s.set(o.s, o.s * 0.7, o.s);
        p.set(o.x, this.heightAt(o.x, o.z) - 0.05, o.z);
        im.setMatrixAt(i, m.compose(p, q, s));
      });
      im.count = list.length;
      im.castShadow = shadow; im.receiveShadow = true;
      this.group.add(im);
    };
    make(rockGeo, rockMat, rocks, true);
    make(tuftGeo, tuftMat, tufts, false);
  }
}

/** Road network: each start to its two neighbouring expansions, expansions to the fords, fords to the centre. */
function makeRoads() {
  const F = [{ x: 64, z: 42 }, { x: 64, z: 86 }, { x: 42, z: 64 }, { x: 86, z: 64 }]; // ford mouths N, S, W, E
  const segs = [];
  const link = (a, b) => segs.push([a, b]);
  STARTS.forEach((s) => {
    const near = [...EXPANSIONS].sort((p, q) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(q.x - s.x, q.z - s.z)).slice(0, 2);
    for (const e of near) link(s, e);
  });
  EXPANSIONS.forEach((e, i) => { link(e, F[i]); link(F[i], CENTER); });
  return segs;
}

function flatten(h, x, z, s, r, target) {
  const d = Math.hypot(x - s.x, z - s.z);
  return lerp(h, target, 1 - smooth(clamp((d - r * 0.65) / (r * 0.35), 0, 1)));
}

/** Jitter a geometry's vertices for an organic, hand-sculpted look. */
export function lumpy(geo, amt, seed) {
  const r = rng(seed);
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, 1 + (r() - 0.5) * 2 * amt);
    const f = map.get(k);
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  return geo;
}

function mergeCones() {
  const parts = [[1.0, 1.3, 1.5], [0.8, 1.1, 2.3], [0.55, 0.9, 3.0]];
  const geos = parts.map(([r, h, y]) => new THREE.ConeGeometry(r, h, 7).translate(0, y, 0));
  return mergeGeos(geos);
}

/** Minimal non-indexed geometry merge (position + normal), so the addons module isn't needed here. */
export function mergeGeos(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
