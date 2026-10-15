// Procedural 3D models for every unit, hero, creep, building and resource. No asset files: each
// model is built from shared primitive geometries and cached materials, in a chunky hand-painted
// style. Unit models expose an animate(dt, state) function: walk cycles, attack swings, wing flaps,
// work, cast and death.

import * as THREE from 'three';
import { applyFog } from './fog.js';
import { lumpy, mergeGeos } from './world.js';

// ── shared geometry and materials ─────────────────────────────────────────────────────────────────
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sph: new THREE.SphereGeometry(1, 14, 10),
  sphLo: new THREE.SphereGeometry(1, 8, 6),
  hemi: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 12),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  tor: new THREE.TorusGeometry(1, 0.12, 6, 18),
  torHalf: new THREE.TorusGeometry(1, 0.1, 5, 14, Math.PI),
  cap: new THREE.CapsuleGeometry(0.5, 1, 4, 8),
  ico: new THREE.IcosahedronGeometry(1, 0),
  oct: new THREE.OctahedronGeometry(1, 0),
  prism: prismGeo(),
  wing: wingGeo(),
  rock: lumpy(new THREE.IcosahedronGeometry(1, 1), 0.22, 21),
  leaf: lumpy(new THREE.IcosahedronGeometry(1, 1), 0.2, 33),
  crystal: new THREE.OctahedronGeometry(1, 0).scale(0.45, 1.4, 0.45),
};

function prismGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

