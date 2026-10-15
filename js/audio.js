// Synthesised audio: every sound is generated with WebAudio, no files.
//
// Buses: sfx and voices (with a shared reverb send), ambience, and music, into a compressor.
// Sounds are positional: they fade with distance from the camera target and pan left/right.
//
// What's here:
// - aether: geyser bubbling (rising-pitch bubbles), eruptions, the extractor pump, aether pickup
// - harvesting: axe chops, tree creak-and-crash, pick clinks, coin / lumber / crystal deposits
// - combat: sword clangs, axe and club thuds, claws, bone clatter, bow twangs, rifle cracks,
//   cannon and catapult launches, magic zaps, lightning, ice, fire, quakes, heals and more
// - construction hammering, build fanfares, collapses, the war horn
// - unit voices: little formant "words" in a different voice per race
// - ambience: wind, birds by day, crickets by night, lapping water
// - music: a generative modal tune (harp, flute, drone) that adds drums when battle is near

const VOWELS = { a: [800, 1150, 2800], e: [400, 2000, 2600], i: [300, 2300, 3000], o: [450, 800, 2800], u: [325, 700, 2500], y: [500, 1500, 2500] };
const RACE_VOICE = {
  valemark: { pitch: 150, rough: 0, words: ['yes', 'aye', 'hm'], speed: 1 },
  ironfang: { pitch: 85, rough: 0.6, words: ['ug', 'oga', 'zug'], speed: 0.85 },
  sylvan: { pitch: 260, rough: 0, words: ['ae', 'ili', 'ya'], speed: 1.15, airy: 0.4 },
  dread: { pitch: 110, rough: 0, words: ['hss', 'oh', 'uu'], speed: 0.8, whisper: true },
  deepforge: { pitch: 105, rough: 0.25, words: ['aye', 'ho', 'ya'], speed: 1.05 },
  neutral: { pitch: 120, rough: 0.5, words: ['gr'], speed: 1 },
};

