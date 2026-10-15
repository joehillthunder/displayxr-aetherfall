// Fog of war. A visibility grid per player; the local player's grid is uploaded to a small texture
// that every world material samples (applyFog), so terrain, trees and buildings outside sight are
// dimmed and unexplored land is nearly black.

import * as THREE from 'three';

export class Fog {
  constructor(N) {
    this.N = N;
    this.vis = new Uint8Array(N * N); // seen this tick
    this.explored = new Uint8Array(N * N);
    this.data = new Uint8Array(N * N * 4);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.reveals = []; // {x, z, r, until}
    this.enabled = true;
  }

  /** Recompute from a list of {x, z, r} sight sources. */
  update(sources, now) {
    const { N, vis, explored, data } = this;
    vis.fill(0);
    this.reveals = this.reveals.filter((r) => r.until > now);
    const all = sources.concat(this.reveals);
    for (const s of all) {
      const r = s.r, r2 = r * r;
      const x0 = Math.max(0, Math.floor(s.x - r)), x1 = Math.min(N - 1, Math.ceil(s.x + r));
      const z0 = Math.max(0, Math.floor(s.z - r)), z1 = Math.min(N - 1, Math.ceil(s.z + r));
      for (let z = z0; z <= z1; z++) {
        const dz = z + 0.5 - s.z;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - s.x;
          if (dx * dx + dz * dz <= r2) { const i = z * N + x; vis[i] = 1; explored[i] = 1; }
        }
      }
    }
    const off = !this.enabled;
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = off || vis[i] ? 255 : 0;
      data[i * 4 + 1] = off || explored[i] ? 255 : 0;
    }
    this.tex.needsUpdate = true;
  }

  visible(x, z) {
    if (!this.enabled) return true;
    const i = Math.floor(z) * this.N + Math.floor(x);
    return this.vis[i] === 1;
  }

  isExplored(x, z) {
    if (!this.enabled) return true;
    return this.explored[Math.floor(z) * this.N + Math.floor(x)] === 1;
  }
}

export const fogUniforms = {
  uFog: { value: null },
  uWorldSize: { value: 128 },
  uTime: { value: 0 },
  uCloud: { value: 1 }, // strength of the drifting cloud shadows (0 at night)
};

export const GLSL_NOISE = `
  float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fhash(i), fhash(i + vec2(1, 0)), f.x), mix(fhash(i + vec2(0, 1)), fhash(i + vec2(1, 1)), f.x), f.y);
  }`;

// Surface patterns drawn in world space and projected on each face's dominant axis, so a stretched
// box still shows bricks of the same size.
export const PATTERN = { brick: 1, plank: 2, shingle: 3, bark: 4 };
const PATTERN_GLSL = `
  #ifdef AF_GRAIN
    diffuseColor.rgb *= 0.9 + 0.2 * fnoise(vWPos.xz * 6.0 + vWPos.y * 4.0);
  #endif
  #if AF_PAT > 0
  {
    vec3 an = abs(vWN);
    vec2 puv = an.y > max(an.x, an.z) ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
    #if AF_PAT == 1
      vec2 b = puv * vec2(3.0, 5.5); b.x += mod(floor(b.y), 2.0) * 0.5;
      vec2 f = fract(b); float m = clamp(step(f.x, 0.07) + step(f.y, 0.12), 0.0, 1.0);
      diffuseColor.rgb *= (0.84 + 0.26 * fhash(floor(b))) * (1.0 - 0.4 * m);
    #elif AF_PAT == 2
      vec2 b = puv * vec2(1.0, 6.5); b.x += fhash(vec2(floor(b.y), 3.0)) * 4.0;
      float seam = clamp(step(fract(b.y), 0.09) + step(fract(b.x * 0.5), 0.02), 0.0, 1.0);
      diffuseColor.rgb *= (0.84 + 0.22 * fhash(floor(b * vec2(0.5, 1.0)))) * (0.88 + 0.12 * fnoise(vec2(b.x * 14.0, b.y * 1.5))) * (1.0 - 0.38 * seam);
    #elif AF_PAT == 3
      vec2 b = vec2(puv.x, vWPos.y) * vec2(5.0, 7.5); b.x += mod(floor(b.y), 2.0) * 0.5;
      vec2 f = fract(b);
      diffuseColor.rgb *= (0.8 + 0.3 * fhash(floor(b))) * (0.68 + 0.32 * smoothstep(0.0, 0.4, f.y)) * (1.0 - 0.3 * step(f.x, 0.05));
    #elif AF_PAT == 4
      float g = fnoise(vec2((vWPos.x + vWPos.z) * 10.0, vWPos.y * 1.3));
      diffuseColor.rgb *= 0.7 + 0.45 * smoothstep(0.25, 0.7, g);
    #endif
  }
  #endif`;

/**
 * Inject fog of war, cloud shadows and optional surface detail into a built-in material.
 * opts: { grain: painterly noise, pat: a PATTERN key }.
 */
export function applyFog(mat, key = 'std', extra = null, opts = {}) {
  const pat = PATTERN[opts.pat] ?? 0;
  mat.defines = { ...(mat.defines || {}), AF_PAT: pat };
  if (opts.grain) mat.defines.AF_GRAIN = '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fogUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWorldSize;\nvarying vec2 vFogUv;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        vec3 fwn = objectNormal;
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
          fwn = mat3(instanceMatrix) * fwn;
        #endif
        fwp = modelMatrix * fwp;
        vWPos = fwp.xyz;
        vWN = normalize(mat3(modelMatrix) * fwn);
        vFogUv = fwp.xz / uWorldSize;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFog;\nuniform float uTime;\nuniform float uCloud;\nvarying vec2 vFogUv;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + PATTERN_GLSL)
      .replace('#include <dithering_fragment>', `
        vec2 fogV = texture2D(uFog, vFogUv).rg;
        gl_FragColor.rgb *= mix(0.07, mix(0.42, 1.0, fogV.r), fogV.g);
        float cl = fnoise(vWPos.xz * 0.028 + vec2(uTime * 0.016, uTime * 0.006)) * 0.65 + fnoise(vWPos.xz * 0.07 - vec2(uTime * 0.02, 0.0)) * 0.35;
        gl_FragColor.rgb *= mix(1.0, mix(0.72, 1.0, smoothstep(0.38, 0.62, cl)), uCloud);
        #include <dithering_fragment>`);
    if (extra) extra(sh);
  };
  mat.customProgramCacheKey = () => 'fog-' + key + '-' + pat + (opts.grain ? 'g' : '');
  return mat;
}
