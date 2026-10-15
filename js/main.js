// Aetherfall: Realms at War. Boot, the start menu (faction, hero, opponents, map), the world and
// match set-up, the day/night cycle, lighting and the frame loop.

import * as THREE from 'three';
import { Stage } from './stage.js';
import { World, STARTS, N } from './world.js';
import { Fog, fogUniforms } from './fog.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { makeGeyser, makeGoldMine } from './models.js';
import { FACTIONS, FACTION_IDS, HEROES, ABILITY } from './data.js';
import { clamp, lerp } from './util.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const QUALITY = {
  high: { shadow: 2048, density: 1, eye: 2560 },
  medium: { shadow: 1024, density: 0.7, eye: 1920 },
  low: { shadow: 0, density: 0.4, eye: 1280 },
};

const canvas = $('stage');
const stage = new Stage(canvas);
const scene = stage.scene;
const audio = new Audio();
let quality = params.get('quality') ?? load('quality', 'high');

// ── lights and sky ──────────────────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a3a28, 0.9);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(hemi, sun, sun.target);
const ambient = new THREE.AmbientLight(0x404858, 0.35);
scene.add(ambient);
scene.background = new THREE.Color(0x8fb8e0);
scene.fog = new THREE.Fog(0x8fb8e0, 90, 220);
const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x4a4a40, roughness: 1 }));
outer.rotation.x = -Math.PI / 2;
outer.position.set(N / 2, -1.5, N / 2);
scene.add(outer);

function applyQuality() {
  const Q = QUALITY[quality] ?? QUALITY.high;
  stage.renderer.shadowMap.enabled = Q.shadow > 0;
  sun.castShadow = Q.shadow > 0;
  if (Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  stage.maxEyeW = Q.eye;
  stage.sizeToCanvas();
  if (fx) fx.density = Q.density;
  scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
}

// ── world state ─────────────────────────────────────────────────────────────────────────────────
let world, fog, fx, game, ui, ais = [];
let previewT = 0;

function buildWorld(seed, styles) {
  if (world) scene.remove(world.group);
  if (fx) { scene.remove(fx.glow.points, fx.smoke.points); }
  world = new World(seed, styles);
  scene.add(world.buildMeshes());
  fog = new Fog(N);
  fogUniforms.uFog.value = fog.tex;
  fogUniforms.uWorldSize.value = N;
  fx = new FX(scene, world);
  fx.density = (QUALITY[quality] ?? QUALITY.high).density;
}

/** The menu backdrop: the real map with its resources, the fog lifted, the camera circling. */
function buildPreview(seed) {
  buildWorld(seed, [null, null, null, null]);
  fog.enabled = false;
  fog.update([], 0);
  const g = new THREE.Group();
  for (const m of world.mines) { const o = makeGoldMine(); o.position.set(m.x, world.heightAt(m.x, m.z), m.z); g.add(o); }
  for (const gy of world.geysers) { const o = makeGeyser(gy.great); const y = world.heightAt(gy.x, gy.z); o.position.set(gy.x, y, gy.z); g.add(o); fx.addPlume(gy.x, y + 0.15, gy.z, { great: gy.great }); }
  world.group.add(g);
}

// ── day / night ─────────────────────────────────────────────────────────────────────────────────
const DAY = 480;
const C = {
  dayBg: new THREE.Color(0x8fb8e0), nightBg: new THREE.Color(0x101a34),
  daySun: new THREE.Color(0xfff0d8), duskSun: new THREE.Color(0xffa060), nightSun: new THREE.Color(0x8098ff),
};
const tmp = new THREE.Color();
function lighting(t, target, dist) {
  const ph = ((t / DAY) + 0.32) % 1;
  const el = Math.sin(ph * Math.PI * 2);
  const dayK = clamp(el * 1.6 + 0.45, 0, 1);
  const dusk = clamp(1 - Math.abs(el) * 3, 0, 1);
  const az = ph * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(az) * 0.8, 0.55 + Math.max(0, el) * 0.6, 0.45 + Math.sin(az) * 0.3).normalize();
  sun.position.copy(target).addScaledVector(dir, 80);
  sun.target.position.copy(target);
  const s = Math.max(24, dist * 1.1);
  const cam = sun.shadow.camera;
  if (cam.right !== s) { cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 10; cam.far = 200; cam.updateProjectionMatrix(); }
  sun.intensity = lerp(0.55, 2.5, dayK);
  sun.color.copy(C.nightSun).lerp(C.daySun, dayK).lerp(C.duskSun, dusk * 0.6);
  hemi.intensity = lerp(0.45, 0.95, dayK);
  ambient.intensity = lerp(0.5, 0.25, dayK);
  tmp.copy(C.nightBg).lerp(C.dayBg, dayK);
  scene.background.copy(tmp);
  scene.fog.color.copy(tmp);
  world.waterMat.uniforms.uDay.value = lerp(0.35, 1, dayK);
  world.waterMat.uniforms.uSun.value.copy(dir);
  return dayK;
}