// D dorian by day, D aeolian by night (MIDI notes)
const SCALE_DAY = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
const SCALE_NIGHT = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.musicOn = true;
    this.last = {};
    this.listener = () => ({ x: 64, z: 64, range: 40 });
    this.intensity = 0;
    this.day = 1;
    this.inMenu = true;
  }

  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const c = (this.ctx = new AudioContext());
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.ratio.value = 4;
      this.master = c.createGain(); this.master.gain.value = 0.7;
      this.master.connect(this.comp).connect(c.destination);
      this.sfx = c.createGain(); this.sfx.gain.value = 0.55; this.sfx.connect(this.master);
      this.amb = c.createGain(); this.amb.gain.value = 0.35; this.amb.connect(this.master);
      this.mus = c.createGain(); this.mus.gain.value = this.musicOn ? 0.22 : 0; this.mus.connect(this.master);
      // reverb send: a generated stone-hall impulse response
      this.verb = c.createConvolver();
      this.verb.buffer = this.impulse(2.2, 2.6);
      this.verbIn = c.createGain(); this.verbIn.gain.value = 0.3;
      this.verbIn.connect(this.verb).connect(this.master);
      this.musVerb = c.createGain(); this.musVerb.gain.value = 0.5;
      this.mus.connect(this.musVerb).connect(this.verbIn);
      const len = c.sampleRate * 2;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.brownBuf = c.createBuffer(1, len, c.sampleRate);
      const b = this.brownBuf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) { v = (v + (Math.random() * 2 - 1) * 0.02) * 0.998; b[i] = v * 3.5; }
      this.distCurve = new Float32Array(256).map((_, i) => { const x = i / 128 - 1; return Math.tanh(x * 3); });
      this.startAmbience();
      this.musicT = c.currentTime + 0.5;
      this.music = { step: 0, deg: 4, phrase: 0 };
    } catch (e) { console.warn('[aetherfall] audio unavailable', e); this.ctx = null; }
  }

  impulse(dur, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.3);
  }

  // ── building blocks ─────────────────────────────────────────────────────────────────────────────
  /** An output for one sound: gain, stereo pan and reverb send. */
  out(vol, pan = 0, wet = 0.25, bus = this.sfx) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = vol;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(bus);
    if (wet > 0) { const s = c.createGain(); s.gain.value = wet; p.connect(s).connect(this.verbIn); }
    return g;
  }

  osc(dest, type, f0, f1, t, dur, vol, attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  noise(dest, t, dur, vol, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.003, brown = false) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = brown ? this.brownBuf : this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  /** A struck metal object: inharmonic partials with fast decay. */
  metal(dest, t, f, dur, vol) {
    for (const [r, a] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25], [13.3, 0.12]]) if (f * r < 16000) this.osc(dest, 'sine', f * r, f * r * 0.995, t, dur / Math.sqrt(r), vol * a, 0.001);
  }

  /** A bubble: a sine whose pitch rises quickly as it pops. */
  bubble(dest, t, f, vol) {
    this.osc(dest, 'sine', f, f * (2.2 + Math.random()), t, 0.05 + Math.random() * 0.05, vol, 0.004);
  }

  /** A formant-synthesised syllable: a buzz through three vowel resonances. */
  vowel(dest, t, dur, pitch, v, vol, opts = {}) {
    const c = this.ctx;
    const F = VOWELS[v] ?? VOWELS.a;
    const src = opts.whisper ? c.createBufferSource() : c.createOscillator();
    if (opts.whisper) { src.buffer = this.noiseBuf; }
    else {
      src.type = 'sawtooth';
      src.frequency.setValueAtTime(pitch, t);
      src.frequency.linearRampToValueAtTime(pitch * (opts.bend ?? 1), t + dur);
      const vib = c.createOscillator(), vg = c.createGain();
      vib.frequency.value = 5.5; vg.gain.value = pitch * 0.02;
      vib.connect(vg).connect(src.frequency);
      vib.start(t); vib.stop(t + dur + 0.05);
    }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    env.gain.setValueAtTime(vol, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = src;
    if (opts.rough) { const ws = c.createWaveShaper(); ws.curve = this.distCurve; head.connect(ws); head = ws; }
    F.forEach((fr, i) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = fr * (opts.formantShift ?? 1); bp.Q.value = opts.whisper ? 6 : 9;
      const g = c.createGain(); g.gain.value = [1, 0.6, 0.25][i];
      head.connect(bp).connect(g).connect(env);
    });
    env.connect(dest);
    src.start(t); src.stop(t + dur + 0.05);
    if (opts.airy) this.noise(dest, t, dur, vol * opts.airy * 0.5, 'highpass', 4000, 4000, 0.5, 0.02);
  }

  // ── public: one-shot sounds ─────────────────────────────────────────────────────────────────────
  /** Play a named sound, optionally at an entity (fades with distance, pans). */
  play(name, ent, opts = {}) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    const gap = { hit: 45, clang: 45, thud: 45, chop: 60, pick: 70, hammer: 90, bubble: 30 }[name] ?? 100;
    const key = name + (opts.key ?? '');
    if (now - (this.last[key] ?? 0) < gap) return;
    let v = 1, pan = 0;
    if (ent) {
      const L = this.listener();
      const dx = ent.x - L.x, dz = ent.z - L.z;
      const d = Math.hypot(dx, dz);
      v = Math.max(0, 1 - d / L.range);
      v *= v;
      if (v < 0.02) return;
      pan = Math.max(-0.9, Math.min(0.9, dx / (L.range * 0.5)));
    }
    this.last[key] = now;
    const fn = this.S[name];
    if (fn) fn.call(this, this.ctx.currentTime + 0.005, v, pan, opts);
  }

  get S() {
    return SOUNDS;
  }

  /** A unit's voice line: "sel" (selected, rising) or "ok" (order, falling). */
  voice(faction, kind = 'ok', hero = false, ent = null) {
    if (!this.on || !this.ctx) return;
    const now = performance.now();
    if (now - (this.last.voice ?? 0) < 260) return;
    this.last.voice = now;
    const R = RACE_VOICE[faction] ?? RACE_VOICE.neutral;
    const c = this.ctx, t = c.currentTime + 0.01;
    const o = this.out(0.5, 0, 0.18);
    const word = R.words[Math.floor(Math.random() * R.words.length)];
    const vowels = word.replace(/[^aeiouy]/g, '') || 'a';
    const base = R.pitch * (hero ? 0.82 : 1) * (0.92 + Math.random() * 0.16);
    const sp = 0.13 / R.speed;
    let tt = t;
    [...vowels].forEach((v, i) => {
      const last = i === vowels.length - 1;
      const bend = kind === 'sel' ? (last ? 1.25 : 1.05) : (last ? 0.82 : 0.98);
      this.vowel(o, tt, sp * (last ? 1.5 : 1), base * (kind === 'sel' && last ? 1.08 : 1), v, 0.35, { bend, rough: R.rough, whisper: R.whisper, airy: R.airy, formantShift: faction === 'ironfang' ? 0.85 : faction === 'sylvan' ? 1.15 : 1 });
      // consonant clicks
      if (/[kgzt]/.test(word)) this.noise(o, tt, 0.03, 0.15, 'highpass', 3000);
      tt += sp * 0.9;
    });
    if (hero) this.osc(o, 'sine', base / 2, base / 2, t, tt - t + 0.1, 0.08, 0.03);
  }

  // ── ambience, gas loops and music, driven every frame ───────────────────────────────────────────
  startAmbience() {
    const c = this.ctx;
    const loop = (buf, type, f, q, vol) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = vol;
      s.connect(fl).connect(g).connect(this.amb);
      s.start();
      return { g, fl };
    };
    this.wind = loop(this.noiseBuf, 'bandpass', 500, 0.6, 0.0);
    this.water = loop(this.brownBuf, 'lowpass', 500, 0.7, 0.0);
    this.gasHiss = loop(this.noiseBuf, 'bandpass', 2400, 1.5, 0.0);
    this.gasRumble = loop(this.brownBuf, 'lowpass', 140, 1, 0.0);
  }

  /**
   * Called every frame. s: { day 0..1, menu, geyser: {d, tapped, great}|null, water: distance,
   * intensity 0..1 (nearby fighting) }.
   */
  update(dt, s) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime;
    const on = this.on ? 1 : 0;
    this.day = s.day ?? 1;
    this.inMenu = !!s.menu;
    this.intensity += ((s.intensity ?? 0) - this.intensity) * Math.min(1, dt * 0.8);
    // wind gusts
    const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1);
    this.wind.g.gain.setTargetAtTime(on * (0.05 + gust * 0.08), t, 0.5);
    this.wind.fl.frequency.setTargetAtTime(350 + gust * 500, t, 0.5);
    // lapping water
    const wv = s.water != null ? Math.max(0, 1 - s.water / 18) : 0;
    this.water.g.gain.setTargetAtTime(on * wv * (0.35 + 0.25 * Math.sin(t * 0.9)), t, 0.2);
    // aether geysers: hiss + rumble + bubbles, louder and pumping when tapped
    const G = s.geyser;
    const gv = G ? Math.max(0, 1 - G.d / 22) ** 1.5 * (G.great ? 1.4 : 1) : 0;
    const pump = G?.tapped ? 0.6 + 0.4 * Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)) : 1;
    this.gasHiss.g.gain.setTargetAtTime(on * gv * 0.18 * pump, t, 0.08);
    this.gasHiss.fl.frequency.setTargetAtTime(2000 + Math.sin(t * 3.1) * 500, t, 0.1);
    this.gasRumble.g.gain.setTargetAtTime(on * gv * 0.55 * pump, t, 0.08);
    if (on && gv > 0.03) {
      this.bubT = (this.bubT ?? 0) - dt;
      while (this.bubT < 0) {
        this.bubT += 0.03 + Math.random() * (0.25 - gv * 0.18);
        const o = this.out(gv * 0.5, (Math.random() - 0.5) * 0.6, 0.35, this.amb);
        this.bubble(o, t + Math.random() * 0.05, 180 + Math.random() * 500 * (G.great ? 0.7 : 1), 0.4);
      }
      if (G.tapped) {
        this.pumpT = (this.pumpT ?? 0) - dt;
        if (this.pumpT < 0) { this.pumpT = 0.9; const o = this.out(gv * 0.6, 0, 0.2, this.amb); this.noise(o, t, 0.22, 0.6, 'lowpass', 300, 120, 1, 0.01, true); this.metal(o, t + 0.12, 620, 0.25, 0.08); }
      }
    }
    // birds by day, crickets by night
    if (on && !this.inMenu) {
      this.critT = (this.critT ?? 1) - dt;
      if (this.critT < 0) {
        if (this.day > 0.5) { this.critT = 1.2 + Math.random() * 4; this.bird(); }
        else { this.critT = 0.25 + Math.random() * 0.5; this.cricket(); }
      }
    }
    this.musicTick();
  }

  bird() {
    const t = this.ctx.currentTime, o = this.out(0.12, Math.random() * 1.6 - 0.8, 0.4, this.amb);
    const f = 2400 + Math.random() * 2000, n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.osc(o, 'sine', f * (1 + Math.random() * 0.2), f * (0.7 + Math.random() * 0.6), t + i * 0.11, 0.08, 0.5, 0.005);
  }

  cricket() {
    const t = this.ctx.currentTime, o = this.out(0.05, Math.random() * 1.6 - 0.8, 0.2, this.amb);
    for (let i = 0; i < 3; i++) this.osc(o, 'sine', 4400, 4400, t + i * 0.045, 0.03, 0.5, 0.003);
  }

  // ── generative music ────────────────────────────────────────────────────────────────────────────
  musicTick() {
    const c = this.ctx;
    if (!this.musicOn || !this.on) { this.musicT = c.currentTime + 0.2; return; }
    const war = this.intensity;
    const bpm = 84 + war * 30;
    const step = 60 / bpm / 2; // eighth notes
    while (this.musicT < c.currentTime + 0.15) {
      this.musicNote(this.musicT, step, war);
      this.musicT += step;
    }
  }

  musicNote(t, step, war) {
    const M = this.music;
    const scale = this.day > 0.4 ? SCALE_DAY : SCALE_NIGHT;
    const i = M.step++ % 32;
    const bar = Math.floor(M.step / 8);
    // drone on each phrase
    if (i === 0) {
      const root = [50, 50, 53, 48][M.phrase++ % 4];
      for (const [m, det] of [[root, -4], [root + 7, 4]]) {
        const o = this.out(0.18, 0, 0.6, this.mus);
        const os = this.osc(o, 'sawtooth', mtof(m), mtof(m), t, step * 32, 0.3, 1.5);
        os.detune.value = det;
      }
    }
    // harp arpeggio on most eighths
    if (i % 2 === 0 || Math.random() < 0.35) {
      const deg = [0, 2, 4, 7, 4, 2][Math.floor(i / 2) % 6] + (bar % 4 === 2 ? 1 : 0);
      this.pluck(t, mtof(scale[Math.min(scale.length - 1, deg)] - 12), 0.22);
    }
    // flute melody: a random walk over the scale, phrased with rests
    if (i % 4 === 0 && Math.random() < 0.75) {
      M.deg = Math.max(0, Math.min(scale.length - 1, M.deg + Math.round((Math.random() - 0.5) * 4)));
      const dur = step * (Math.random() < 0.3 ? 4 : 2);
      this.flute(t, mtof(scale[M.deg]), dur);
    }
    // war drums when fighting is near
    if (war > 0.15) {
      if (i % 4 === 0) this.drum(t, 70, 0.55 * war);
      if (i % 8 === 6 || (war > 0.6 && i % 4 === 3)) this.drum(t, 110, 0.35 * war);
      if (war > 0.4 && i % 2 === 1) { const o = this.out(0.08 * war, 0.3, 0.2, this.mus); this.noise(o, t, 0.05, 0.6, 'highpass', 6000); }
    }
  }

  pluck(t, f, vol) {
    const o = this.out(vol, (Math.random() - 0.5) * 0.4, 0.5, this.mus);
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 6, t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.6);
    lp.connect(o);
    this.osc(lp, 'triangle', f, f, t, 1.2, 0.5, 0.002);
    this.osc(lp, 'sawtooth', f * 2, f * 2, t, 0.3, 0.1, 0.002);
  }

  flute(t, f, dur) {
    const c = this.ctx, o = this.out(0.16, 0.15, 0.7, this.mus);
    const os = c.createOscillator(), g = c.createGain();
    os.type = 'sine'; os.frequency.value = f;
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5; vg.gain.value = f * 0.008;
    vib.connect(vg).connect(os.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.08);
    g.gain.setValueAtTime(0.5, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    os.connect(g).connect(o);
    os.start(t); os.stop(t + dur + 0.3); vib.start(t); vib.stop(t + dur + 0.3);
    this.noise(o, t, dur, 0.04, 'bandpass', f * 2, f * 2, 2, 0.08);
  }

  drum(t, f, vol) {
    const o = this.out(vol, 0, 0.3, this.mus);
    this.osc(o, 'sine', f * 1.8, f, t, 0.35, 0.9, 0.002);
    this.noise(o, t, 0.12, 0.3, 'lowpass', 900, 300, 1, 0.002);
  }
}

