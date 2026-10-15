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
};

/** Inject fog-of-war darkening (and an optional extra patch) into a built-in material. */
export function applyFog(mat, key = 'std', extra = null) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fogUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWorldSize;\nvarying vec2 vFogUv;\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        fwp = modelMatrix * fwp;
        vWPos = fwp.xyz;
        vFogUv = fwp.xz / uWorldSize;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFog;\nuniform float uTime;\nvarying vec2 vFogUv;\nvarying vec3 vWPos;')
      .replace('#include <dithering_fragment>', `
        vec2 fogV = texture2D(uFog, vFogUv).rg;
        gl_FragColor.rgb *= mix(0.07, mix(0.42, 1.0, fogV.r), fogV.g);
        #include <dithering_fragment>`);
    if (extra) extra(sh);
  };
  mat.customProgramCacheKey = () => 'fog-' + key;
  return mat;
}