// ── frame loop ──────────────────────────────────────────────────────────────────────────────────
let fogT = 0;
let fpsN = 0, fpsT = 0;
const speed = Number(params.get('speed') ?? 1);
stage.onTick = (dt) => {
  fogUniforms.uTime.value += dt;
  fx.setViewHeight(canvas.height);
  fpsN++; fpsT += dt;
  if (fpsT > 1) { $('fps').textContent = `${Math.round(fpsN / fpsT)} fps`; fpsN = 0; fpsT = 0; }
  if (!game) {
    previewT += dt;
    const a = previewT * 0.05;
    stage.cam.position.set(64 + Math.cos(a) * 62, 46, 64 + Math.sin(a) * 62);
    stage.cam.lookAt(64, 0, 64);
    stage.focusDist = 70;
    lighting(150, new THREE.Vector3(64, 0, 64), 70);
    fx.update(dt);
    return;
  }
  const gdt = ui.paused ? 0 : dt * speed;
  game.update(gdt);
  for (const ai of ais) ai.update(gdt);
  fogT -= gdt;
  if (fogT <= 0) { fogT = 0.15; fog.update(game.sightSources(0), game.time); }
  fx.update(gdt);
  const T = ui.camT;
  const dayK = lighting(game.time, new THREE.Vector3(T.x, T.gy, T.z), T.dist);
  ui.update(dt, dayK);
  audio.listener = () => ({ x: T.x, z: T.z, range: 18 + T.dist });
};
stage.onModeChange = (stereo) => updateBadge();

// ── menu ────────────────────────────────────────────────────────────────────────────────────────
const choice = {
  faction: params.get('faction') ?? load('faction', 'valemark'),
  hero: params.get('hero') ?? load('hero', null),
  opponents: Number(params.get('opp') ?? load('opponents', 1)),
  oppFaction: params.get('enemy') ?? load('oppFaction', 'random'),
  difficulty: params.get('diff') ?? load('difficulty', 'normal'),
  seed: Number(params.get('seed') ?? Math.floor(Math.random() * 99999)),
  fog: params.get('fog') !== '0',
};
if (!FACTIONS[choice.faction]) choice.faction = 'valemark';
if (!HEROES[choice.hero] || HEROES[choice.hero].faction !== choice.faction) choice.hero = FACTIONS[choice.faction].heroes[0];

