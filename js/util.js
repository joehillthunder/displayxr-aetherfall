// Small shared helpers: maths, a seeded RNG and value noise.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const angleTo = (ax, az, bx, bz) => Math.atan2(bx - ax, bz - az);

/** Shortest signed difference between two angles. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** mulberry32: a fast, seedable RNG. */
export function rng(seed) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

/** 2D value noise with smooth interpolation and fractal sum. */
export function makeNoise(seed) {
  const r = rng(seed);
  const P = new Uint8Array(512);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const V = new Float32Array(256).map(() => r() * 2 - 1);
  const at = (x, y) => V[P[(P[x & 255] + y) & 511]];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smooth(x - xi), v = smooth(y - yi);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
  n2.fbm = (x, y, oct = 4) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * n2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  };
  return n2;
}

export const fmt = (n) => Math.floor(n).toLocaleString('en-US');