function wingGeo() {
  // a membrane wing: fan of triangles along +X, with a slight droop
  const pts = [[0, 0, 0.18], [0, 0, -0.2], [0.55, 0.05, -0.32], [1.05, 0.0, -0.18], [1.3, -0.05, 0.05], [0.7, 0.04, 0.22]];
  const pos = [];
  for (let i = 1; i < pts.length - 1; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const matCache = new Map();
/** Cached fog-aware standard material. */
export function M(color, o = {}) {
  const k = `${color}|${o.r ?? 0.75}|${o.m ?? 0}|${o.e ?? ''}|${o.ei ?? 1}|${o.flat ?? 1}|${o.op ?? 1}|${o.ds ?? 0}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: o.r ?? 0.75, metalness: o.m ?? 0, flatShading: (o.flat ?? 1) === 1,
      emissive: o.e != null ? new THREE.Color(o.e) : new THREE.Color(0), emissiveIntensity: o.ei ?? 1,
      transparent: (o.op ?? 1) < 1, opacity: o.op ?? 1, side: o.ds ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: (o.op ?? 1) >= 1,
    });
    applyFog(m, o.e != null ? 'emi' : 'std');
    matCache.set(k, m);
  }
  return m;
}
const glow = (c, i = 1.6) => M(c, { e: c, ei: i, r: 0.4 });

function add(parent, geo, mat, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  m.scale.set(s[0], s[1], s[2]);
  m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function grp(parent, p = [0, 0, 0], r = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  g.rotation.set(r[0], r[1], r[2]);
  parent?.add(g);
  return g;
}
const tint = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ── weapons and gear ──────────────────────────────────────────────────────────────────────────────
function weapon(kind, hand, look, team) {
  const metal = M(look.metal ?? 0xc8ced8, { r: 0.35, m: 0.7 });
  const wood = M(0x6a4a2a);
  const g = grp(hand);
  switch (kind) {
    case 'sword':
      add(g, G.box, metal, [0, 0, 0.42], [0.06, 0.02, 0.62]);
      add(g, G.box, M(0x8a6a2a, { m: 0.6, r: 0.4 }), [0, 0, 0.1], [0.22, 0.04, 0.05]);
      add(g, G.cyl6, wood, [0, 0, 0.02], [0.03, 0.14, 0.03], [Math.PI / 2, 0, 0]);
      break;
    case 'runeblade':
      add(g, G.box, glow(0x7fd8ff, 1.3), [0, 0, 0.55], [0.09, 0.025, 0.85]);
      add(g, G.box, M(0x30343c, { m: 0.8, r: 0.3 }), [0, 0, 0.1], [0.3, 0.06, 0.07]);
      add(g, G.sph, glow(0x7fd8ff, 2), [0, 0, 0.03], [0.05, 0.05, 0.05]);
      break;
    case 'axe': case 'greataxe': {
      const big = kind === 'greataxe' ? 1.5 : 1;
      add(g, G.cyl6, wood, [0, 0, 0.3 * big], [0.03, 0.75 * big, 0.03], [Math.PI / 2, 0, 0]);
      add(g, G.box, metal, [0.12 * big, 0, 0.6 * big], [0.22 * big, 0.03, 0.28 * big]);
      if (big > 1) add(g, G.box, metal, [-0.12 * big, 0, 0.6 * big], [0.22 * big, 0.03, 0.28 * big]);
      break;
    }
    case 'hammer': case 'warhammer': case 'club': {
      const big = kind === 'warhammer' ? 1.4 : 1;
      add(g, G.cyl6, wood, [0, 0, 0.3 * big], [0.03, 0.7 * big, 0.03], [Math.PI / 2, 0, 0]);
      if (kind === 'club') add(g, G.sphLo, M(0x7a5a3a), [0, 0, 0.62], [0.13, 0.13, 0.22]);
      else add(g, G.box, kind === 'warhammer' ? M(0xe8d090, { m: 0.8, r: 0.3 }) : metal, [0, 0, 0.62 * big], [0.3 * big, 0.16 * big, 0.16 * big]);
      break;
    }
    case 'spear': case 'lance': {
      const L = kind === 'lance' ? 1.8 : 1.3;
      add(g, G.cyl6, wood, [0, 0, L * 0.35], [0.025, L, 0.025], [Math.PI / 2, 0, 0]);
      add(g, G.cone4, metal, [0, 0, L * 0.85 + 0.08], [0.06, 0.22, 0.06], [Math.PI / 2, 0, 0]);
      if (kind === 'lance') { add(g, G.cone, M(team), [0, 0, 0.15], [0.09, 0.3, 0.09], [-Math.PI / 2, 0, 0]); }
      break;
    }
    case 'glaive': {
      const t = add(g, G.torHalf, metal, [0, 0, 0.1], [0.32, 0.32, 0.6], [0, Math.PI / 2, 0]);
      add(g, G.cyl6, M(0x3a2a4a), [0, 0, 0.1], [0.025, 0.4, 0.025], [0, 0, Math.PI / 2]);
      t.castShadow = false;
      break;
    }
    case 'bow':
      add(g, G.torHalf, wood, [0, 0, 0.12], [0.45, 0.45, 0.5], [0, Math.PI / 2, Math.PI / 2]);
      add(g, G.cyl6, M(0xe8e0d0), [0, 0, 0.12], [0.004, 0.9, 0.004], [Math.PI / 2, 0, 0], false);
      break;
    case 'staff': case 'totem':
      add(g, G.cyl6, wood, [0, 0.25, 0], [0.03, 1.3, 0.03]);
      if (kind === 'staff') {
        add(g, G.sph, glow(look.orb ?? (look.cloth === 0x2a2038 ? 0x8aff8a : 0x9fd8ff), 2), [0, 0.95, 0], [0.09, 0.09, 0.09]);
        add(g, G.tor, M(0xc8a040, { m: 0.7, r: 0.3 }), [0, 0.95, 0], [0.1, 0.1, 0.1], [Math.PI / 2, 0, 0]);
      } else {
        add(g, G.sph, M(0xe8e0c8), [0, 0.95, 0], [0.1, 0.11, 0.1]);
        add(g, G.cone, M(0xe8e0c8), [0.1, 1.05, 0], [0.03, 0.15, 0.03], [0, 0, -0.6]);
        add(g, G.cone, M(0xe8e0c8), [-0.1, 1.05, 0], [0.03, 0.15, 0.03], [0, 0, 0.6]);
        add(g, G.box, M(team), [0, 0.7, 0.05], [0.12, 0.2, 0.01]);
      }
      break;
    case 'scythe':
      add(g, G.cyl6, M(0x2a2a30), [0, 0.2, 0], [0.03, 1.5, 0.03]);
      add(g, G.box, M(0xa8b0b8, { m: 0.8, r: 0.3 }), [0, 0.92, 0.25], [0.02, 0.1, 0.5], [0.3, 0, 0]);
      break;
    case 'rifle':
      add(g, G.cyl6, M(0x3a3a3a, { m: 0.8, r: 0.35 }), [0, 0, 0.42], [0.03, 0.7, 0.03], [Math.PI / 2, 0, 0]);
      add(g, G.box, wood, [0, -0.02, 0.08], [0.06, 0.08, 0.38]);
      break;
    case 'pick':
      add(g, G.cyl6, wood, [0, 0, 0.25], [0.025, 0.55, 0.025], [Math.PI / 2, 0, 0]);
      add(g, G.box, metal, [0, 0.0, 0.5], [0.04, 0.32, 0.05], [0, 0, 0]);
      break;
    default: break;
  }
  return g;
}

function helmet(kind, head, look, team, r) {
  const metal = M(look.metal ?? 0xc8ced8, { r: 0.35, m: 0.7 });
  switch (kind) {
    case 'kettle': add(head, G.hemi, metal, [0, 0.02, 0], [r * 1.12, r * 1.05, r * 1.12]); add(head, G.cyl, metal, [0, 0.03, 0], [r * 1.5, 0.02, r * 1.5]); break;
    case 'great': add(head, G.cyl8, metal, [0, 0, 0], [r * 1.08, r * 2.15, r * 1.08]); add(head, G.box, M(0x111111), [0, 0.02, r * 1.02], [r * 1.2, r * 0.12, 0.02]); add(head, G.cone, M(team), [0, r * 1.25, 0], [r * 0.25, r * 0.6, r * 0.25]); break;
    case 'hood': add(head, G.cone, M(look.cloth), [0, r * 0.35, -r * 0.1], [r * 1.25, r * 2.2, r * 1.25]); break;
    case 'horned':
      add(head, G.hemi, metal, [0, 0.02, 0], [r * 1.12, r * 1.05, r * 1.12]);
      add(head, G.cone, M(0xf0e8d0), [r * 1.0, r * 0.6, 0], [r * 0.22, r * 0.9, r * 0.22], [0, 0, -0.9]);
      add(head, G.cone, M(0xf0e8d0), [-r * 1.0, r * 0.6, 0], [r * 0.22, r * 0.9, r * 0.22], [0, 0, 0.9]);
      break;
    case 'winged':
      add(head, G.hemi, metal, [0, 0.02, 0], [r * 1.12, r * 1.05, r * 1.12]);
      add(head, G.wing, M(0xf0f0f0, { ds: 1 }), [r, r * 0.4, 0], [r * 0.9, r * 0.9, r * 0.9], [0, 0, 0.6]);
      add(head, G.wing, M(0xf0f0f0, { ds: 1 }), [-r, r * 0.4, 0], [-r * 0.9, r * 0.9, r * 0.9], [0, 0, -0.6]);
      break;
    case 'band': add(head, G.cyl, M(team), [0, r * 0.25, 0], [r * 1.05, r * 0.3, r * 1.05]); break;
    case 'skull': add(head, G.sph, M(0xe8e0c8), [0, r * 0.7, 0.02], [r * 0.85, r * 0.75, r * 0.95]); add(head, G.cone, M(0xe8e0c8), [r * 0.6, r * 1.1, 0], [r * 0.15, r * 0.6, r * 0.15], [0, 0, -0.5]); add(head, G.cone, M(0xe8e0c8), [-r * 0.6, r * 1.1, 0], [r * 0.15, r * 0.6, r * 0.15], [0, 0, 0.5]); break;
    case 'crest': add(head, G.hemi, metal, [0, 0.02, 0], [r * 1.1, r * 1.0, r * 1.15]); add(head, G.box, M(team), [0, r * 1.0, -r * 0.2], [r * 0.12, r * 0.7, r * 1.5], [0.3, 0, 0]); break;
    case 'antler':
      for (const sx of [1, -1]) {
        add(head, G.cyl6, M(0xb89a6a), [sx * r * 0.6, r * 1.1, 0], [0.025, r * 1.6, 0.025], [0, 0, -sx * 0.5]);
        add(head, G.cyl6, M(0xb89a6a), [sx * r * 1.0, r * 1.6, 0.03], [0.02, r * 0.8, 0.02], [0.5, 0, -sx * 1.1]);
      }
      break;
    case 'wizard': add(head, G.cone, M(look.cloth), [0, r * 1.5, -r * 0.1], [r * 1.0, r * 2.6, r * 1.0], [-0.15, 0, 0]); add(head, G.cyl, M(look.cloth), [0, r * 0.45, 0], [r * 1.6, 0.02, r * 1.6]); break;
    case 'crown':
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; add(head, G.cone4, M(0x9fe6ff, { e: 0x5fb8ff, ei: 0.8, r: 0.2 }), [Math.sin(a) * r * 0.8, r * 1.1, Math.cos(a) * r * 0.8], [r * 0.12, r * 0.7, r * 0.12]); }
      break;
    case 'mining': add(head, G.hemi, M(0x8a6a2a, { m: 0.5 }), [0, 0.02, 0], [r * 1.12, r * 1.0, r * 1.12]); add(head, G.cyl, glow(0xfff0a0, 2.5), [0, r * 0.55, r * 0.95], [r * 0.25, 0.06, r * 0.25], [Math.PI / 2, 0, 0]); break;
    case 'cap': add(head, G.hemi, M(look.cloth), [0, 0.02, 0], [r * 1.08, r * 0.9, r * 1.08]); break;
    case 'wolfpelt': add(head, G.sphLo, M(0x8a8a90), [0, r * 0.6, -r * 0.2], [r * 1.2, r * 0.8, r * 1.4]); add(head, G.cone, M(0x8a8a90), [r * 0.5, r * 1.2, 0], [r * 0.2, r * 0.5, r * 0.2]); add(head, G.cone, M(0x8a8a90), [-r * 0.5, r * 1.2, 0], [r * 0.2, r * 0.5, r * 0.2]); break;
    default: break;
  }
}

// ── humanoid ──────────────────────────────────────────────────────────────────────────────────────
const BODY = {
  human:  { s: 1.0, w: 1.0, leg: 0.52, tor: 0.5, head: 0.16, arm: 0.5 },
  orc:    { s: 1.15, w: 1.35, leg: 0.48, tor: 0.52, head: 0.16, arm: 0.56, hunch: 0.25 },
  elf:    { s: 1.1, w: 0.88, leg: 0.6, tor: 0.5, head: 0.145, arm: 0.52 },
  undead: { s: 1.0, w: 0.82, leg: 0.52, tor: 0.48, head: 0.15, arm: 0.5, bony: true },
  dwarf:  { s: 0.82, w: 1.45, leg: 0.36, tor: 0.52, head: 0.17, arm: 0.44 },
  kobold: { s: 0.7, w: 1.0, leg: 0.4, tor: 0.42, head: 0.17, arm: 0.42 },
  ogre:   { s: 1.6, w: 1.6, leg: 0.5, tor: 0.6, head: 0.17, arm: 0.6, hunch: 0.3 },
};

function humanoid(root, look, team) {
  const B = BODY[look.body] ?? BODY.human;
  const S = B.s * (look.hero ? 1.22 : 1);
  const P = { root, look, kind: 'humanoid' };
  const skin = M(look.skin ?? 0xe8b894, { r: 0.7 });
  const cloth = M(look.cloth ?? 0x7a5a3a);
  const metal = M(look.metal ?? 0xc8ced8, { r: 0.35, m: 0.7 });
  const teamM = M(team);
  const bone = M(look.skin ?? 0xd8d4c0);
  const body = grp(root, [0, 0, 0]);
  body.scale.setScalar(S);
  P.body = body;
  const hip = B.leg;
  const W = 0.21 * B.w;
  // legs
  const legMat = B.bony ? bone : M(look.robe ? look.cloth : tint(look.cloth ?? 0x7a5a3a, 0x222222, 0.35));
  P.legs = [-1, 1].map((sx) => {
    const L = grp(body, [sx * W * 0.5, hip, 0]);
    add(L, G.cap, legMat, [0, -B.leg * 0.5, 0], [B.bony ? 0.1 : 0.17, B.leg * 0.62, B.bony ? 0.1 : 0.17]);
    add(L, G.box, M(0x3a2a1a), [0, -B.leg + 0.04, 0.04], [0.13, 0.08, 0.2]);
    return L;
  });
  // torso
  const torso = grp(body, [0, hip, 0], [B.hunch ?? 0, 0, 0]);
  P.torso = torso;
  if (B.bony) {
    add(torso, G.cyl6, bone, [0, B.tor * 0.5, 0], [0.035, B.tor, 0.035]);
    for (let i = 0; i < 4; i++) add(torso, G.tor, bone, [0, B.tor * (0.45 + i * 0.12), 0.02], [W * 0.75 - i * 0.012, W * 0.55, 0.25], [Math.PI / 2, 0, 0]);
    add(torso, G.box, cloth, [0, 0.06, 0], [W * 1.6, 0.14, 0.24]);
  } else {
    add(torso, G.cyl8, look.robe ? cloth : metal, [0, B.tor * 0.5, 0], [W, B.tor, W * 0.62]);
    add(torso, G.box, teamM, [0, B.tor * 0.45, W * 0.55], [W * 1.1, B.tor * 0.75, 0.03]); // tabard
    add(torso, G.box, M(0x4a3420), [0, 0.04, 0], [W * 2.05, 0.07, W * 1.3]); // belt
    if (look.robe) add(torso, G.cone, cloth, [0, -0.2, 0], [W * 1.45, 0.62, W * 1.1]);
  }
  if (look.shoulders || look.hero) {
    for (const sx of [-1, 1]) add(torso, G.hemi, look.shoulders ? metal : teamM, [sx * W * 1.15, B.tor * 0.95, 0], [0.12 * B.w, 0.1, 0.13]);
  }
  // head
  const head = grp(torso, [0, B.tor + B.head * 0.95, 0.02]);
  P.head = head;
  const hr = B.head;
  if (look.body === 'kobold') {
    add(head, G.sph, skin, [0, 0, 0], [hr, hr * 0.9, hr]);
    add(head, G.cone, skin, [0, -0.02, hr * 1.1], [hr * 0.55, hr * 1.4, hr * 0.55], [Math.PI / 2, 0, 0]);
    add(head, G.cyl, M(0xf8f0d0), [0, hr * 1.2, 0], [0.03, 0.12, 0.03]);
    add(head, G.sph, glow(0xffc040, 3), [0, hr * 1.2 + 0.09, 0], [0.025, 0.04, 0.025]);
  } else {
    add(head, G.sph, B.bony ? bone : skin, [0, 0, 0], [hr, hr * 1.08, hr]);
    // eyes
    const eyeM = B.bony || look.body === 'undead' ? glow(0x8aff6a, 3) : look.body === 'elf' ? glow(0xd8f0ff, 2) : M(0x1a1a1a);
    for (const sx of [-1, 1]) add(head, G.sphLo, eyeM, [sx * hr * 0.38, hr * 0.12, hr * 0.88], [hr * 0.16, hr * 0.16, hr * 0.1], [0, 0, 0], false);
    if (look.body === 'orc') {
      add(head, G.box, skin, [0, -hr * 0.5, hr * 0.35], [hr * 1.5, hr * 0.6, hr * 1.1]);
      for (const sx of [-1, 1]) add(head, G.cone, M(0xf0ead8), [sx * hr * 0.45, -hr * 0.35, hr * 0.85], [0.025, 0.1, 0.025]);
    }
    if (look.body === 'elf') for (const sx of [-1, 1]) add(head, G.cone, skin, [sx * hr * 1.2, hr * 0.3, -hr * 0.1], [0.04, hr * 2.2, 0.04], [0, 0, -sx * 1.15]);
    if (look.body === 'dwarf') {
      add(head, G.cone, M(look.hair ?? 0xb8582a), [0, -hr * 0.85, hr * 0.5], [hr * 1.0, hr * 2.2, hr * 0.7], [Math.PI, 0, 0]);
      add(head, G.box, M(look.hair ?? 0xb8582a), [0, -hr * 0.05, hr * 0.92], [hr * 1.1, hr * 0.15, hr * 0.15]);
    }
    if (look.body === 'ogre') { add(head, G.cone, M(0xd8d0b8), [0, hr * 1.1, 0.04], [0.04, 0.16, 0.04]); add(head, G.box, skin, [0, -hr * 0.55, hr * 0.4], [hr * 1.5, hr * 0.5, hr * 0.9]); }
    if ((look.helm ?? 'none') === 'none' && !B.bony && look.hair) add(head, G.hemi, M(look.hair), [0, hr * 0.1, -hr * 0.08], [hr * 1.06, hr * 1.0, hr * 1.06]);
  }
  helmet(look.helm ?? 'none', head, look, team, hr);
  // arms
  const armM = B.bony ? bone : look.robe ? cloth : skin;
  P.arms = [-1, 1].map((sx) => {
    const A = grp(torso, [sx * (W * 1.22), B.tor * 0.88, 0]);
    add(A, G.cap, armM, [0, -B.arm * 0.45, 0], [B.bony ? 0.08 : 0.13 * Math.min(1.3, B.w), B.arm * 0.6, B.bony ? 0.08 : 0.13 * Math.min(1.3, B.w)]);
    add(A, G.sphLo, B.bony ? bone : skin, [0, -B.arm * 0.95, 0], [0.065, 0.065, 0.065]);
    A.userData.hand = grp(A, [0, -B.arm * 0.95, 0]);
    return A;
  });
  // weapon (right hand) and off-hand gear (left)
  const wk = look.weapon;
  if (wk === 'bow') P.weapon = weapon('bow', P.arms[0].userData.hand, look, team);
  else if (wk) P.weapon = weapon(wk, P.arms[1].userData.hand, look, team);
  if (look.shield) {
    const sh = grp(P.arms[0].userData.hand, [-0.06, 0.05, 0.05]);
    if (look.shield === 'kite') { add(sh, G.box, teamM, [0, 0, 0], [0.04, 0.42, 0.3]); add(sh, G.box, M(0xf0d070, { m: 0.6 }), [-0.025, 0.04, 0], [0.01, 0.08, 0.2]); add(sh, G.box, M(0xf0d070, { m: 0.6 }), [-0.025, 0.04, 0], [0.01, 0.22, 0.06]); }
    else { add(sh, G.cyl, metal, [0, 0, 0], [0.22, 0.04, 0.22], [0, 0, Math.PI / 2]); add(sh, G.cyl, teamM, [-0.02, 0, 0], [0.16, 0.03, 0.16], [0, 0, Math.PI / 2]); }
  }
  if (look.cape) {
    const cape = grp(torso, [0, B.tor * 0.95, -W * 0.62]);
    add(cape, G.box, teamM, [0, -0.38, 0], [W * 2.1, 0.78, 0.025]);
    P.cape = cape;
  }
  P.handY = hip + B.tor;
  P.height = (hip + B.tor + hr * 2.2) * S;
  return P;
}

// ── quadrupeds (mounts and beasts) ────────────────────────────────────────────────────────────────
const BEAST = {
  horse:     { len: 1.0, h: 0.75, w: 0.32, color: 0x7a5434, neck: 0.5, head: 0.32, caparison: true },
  wolf:      { len: 0.85, h: 0.6, w: 0.3, color: 0x6a6a72, neck: 0.25, head: 0.3, snout: true, tail: true },
  stag:      { len: 0.95, h: 0.8, w: 0.27, color: 0x9a7a52, neck: 0.5, head: 0.26, antler: true },
  ram:       { len: 0.8, h: 0.6, w: 0.34, color: 0xd8ccb0, neck: 0.25, head: 0.28, horns: true },
  bonehorse: { len: 1.0, h: 0.78, w: 0.26, color: 0xd8d4c0, neck: 0.5, head: 0.32, bony: true },
};

function quadruped(root, kind, team, ghost) {
  const B = BEAST[kind];
  const P = { kind: 'quad' };
  const col = ghost ?? B.color;
  const hide = ghost ? M(col, { op: 0.65, e: col, ei: 0.4 }) : M(col);
  const g = grp(root, [0, 0, 0]);
  P.beast = g;
  const y = B.h;
  if (B.bony) {
    add(g, G.cyl6, hide, [0, y + 0.05, 0], [0.05, B.len * 1.1, 0.05], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) add(g, G.tor, hide, [0, y, -0.25 + i * 0.16], [B.w, B.w * 0.9, 0.3]);
  } else {
    add(g, G.sph, hide, [0, y, 0], [B.w, B.w * 0.95, B.len * 0.62]);
  }
  if (B.caparison) {
    add(g, G.box, M(team), [0, y - 0.05, 0], [B.w * 2.15, B.w * 1.3, B.len * 0.9]);
    add(g, G.box, M(0xe8d070, { m: 0.6 }), [0, y - 0.38, 0], [B.w * 2.18, 0.04, B.len * 0.92]);
  }
  // neck + head
  const neck = grp(g, [0, y + 0.1, B.len * 0.45], [-0.7, 0, 0]);
  add(neck, G.cap, hide, [0, B.neck * 0.45, 0], [B.w * 0.75, B.neck * 0.6 + 0.05, B.w * 0.75]);
  const head = grp(neck, [0, B.neck * 0.9, 0], [0.9, 0, 0]);
  P.head = head;
  add(head, G.box, hide, [0, 0, B.head * 0.5], [B.w * 0.8, B.w * 0.8, B.head * (B.snout ? 1.4 : 1.6)]);
  const eye = B.bony || ghost ? glow(ghost ?? 0x8aff6a, 3) : M(0x111111);
  for (const sx of [-1, 1]) add(head, G.sphLo, eye, [sx * B.w * 0.4, B.w * 0.15, B.head * 0.4], [0.035, 0.035, 0.035], [0, 0, 0], false);
  for (const sx of [-1, 1]) add(head, G.cone, hide, [sx * B.w * 0.28, B.w * 0.5, 0], [0.04, 0.14, 0.04]);
  if (B.antler) for (const sx of [-1, 1]) {
    add(head, G.cyl6, M(0xd8c8a0), [sx * 0.1, 0.25, -0.02], [0.02, 0.4, 0.02], [0, 0, -sx * 0.4]);
    add(head, G.cyl6, M(0xd8c8a0), [sx * 0.22, 0.4, 0.04], [0.016, 0.25, 0.016], [0.4, 0, -sx * 1.1]);
  }
  if (B.horns) for (const sx of [-1, 1]) add(head, G.tor, M(0x8a7a5a), [sx * 0.14, 0.06, 0.02], [0.1, 0.1, 0.25], [0, Math.PI / 2, 0]);
  if (B.tail) add(g, G.cone, hide, [0, y + 0.1, -B.len * 0.65], [0.07, 0.4, 0.07], [-2.2, 0, 0]);
  else if (!B.bony && kind !== 'ram') add(g, G.cone, M(0x2a1a10), [0, y, -B.len * 0.62], [0.06, 0.45, 0.06], [-2.6, 0, 0]);
  P.legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
    const L = grp(g, [sx * B.w * 0.6, y - 0.05, sz * B.len * 0.4]);
    add(L, G.cap, hide, [0, -y * 0.5, 0], [B.bony ? 0.05 : 0.09, y * 0.62, B.bony ? 0.05 : 0.09]);
    add(L, G.box, M(0x2a2018), [0, -y + 0.04, 0.02], [0.1, 0.07, 0.12]);
    return L;
  });
  P.seat = y + B.w * 0.8;
  return P;
}

// ── other bodies ──────────────────────────────────────────────────────────────────────────────────
function wisp(root) {
  const g = grp(root, [0, 0.8, 0]);
  add(g, G.sph, glow(0xbfe8ff, 2.6), [0, 0, 0], [0.18, 0.18, 0.18], [0, 0, 0], false);
  add(g, G.sph, M(0xbfe8ff, { op: 0.3, e: 0x9fd0ff, ei: 1 }), [0, 0, 0], [0.32, 0.32, 0.32], [0, 0, 0], false);
  const orbit = grp(g);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; add(orbit, G.sphLo, glow(0xe8f8ff, 3), [Math.sin(a) * 0.32, Math.cos(a * 2) * 0.1, Math.cos(a) * 0.32], [0.04, 0.04, 0.04], [0, 0, 0], false); }
  return { kind: 'wisp', body: g, orbit, height: 1.2 };
}

function treant(root, small) {
  const s = small ? 0.75 : 1.5;
  const g = grp(root);
  g.scale.setScalar(s);
  const bark = M(0x5a4030), leaf = M(0x4f8a3a);
  const P = { kind: 'treant', body: g };
  P.legs = [-1, 1].map((sx) => { const L = grp(g, [sx * 0.18, 0.55, 0]); add(L, G.cyl6, bark, [0, -0.28, 0], [0.11, 0.6, 0.11]); add(L, G.cone6, bark, [0, -0.52, 0.06], [0.16, 0.12, 0.2], [Math.PI / 2, 0, 0]); return L; });
  const torso = grp(g, [0, 0.55, 0]);
  P.torso = torso;
  add(torso, G.cyl6, bark, [0, 0.45, 0], [0.25, 0.95, 0.22]);
  add(torso, G.leaf, leaf, [0, 1.1, -0.05], [0.5, 0.42, 0.45]);
  add(torso, G.leaf, M(0x6aa040), [0.25, 1.25, 0.05], [0.28, 0.25, 0.28]);
  for (const sx of [-1, 1]) add(torso, G.sphLo, glow(0xd8ff8a, 2.2), [sx * 0.08, 0.72, 0.21], [0.035, 0.03, 0.02], [0, 0, 0], false);
  P.arms = [-1, 1].map((sx) => {
    const A = grp(torso, [sx * 0.3, 0.75, 0]);
    add(A, G.cyl6, bark, [0, -0.32, 0], [0.07, 0.68, 0.07], [0, 0, sx * 0.15]);
    add(A, G.leaf, leaf, [sx * 0.05, -0.68, 0.02], [0.12, 0.1, 0.12]);
    A.userData.hand = grp(A, [0, -0.65, 0]);
    return A;
  });
  P.height = 2 * s;
  return P;
}

function golem(root, type) {
  const bone = type === 'bone';
  const mat = bone ? M(0xe0dac8) : M(0x8a8478, { m: 0.6, r: 0.4 });
  const accent = bone ? glow(0x8aff6a, 2.4) : glow(0xff8a30, 2.4);
  const g = grp(root);
  g.scale.setScalar(1.35);
  const P = { kind: 'humanoid', body: g };
  P.legs = [-1, 1].map((sx) => { const L = grp(g, [sx * 0.22, 0.5, 0]); add(L, bone ? G.cap : G.box, mat, [0, -0.25, 0], bone ? [0.16, 0.36, 0.16] : [0.22, 0.5, 0.24]); return L; });
  const torso = grp(g, [0, 0.5, 0], [0.25, 0, 0]);
  P.torso = torso;
  if (bone) {
    for (let i = 0; i < 5; i++) add(torso, G.tor, mat, [0, 0.15 + i * 0.13, 0], [0.32 - Math.abs(i - 2) * 0.03, 0.26, 0.4], [Math.PI / 2, 0, 0]);
    add(torso, G.cyl6, mat, [0, 0.4, -0.08], [0.06, 0.8, 0.06]);
    add(torso, G.sph, accent, [0, 0.45, 0], [0.12, 0.12, 0.12], [0, 0, 0], false);
  } else {
    add(torso, G.box, mat, [0, 0.4, 0], [0.7, 0.75, 0.45]);
    add(torso, G.box, accent, [0, 0.42, 0.23], [0.2, 0.22, 0.02], [0, 0, 0], false);
    for (const sx of [-1, 1]) add(torso, G.cyl6, M(0x5a5048, { m: 0.7 }), [sx * 0.2, 0.9, -0.1], [0.06, 0.3, 0.06]);
  }
  const head = grp(torso, [0, 0.9, 0.1]);
  P.head = head;
  add(head, bone ? G.sph : G.box, mat, [0, 0, 0], bone ? [0.15, 0.17, 0.17] : [0.25, 0.22, 0.25]);
  for (const sx of [-1, 1]) add(head, G.sphLo, accent, [sx * 0.06, 0.02, 0.13], [0.03, 0.03, 0.02], [0, 0, 0], false);
  P.arms = [-1, 1].map((sx) => {
    const A = grp(torso, [sx * 0.45, 0.7, 0]);
    add(A, bone ? G.cap : G.box, mat, [0, -0.35, 0], bone ? [0.14, 0.5, 0.14] : [0.2, 0.7, 0.2]);
    add(A, bone ? G.sph : G.box, mat, [0, -0.75, 0.02], bone ? [0.11, 0.11, 0.11] : [0.26, 0.22, 0.26]);
    A.userData.hand = grp(A, [0, -0.75, 0]);
    return A;
  });
  P.height = 2.4;
  return P;
}

function spider(root) {
  const g = grp(root);
  const c = M(0x3a2a2a), m = M(0x5a2a3a);
  add(g, G.sph, c, [0, 0.45, -0.3], [0.38, 0.32, 0.45]);
  add(g, G.box, M(0xc84030), [0, 0.7, -0.35], [0.2, 0.02, 0.25], [0, 0.785, 0], false);
  add(g, G.sph, m, [0, 0.4, 0.15], [0.2, 0.17, 0.22]);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) add(g, G.sphLo, glow(0xff4030, 2), [sx * (0.04 + i * 0.02), 0.48 + (i % 2) * 0.03, 0.35], [0.02, 0.02, 0.02], [0, 0, 0], false);
  const legs = [];
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const L = grp(g, [sx * 0.15, 0.42, 0.18 - i * 0.12], [0, sx * (0.6 - i * 0.35), 0]);
    add(L, G.cyl6, c, [sx * 0.25, 0.08, 0], [0.025, 0.55, 0.025], [0, 0, sx * 1.1]);
    add(L, G.cyl6, c, [sx * 0.55, -0.15, 0], [0.02, 0.6, 0.02], [0, 0, -sx * 0.5]);
    legs.push(L);
  }
  return { kind: 'spider', body: g, spiderLegs: legs, height: 0.9 };
}

function elemental(root, color) {
  const g = grp(root, [0, 0, 0]);
  const m = M(color, { op: 0.7, e: color, ei: 0.5, r: 0.1 });
  add(g, G.cone, m, [0, 0.45, 0], [0.32, 0.9, 0.32], [Math.PI, 0, 0], false);
  add(g, G.sph, m, [0, 1.05, 0], [0.35, 0.38, 0.35], [0, 0, 0], false);
  add(g, G.sph, m, [0, 1.5, 0.05], [0.2, 0.2, 0.2], [0, 0, 0], false);
  for (const sx of [-1, 1]) add(g, G.sphLo, glow(0xffffff, 3), [sx * 0.07, 1.53, 0.18], [0.03, 0.03, 0.02], [0, 0, 0], false);
  const arms = [-1, 1].map((sx) => { const A = grp(g, [sx * 0.35, 1.15, 0]); add(A, G.sph, m, [sx * 0.08, -0.25, 0], [0.12, 0.3, 0.12], [0, 0, 0], false); A.userData.hand = grp(A, [0, -0.5, 0]); return A; });
  return { kind: 'float', body: g, arms, height: 1.8 };
}

function wyrm(root) {
  const g = grp(root);
  g.scale.setScalar(1.6);
  const scale = M(0x5a3a9a, { r: 0.5, m: 0.2 }), belly = M(0x9a8ad8), crys = M(0x9ff0ff, { e: 0x5fd8ff, ei: 1.6, r: 0.2 });
  const P = { kind: 'quad', body: g };
  add(g, G.sph, scale, [0, 0.9, 0], [0.55, 0.5, 0.95]);
  add(g, G.sph, belly, [0, 0.72, 0.05], [0.45, 0.35, 0.8]);
  for (let i = 0; i < 6; i++) add(g, G.crystal, crys, [0, 1.35 - Math.abs(i - 2) * 0.04, 0.55 - i * 0.25], [0.18, 0.2, 0.18], [0, 0, 0], false);
  const neck = grp(g, [0, 1.05, 0.8], [-0.6, 0, 0]);
  add(neck, G.cap, scale, [0, 0.4, 0], [0.26, 0.7, 0.26]);
  const head = grp(neck, [0, 0.85, 0.05], [0.9, 0, 0]);
  P.head = head;
  add(head, G.box, scale, [0, 0, 0.25], [0.35, 0.28, 0.65]);
  add(head, G.box, belly, [0, -0.12, 0.28], [0.3, 0.06, 0.6]);
  for (const sx of [-1, 1]) {
    add(head, G.sphLo, glow(0x9ff0ff, 3), [sx * 0.15, 0.08, 0.3], [0.04, 0.04, 0.05], [0, 0, 0], false);
    add(head, G.cone, crys, [sx * 0.12, 0.22, -0.05], [0.05, 0.4, 0.05], [-0.8, 0, -sx * 0.3]);
  }
  add(g, G.cone, scale, [0, 0.85, -1.3], [0.22, 1.2, 0.22], [-1.75, 0, 0]);
  P.wings = [-1, 1].map((sx) => { const W = grp(g, [sx * 0.35, 1.25, 0.2]); add(W, G.wing, M(0x7a5ab8, { ds: 1 }), [0, 0, 0], [sx * 1.6, 1.6, 1.6], [0, 0, 0]); return W; });
  P.legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => { const L = grp(g, [sx * 0.4, 0.75, sz * 0.5]); add(L, G.cap, scale, [0, -0.35, 0], [0.14, 0.5, 0.14]); return L; });
  P.height = 3;
  return P;
}

function machine(root, kind, team) {
  const wood = M(0x7a5434), dark = M(0x4a3420), metal = M(0x8a8a90, { m: 0.7, r: 0.35 });
  const aether = M(0x7ff0ff, { e: 0x3fd8ff, ei: 2, r: 0.1, op: 0.85 });
  const g = grp(root);
  const P = { kind: 'machine', body: g, wheels: [] };
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = grp(g, [sx * 0.55, 0.3, sz * 0.5]);
    add(w, G.cyl, dark, [0, 0, 0], [0.3, 0.1, 0.3], [0, 0, Math.PI / 2]);
    add(w, G.cyl, metal, [sx * 0.05, 0, 0], [0.31, 0.04, 0.31], [0, 0, Math.PI / 2]);
    P.wheels.push(w);
  }
  add(g, G.box, wood, [0, 0.45, 0], [1.0, 0.18, 1.4]);
  add(g, G.box, M(team), [0, 0.56, -0.55], [0.9, 0.06, 0.25]);
  // aether canister: every siege engine burns aether, so it glows
  const can = grp(g, [0, 0.75, -0.45]);
  add(can, G.cyl, aether, [0, 0, 0], [0.16, 0.38, 0.16], [0, 0, 0], false);
  add(can, G.cyl, metal, [0, 0.2, 0], [0.18, 0.05, 0.18]);
  add(can, G.cyl, metal, [0, -0.2, 0], [0.18, 0.05, 0.18]);
  P.glow = can;
  if (kind === 'ballista') {
    const arm = grp(g, [0, 0.75, 0.15]);
    add(arm, G.box, wood, [0, 0, 0.2], [0.12, 0.12, 1.2]);
    add(arm, G.torHalf, wood, [0, 0, 0.6], [0.6, 0.35, 0.5], [Math.PI / 2, 0, 0]);
    add(arm, G.cyl6, aether, [0, 0.09, 0.3], [0.03, 1.0, 0.03], [Math.PI / 2, 0, 0], false);
    P.arm = arm;
  } else if (kind === 'catapult') {
    add(g, G.box, wood, [-0.4, 0.85, 0], [0.1, 0.7, 0.1]);
    add(g, G.box, wood, [0.4, 0.85, 0], [0.1, 0.7, 0.1]);
    add(g, G.cyl, wood, [0, 1.1, 0], [0.06, 0.9, 0.06], [0, 0, Math.PI / 2]);
    const arm = grp(g, [0, 1.1, 0], [-0.9, 0, 0]);
    add(arm, G.box, wood, [0, 0, 0.45], [0.1, 0.1, 1.0]);
    add(arm, G.hemi, M(0xe8e0c8), [0, 0.05, 0.95], [0.2, 0.15, 0.2], [Math.PI, 0, 0]);
    add(arm, G.sph, aether, [0, 0.12, 0.95], [0.12, 0.12, 0.12], [0, 0, 0], false);
    for (const sx of [-1, 1]) add(g, G.cone, M(0xf0e8d0), [sx * 0.5, 0.6, 0.72], [0.05, 0.3, 0.05], [Math.PI / 2, 0, 0]);
    P.arm = arm;
  } else {
    const arm = grp(g, [0, 0.85, 0.05]);
    add(arm, G.cyl, metal, [0, 0, 0.35], [0.17, 1.1, 0.17], [Math.PI / 2, 0, 0]);
    add(arm, G.tor, M(0xb08850, { m: 0.7, r: 0.3 }), [0, 0, 0.88], [0.18, 0.18, 0.5]);
    add(arm, G.tor, aether, [0, 0, 0.5], [0.18, 0.18, 0.4], [0, 0, 0], false);
    add(g, G.cyl, M(0x5a5048, { m: 0.6 }), [0.32, 1.05, -0.45], [0.06, 0.5, 0.06]);
    P.arm = arm;
    P.smoke = true;
  }
  P.height = 1.4;
  return P;
}

function flyerModel(root, look, team) {
  const kind = look.flyer;
  const P = { kind: 'flyer', body: grp(root) };
  const g = P.body;
  if (kind === 'gyro') {
    const metal = M(0xb08850, { m: 0.7, r: 0.35 });
    add(g, G.sph, metal, [0, 0, 0], [0.38, 0.32, 0.55]);
    add(g, G.sph, M(0x9fd8ff, { op: 0.45, r: 0.05 }), [0, 0.12, 0.25], [0.26, 0.2, 0.25], [0, 0, 0], false);
    add(g, G.cyl, M(0x7ff0ff, { e: 0x3fd8ff, ei: 2, op: 0.85 }), [0, 0.1, -0.5], [0.12, 0.35, 0.12], [Math.PI / 2, 0, 0], false);
    add(g, G.box, M(team), [0, -0.05, -0.75], [0.04, 0.3, 0.3]);
    add(g, G.cyl6, metal, [0, 0.45, 0], [0.04, 0.3, 0.04]);
    const rotor = grp(g, [0, 0.62, 0]);
    add(rotor, G.box, M(0x5a4a3a), [0, 0, 0], [1.9, 0.02, 0.1]);
    add(rotor, G.box, M(0x5a4a3a), [0, 0, 0], [0.1, 0.02, 1.9]);
    P.rotor = rotor;
    const pilot = grp(g, [0, 0.12, 0.1]);
    add(pilot, G.sph, M(0xe0a882), [0, 0.1, 0], [0.1, 0.11, 0.1]);
    add(pilot, G.hemi, M(0x8a6a2a), [0, 0.13, 0], [0.11, 0.08, 0.11]);
    P.height = 1;
    return P;
  }
  const C = {
    griffin: { body: 0xc8a060, head: 0xf0f0e8, wing: 0xe8dcc0, beak: 0xf0c040 },
    wyvern: { body: 0x7a5a3a, head: 0x8a6a42, wing: 0xa04a3a, beak: 0xe8e0c8 },
    hawk: { body: 0x4a4a6a, head: 0x6a6a8a, wing: 0x8a8ac8, beak: 0xe8d090 },
    gargoyle: { body: 0x6a6a72, head: 0x7a7a82, wing: 0x5a5a62, beak: 0x9a9aa0 },
  }[kind];
  const bodyM = M(C.body);
  add(g, G.sph, bodyM, [0, 0, 0], [0.3, 0.3, 0.62]);
  const head = grp(g, [0, 0.22, 0.55]);
  P.head = head;
  add(head, G.sph, M(C.head), [0, 0, 0], [0.2, 0.2, 0.22]);
  add(head, G.cone, M(C.beak), [0, -0.03, 0.24], [0.07, 0.22, 0.07], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) add(head, G.sphLo, kind === 'gargoyle' ? glow(0xff4030, 3) : M(0x111111), [sx * 0.1, 0.06, 0.15], [0.03, 0.03, 0.03], [0, 0, 0], false);
  if (kind === 'gargoyle') for (const sx of [-1, 1]) add(head, G.cone, M(0x4a4a50), [sx * 0.1, 0.22, -0.02], [0.04, 0.2, 0.04], [-0.4, 0, -sx * 0.3]);
  add(g, G.cone, bodyM, [0, 0, -0.7], [0.12, 0.6, 0.12], [-Math.PI / 2, 0, 0]);
  P.wings = [-1, 1].map((sx) => { const W = grp(g, [sx * 0.2, 0.15, 0.05]); add(W, G.wing, M(C.wing, { ds: 1 }), [0, 0, 0], [sx * 1.5, 1.5, 1.5]); return W; });
  for (const sx of [-1, 1]) add(g, G.cap, bodyM, [sx * 0.16, -0.3, 0.2], [0.06, 0.25, 0.06], [0.6, 0, 0]);
  if (look.rider !== false) {
    const seat = grp(g, [0, 0.12, -0.05]);
    const rider = humanoid(seat, { ...look, flyer: undefined }, team);
    rider.body.scale.multiplyScalar(0.8);
    for (const L of rider.legs) L.rotation.set(-1.3, 0, 0);
    rider.body.position.y = -0.25;
    P.rider = rider;
  }
  P.height = 1.2;
  return P;
}

// ── unit model factory ────────────────────────────────────────────────────────────────────────────
/**
 * Build a unit model. Returns { root, animate(dt, st), height, muzzle() }.
 * st: { moving, attack (0..1 phase or -1), work, cast, dead (0..1) }
 */
export function makeUnitModel(def, teamHex) {
  const team = typeof teamHex === 'string' ? new THREE.Color(teamHex).getHex() : teamHex;
  const look = def.look;
  const root = new THREE.Group();
  const inner = grp(root);
  let P;
  if (look.machine) P = machine(inner, look.machine, team);
  else if (look.flyer) P = flyerModel(inner, look, team);
  else if (look.body === 'wisp') P = wisp(inner);
  else if (look.body === 'treant') P = treant(inner, look.small);
  else if (look.body === 'golem') P = golem(inner, look.golem);
  else if (look.body === 'spider') P = spider(inner);
  else if (look.body === 'wolf') { P = quadruped(inner, 'wolf', team, look.ghost); P.body = P.beast; P.height = 1; }
  else if (look.body === 'wyrm') P = wyrm(inner);
  else if (look.body === 'elemental') P = elemental(inner, look.color);
  else if (look.mount || look.centaur) {
    const mount = quadruped(inner, look.centaur ? 'stag' : look.mount, team);
    const seat = grp(mount.beast, [0, mount.seat - 0.05, look.centaur ? 0.35 : 0]);
    const rider = humanoid(seat, look, team);
    if (look.centaur) { for (const L of rider.legs) L.visible = false; rider.body.position.y = -0.5; }
    else { rider.legs[0].rotation.set(-1.2, 0, 0.35); rider.legs[1].rotation.set(-1.2, 0, -0.35); rider.body.position.y = -0.48; }
    P = { kind: 'mounted', mount, rider, body: mount.beast, legs: mount.legs, arms: rider.arms, head: rider.head, cape: rider.cape, height: mount.seat + rider.height - 0.4 };
    if (look.hero) inner.scale.setScalar(1.1);
  } else P = humanoid(inner, look, team);

  // RTS scale: units are drawn larger than life so they read at battlefield distance
  const SC = 1.3;
  inner.scale.multiplyScalar(SC);
  P.height = (P.height ?? 1.6) * SC;
  if (def.hero) {
    // heroes get a floating faction sigil
    const sig = grp(root, [0, P.height + 0.45, 0]);
    add(sig, G.oct, glow(0xffd860, 1.8), [0, 0, 0], [0.12, 0.18, 0.12], [0, 0, 0], false);
    P.sigil = sig;
  }

  let t = Math.random() * 10;
  const arms = P.arms ?? P.rider?.arms;
  const legs = P.legs;
  const flyBase = 0;
  const animate = (dt, st) => {
    t += dt;
    if (st.dead > 0) {
      const k = Math.min(1, st.dead * 2.2);
      inner.rotation.x = -k * Math.PI / 2 * (P.kind === 'flyer' ? 0 : 1);
      inner.position.y = (P.kind === 'flyer' ? -k * 2.5 : 0) - Math.max(0, st.dead - 0.6) * 1.2;
      if (P.kind === 'flyer') inner.rotation.z = k * 1.2;
      return;
    }
    inner.rotation.set(0, 0, 0);
    inner.position.y = 0;
    const walk = st.moving ? t * (P.kind === 'quad' || P.kind === 'mounted' ? 9 : 8) * (st.speedMul ?? 1) : 0;
    const sw = st.moving ? Math.sin(walk) : 0;
    if (P.sigil) { P.sigil.rotation.y += dt * 2; P.sigil.position.y = (P.height ?? 1.6) + 0.45 + Math.sin(t * 2) * 0.06; }
    switch (P.kind) {
      case 'humanoid': case 'treant': {
        legs[0].rotation.x = sw * 0.65; legs[1].rotation.x = -sw * 0.65;
        if (P.body) P.body.position.y = st.moving ? Math.abs(Math.cos(walk)) * 0.04 : Math.sin(t * 2) * 0.008;
        break;
      }
      case 'quad': case 'mounted': {
        const L = legs;
        L[0].rotation.x = sw * 0.7; L[3].rotation.x = sw * 0.7; L[1].rotation.x = -sw * 0.7; L[2].rotation.x = -sw * 0.7;
        if (P.body) P.body.position.y = st.moving ? Math.abs(Math.cos(walk)) * 0.06 : 0;
        if (P.wings) for (const [i, W] of P.wings.entries()) W.rotation.z = (i ? 1 : -1) * (0.3 + Math.sin(t * 1.5) * 0.12);
        break;
      }
      case 'flyer': {
        const f = Math.sin(t * (st.moving ? 9 : 6));
        if (P.wings) { P.wings[0].rotation.z = f * 0.7; P.wings[1].rotation.z = -f * 0.7; }
        if (P.rotor) P.rotor.rotation.y += dt * 25;
        P.body.position.y = flyBase + Math.sin(t * 2) * 0.12;
        P.body.rotation.x = st.moving ? 0.12 : 0;
        break;
      }
      case 'wisp': case 'float':
        P.body.position.y = (P.kind === 'wisp' ? 0.8 : 0) + Math.sin(t * 2.5) * 0.08;
        if (P.orbit) P.orbit.rotation.y += dt * 3;
        if (P.kind === 'float') P.body.rotation.y = Math.sin(t) * 0.15;
        break;
      case 'spider':
        P.spiderLegs.forEach((L, i) => { L.rotation.x = st.moving ? Math.sin(walk * 1.3 + i * 1.7) * 0.35 : 0; });
        break;
      case 'machine':
        if (st.moving) for (const w of P.wheels) w.rotation.x += dt * 4;
        P.glow.scale.y = 1 + Math.sin(t * 6) * 0.06;
        break;
      default: break;
    }
    // arms: walk swing, then attack / work / cast overrides
    if (arms) {
      const a0 = arms[0], a1 = arms[1];
      const mounted = P.kind === 'mounted' || P.kind === 'flyer';
      a0.rotation.set(mounted ? -0.5 : sw * 0.45, 0, 0.08);
      a1.rotation.set(mounted ? -0.5 : -sw * 0.45, 0, -0.08);
      if (st.attack >= 0) {
        const p = st.attack;
        if (look.weapon === 'bow') { a0.rotation.set(-1.5, 0, 0.1); a1.rotation.set(-1.4, 0, -0.5 + p * 0.3); }
        else if (look.weapon === 'staff' || look.weapon === 'totem' || def.proj === 'bolt' && !look.weapon) { a1.rotation.set(-0.3 - Math.sin(p * Math.PI) * 1.4, 0, -0.1); }
        else if (look.weapon === 'rifle' || look.weapon === 'spear' && def.proj) { a1.rotation.set(-1.5 + (p < 0.5 ? 0 : (p - 0.5) * 0.8), 0, 0); a0.rotation.set(-1.3, 0, 0.4); }
        else { const s = p < 0.45 ? p / 0.45 : 1 - (p - 0.45) / 0.55; a1.rotation.set(-0.4 - s * 2.3 + (p > 0.45 ? 0 : 0), 0, -0.15); if (P.torso) P.torso.rotation.y = (s - 0.5) * 0.4; }
      } else if (st.work) {
        const s = (Math.sin(t * 6) + 1) / 2;
        a1.rotation.set(-0.4 - s * 2.0, 0, -0.1); a0.rotation.set(-0.4 - s * 1.6, 0, 0.1);
      } else if (st.cast) {
        a0.rotation.set(-2.6, 0, 0.3); a1.rotation.set(-2.6, 0, -0.3);
      } else if (P.torso && P.kind === 'humanoid') P.torso.rotation.y = 0;
    }
    if (P.kind === 'machine' && P.arm) {
      const a = st.attack;
      if (look.machine === 'catapult') P.arm.rotation.x = a >= 0 ? (a < 0.25 ? -0.9 + (a / 0.25) * 1.7 : 0.8 - ((a - 0.25) / 0.75) * 1.7) : -0.9;
      else { P.arm.userData.z0 ??= P.arm.position.z; P.arm.position.z = P.arm.userData.z0 - (a >= 0 && a < 0.35 ? 0.18 * (1 - a / 0.35) : 0); }
    }
    if (P.cape) P.cape.rotation.x = 0.1 + (st.moving ? 0.35 + Math.sin(t * 7) * 0.08 : Math.sin(t * 1.3) * 0.04);
  };
  return { root, inner, animate, height: P.height ?? 1.6, parts: P };
}

// ── buildings ─────────────────────────────────────────────────────────────────────────────────────
const STYLE = {
  valemark:  { stone: 0xb8b2a6, wall: 0xe8dcc0, trim: 0x5a3e28, roof: 0x3a5a9a, accent: 0xf0d070, glowc: 0xfff0b0 },
  ironfang:  { stone: 0x8a6a4a, wall: 0x7a5434, trim: 0x3a2a1a, roof: 0xb88a5a, accent: 0xe8e0c8, glowc: 0xff8a30 },
  sylvan:    { stone: 0xb8b8c8, wall: 0x6a4a3a, trim: 0x3a2a2a, roof: 0x4a8a7a, accent: 0xc8b8ff, glowc: 0x9fd8ff },
  dread:     { stone: 0x4a4650, wall: 0x3a3442, trim: 0x2a2630, roof: 0x5a3a7a, accent: 0xe0dcc8, glowc: 0x8aff6a },
  deepforge: { stone: 0x8a8278, wall: 0x9a8a78, trim: 0xb08850, roof: 0x6a5a4a, accent: 0xb08850, glowc: 0xff9a40 },
};

export function makeBuildingModel(def, teamHex) {
  const team = new THREE.Color(teamHex).getHex();
  const S = STYLE[def.style];
  const s = def.size;
  const root = new THREE.Group();
  const g = grp(root);
  const P = { root, inner: g, lights: [], spin: [], smoke: [], bob: [] };
  const st = M(S.stone), wall = M(S.wall), trim = M(S.trim), roofM = M(tint(S.roof, team, 0.35)), teamM = M(team), acc = M(S.accent, { m: 0.4, r: 0.5 });
  const glowM = glow(S.glowc, 1.8);
  const B = BUILDERS[def.style];
  B[def.type](g, s, { st, wall, trim, roofM, teamM, acc, glowM, S, team, P });
  // construction scaffold
  const scaf = grp(root);
  const pole = M(0x8a6a42);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(scaf, G.box, pole, [sx * s * 0.48, 1.2, sz * s * 0.48], [0.08, 2.4, 0.08]);
  for (const y of [0.8, 1.6, 2.3]) for (const r of [0, Math.PI / 2]) { const b = add(scaf, G.box, pole, [0, y, 0], [s, 0.06, 0.06], [0, r, 0]); b.position.set(r ? s * 0.48 : 0, y, r ? 0 : s * 0.48); }
  scaf.visible = false;
  P.scaffold = scaf;
  P.setProgress = (k) => {
    scaf.visible = k < 1;
    g.scale.set(1, Math.max(0.08, k), 1);
    g.position.y = 0;
  };
  let t = 0;
  P.animate = (dt) => {
    t += dt;
    for (const o of P.spin) o.rotation.y += dt * (o.userData.spd ?? 1);
    for (const o of P.bob) o.position.y = o.userData.y0 + Math.sin(t * 2 + o.userData.y0) * 0.12;
  };
  return P;
}

// Shared building pieces
function foundation(g, s, m, h = 0.35) { add(g, G.box, m, [0, h / 2 - 0.05, 0], [s * 0.96, h, s * 0.96]); }
function gableRoof(g, w, d, h, y, m, rotY = 0) { return add(g, G.prism, m, [0, y, 0], [w * 1.12, h, d * 1.1], [0, rotY, 0]); }
function door(g, z, w, h, m) { add(g, G.box, m, [0, h / 2 + 0.25, z], [w, h, 0.06]); add(g, G.cyl, m, [0, h + 0.25, z], [w / 2, 0.06, w / 2], [Math.PI / 2, 0, 0]); }
function banner(g, x, y, z, team, h = 1.4) {
  add(g, G.cyl6, M(0x5a3e28), [x, y + h / 2, z], [0.03, h, 0.03]);
  add(g, G.box, M(team), [x + 0.2, y + h - 0.3, z], [0.4, 0.5, 0.02]);
}
function windows(g, w, y, z, glowM, n = 2) { for (let i = 0; i < n; i++) add(g, G.box, glowM, [(i - (n - 1) / 2) * w / n, y, z], [0.18, 0.28, 0.03], [0, 0, 0], false); }
function spikes(g, r, y, n, m, len = 0.6) { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; add(g, G.cone, m, [Math.sin(a) * r, y, Math.cos(a) * r], [0.07, len, 0.07], [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]); } }
function crystalCluster(g, x, y, z, sc, m, n = 5) {
  for (let i = 0; i < n; i++) { const a = i / n * 6.28; add(g, G.crystal, m, [x + Math.sin(a) * 0.18 * sc, y + 0.25 * sc, z + Math.cos(a) * 0.18 * sc], [sc * 0.6, sc * (0.6 + (i % 3) * 0.25), sc * 0.6], [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35], false); }
  add(g, G.crystal, m, [x, y + 0.45 * sc, z], [sc, sc * 1.2, sc], [0, 0, 0], false);
}
const aetherM = () => M(0x8ff4ff, { e: 0x3fd8ff, ei: 2.2, r: 0.1, op: 0.9 });

function extractorCommon(g, s, k, housing) {
  // every extractor straddles the geyser: a glowing aether tank, pipes and a vent
  housing();
  const tank = grp(g, [s * 0.25, 0, -s * 0.2]);
  add(tank, G.cyl, aetherM(), [0, 1.3, 0], [0.38, 1.2, 0.38], [0, 0, 0], false);
  add(tank, G.cyl, k.acc, [0, 0.72, 0], [0.44, 0.1, 0.44]);
  add(tank, G.cyl, k.acc, [0, 1.92, 0], [0.44, 0.1, 0.44]);
  for (let i = 0; i < 3; i++) add(tank, G.box, k.acc, [Math.sin(i * 2.1) * 0.4, 1.3, Math.cos(i * 2.1) * 0.4], [0.05, 1.2, 0.05], [0, i * 2.1, 0]);
  add(g, G.cyl, k.acc, [-s * 0.15, 0.9, s * 0.1], [0.08, 1.2, 0.08], [0, 0, 1.2]);
  const vent = grp(g, [-s * 0.25, 0, s * 0.25]);
  add(vent, G.cyl, k.trim, [0, 1.4, 0], [0.2, 2.4, 0.2]);
  add(vent, G.cyl, aetherM(), [0, 2.65, 0], [0.16, 0.12, 0.16], [0, 0, 0], false);
  k.P.vent = { x: -s * 0.25, y: 2.7, z: s * 0.25 };
  const ring = grp(tank, [0, 1.3, 0]);
  add(ring, G.tor, aetherM(), [0, 0, 0], [0.55, 0.55, 0.55], [Math.PI / 2, 0, 0], false);
  ring.userData.spd = 1.5;
  k.P.spin.push(ring);
}

const BUILDERS = {
  valemark: {
    hall(g, s, k) {
      foundation(g, s, k.st);
      add(g, G.box, k.wall, [0, 1.3, 0.2], [2.8, 1.9, 2.2]);
      for (const x of [-1.38, 1.38]) for (const z of [-0.88, 1.28]) add(g, G.box, k.trim, [x, 1.3, z], [0.12, 1.9, 0.12]);
      add(g, G.box, k.trim, [0, 2.2, 1.32], [2.9, 0.1, 0.06]);
      gableRoof(g, 2.8, 2.3, 1.3, 2.25, k.roofM, Math.PI / 2);
      door(g, 1.32, 0.6, 0.8, k.trim);
      windows(g, 2.2, 1.7, 1.32, k.glowM, 3);
      // keep tower
      add(g, G.cyl8, k.st, [-1.2, 2.0, -1.1], [0.75, 4, 0.75]);
      add(g, G.cone, k.roofM, [-1.2, 4.6, -1.1], [0.95, 1.4, 0.95]);
      windows(g, 0.6, 3, -0.35, k.glowM, 1);
      add(g, G.box, k.st, [1.2, 2.6, -1.2], [0.4, 1.2, 0.4]);
      banner(g, -1.2, 5.2, -1.1, k.team, 1.0);
      banner(g, 1.6, 0.3, 1.6, k.team);
    },
    farm(g, s, k) {
      add(g, G.box, k.wall, [-0.35, 0.55, -0.3], [1.0, 0.9, 0.9]);
      gableRoof(g, 1.0, 0.9, 0.6, 1.0, M(0xc8a050));
      add(g, G.box, k.trim, [-0.35, 0.45, 0.16], [0.25, 0.5, 0.03]);
      for (let i = 0; i < 4; i++) add(g, G.box, M(0x6a9a3a), [0.55, 0.12, -0.6 + i * 0.35], [0.5, 0.12, 0.14]);
      add(g, G.cyl, M(0xd8b860), [0.55, 0.3, 0.75], [0.25, 0.5, 0.25]);
      for (const z of [-0.95, 0.95]) add(g, G.box, k.trim, [0, 0.2, z], [1.9, 0.06, 0.05]);
    },
    barracks(g, s, k) {
      foundation(g, s, k.st, 0.3);
      add(g, G.box, k.st, [0, 0.95, -0.1], [2.6, 1.4, 1.8]);
      gableRoof(g, 2.6, 1.8, 1.0, 1.65, k.roofM);
      door(g, 0.82, 0.7, 0.8, k.trim);
      for (const x of [-1.3, 1.3]) { add(g, G.cyl8, k.st, [x, 1.3, 0.8], [0.3, 2.4, 0.3]); add(g, G.cone, k.roofM, [x, 2.8, 0.8], [0.4, 0.7, 0.4]); }
      add(g, G.cyl6, k.trim, [0.9, 0.6, 1.25], [0.06, 1, 0.06]);
      add(g, G.box, M(0xc8a060), [0.9, 0.85, 1.25], [0.5, 0.06, 0.06]);
      banner(g, -0.6, 2.4, -0.1, k.team, 1.2);
    },
    sanctum(g, s, k) {
      foundation(g, s, k.st, 0.3);
      add(g, G.cyl8, k.st, [0, 1.6, 0], [1.0, 3, 1.0]);
      add(g, G.cone, M(tint(0x6a4aa8, k.team, 0.25)), [0, 3.9, 0], [1.25, 1.8, 1.25]);
      windows(g, 0.8, 2, 0.98, glow(0xc8a0ff, 2), 2);
      door(g, 0.98, 0.5, 0.7, k.trim);
      for (let i = 0; i < 3; i++) { const o = grp(g, [Math.sin(i * 2.1) * 1.3, 2.6 + i * 0.3, Math.cos(i * 2.1) * 1.3]); add(o, G.sph, glow(0xc8a0ff, 2.5), [0, 0, 0], [0.14, 0.14, 0.14], [0, 0, 0], false); o.userData.y0 = o.position.y; k.P.bob.push(o); }
    },
    workshop(g, s, k) {
      foundation(g, s, k.st, 0.3);
      add(g, G.box, k.wall, [0.3, 0.95, 0], [1.6, 1.4, 2.2]);
      gableRoof(g, 1.6, 2.2, 0.8, 1.65, k.roofM);
      add(g, G.box, k.trim, [-0.9, 1.1, 0], [0.1, 1.7, 2.2]);
      add(g, G.box, M(0x6a6a70, { m: 0.6 }), [-0.9, 2.0, 0], [1.0, 0.1, 2.3]);
      add(g, G.cyl, k.st, [0.8, 2.3, -0.7], [0.18, 1.6, 0.18]);
      k.P.smoke.push({ x: 0.8, y: 3.1, z: -0.7 });
      const gear = grp(g, [-0.85, 1.0, 1.15]);
      add(gear, G.tor, M(0x8a8a90, { m: 0.7 }), [0, 0, 0], [0.35, 0.35, 0.6]);
      gear.userData.spd = 0.6; k.P.spin.push(gear);
    },
    tower(g, s, k) {
      add(g, G.cyl8, k.st, [0, 1.8, 0], [0.75, 3.6, 0.75]);
      add(g, G.cyl8, k.st, [0, 3.7, 0], [0.92, 0.3, 0.92]);
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; add(g, G.box, k.st, [Math.sin(a) * 0.82, 4.0, Math.cos(a) * 0.82], [0.22, 0.3, 0.22], [0, a, 0]); }
      add(g, G.cone, k.roofM, [0, 4.6, 0], [0.7, 1.0, 0.7]);
      windows(g, 0.4, 2.6, 0.76, k.glowM, 1);
      banner(g, 0, 5.0, 0, k.team, 0.8);
      k.P.muzzle = [0, 4, 0];
    },
    extractor(g, s, k) {
      extractorCommon(g, s, k, () => {
        foundation(g, s, k.st, 0.4);
        add(g, G.box, k.wall, [-0.4, 0.9, -0.3], [1.4, 1.0, 1.2]);
        gableRoof(g, 1.4, 1.2, 0.6, 1.4, k.roofM);
      });
    },
  },
  ironfang: {
    hall(g, s, k) {
      add(g, G.cyl8, M(0x7a5a3a), [0, 0.2, 0], [1.9, 0.4, 1.9]);
      add(g, G.cyl8, k.wall, [0, 1.1, 0], [1.5, 1.6, 1.5]);
      add(g, G.cone6, k.roofM, [0, 2.75, 0], [1.9, 1.9, 1.9]);
      spikes(g, 1.75, 2.0, 8, M(0xe8e0c8), 0.8);
      add(g, G.cone, M(0xe8e0c8), [0.3, 3.9, 0], [0.08, 0.9, 0.08], [0, 0, -0.5]);
      add(g, G.cone, M(0xe8e0c8), [-0.3, 3.9, 0], [0.08, 0.9, 0.08], [0, 0, 0.5]);
      door(g, 1.5, 0.65, 0.8, M(0x2a1a10));
      add(g, G.sph, M(0xe8e0c8), [0, 1.65, 1.55], [0.22, 0.2, 0.15]);
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; if (Math.abs(Math.sin(a / 2)) < 0.2) continue; add(g, G.cyl6, M(0x6a4a2a), [Math.sin(a) * 1.95, 0.7, Math.cos(a) * 1.95], [0.1, 1.4, 0.1]); add(g, G.cone6, M(0x6a4a2a), [Math.sin(a) * 1.95, 1.55, Math.cos(a) * 1.95], [0.1, 0.3, 0.1]); }
      banner(g, 1.2, 0, 1.4, k.team, 2);
      add(g, G.box, k.glowM, [0, 0.55, 1.52], [0.4, 0.4, 0.02], [0, 0, 0], false);
    },
    farm(g, s, k) {
      add(g, G.hemi, M(0x8a6a4a), [0, 0, 0], [0.9, 0.8, 0.9]);
      add(g, G.cone6, k.roofM, [0, 0.95, 0], [0.6, 0.5, 0.6]);
      door(g, 0.8, 0.35, 0.35, M(0x2a1a10));
      spikes(g, 0.85, 0.5, 6, M(0xe8e0c8), 0.4);
    },
    barracks(g, s, k) {
      add(g, G.box, M(0x7a5a3a), [0, 0.15, 0], [s * 0.95, 0.3, s * 0.95]);
      add(g, G.box, k.wall, [0, 0.95, -0.2], [2.4, 1.3, 1.6]);
      add(g, G.prism, k.roofM, [0, 1.6, -0.2], [2.8, 1.1, 2.0]);
      for (let i = 0; i < 5; i++) add(g, G.cone, M(0xe8e0c8), [-1.0 + i * 0.5, 2.45, -0.2], [0.06, 0.5, 0.06]);
      door(g, 0.62, 0.6, 0.7, M(0x2a1a10));
      add(g, G.cyl6, M(0x6a4a2a), [1.0, 0.7, 1.0], [0.08, 1.4, 0.08]);
      add(g, G.sph, M(0xe8e0c8), [1.0, 1.5, 1.0], [0.18, 0.16, 0.16]);
      banner(g, -1.1, 0.3, 1.1, k.team, 1.8);
    },
    sanctum(g, s, k) {
      add(g, G.cyl8, k.wall, [0, 0.8, 0], [1.2, 1.4, 1.2]);
      add(g, G.cone6, M(0x5a6a8a), [0, 2.2, 0], [1.5, 1.6, 1.5]);
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.78; add(g, G.cyl6, M(0x6a4a2a), [Math.sin(a) * 1.35, 1.0, Math.cos(a) * 1.35], [0.07, 2, 0.07]); add(g, G.sph, glow(0x9fd0ff, 2), [Math.sin(a) * 1.35, 2.05, Math.cos(a) * 1.35], [0.12, 0.12, 0.12], [0, 0, 0], false); }
      door(g, 1.2, 0.5, 0.6, M(0x2a1a10));
      k.P.smoke.push({ x: 0, y: 3, z: 0 });
    },
    workshop(g, s, k) {
      add(g, G.box, M(0x5a4a3a), [0, 0.6, 0], [2.4, 1.2, 2.2]);
      add(g, G.prism, k.roofM, [0, 1.2, 0], [2.8, 0.9, 2.4], [0, Math.PI / 2, 0]);
      add(g, G.cyl, M(0x3a3a3a, { m: 0.6 }), [0.8, 1.9, -0.7], [0.22, 1.6, 0.22]);
      add(g, G.box, glow(0xff6a20, 2), [0, 0.5, 1.11], [0.8, 0.5, 0.02], [0, 0, 0], false);
      k.P.smoke.push({ x: 0.8, y: 2.8, z: -0.7 });
      spikes(g, 1.45, 0.4, 10, M(0x8a8a90, { m: 0.6 }), 0.5);
    },
    tower(g, s, k) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.cyl6, M(0x6a4a2a), [sx * 0.55, 1.6, sz * 0.55], [0.09, 3.2, 0.09], [sz * 0.08, 0, -sx * 0.08]);
      add(g, G.box, M(0x7a5a3a), [0, 3.2, 0], [1.4, 0.15, 1.4]);
      add(g, G.cone6, k.roofM, [0, 4.0, 0], [1.0, 1.0, 1.0]);
      spikes(g, 0.8, 3.4, 6, M(0xe8e0c8), 0.5);
      banner(g, 0.6, 3.3, 0.6, k.team, 1);
      k.P.muzzle = [0, 3.6, 0];
    },
    extractor(g, s, k) {
      extractorCommon(g, s, k, () => {
        add(g, G.box, M(0x7a5a3a), [0, 0.15, 0], [s * 0.9, 0.3, s * 0.9]);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.cyl6, M(0x6a4a2a), [sx * 1.1, 1.2, sz * 1.1], [0.1, 2.4, 0.1]);
        add(g, G.cone6, k.roofM, [-0.4, 1.4, -0.3], [0.9, 1.2, 0.9]);
      });
    },
  },
  sylvan: {
    hall(g, s, k) {
      // the Tree of Ages: a living hall
      const bark = M(0x6a4a3a);
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; add(g, G.cone6, bark, [Math.sin(a) * 1.0, 0.4, Math.cos(a) * 1.0], [0.3, 1.0, 0.3], [Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9]); }
      add(g, G.cyl8, bark, [0, 1.8, 0], [0.75, 3.6, 0.75]);
      add(g, G.leaf, M(0x3f8a6a), [0, 4.4, 0], [2.0, 1.2, 2.0]);
      add(g, G.leaf, M(0x5aa080), [0.9, 4.0, 0.6], [1.1, 0.8, 1.1]);
      add(g, G.leaf, M(0x4a7aa0), [-0.9, 4.2, -0.5], [1.2, 0.8, 1.2]);
      add(g, G.box, glow(0xbfe0ff, 1.8), [0, 0.8, 0.74], [0.45, 0.9, 0.04], [0, 0, 0], false);
      for (let i = 0; i < 5; i++) { const o = grp(g, [Math.sin(i * 1.3) * 1.7, 3 + (i % 3) * 0.4, Math.cos(i * 1.3) * 1.7]); add(o, G.sph, glow(0xd8f0ff, 3), [0, 0, 0], [0.08, 0.08, 0.08], [0, 0, 0], false); o.userData.y0 = o.position.y; k.P.bob.push(o); }
      banner(g, 1.4, 0, 1.3, k.team, 1.6);
    },
    farm(g, s, k) {
      add(g, G.cyl, M(0xc8c8d8), [0, 0.25, 0], [0.85, 0.5, 0.85]);
      add(g, G.cyl, glow(0x7fc8ff, 1.6), [0, 0.46, 0], [0.7, 0.05, 0.7], [0, 0, 0], false);
      for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28; add(g, G.box, M(0xc8c8d8), [Math.sin(a) * 0.8, 0.8, Math.cos(a) * 0.8], [0.12, 1.1, 0.12]); }
      const o = grp(g, [0, 1.3, 0]); add(o, G.oct, glow(0xbfe8ff, 2.5), [0, 0, 0], [0.15, 0.22, 0.15], [0, 0, 0], false); o.userData.spd = 1; k.P.spin.push(o);
    },
    barracks(g, s, k) {
      const bark = M(0x6a4a3a);
      add(g, G.cyl8, bark, [0, 1.0, 0], [0.9, 2.0, 0.9]);
      add(g, G.leaf, M(0x3f7a5a), [0, 2.5, 0], [1.6, 0.9, 1.6]);
      for (const sx of [-1, 1]) add(g, G.cone6, bark, [sx * 0.9, 0.4, 0.4], [0.25, 1.0, 0.25], [0, 0, sx * 0.6]);
      add(g, G.box, glow(0xbfe0ff, 1.6), [0, 0.65, 0.88], [0.4, 0.8, 0.04], [0, 0, 0], false);
      for (const sx of [-1, 1]) add(g, G.sphLo, glow(0xd8ff8a, 2), [sx * 0.25, 1.5, 0.8], [0.08, 0.06, 0.03], [0, 0, 0], false);
      banner(g, 1.1, 0, 1.1, k.team, 1.4);
    },
    sanctum(g, s, k) {
      for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; add(g, G.box, M(0xc8c8d8), [Math.sin(a) * 1.2, 1.0, Math.cos(a) * 1.2], [0.2, 2.0, 0.2]); add(g, G.leaf, M(0x4a8a6a), [Math.sin(a) * 1.2, 2.1, Math.cos(a) * 1.2], [0.4, 0.3, 0.4]); }
      add(g, G.cyl, M(0x9a9aaa), [0, 0.1, 0], [1.3, 0.2, 1.3]);
      const o = grp(g, [0, 1.4, 0]); crystalCluster(o, 0, -0.5, 0, 0.5, glow(0xb89aff, 2)); o.userData.spd = 0.4; k.P.spin.push(o);
    },
    workshop(g, s, k) {
      const bark = M(0x5a4030);
      add(g, G.cyl6, bark, [0, 1.2, 0], [0.8, 2.4, 0.7]);
      add(g, G.leaf, M(0x5a8a3a), [0, 2.8, 0], [1.5, 1.0, 1.5]);
      for (const sx of [-1, 1]) add(g, G.cyl6, bark, [sx * 0.85, 1.5, 0], [0.18, 1.4, 0.18], [0, 0, sx * 0.9]);
      for (const sx of [-1, 1]) add(g, G.sphLo, glow(0xd8ff8a, 2.4), [sx * 0.25, 1.6, 0.68], [0.1, 0.08, 0.03], [0, 0, 0], false);
      add(g, G.box, M(0x2a1a10), [0, 0.9, 0.7], [0.4, 0.12, 0.03]);
    },
    tower(g, s, k) {
      add(g, G.cyl8, M(0xd8d8e8), [0, 2.0, 0], [0.32, 4, 0.42]);
      add(g, G.cone6, M(0xd8d8e8), [0, 0.4, 0], [0.7, 0.8, 0.7]);
      add(g, G.torHalf, glow(0xd8e8ff, 1.6), [0, 4.3, 0], [0.5, 0.5, 0.6], [0, 0, Math.PI], false);
      const o = grp(g, [0, 4.5, 0]); add(o, G.sph, glow(0xbfe0ff, 3), [0, 0, 0], [0.15, 0.15, 0.15], [0, 0, 0], false); o.userData.y0 = 4.5; k.P.bob.push(o);
      k.P.muzzle = [0, 4.4, 0];
    },
    extractor(g, s, k) {
      extractorCommon(g, s, k, () => {
        for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; add(g, G.leaf, M(0x9a6ab8), [Math.sin(a) * 0.9, 0.5, Math.cos(a) * 0.9], [0.5, 0.25, 0.7], [0.5, a, 0]); }
        add(g, G.cyl, M(0x6a4a3a), [-0.4, 0.6, -0.3], [0.3, 1.2, 0.3]);
      });
    },
  },
  dread: {
    hall(g, s, k) {
      add(g, G.box, k.st, [0, 0.25, 0], [s * 0.95, 0.5, s * 0.95]);
      add(g, G.box, k.wall, [0, 1.4, 0], [2.4, 1.9, 2.4]);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { add(g, G.cyl6, k.st, [sx * 1.3, 1.8, sz * 1.3], [0.3, 3.6, 0.3]); add(g, G.cone6, k.roofM, [sx * 1.3, 4.1, sz * 1.3], [0.35, 1.2, 0.35]); }
      add(g, G.cone4, k.roofM, [0, 3.2, 0], [1.9, 1.8, 1.9], [0, 0.785, 0]);
      const o = grp(g, [0, 4.8, 0]); add(o, G.oct, glow(0x8aff6a, 2.4), [0, 0, 0], [0.35, 0.55, 0.35], [0, 0, 0], false); o.userData.spd = 0.8; k.P.spin.push(o);
      for (let i = 0; i < 4; i++) add(g, G.cyl6, M(0xe0dcc8), [-1.0 + i * 0.66, 1.0, 1.25], [0.05, 1.4, 0.05], [0.2, 0, 0]);
      add(g, G.box, glow(0x8aff6a, 1.6), [0, 0.9, 1.21], [0.6, 1.0, 0.03], [0, 0, 0], false);
      banner(g, 1.3, 0.5, 1.75, k.team, 1.6);
    },
    farm(g, s, k) {
      add(g, G.cone4, k.wall, [0, 0.6, 0], [1.0, 1.2, 1.0], [0, 0.785, 0]);
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.78; add(g, G.cone, M(0xe0dcc8), [Math.sin(a) * 0.75, 0.6, Math.cos(a) * 0.75], [0.06, 0.9, 0.06], [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]); }
      const o = grp(g, [0, 1.6, 0]); add(o, G.oct, glow(0xb07aff, 2.4), [0, 0, 0], [0.18, 0.28, 0.18], [0, 0, 0], false); o.userData.y0 = 1.6; k.P.bob.push(o);
    },
    barracks(g, s, k) {
      add(g, G.box, k.st, [0, 0.2, 0], [s * 0.95, 0.4, s * 0.95]);
      add(g, G.box, k.wall, [0, 0.9, -0.2], [2.4, 1.2, 1.8]);
      for (let i = 0; i < 5; i++) add(g, G.tor, M(0xe0dcc8), [-1.0 + i * 0.5, 1.5, -0.2], [0.45, 0.6, 0.6], [0, Math.PI / 2, 0]);
      add(g, G.box, glow(0x8aff6a, 1.4), [0, 0.7, 0.71], [0.6, 0.7, 0.03], [0, 0, 0], false);
      for (const sx of [-1, 1]) { add(g, G.cyl6, k.st, [sx * 1.2, 1.6, 0.8], [0.18, 2.6, 0.18]); add(g, G.cone6, k.roofM, [sx * 1.2, 3.2, 0.8], [0.22, 0.7, 0.22]); }
      banner(g, 0, 1.5, -0.2, k.team, 1.2);
    },
    sanctum(g, s, k) {
      add(g, G.box, k.st, [0, 0.2, 0], [s * 0.9, 0.4, s * 0.9]);
      add(g, G.cyl6, k.wall, [0, 1.3, 0], [1.0, 2.2, 1.0]);
      add(g, G.cone6, k.roofM, [0, 3.0, 0], [1.2, 1.4, 1.2]);
      for (let i = 0; i < 3; i++) { const o = grp(g, [Math.sin(i * 2.1) * 1.25, 1.8 + i * 0.3, Math.cos(i * 2.1) * 1.25]); add(o, G.sph, M(0xe0dcc8), [0, 0, 0], [0.16, 0.18, 0.18], [0, 0, 0], false); add(o, G.sphLo, glow(0x8aff6a, 3), [0, 0.02, 0.14], [0.06, 0.04, 0.03], [0, 0, 0], false); o.userData.y0 = o.position.y; k.P.bob.push(o); }
      add(g, G.box, glow(0x8aff6a, 1.4), [0, 1.0, 1.0], [0.4, 0.8, 0.03], [0, 0, 0], false);
    },
    workshop(g, s, k) {
      add(g, G.box, k.st, [0, 0.6, 0], [2.4, 1.2, 2.2]);
      add(g, G.box, glow(0x8aff6a, 1.6), [0, 0.6, 1.11], [0.9, 0.6, 0.02], [0, 0, 0], false);
      for (let i = 0; i < 6; i++) add(g, G.cone, M(0xe0dcc8), [-1.0 + i * 0.4, 1.6, 0.6 - (i % 2) * 1.0], [0.08, 0.9, 0.08]);
      add(g, G.cyl6, k.wall, [0.8, 1.8, -0.6], [0.25, 1.6, 0.25]);
      k.P.smoke.push({ x: 0.8, y: 2.7, z: -0.6, color: 0x7aff7a });
    },
    tower(g, s, k) {
      add(g, G.cyl6, k.wall, [0, 1.7, 0], [0.5, 3.4, 0.5]);
      add(g, G.cone6, k.roofM, [0, 3.8, 0], [0.6, 1.0, 0.6]);
      spikes(g, 0.5, 2.5, 6, M(0xe0dcc8), 0.6);
      const o = grp(g, [0, 4.7, 0]); add(o, G.sph, glow(0x8aff6a, 3), [0, 0, 0], [0.18, 0.18, 0.18], [0, 0, 0], false); o.userData.y0 = 4.7; k.P.bob.push(o);
      k.P.muzzle = [0, 4.6, 0];
    },
    extractor(g, s, k) {
      extractorCommon(g, s, k, () => {
        add(g, G.box, k.st, [0, 0.2, 0], [s * 0.9, 0.4, s * 0.9]);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1]]) add(g, G.cone, M(0xe0dcc8), [sx * 1.1, 0.9, sz * 1.1], [0.1, 1.6, 0.1]);
        add(g, G.cone4, k.wall, [-0.4, 0.9, -0.3], [0.8, 1.2, 0.8]);
      });
    },
  },
  deepforge: {
    hall(g, s, k) {
      add(g, G.rock, M(0x7a7268), [0, 0.6, -0.6], [2.2, 1.8, 1.6]);
      add(g, G.box, k.st, [0, 1.1, 0.6], [3.0, 2.0, 1.6]);
      add(g, G.box, k.acc, [0, 2.15, 1.42], [3.1, 0.15, 0.08]);
      add(g, G.prism, k.roofM, [0, 2.1, 0.6], [3.2, 0.7, 1.8]);
      door(g, 1.42, 0.9, 1.0, M(0x4a3420));
      add(g, G.box, k.acc, [0, 1.75, 1.45], [0.9, 0.08, 0.04]);
      windows(g, 2.4, 1.4, 1.42, k.glowM, 4);
      for (const sx of [-1, 1]) { add(g, G.box, k.st, [sx * 1.55, 1.5, 1.2], [0.5, 3, 0.5]); add(g, G.box, k.acc, [sx * 1.55, 3.05, 1.2], [0.6, 0.12, 0.6]); }
      add(g, G.cyl8, k.st, [0.9, 3.0, -0.6], [0.3, 2.0, 0.3]);
      k.P.smoke.push({ x: 0.9, y: 4.1, z: -0.6 });
      banner(g, -1.55, 3.1, 1.2, k.team, 1.0);
    },
    farm(g, s, k) {
      add(g, G.box, k.st, [0, 0.5, 0], [1.4, 0.9, 1.2]);
      add(g, G.prism, k.roofM, [0, 0.95, 0], [1.6, 0.5, 1.4]);
      add(g, G.cyl, M(0x8a5a2a), [0.6, 0.3, 0.7], [0.25, 0.55, 0.25], [0, 0, Math.PI / 2]);
      add(g, G.tor, k.acc, [0.6, 0.3, 0.7], [0.25, 0.25, 0.4], [0, Math.PI / 2, 0]);
      add(g, G.cyl, k.st, [-0.4, 1.3, -0.3], [0.12, 0.6, 0.12]);
      k.P.smoke.push({ x: -0.4, y: 1.7, z: -0.3 });
    },
    barracks(g, s, k) {
      add(g, G.box, k.st, [0, 0.9, -0.1], [2.6, 1.8, 2.0]);
      add(g, G.box, k.acc, [0, 1.85, -0.1], [2.7, 0.12, 2.1]);
      add(g, G.prism, k.roofM, [0, 1.9, -0.1], [2.7, 0.6, 2.1]);
      door(g, 0.92, 0.8, 0.9, M(0x4a3420));
      windows(g, 2, 1.3, 0.92, k.glowM, 2);
      banner(g, 1.1, 0.0, 1.2, k.team, 1.5);
    },
    sanctum(g, s, k) {
      add(g, G.box, k.st, [0, 0.8, 0], [2.2, 1.6, 2.2]);
      add(g, G.box, k.acc, [0, 1.65, 0], [2.3, 0.12, 2.3]);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.box, glow(0xff9a40, 1.8), [sx * 1.1, 1.0, sz * 1.1], [0.05, 0.6, 0.05], [0, 0, 0], false);
      add(g, G.box, glow(0xffa040, 2), [0, 1.0, 1.11], [0.5, 0.5, 0.02], [0, 0, 0], false);
      const o = grp(g, [0, 2.3, 0]); add(o, G.box, k.st, [0, 0, 0], [0.5, 0.5, 0.5], [0.6, 0, 0.6]); add(o, G.box, glow(0xffa040, 2.5), [0, 0, 0], [0.52, 0.06, 0.52], [0.6, 0, 0.6], false); o.userData.spd = 0.7; k.P.spin.push(o);
    },
    workshop(g, s, k) {
      add(g, G.box, k.st, [0, 0.8, 0], [2.4, 1.6, 2.2]);
      add(g, G.box, k.acc, [0, 1.65, 0], [2.5, 0.12, 2.3]);
      for (const sx of [-0.6, 0.6]) { add(g, G.cyl, M(0x5a5048, { m: 0.6 }), [sx, 2.4, -0.6], [0.22, 1.6, 0.22]); k.P.smoke.push({ x: sx, y: 3.3, z: -0.6 }); }
      add(g, G.box, glow(0xff6a20, 2.2), [0, 0.7, 1.11], [1.0, 0.7, 0.02], [0, 0, 0], false);
      const gear = grp(g, [1.25, 1.0, 0.3]);
      add(gear, G.tor, k.acc, [0, 0, 0], [0.45, 0.45, 0.6], [0, Math.PI / 2, 0]);
      gear.userData.spd = 0; k.P.spin.push(gear);
    },
    tower(g, s, k) {
      add(g, G.cyl8, k.st, [0, 1.3, 0], [0.85, 2.6, 0.85]);
      add(g, G.cyl8, k.acc, [0, 2.65, 0], [0.92, 0.12, 0.92]);
      const top = grp(g, [0, 3.0, 0]);
      add(top, G.cyl, M(0x3a3a3a, { m: 0.8, r: 0.3 }), [0, 0, 0.3], [0.16, 1.0, 0.16], [Math.PI / 2 - 0.2, 0, 0]);
      add(top, G.sph, k.st, [0, 0, 0], [0.4, 0.35, 0.4]);
      top.userData.spd = 0.3; k.P.spin.push(top);
      windows(g, 0.5, 1.8, 0.85, k.glowM, 1);
      k.P.muzzle = [0, 3.1, 0];
    },
    extractor(g, s, k) {
      extractorCommon(g, s, k, () => {
        add(g, G.box, k.st, [0, 0.3, 0], [s * 0.9, 0.6, s * 0.9]);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.box, k.acc, [sx * 1.1, 1.4, sz * 1.1], [0.15, 2.2, 0.15], [sz * 0.1, 0, -sx * 0.1]);
        add(g, G.box, k.st, [-0.4, 1.0, -0.3], [1.0, 0.8, 1.0]);
      });
    },
  },
};

// ── resources ─────────────────────────────────────────────────────────────────────────────────────
export function makeGoldMine() {
  const root = new THREE.Group();
  add(root, G.rock, M(0x7d766c), [0, 0.7, -0.2], [1.6, 1.3, 1.4]);
  add(root, G.rock, M(0x6a645a), [1.0, 0.4, 0.4], [0.7, 0.6, 0.7]);
  add(root, G.rock, M(0x8a847a), [-1.1, 0.4, 0.3], [0.8, 0.5, 0.7]);
  const wood = M(0x6a4a2a);
  add(root, G.box, wood, [-0.45, 0.6, 1.05], [0.15, 1.2, 0.15]);
  add(root, G.box, wood, [0.45, 0.6, 1.05], [0.15, 1.2, 0.15]);
  add(root, G.box, wood, [0, 1.22, 1.05], [1.2, 0.15, 0.2]);
  add(root, G.box, M(0x0a0806), [0, 0.55, 1.0], [0.75, 1.0, 0.05], [0, 0, 0], false);
  const gold = M(0xffcc33, { m: 0.9, r: 0.25, e: 0x8a5a00, ei: 0.6 });
  for (let i = 0; i < 9; i++) add(root, G.oct, gold, [Math.sin(i * 2.4) * 1.1, 0.5 + (i % 3) * 0.35, Math.cos(i * 2.4) * 0.8 + 0.2], [0.14, 0.18, 0.14], [i, i * 2, 0], false);
  add(root, G.box, M(0x5a4a3a), [0.9, 0.2, 1.4], [0.5, 0.3, 0.35]);
  for (let i = 0; i < 4; i++) add(root, G.oct, gold, [0.8 + (i % 2) * 0.2, 0.42, 1.35 + (i >> 1) * 0.1], [0.1, 0.1, 0.1], [i, 0, 0], false);
  return root;
}

export function makeGeyser(great) {
  const root = new THREE.Group();
  const sc = great ? 1.6 : 1;
  const rockM = M(0x5a5468);
  for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; add(root, G.rock, rockM, [Math.sin(a) * 1.1 * sc, 0.2, Math.cos(a) * 1.1 * sc], [0.45 * sc, 0.35 * sc, 0.45 * sc], [i, i, 0]); }
  add(root, G.cyl, M(0x1a1630), [0, 0.05, 0], [0.9 * sc, 0.1, 0.9 * sc]);
  const pool = add(root, G.cyl, M(0x8ff4ff, { e: 0x3fc8ff, ei: 2.4, r: 0.1 }), [0, 0.12, 0], [0.7 * sc, 0.04, 0.7 * sc], [0, 0, 0], false);
  const cm = M(great ? 0xd8a8ff : 0x9ff4ff, { e: great ? 0xa060ff : 0x3fd8ff, ei: 1.8, r: 0.15, op: 0.92 });
  crystalCluster(root, 1.2 * sc, 0, 0.5 * sc, 0.35 * sc, cm, 4);
  crystalCluster(root, -1.0 * sc, 0, -0.9 * sc, 0.28 * sc, cm, 3);
  if (great) crystalCluster(root, 0.2, 0, -1.8, 0.5, cm, 5);
  root.userData.pool = pool;
  return root;
}

/** Selection ring and health bar pieces. */
export function makeRing(radius, color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(radius * 0.86, radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return m;
}

export function makeHealthBar(width) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.12), new THREE.MeshBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.75, depthWrite: false }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.08), new THREE.MeshBasicMaterial({ color: 0x40e040, depthWrite: false, transparent: true }));
  fg.position.z = 0.001;
  const mana = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.05), new THREE.MeshBasicMaterial({ color: 0x4080ff, depthWrite: false, transparent: true }));
  mana.position.set(0, -0.09, 0.001);
  mana.visible = false;
  g.add(bg, fg, mana);
  g.renderOrder = 5;
  for (const m of [bg, fg, mana]) m.renderOrder = 5;
  g.userData = { fg, mana, width };
  g.set = (k, mk) => {
    k = Math.max(0, Math.min(1, k));
    fg.scale.x = Math.max(0.001, k);
    fg.position.x = -width * (1 - k) / 2;
    fg.material.color.setHex(k > 0.6 ? 0x40e040 : k > 0.3 ? 0xf0c020 : 0xf04020);
    if (mk != null) { mana.visible = true; mana.scale.x = Math.max(0.001, mk); mana.position.x = -width * (1 - mk) / 2; }
  };
  return g;
}

export { G as GEO, glow as glowMat };