function load(k, d) { try { const v = localStorage.getItem('aetherfall.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function save(k, v) { try { localStorage.setItem('aetherfall.' + k, JSON.stringify(v)); } catch { /* private mode */ } }

const EMBLEM = { valemark: '🦁', ironfang: '🐺', sylvan: '🌙', dread: '💀', deepforge: '⚒️' };

function renderMenu() {
  $('factions').innerHTML = FACTION_IDS.map((id) => {
    const F = FACTIONS[id];
    return `<button class="fcard ${choice.faction === id ? 'on' : ''}" data-f="${id}" style="--fc:${F.color}">
      <span class="em">${EMBLEM[id]}</span><b>${F.name}</b><small>${F.race}</small><p>${F.trait}</p></button>`;
  }).join('');
  const F = FACTIONS[choice.faction];
  $('lore').innerHTML = `<h3>${F.name}</h3><p>${F.lore}</p>
    <div class="roster">${['worker', 'melee', 'ranged', 'cavalry', 'caster', 'siege', 'flyer'].map((r) => `<span>${F.units[r].name}</span>`).join('')}</div>
    <div class="roster bld">${Object.values(F.buildings).map((b) => `<span>${b}</span>`).join('')}</div>`;
  $('heroes').innerHTML = F.heroes.map((id) => {
    const H = HEROES[id];
    return `<button class="hcard ${choice.hero === id ? 'on' : ''}" data-h="${id}">
      <b>${H.name}</b><small>${H.title}</small><p>${H.blurb}</p>
      <ul>${H.abilities.map((a, i) => `<li><span class="ai">${ABILITY[a].icon}</span> <b>${ABILITY[a].name}</b> <em>lvl ${i + 1}</em><br><small>${ABILITY[a].desc}</small></li>`).join('')}</ul></button>`;
  }).join('');
  $('opp').value = String(choice.opponents);
  $('oppf').innerHTML = `<option value="random">Random</option>` + FACTION_IDS.map((id) => `<option value="${id}">${FACTIONS[id].name}</option>`).join('');
  $('oppf').value = choice.oppFaction;
  $('diff').value = choice.difficulty;
  $('seed').value = choice.seed;
  $('fogon').checked = choice.fog;
}

$('factions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  choice.faction = b.dataset.f;
  choice.hero = FACTIONS[choice.faction].heroes[0];
  audio.unlock(); audio.play('click');
  renderMenu();
});
$('heroes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-h]');
  if (!b) return;
  choice.hero = b.dataset.h;
  audio.unlock(); audio.play('click');
  renderMenu();
});
$('opp').addEventListener('change', (e) => { choice.opponents = Number(e.target.value); });
$('oppf').addEventListener('change', (e) => { choice.oppFaction = e.target.value; });
$('diff').addEventListener('change', (e) => { choice.difficulty = e.target.value; });
$('fogon').addEventListener('change', (e) => { choice.fog = e.target.checked; });
$('seed').addEventListener('change', (e) => { choice.seed = Number(e.target.value) || 1; buildPreview(choice.seed); });
$('reroll').addEventListener('click', () => { choice.seed = Math.floor(Math.random() * 99999); $('seed').value = choice.seed; buildPreview(choice.seed); });
$('start').addEventListener('click', () => { audio.unlock(); startMatch(); });

function startMatch() {
  save('faction', choice.faction); save('hero', choice.hero); save('opponents', choice.opponents);
  save('oppFaction', choice.oppFaction); save('difficulty', choice.difficulty);
  const players = [{ faction: choice.faction, hero: choice.hero, start: 0 }];
  const pool = FACTION_IDS.filter((f) => f !== choice.faction);
  for (let i = 0; i < choice.opponents; i++) {
    const f = choice.oppFaction === 'random' ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] ?? FACTION_IDS[i] : choice.oppFaction;
    const H = FACTIONS[f].heroes;
    players.push({ faction: f, hero: H[Math.floor(Math.random() * H.length)], start: i + 1, difficulty: choice.difficulty });
  }
  const styles = [null, null, null, null];
  players.forEach((p) => { styles[p.start] = FACTIONS[p.faction].style; });
  buildWorld(choice.seed, styles);
  fog.enabled = choice.fog;
  game = new Game({ scene, world, fog, fx, audio, setup: { players } });
  ais = players.slice(1).map((_, i) => new AI(game, i + 1));
  ui = new UI({ stage, game, world, fog, audio, canvas });
  ui.onOver = showEnd;
  fog.update(game.sightSources(0), 0);
  document.body.classList.remove('in-menu');
  $('menu').classList.remove('show');
  const F = FACTIONS[choice.faction], H = HEROES[choice.hero];
  ui.message(`${F.name}: ${H.name}, ${H.title}, leads your people.`, 'good');
  ui.message(`Enemies: ${players.slice(1).map((p) => FACTIONS[p.faction].name).join(', ')}. Destroy every enemy building to win.`);
  window.aetherfall = { game, ui, world, fog, fx, stage, ais };
  canvas.focus();
}

