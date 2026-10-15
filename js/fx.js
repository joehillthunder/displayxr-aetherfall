// Effects: a GPU point-particle system (additive glow and soft smoke), aether geyser plumes,
// projectiles, and spell visuals (shock rings, light columns, lightning, falling stars and ice).

import * as THREE from 'three';
import { fogUniforms } from './fog.js';
import { GEO, glowMat, M } from './models.js';

const VERT = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  uniform float uViewH; uniform sampler2D uFog; uniform float uWorldSize;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 fv = texture2D(uFog, wp.xz / uWorldSize).rg;
    vColor = aColor; vAlpha = aAlpha * mix(0.2 * fv.g, 1.0, fv.r);
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
  }`;
const FRAG_ADD = `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    float a = smoothstep(0.5, 0.0, d); a *= a;
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
    #include <colorspace_fragment>
  }`;
const FRAG_ALPHA = `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    float a = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor, a * vAlpha * 0.6);
    #include <colorspace_fragment>
  }`;

class Particles {
  constructor(cap, additive) {
    this.cap = cap;
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.size0 = new Float32Array(cap);
    this.swirl = new Float32Array(cap);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(64, 0, 64), 200);
    this.uniforms = { ...fogUniforms, uViewH: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
    this.geo = geo;
    this.c = new THREE.Color();
  }

  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, grow = 0, swirl = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.c.set(color);
    this.col[i * 3] = this.c.r; this.col[i * 3 + 1] = this.c.g; this.col[i * 3 + 2] = this.c.b;
    this.size[i] = this.size0[i] = size;
    this.life[i] = this.max[i] = life;
    this.grav[i] = grav; this.grow[i] = grow; this.swirl[i] = swirl;
    this.alpha[i] = 1;
  }

  update(dt) {
    const { pos, vel, life, max, size, size0, alpha, grav, grow, swirl } = this;
    let i = 0;
    while (i < this.n) {
      life[i] -= dt;
      if (life[i] <= 0) { this.kill(i); continue; }
      const k = life[i] / max[i];
      if (swirl[i]) {
        const vx = vel[i * 3], vz = vel[i * 3 + 2], s = swirl[i] * dt;
        vel[i * 3] = vx * Math.cos(s) - vz * Math.sin(s);
        vel[i * 3 + 2] = vx * Math.sin(s) + vz * Math.cos(s);
      }
      vel[i * 3 + 1] -= grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = size0[i] * (1 + grow[i] * (1 - k));
      alpha[i] = Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 8 + 0.2);
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    for (const a of ['position', 'aColor', 'aSize', 'aAlpha']) g.attributes[a].needsUpdate = true;
  }

  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const [arr, w] of [[this.pos, 3], [this.vel, 3], [this.col, 3]]) for (let c = 0; c < w; c++) arr[i * w + c] = arr[j * w + c];
    for (const arr of [this.size, this.size0, this.alpha, this.life, this.max, this.grav, this.grow, this.swirl]) arr[i] = arr[j];
  }
}

export class FX {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.glow = new Particles(7000, true);
    this.smoke = new Particles(2500, false);
    scene.add(this.glow.points, this.smoke.points);
    this.projectiles = [];
    this.effects = [];
    this.emitters = [];
    this.density = 1;
  }

  setViewHeight(h) { this.glow.uniforms.uViewH.value = h; this.smoke.uniforms.uViewH.value = h; }

  // ── emitters ────────────────────────────────────────────────────────────────────────────────────
  /** A continuous aether plume: a swirling column of glowing motes with a bright core. */
  addPlume(x, y, z, opts = {}) {
    const e = { kind: 'plume', x, y, z, acc: 0, great: !!opts.great, strength: opts.strength ?? 1, active: true };
    this.emitters.push(e);
    return e;
  }
  addSmoke(x, y, z, color = 0x8a8a8a, rate = 4) {
    const e = { kind: 'smoke', x, y, z, acc: 0, color, rate, active: true };
    this.emitters.push(e);
    return e;
  }
  addFire(x, y, z, scale = 1) {
    const e = { kind: 'fire', x, y, z, acc: 0, scale, active: true };
    this.emitters.push(e);
    return e;
  }
  remove(e) { if (e) e.active = false; }

  runEmitters(dt) {
    const g = this.glow, s = this.smoke, d = this.density;
    this.emitters = this.emitters.filter((e) => e.active);
    for (const e of this.emitters) {
      if (e.kind === 'plume') {
        const rate = (e.great ? 46 : 28) * e.strength * d;
        e.acc += dt * rate;
        while (e.acc > 1) {
          e.acc -= 1;
          const a = Math.random() * 6.28, r = Math.random() * (e.great ? 0.6 : 0.35);
          const up = (e.great ? 3.2 : 2.2) * (0.7 + Math.random() * 0.6) * (0.6 + e.strength * 0.4);
          const col = e.great ? (Math.random() < 0.5 ? 0xc89aff : 0x8ff0ff) : (Math.random() < 0.7 ? 0x6fe8ff : 0xd8ffff);
          g.spawn(e.x + Math.cos(a) * r, e.y, e.z + Math.sin(a) * r, Math.cos(a) * 0.35, up, Math.sin(a) * 0.35, col, e.great ? 0.4 : 0.26, 1.6 + Math.random() * 1.2, -0.2, 1.4, 2.2);
        }
        if (Math.random() < dt * 4 * d) g.spawn(e.x, e.y + 0.1, e.z, 0, 1.2, 0, e.great ? 0xd8c0ff : 0xc8ffff, e.great ? 0.9 : 0.6, 0.5, 0, 0.6);
      } else if (e.kind === 'smoke') {
        e.acc += dt * e.rate * d;
        while (e.acc > 1) { e.acc -= 1; s.spawn(e.x + (Math.random() - 0.5) * 0.2, e.y, e.z + (Math.random() - 0.5) * 0.2, 0.15 + Math.random() * 0.15, 0.7 + Math.random() * 0.4, 0.05, e.color, 0.45, 2.6, -0.05, 2.5); }
      } else if (e.kind === 'fire') {
        e.acc += dt * 26 * e.scale * d;
        while (e.acc > 1) {
          e.acc -= 1;
          const r = 0.6 * e.scale;
          g.spawn(e.x + (Math.random() - 0.5) * r, e.y, e.z + (Math.random() - 0.5) * r, 0, 1.2 + Math.random(), 0, Math.random() < 0.5 ? 0xff7a20 : 0xffc040, 0.35 * e.scale, 0.6 + Math.random() * 0.3, -0.5, -0.5);
          if (Math.random() < 0.3) s.spawn(e.x, e.y + 0.6, e.z, 0.1, 0.9, 0, 0x3a3a3a, 0.5, 2.2, -0.05, 2);
        }
      }
    }
  }

  /** A geyser erupts: a fountain of aether that shoots out of the screen in 3D and rains back down. */
  erupt(x, y, z, great, tapped) {
    const g = this.glow, d = this.density;
    const n = Math.round((great ? 220 : 130) * d);
    const h = great ? 13 : tapped ? 7 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = Math.random() * (great ? 0.7 : 0.4);
      const up = h * (0.55 + Math.random() * 0.5);
      const spread = 0.6 + Math.random() * 1.6;
      const col = great ? (Math.random() < 0.5 ? 0xc89aff : Math.random() < 0.5 ? 0x8ff0ff : 0xffffff) : (Math.random() < 0.75 ? 0x6fe8ff : 0xe8ffff);
      g.spawn(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * spread, up, Math.sin(a) * spread, col, (great ? 0.5 : 0.38) * (0.6 + Math.random() * 0.8), 1.6 + Math.random() * 1.2, 7.5, 0.4, 1.2);
    }
    // the steam cloud and a shock ring on the ground
    for (let i = 0; i < 14 * d; i++) { const a = Math.random() * 6.28; this.smoke.spawn(x, y + 0.5, z, Math.cos(a) * 1.4, 2 + Math.random() * 2, Math.sin(a) * 1.4, 0xbfe8f0, 0.9, 2.4, -0.2, 2.5); }
    this.ring(x, y, z, great ? 5 : 3, great ? 0xc89aff : 0x6fe8ff, 0.9);
    this.column(x, y, z, great ? 0xd8b8ff : 0xaff4ff, h * 0.6, 0.7, great ? 0.7 : 0.45);
  }

  /** Fireflies drifting over the forests at night. */
  fireflies(cx, cz, night, dt) {
    if (night < 0.3) return;
    this.ffAcc = (this.ffAcc ?? 0) + dt * 18 * night * this.density;
    while (this.ffAcc > 1) {
      this.ffAcc -= 1;
      const x = cx + (Math.random() - 0.5) * 50, z = cz + (Math.random() - 0.5) * 40;
      const y = this.world.surfaceAt(x, z) + 0.4 + Math.random() * 2.5;
      this.glow.spawn(x, y, z, (Math.random() - 0.5) * 0.5, (Math.random() - 0.3) * 0.3, (Math.random() - 0.5) * 0.5, Math.random() < 0.7 ? 0xd8ff6a : 0xffe08a, 0.16, 3 + Math.random() * 3, 0, 0.3, 1.5);
    }
  }

  // ── one-shots ───────────────────────────────────────────────────────────────────────────────────
  burst(x, y, z, color, n = 16, speed = 2, size = 0.25, life = 0.7, grav = 3) {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.glow.spawn(x, y, z, Math.cos(a) * r * sp, Math.abs(u) * sp + 0.5, Math.sin(a) * r * sp, color, size, life * (0.6 + Math.random() * 0.6), grav);
    }
  }
  dust(x, y, z, n = 10, color = 0x9a8a6a) {
    for (let i = 0; i < n * this.density; i++) { const a = Math.random() * 6.28; this.smoke.spawn(x, y + 0.1, z, Math.cos(a) * 1.2, 0.4 + Math.random() * 0.6, Math.sin(a) * 1.2, color, 0.6, 1.1, 0.4, 1.8); }
  }
  blood(x, y, z, color = 0x8a1a1a) { for (let i = 0; i < 5; i++) this.smoke.spawn(x, y, z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, color, 0.12, 0.5, 8); }

  ring(x, y, z, radius, color, dur = 0.6) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.15, z);
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur, update: (k) => { mesh.scale.setScalar(0.2 + k * radius); mesh.material.opacity = 1 - k; } });
  }

  column(x, y, z, color, h = 4, dur = 0.9, r = 0.6) {
    const mesh = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(r, h, r);
    this.scene.add(mesh);
    this.effects.push({ mesh, t: 0, dur, update: (k) => { mesh.material.opacity = Math.sin(k * Math.PI) * 0.6; mesh.scale.set(r * (1 - k * 0.6), h, r * (1 - k * 0.6)); } });
    this.burst(x, y + 0.5, z, color, 20, 1.5, 0.25, 1.0, -1);
  }

  /** Jagged lightning from a to b (Vector3s). */
  lightning(a, b, color = 0x9fd0ff, dur = 0.35) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const segs = 9;
    let prev = a.clone();
    for (let i = 1; i <= segs; i++) {
      const p = a.clone().lerp(b, i / segs);
      if (i < segs) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6));
      const len = prev.distanceTo(p);
      const m = new THREE.Mesh(GEO.box, mat);
      m.position.copy(prev).lerp(p, 0.5);
      m.scale.set(0.07, 0.07, len);
      m.lookAt(p);
      group.add(m);
      prev = p;
    }
    this.scene.add(group);
    this.effects.push({ mesh: group, t: 0, dur, update: (k) => { mat.opacity = 1 - k; } });
    this.burst(b.x, b.y, b.z, color, 10, 2, 0.2, 0.4, 0);
  }

  /** Stars, ice shards or flame raining onto an area for `dur` seconds. */
  rain(x, y, z, radius, color, dur, kind) {
    this.effects.push({
      t: 0, dur, acc: 0,
      update: (k, dt, e) => {
        e.acc += dt * (kind === 'star' ? 14 : 40) * this.density;
        while (e.acc > 1) {
          e.acc -= 1;
          const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * radius;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (kind === 'fire') this.glow.spawn(px, y + 0.1, pz, 0, 3 + Math.random() * 3, 0, Math.random() < 0.5 ? 0xff7a20 : 0xffd040, 0.5, 0.7, 0, -0.5);
          else this.glow.spawn(px - 2, y + 9, pz - 1, 2 * 2.2, -9 * 2.2, 1 * 2.2, color, kind === 'star' ? 0.6 : 0.3, 0.45, 0);
          if (kind === 'star' && Math.random() < 0.5) this.burst(px, y + 0.1, pz, color, 4, 2, 0.25, 0.4);
        }
      },
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, y + 0.12, z);
    this.scene.add(disc);
    this.effects.push({ mesh: disc, t: 0, dur, update: (k) => { disc.material.opacity = 0.3 * Math.sin(k * Math.PI); } });
  }

  // ── projectiles ─────────────────────────────────────────────────────────────────────────────────
  /** Fire a projectile; `target` is { x, y, z } or a function returning one (homing). onHit fires on arrival. */
  shoot(kind, from, target, onHit, color) {
    const mesh = new THREE.Group();
    const tp = typeof target === 'function' ? target() : target;
    const d = Math.hypot(tp.x - from.x, tp.z - from.z);
    let speed = 16, arc = 0.15 * d;
    switch (kind) {
      case 'arrow': {
        const shaft = new THREE.Mesh(GEO.cyl6, M(0x8a6a42)); shaft.scale.set(0.02, 0.7, 0.02); shaft.rotation.x = Math.PI / 2; mesh.add(shaft);
        const tip = new THREE.Mesh(GEO.cone4, M(0xc8ced8, { m: 0.6 })); tip.scale.set(0.04, 0.12, 0.04); tip.rotation.x = Math.PI / 2; tip.position.z = 0.38; mesh.add(tip);
        speed = 20; break;
      }
      case 'spear': {
        const shaft = new THREE.Mesh(GEO.cyl6, M(0x6a4a2a)); shaft.scale.set(0.03, 1.1, 0.03); shaft.rotation.x = Math.PI / 2; mesh.add(shaft);
        speed = 15; break;
      }
      case 'bullet': {
        const b = new THREE.Mesh(GEO.sphLo, glowMat(0xffd080, 3)); b.scale.setScalar(0.06); mesh.add(b);
        speed = 40; arc = 0; break;
      }
      case 'boulder': {
        const b = new THREE.Mesh(GEO.rock, M(0x7a7068)); b.scale.setScalar(0.28); mesh.add(b);
        const g = new THREE.Mesh(GEO.sph, glowMat(0x7ff0ff, 2)); g.scale.setScalar(0.12); mesh.add(g);
        speed = 11; arc = 0.4 * d; break;
      }
      case 'glaive': {
        const t = new THREE.Mesh(GEO.tor, M(0xd8e0f0, { m: 0.8, r: 0.3 })); t.scale.set(0.3, 0.3, 0.6); t.rotation.x = Math.PI / 2; mesh.add(t);
        speed = 18; arc = 0.05 * d; mesh.userData.spin = true; break;
      }
      case 'breath': {
        const b = new THREE.Mesh(GEO.sph, glowMat(0xb88aff, 3)); b.scale.setScalar(0.35); mesh.add(b);
        speed = 12; arc = 0.05 * d; color = 0xb88aff; break;
      }
      default: { // bolt
        const b = new THREE.Mesh(GEO.sph, glowMat(color ?? 0x9fd8ff, 3)); b.scale.setScalar(0.14); mesh.add(b);
        speed = 15; arc = 0.05 * d; color = color ?? 0x9fd8ff;
      }
    }
    mesh.position.set(from.x, from.y, from.z);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, kind, from: { ...from }, target, t: 0, dur: Math.max(0.08, d / speed), arc, onHit, color });
  }

  update(dt) {
    this.runEmitters(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const tp = typeof p.target === 'function' ? p.target() : p.target;
      const x = p.from.x + (tp.x - p.from.x) * k, z = p.from.z + (tp.z - p.from.z) * k;
      const y = p.from.y + (tp.y - p.from.y) * k + Math.sin(k * Math.PI) * p.arc;
      const prev = p.mesh.position.clone();
      p.mesh.position.set(x, y, z);
      if (p.mesh.userData.spin) p.mesh.rotation.y += dt * 25;
      else if (prev.distanceToSquared(p.mesh.position) > 1e-6) p.mesh.lookAt(prev.multiplyScalar(-1).add(p.mesh.position.clone().multiplyScalar(2)));
      if (p.color && Math.random() < 0.8 * this.density) this.glow.spawn(x, y, z, 0, 0.2, 0, p.color, p.kind === 'breath' ? 0.5 : 0.22, 0.35, 0);
      if (p.kind === 'boulder' && Math.random() < 0.6) this.glow.spawn(x, y, z, 0, 0, 0, 0x7ff0ff, 0.2, 0.4, 0);
      if (k >= 1) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        p.onHit?.(tp);
        if (p.kind === 'boulder' || p.kind === 'breath') { this.burst(tp.x, tp.y, tp.z, p.kind === 'breath' ? 0xb88aff : 0x7ff0ff, 22, 3, 0.3, 0.6); this.dust(tp.x, tp.y, tp.z, 8); }
        else if (p.color) this.burst(tp.x, tp.y, tp.z, p.color, 8, 1.5, 0.18, 0.35, 0);
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      e.update(k, dt, e);
      if (k >= 1) {
        if (e.mesh) { this.scene.remove(e.mesh); e.mesh.traverse?.((m) => { if (m.geometry && m.geometry !== GEO.cyl && m.geometry !== GEO.box) m.geometry.dispose(); }); }
        this.effects.splice(i, 1);
      }
    }
    this.glow.update(dt);
    this.smoke.update(dt);
  }
}
