// Grid A* with 8-way moves (no corner cutting) and line-of-sight smoothing. If the goal can't be
// reached, the path ends at the closest reachable cell, so units walk up to blocked targets
// (trees, mines, buildings) instead of standing still.

import { N } from './world.js';

const SQ2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

class Heap {
  constructor() { this.a = []; this.f = []; }
  push(n, f) {
    const a = this.a, F = this.f;
    a.push(n); F.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [F[p], F[i]] = [F[i], F[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, F = this.f;
    const top = a[0];
    const ln = a.pop(), lf = F.pop();
    if (a.length) {
      a[0] = ln; F[0] = lf;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && F[l] < F[m]) m = l;
        if (r < a.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [F[m], F[i]] = [F[i], F[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const g = new Float32Array(N * N);
const came = new Int32Array(N * N);
const stamp = new Uint32Array(N * N);
const closed = new Uint32Array(N * N);
let gen = 1;

export function findPath(world, sx, sz, tx, tz, maxNodes = 16384) {
  const blocked = (x, z) => world.isBlocked(x, z);
  let s = { x: Math.floor(sx), z: Math.floor(sz) };
  const t = { x: Math.max(0, Math.min(N - 1, Math.floor(tx))), z: Math.max(0, Math.min(N - 1, Math.floor(tz))) };
  if (blocked(s.x, s.z)) {
    const o = world.nearestOpen(sx, sz, 3);
    if (o) s = { x: Math.floor(o.x), z: Math.floor(o.z) };
  }
  gen++;
  const si = s.z * N + s.x, ti = t.z * N + t.x;
  const h = (x, z) => { const dx = Math.abs(x - t.x), dz = Math.abs(z - t.z); return Math.max(dx, dz) + (SQ2 - 1) * Math.min(dx, dz); };
  const open = new Heap();
  g[si] = 0; stamp[si] = gen; came[si] = -1;
  open.push(si, h(s.x, s.z));
  let best = si, bestH = h(s.x, s.z), found = false, count = 0;
  while (open.size) {
    const c = open.pop();
    if (closed[c] === gen) continue;
    closed[c] = gen;
    if (c === ti) { found = true; best = c; break; }
    if (++count > maxNodes) break;
    const cx = c % N, cz = (c / N) | 0;
    const hc = h(cx, cz);
    if (hc < bestH) { bestH = hc; best = c; }
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (ni !== ti && blocked(nx, nz)) continue;
      if (ni === ti && blocked(nx, nz) && (dx && dz)) continue;
      if (dx && dz && (blocked(cx + dx, cz) || blocked(cx, cz + dz))) continue;
      if (closed[ni] === gen) continue;
      const ng = g[c] + cost;
      if (stamp[ni] !== gen || ng < g[ni]) {
        stamp[ni] = gen; g[ni] = ng; came[ni] = c;
        open.push(ni, ng + h(nx, nz) * 1.15);
      }
    }
  }
  // rebuild
  const cells = [];
  let c = best;
  while (c !== -1 && c !== undefined) { cells.push(c); if (c === si) break; c = came[c]; }
  cells.reverse();
  // a blocked goal cell (a tree, a mine) is only the destination, never a step
  if (found && blocked(t.x, t.z)) cells.pop();
  const pts = cells.map((i) => ({ x: (i % N) + 0.5, z: ((i / N) | 0) + 0.5 }));
  if (found && !blocked(t.x, t.z) && pts.length) pts[pts.length - 1] = { x: tx, z: tz };
  return smooth(world, pts, sx, sz);
}

function lineClear(world, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(d * 3);
  for (let i = 1; i < n; i++) {
    const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
    // check the cell and a small radius so units don't scrape corners
    for (const [ox, oz] of [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) if (world.isBlocked(Math.floor(x + ox), Math.floor(z + oz))) return false;
  }
  return true;
}

function smooth(world, pts, sx, sz) {
  if (pts.length < 2) return pts;
  const out = [];
  let ax = sx, az = sz, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(world, ax, az, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    ax = pts[j].x; az = pts[j].z;
    i = j + 1;
  }
  return out;
}