function showEnd(result) {
  const p = game.players[0].stats;
  const won = result === 'victory';
  $('end').innerHTML = `<div class="panel endp"><h2 class="${won ? 'win' : 'lose'}">${won ? 'Victory' : 'Defeat'}</h2>
    <p>${won ? 'The realm is yours. Every enemy stronghold has fallen.' : 'Your last stronghold has fallen.'}</p>
    <table><tr><td>Time</td><td>${Math.floor(game.time / 60)}:${String(Math.floor(game.time % 60)).padStart(2, '0')}</td></tr>
    <tr><td>Units trained</td><td>${p.unitsTrained}</td></tr><tr><td>Units lost</td><td>${p.unitsLost}</td></tr>
    <tr><td>Enemies destroyed</td><td>${p.kills}</td></tr><tr><td>Gold mined</td><td>${p.gold}</td></tr>
    <tr><td>Lumber harvested</td><td>${p.lumber}</td></tr><tr><td>Aether drawn</td><td>${p.aether}</td></tr>
    <tr><td>Hero level</td><td>${game.players[0].hero?.level ?? 1}</td></tr></table>
    <div class="btns"><button id="again">Play again</button><button id="keep">Keep watching</button></div></div>`;
  $('end').classList.add('show');
  $('again').onclick = () => { location.href = location.pathname; };
  $('keep').onclick = () => $('end').classList.remove('show');
}

// ── toolbar ─────────────────────────────────────────────────────────────────────────────────────
$('quality').value = quality;
$('quality').addEventListener('change', (e) => { quality = e.target.value; save('quality', quality); applyQuality(); });
$('depth').addEventListener('input', (e) => stage.setDepth(Number(e.target.value)));
if (params.get('depth')) { stage.setDepth(Number(params.get('depth'))); $('depth').value = params.get('depth'); }
$('lens').addEventListener('click', async () => { if (!(await stage.setStereo(!stage.stereo))) ui?.message('2D/3D switching needs the DisplayXR Browser.'); updateBadge(); });
$('sound').addEventListener('click', () => { audio.unlock(); audio.on = !audio.on; $('sound').textContent = audio.on ? '🔊' : '🔇'; });
$('helpbtn').addEventListener('click', () => $('help').classList.toggle('show'));
$('help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('help').classList.remove('show'); });
$('pausebtn').addEventListener('click', () => ui?.togglePause());
$('idle').addEventListener('click', () => ui?.selectIdleWorker());
$('full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });

function updateBadge() {
  const b = $('badge');
  if (stage.woven) { b.textContent = stage.stereo ? '3D' : '2D'; b.dataset.kind = 'ok'; b.title = 'Glasses-free 3D via DisplayXR'; }
  else { b.textContent = '2D'; b.dataset.kind = ''; b.title = 'Open in the DisplayXR Browser on a 3D display for glasses-free 3D'; }
  $('lens').style.display = stage.displayModesSupported ? '' : 'none';
}

// ── boot ────────────────────────────────────────────────────────────────────────────────────────
buildPreview(choice.seed);
renderMenu();
applyQuality();
if (params.get('mono') != null) stage.start = async function () { this.sizeToCanvas(); this.monoLoop(); return { woven: false, firstWoven: Promise.resolve({ woven: false }) }; };
stage.start().then((r) => {
  updateBadge();
  r.firstWoven?.then?.((w) => { console.info('[aetherfall] firstWoven', JSON.stringify(w ?? {})); updateBadge(); });
});
if (params.has('auto')) startMatch();
else { document.body.classList.add('in-menu'); $('menu').classList.add('show'); }