// ── the sound library ─────────────────────────────────────────────────────────────────────────────
// Each entry: (t, vol, pan, opts) with `this` bound to the Audio instance.
const SOUNDS = {
  // aether
  erupt(t, v, p, o) {
    const a = this.out(v * 0.9, p, 0.5);
    this.noise(a, t, 2.2, 0.5, 'bandpass', 300, 3200, 0.8, 0.5);
    this.noise(a, t, 2.5, 0.7, 'lowpass', 120, 60, 1, 0.3, true);
    for (let i = 0; i < 26; i++) this.bubble(a, t + Math.random() * 1.6, 200 + Math.random() * 700, 0.35);
    for (let i = 0; i < 6; i++) this.osc(a, 'sine', 1800 + i * 330, 2400 + i * 400, t + 0.4 + i * 0.12, 0.9, 0.06, 0.05);
  },
  aether(t, v, p) { // a worker comes out of the extractor with aether
    const a = this.out(v * 0.6, p, 0.5);
    this.bubble(a, t, 300, 0.4);
    [1318, 1760, 2093].forEach((f, i) => this.osc(a, 'sine', f, f * 1.01, t + 0.05 + i * 0.06, 0.4, 0.18));
  },
  // harvesting
  chop(t, v, p) {
    const a = this.out(v * 0.8, p, 0.2);
    const f = 150 + Math.random() * 60;
    this.osc(a, 'sine', f * 1.6, f, t, 0.09, 0.8, 0.001);
    this.noise(a, t, 0.05, 0.5, 'bandpass', 1100 + Math.random() * 400, 700, 2, 0.001);
  },
  timber(t, v, p) {
    const a = this.out(v, p, 0.45);
    // creak
    const c = this.ctx, bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 5; bp.connect(a);
    const os = this.osc(bp, 'sawtooth', 70, 110, t, 0.9, 0.5, 0.05);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 18; lg.gain.value = 25; lfo.connect(lg).connect(os.frequency); lfo.start(t); lfo.stop(t + 1);
    // crash of leaves and the thud
    this.noise(a, t + 0.85, 0.9, 0.5, 'highpass', 2500, 1500, 0.6, 0.01);
    this.noise(a, t + 0.95, 0.5, 0.8, 'lowpass', 300, 80, 1, 0.005, true);
    this.osc(a, 'sine', 90, 45, t + 0.95, 0.4, 0.7, 0.003);
  },
  pick(t, v, p) {
    const a = this.out(v * 0.45, p, 0.3);
    this.metal(a, t, 1400 + Math.random() * 600, 0.25, 0.2);
    this.noise(a, t, 0.04, 0.4, 'highpass', 3000);
  },
  coins(t, v, p) {
    const a = this.out(v * 0.6, p, 0.3);
    for (let i = 0; i < 5; i++) this.metal(a, t + i * 0.035 + Math.random() * 0.02, 2600 + Math.random() * 1600, 0.3, 0.12);
  },
  woodstack(t, v, p) {
    const a = this.out(v * 0.6, p, 0.2);
    for (let i = 0; i < 2; i++) { this.osc(a, 'sine', 240 - i * 40, 120, t + i * 0.09, 0.12, 0.6, 0.002); this.noise(a, t + i * 0.09, 0.06, 0.3, 'bandpass', 800, 500, 2); }
  },
  stones(t, v, p) { // stone blocks dropped on the pile
    const a = this.out(v * 0.6, p, 0.25);
    for (let i = 0; i < 3; i++) { this.osc(a, 'sine', 420 - i * 60, 180, t + i * 0.07, 0.07, 0.5, 0.001); this.noise(a, t + i * 0.07, 0.05, 0.4, 'bandpass', 2200, 1200, 3, 0.001); }
  },
  crystal(t, v, p) {
    const a = this.out(v * 0.6, p, 0.6);
    [1568, 2093, 2637, 3136].forEach((f, i) => this.osc(a, 'sine', f, f, t + i * 0.05, 0.9, 0.15, 0.003));
  },
  // construction
  hammer(t, v, p) {
    const a = this.out(v * 0.5, p, 0.3);
    this.metal(a, t, 900 + Math.random() * 300, 0.18, 0.18);
    this.osc(a, 'sine', 220, 120, t, 0.08, 0.5, 0.001);
  },
  place(t) { const a = this.out(0.6, 0, 0.3); this.osc(a, 'sine', 140, 60, t, 0.25, 0.8); this.noise(a, t, 0.2, 0.4, 'lowpass', 400, 100, 1, 0.003, true); },
  built(t) { const a = this.out(0.45, 0, 0.5); [523, 659, 784, 1046].forEach((f, i) => { this.osc(a, 'triangle', f, f, t + i * 0.1, 0.45, 0.3); this.osc(a, 'sawtooth', f / 2, f / 2, t + i * 0.1, 0.3, 0.05); }); },
  ready(t) { const a = this.out(0.35, 0, 0.3); this.osc(a, 'triangle', 587, 880, t, 0.16, 0.4); this.osc(a, 'triangle', 880, 880, t + 0.1, 0.2, 0.3); },
  collapse(t, v, p) {
    const a = this.out(v, p, 0.5);
    this.noise(a, t, 1.8, 0.9, 'lowpass', 500, 60, 1, 0.01, true);
    this.osc(a, 'sine', 70, 28, t, 1.5, 0.8);
    for (let i = 0; i < 8; i++) this.noise(a, t + Math.random() * 1.2, 0.15, 0.4, 'bandpass', 600 + Math.random() * 1500, 400, 2);
  },
  // melee
  clang(t, v, p) { // sword on armour
    const a = this.out(v * 0.6, p, 0.3);
    this.metal(a, t, 700 + Math.random() * 500, 0.5, 0.22);
    this.noise(a, t, 0.06, 0.5, 'highpass', 2500, 2500, 1, 0.001);
  },
  thud(t, v, p) { // axe, club, hammer
    const a = this.out(v * 0.7, p, 0.2);
    this.osc(a, 'sine', 160, 55, t, 0.18, 0.9, 0.001);
    this.noise(a, t, 0.1, 0.5, 'lowpass', 1500, 300, 1, 0.001);
  },
  claw(t, v, p) { // beasts and creeps
    const a = this.out(v * 0.6, p, 0.2);
    this.noise(a, t, 0.14, 0.6, 'bandpass', 1800, 600, 1.5, 0.003);
    this.osc(a, 'sawtooth', 220, 120, t, 0.12, 0.15);
  },
  bones(t, v, p) { // undead clatter
    const a = this.out(v * 0.5, p, 0.3);
    for (let i = 0; i < 4; i++) this.osc(a, 'square', 1200 + Math.random() * 1500, 600, t + i * 0.025, 0.03, 0.15, 0.001);
  },
  slam(t, v, p) { // golems, treants, ogres
    const a = this.out(v * 0.9, p, 0.3);
    this.osc(a, 'sine', 90, 35, t, 0.4, 1, 0.002);
    this.noise(a, t, 0.3, 0.6, 'lowpass', 600, 80, 1, 0.002, true);
  },
  // ranged
  bow(t, v, p) {
    const a = this.out(v * 0.5, p, 0.2);
    this.osc(a, 'sawtooth', 210, 160, t, 0.18, 0.25, 0.001);
    this.osc(a, 'sine', 420, 400, t, 0.25, 0.2, 0.001);
    this.noise(a, t + 0.02, 0.25, 0.25, 'bandpass', 3000, 900, 2, 0.02);
  },
  spear(t, v, p) { const a = this.out(v * 0.5, p, 0.2); this.noise(a, t, 0.4, 0.4, 'bandpass', 600, 1800, 2, 0.05); },
  thunk(t, v, p) { const a = this.out(v * 0.45, p, 0.15); this.osc(a, 'sine', 300, 150, t, 0.07, 0.6, 0.001); this.noise(a, t, 0.04, 0.3, 'bandpass', 2000); },
  rifle(t, v, p) {
    const a = this.out(v * 0.6, p, 0.5);
    this.noise(a, t, 0.12, 0.9, 'highpass', 1200, 400, 0.7, 0.0005);
    this.osc(a, 'sine', 180, 60, t, 0.15, 0.7, 0.0005);
  },
  cannon(t, v, p) {
    const a = this.out(v, p, 0.6);
    this.osc(a, 'sine', 120, 30, t, 0.9, 1, 0.002);
    this.noise(a, t, 1.2, 0.9, 'lowpass', 1800, 90, 0.8, 0.002, true);
    this.noise(a, t, 0.08, 0.6, 'highpass', 2000);
  },
  catapult(t, v, p) {
    const a = this.out(v * 0.8, p, 0.4);
    const c = this.ctx, bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 4; bp.connect(a);
    this.osc(bp, 'sawtooth', 60, 90, t, 0.35, 0.6, 0.02);
    this.osc(a, 'sine', 120, 50, t + 0.3, 0.25, 0.8, 0.002);
    this.noise(a, t + 0.32, 0.6, 0.4, 'bandpass', 500, 1600, 1.5, 0.05);
  },
  boom(t, v, p) { // a boulder or cannonball lands
    const a = this.out(v, p, 0.5);
    this.noise(a, t, 0.8, 0.9, 'lowpass', 900, 70, 1, 0.003, true);
    this.osc(a, 'sine', 80, 32, t, 0.6, 0.8);
    this.bubble(a, t + 0.05, 500, 0.15);
  },
  zap(t, v, p) {
    const a = this.out(v * 0.5, p, 0.5);
    this.osc(a, 'sine', 500, 1800, t, 0.25, 0.4, 0.005);
    this.osc(a, 'square', 1000, 3000, t, 0.12, 0.06, 0.002);
  },
  breath(t, v, p) {
    const a = this.out(v * 0.8, p, 0.5);
    this.noise(a, t, 1.0, 0.8, 'bandpass', 400, 2400, 0.8, 0.1);
    this.vowel(a, t, 0.8, 70, 'a', 0.3, { rough: 1, bend: 0.7 });
  },
  // spells
  heal(t, v, p) {
    const a = this.out(v * 0.6, p, 0.8);
    [523, 659, 784, 1046].forEach((f, i) => this.osc(a, 'sine', f, f * 1.003, t + i * 0.04, 1.4, 0.18, 0.15));
    this.vowel(a, t, 1.2, 262, 'a', 0.08, { whisper: false, airy: 0.6 });
  },
  ward(t, v, p) { const a = this.out(v * 0.6, p, 0.6); this.metal(a, t, 523, 1.4, 0.2); this.osc(a, 'sine', 262, 262, t, 1.0, 0.2, 0.1); },
  lightning(t, v, p) {
    const a = this.out(v * 0.8, p, 0.6);
    for (let i = 0; i < 9; i++) this.noise(a, t + i * 0.025 + Math.random() * 0.02, 0.04, 0.8, 'highpass', 1500 + Math.random() * 3000, 800, 0.6, 0.0005);
    this.noise(a, t + 0.1, 1.2, 0.6, 'lowpass', 400, 60, 1, 0.05, true);
  },
  ice(t, v, p) {
    const a = this.out(v * 0.7, p, 0.6);
    this.noise(a, t, 0.5, 0.6, 'highpass', 5000, 2000, 0.8, 0.002);
    for (let i = 0; i < 10; i++) this.osc(a, 'sine', 2500 + Math.random() * 3500, 3000, t + Math.random() * 0.4, 0.2, 0.1, 0.001);
  },
  fire(t, v, p) {
    const a = this.out(v * 0.8, p, 0.5);
    this.noise(a, t, 1.4, 0.8, 'lowpass', 300, 2500, 0.7, 0.2, true);
    for (let i = 0; i < 12; i++) this.noise(a, t + Math.random() * 1.2, 0.03, 0.4, 'highpass', 3000);
  },
  quake(t, v, p) {
    const a = this.out(v, p, 0.5);
    this.osc(a, 'sine', 55, 30, t, 1.0, 1, 0.01);
    this.noise(a, t, 1.1, 0.9, 'lowpass', 250, 50, 1, 0.01, true);
    for (let i = 0; i < 6; i++) this.noise(a, t + 0.1 + Math.random() * 0.6, 0.12, 0.4, 'bandpass', 700 + Math.random() * 800, 400, 2);
  },
  starfall(t, v, p) {
    const a = this.out(v * 0.7, p, 0.8);
    for (let i = 0; i < 10; i++) { const tt = t + i * 0.14; this.osc(a, 'sine', 3000, 600, tt, 0.25, 0.12, 0.003); this.osc(a, 'sine', 90, 40, tt + 0.22, 0.2, 0.4, 0.002); }
  },
  summon(t, v, p) {
    const a = this.out(v * 0.6, p, 0.8);
    this.noise(a, t, 0.9, 0.5, 'bandpass', 200, 2500, 2, 0.7);
    [392, 523, 784].forEach((f, i) => this.osc(a, 'triangle', f, f, t + 0.6 + i * 0.05, 0.6, 0.2));
  },
  roots(t, v, p) {
    const a = this.out(v * 0.7, p, 0.4);
    const c = this.ctx, bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 6; bp.connect(a);
    this.osc(bp, 'sawtooth', 50, 120, t, 0.7, 0.6, 0.02);
    this.noise(a, t, 0.5, 0.4, 'bandpass', 500, 1500, 3, 0.05);
  },
  drain(t, v, p) { const a = this.out(v * 0.6, p, 0.7); this.osc(a, 'sawtooth', 600, 150, t, 0.7, 0.12, 0.02); this.vowel(a, t, 0.6, 90, 'o', 0.2, { whisper: true }); },
  stomp(t, v, p) { SOUNDS.quake.call(this, t, v, p); SOUNDS.slam.call(this, t, v, p); },
  roar(t, v, p) {
    const a = this.out(v * 0.9, p, 0.6);
    this.vowel(a, t, 1.0, 75, 'a', 0.5, { rough: 1, bend: 0.75 });
    this.vowel(a, t + 0.05, 0.9, 112, 'o', 0.25, { rough: 1, bend: 0.7 });
    this.noise(a, t, 1.0, 0.3, 'bandpass', 500, 300, 1, 0.1);
  },
  buff(t, v, p) { const a = this.out(v * 0.6, p, 0.7); [392, 494, 587, 784].forEach((f, i) => this.osc(a, 'triangle', f, f, t + i * 0.06, 0.6, 0.18)); },
  reveal(t, v, p) { const a = this.out(v * 0.5, p, 0.9); this.osc(a, 'sine', 880, 1760, t, 0.8, 0.2, 0.1); this.osc(a, 'sine', 1320, 2640, t + 0.1, 0.8, 0.12, 0.1); },
  level(t) {
    const a = this.out(0.55, 0, 0.6);
    [392, 523, 659, 784, 1046].forEach((f, i) => { this.osc(a, 'sawtooth', f, f, t + i * 0.08, 0.35, 0.08); this.osc(a, 'triangle', f, f, t + i * 0.08, 0.5, 0.25); });
    this.osc(a, 'triangle', 1046, 1046, t + 0.45, 1.0, 0.25, 0.02);
  },
  // deaths
  die(t, v, p, o) {
    const a = this.out(v * 0.6, p, 0.4);
    const kind = o.kind ?? 'humanoid';
    if (kind === 'undead') { this.vowel(a, t, 0.7, 200, 'u', 0.4, { whisper: true }); SOUNDS.bones.call(this, t + 0.2, v, p); }
    else if (kind === 'machine') { this.noise(a, t, 0.6, 0.8, 'lowpass', 1200, 200, 1, 0.002, true); this.metal(a, t, 300, 0.6, 0.2); }
    else if (kind === 'beast') { this.vowel(a, t, 0.35, 400, 'i', 0.4, { rough: 0.5, bend: 0.6 }); }
    else if (kind === 'big') { this.vowel(a, t, 0.9, 65, 'o', 0.5, { rough: 1, bend: 0.6 }); this.osc(a, 'sine', 70, 30, t + 0.6, 0.5, 0.6); }
    else if (kind === 'wisp') { [1568, 1175, 784].forEach((f, i) => this.osc(a, 'sine', f, f / 2, t + i * 0.08, 0.4, 0.2)); }
    else this.vowel(a, t, 0.4, (o.pitch ?? 140) * 1.1, 'o', 0.4, { bend: 0.6, rough: o.rough ?? 0 });
  },
  // UI and alerts
  click(t) { const a = this.out(0.3, 0, 0); this.osc(a, 'sine', 1200, 900, t, 0.04, 0.4, 0.001); },
  order(t) { const a = this.out(0.25, 0, 0); this.osc(a, 'triangle', 660, 880, t, 0.06, 0.3, 0.002); },
  error(t) { const a = this.out(0.35, 0, 0); this.osc(a, 'square', 160, 140, t, 0.18, 0.2); this.osc(a, 'square', 120, 110, t + 0.08, 0.18, 0.15); },
  alert(t) {
    const a = this.out(0.6, 0, 0.7);
    const c = this.ctx, lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(a);
    this.osc(lp, 'sawtooth', 196, 196, t, 0.6, 0.4, 0.08);
    this.osc(lp, 'sawtooth', 147, 147, t + 0.55, 1.0, 0.45, 0.08);
  },
  victory(t) {
    const a = this.out(0.6, 0, 0.8);
    [[523, 0], [659, 0.18], [784, 0.36], [1046, 0.54], [784, 0.8], [1046, 0.98]].forEach(([f, d]) => { this.osc(a, 'sawtooth', f, f, t + d, 0.5, 0.1); this.osc(a, 'triangle', f, f, t + d, 0.6, 0.3); });
  },
  defeat(t) {
    const a = this.out(0.6, 0, 0.8);
    [[392, 0], [349, 0.5], [311, 1.0], [262, 1.6]].forEach(([f, d]) => this.osc(a, 'sawtooth', f / 2, f / 2, t + d, 0.9, 0.15, 0.05));
  },
};
