// Synthesised sound effects (no audio files): sword hits, bow twangs, cannon booms, chopping,
// spell shimmer, build chimes and the war horn. Sounds fade with distance from the camera.

export class Audio {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.last = {};
    this.listener = () => ({ x: 64, z: 64, range: 40 });
  }

  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  tone(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hiss(freq, q, dur, vol, delay = 0, type = 'bandpass') {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  play(name, ent) {
    if (!this.on || !this.ctx) return;
    const now = performance.now();
    if (now - (this.last[name] ?? 0) < (name === 'hit' ? 70 : 110)) return;
    let v = 1;
    if (ent) {
      const L = this.listener();
      const d = Math.hypot(ent.x - L.x, ent.z - L.z);
      v = Math.max(0, 1 - d / L.range);
      if (v < 0.05) return;
    }
    this.last[name] = now;
    switch (name) {
      case 'hit': this.hiss(2400 + Math.random() * 1500, 3, 0.09, 0.35 * v); this.tone('square', 900 + Math.random() * 400, 300, 0.05, 0.05 * v); break;
      case 'shoot': this.tone('triangle', 520, 180, 0.12, 0.12 * v); this.hiss(4000, 1, 0.08, 0.1 * v); break;
      case 'boom': this.hiss(180, 0.8, 0.5, 0.6 * v, 0, 'lowpass'); this.tone('sine', 110, 40, 0.4, 0.3 * v); break;
      case 'die': this.tone('sawtooth', 300, 90, 0.35, 0.06 * v); break;
      case 'chop': this.tone('triangle', 260, 140, 0.06, 0.18 * v); this.hiss(1200, 4, 0.05, 0.15 * v); break;
      case 'cast': this.tone('sine', 660, 1320, 0.35, 0.08 * v); this.tone('sine', 990, 1980, 0.3, 0.05 * v, 0.05); this.hiss(6000, 2, 0.3, 0.06 * v); break;
      case 'collapse': this.hiss(300, 0.6, 1.4, 0.6 * v, 0, 'lowpass'); this.tone('sine', 80, 30, 1.2, 0.3 * v); break;
      case 'alert': this.tone('sawtooth', 220, 220, 0.45, 0.09); this.tone('sawtooth', 165, 165, 0.7, 0.09, 0.45); break;
      case 'built': [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.1, i * 0.09)); break;
      case 'level': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.1, i * 0.08)); break;
      case 'place': this.tone('sine', 160, 90, 0.15, 0.25); break;
      case 'ready': this.tone('triangle', 440, 660, 0.12, 0.08); break;
      case 'click': this.tone('sine', 900, 700, 0.04, 0.06); break;
      case 'order': this.tone('sine', 520, 600, 0.06, 0.06); break;
      case 'error': this.tone('square', 180, 150, 0.15, 0.05); break;
      default: break;
    }
  }
}
