// Dolomites look-dev: Passo Gardena / Sella at 1:1 from South Tyrol LiDAR + Copernicus DEM, SS243 from OpenStreetMap.
// Terrain is CDLOD (one instanced 32x32 grid, quadtree selected per frame, heights read in the vertex shader) over three nested
// 2048² height levels (2 m, 8 m, 32 m). One lighting model for everything static: physical sky LUT (computed on the CPU when the
// sun moves), sun with terrain shadows baked on the GPU per sun change, ambient cube from the same sky, aerial perspective with the
// same scattering coefficients, and a height-fog layer for low cloud.
(async () => {
  // &memtrace (memory work, 2026-10-19): typed arrays of 256 KB or more are recorded with the code line that made them (weak
  // references only); window.__memTrace() reports the ones still alive, summed per line and per backing buffer.
  if (new URLSearchParams(location.search).has('memtrace')) {
    const live = [];
    for (const name of ['Float32Array', 'Float64Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array']) {
      const Base = window[name];
      const Traced = class extends Base { constructor(...a) { super(...a); if (this.byteLength >= 262144) {
        const st = (new Error().stack || '').split('\n').slice(2).find((l) => !/babylon\.js/.test(l)) || '?';
        live.push({ r: new WeakRef(this.buffer), where: st.replace(/^\s*at\s*/, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?v=\d+/, '').slice(0, 90) }); } } };
      Object.defineProperty(Traced, 'name', { value: name }); window[name] = Traced;
    }
    window.__memPeak = { mb: 0, at: '' }; const st0 = document.getElementById('status');
    const bySite = () => { const seen = new Set(), by = {}; for (const e of live) { const b = e.r.deref(); if (!b || seen.has(b)) continue; seen.add(b); by[e.where] = (by[e.where] || 0) + b.byteLength; }
      return Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([w, v]) => Math.round(v / 1e6) + ' MB  ' + w); };
    const GCS = new URLSearchParams(location.search).get('memtrace') === 'gc' && window.gc;      // &memtrace=gc: live data only (slow)
    setInterval(() => { if (GCS) window.gc(); const m = performance.memory ? performance.memory.usedJSHeapSize / 1e6 : 0; if (m > window.__memPeak.mb + 20) window.__memPeak = { mb: Math.round(m), at: st0 ? st0.textContent.slice(0, 60) : '', t: Math.round(performance.now()), live: bySite() }; }, GCS ? 250 : 50);
    window.__memTrace = () => { const seen = new Set(), by = {};
      for (const e of live) { const b = e.r.deref(); if (!b || seen.has(b)) continue; seen.add(b); by[e.where] = (by[e.where] || 0) + b.byteLength; }
      return Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([w, v]) => Math.round(v / 1e6) + ' MB  ' + w); };
  }
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const fail = (t) => { statusEl.hidden = false; statusEl.textContent = t; window.__err = window.__err || t; };      // __err: the test runner stops at once
  window.addEventListener('error', (e) => fail('Something went wrong: ' + (e.message || 'unknown error')));
  window.addEventListener('unhandledrejection', (e) => fail('Something went wrong while loading: ' + ((e.reason && e.reason.message) || e.reason || 'unknown error')));
  const QS = new URLSearchParams(location.search);
  // crash breadcrumb (2026-10-19): phones kill the tab without a message. Every loading step and the first frames are written to
  // localStorage, which survives the crash; the next load shows where the last one stopped. Cleared after 300 good frames.
  const CRUMB = { set: (s, extra) => { try { localStorage.setItem('poCrumb', JSON.stringify(Object.assign({ s, t: new Date().toISOString().slice(11, 19) }, CRUMB.ctx, extra || {}))); } catch (_) {} }, ctx: {} };
  try {
    const prev = JSON.parse(localStorage.getItem('poCrumb') || 'null');
    if (prev && prev.s !== 'ok') {
      const box = document.createElement('div'); box.id = 'crumbBox';
      box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:50;padding:10px 12px;border-radius:12px;background:rgba(120,30,30,.9);color:#fff;font:600 13px/1.35 system-ui,sans-serif;pointer-events:auto';
      box.textContent = 'Last time the game stopped at: ' + Object.entries(prev).map(([k, v]) => k + '=' + v).join(' · ') + '  (tap to hide)';
      box.addEventListener('click', () => box.remove()); document.body.appendChild(box);
      window.__prevCrumb = prev;
    }
  } catch (_) {}
  CRUMB.ctx = { dpr: window.devicePixelRatio, scr: screen.width + 'x' + screen.height };
  CRUMB.set('start');
  new MutationObserver(() => { if (statusEl.textContent) CRUMB.set(statusEl.textContent.slice(0, 50)); }).observe(statusEl, { childList: true, characterData: true, subtree: true });
  const isTouch = window.matchMedia('(pointer: coarse)').matches, isMobile = isTouch || Math.min(screen.width, screen.height) < 700;
  const ASSETS = new URL('../assets/', location.href), assetUrl = (p) => new URL(p, ASSETS).href;
  const V3 = BABYLON.Vector3, C3 = BABYLON.Color3;
  const MAP = 'maps/dolomites/', DBG = +(QS.get('dbg') || 0);
  statusEl.textContent = 'Loading the Dolomites…';
  document.querySelector('.hud') && (document.querySelector('.hud').style.display = 'none');
  if (QS.has('shot')) { const st = document.createElement('style'); st.textContent = '.tools,.mode,.help,.joy,.hint,#lookPanel{display:none!important}'; document.head.appendChild(st); }
  for (const id of ['hornBtn', 'timeBtn', 'lightBtn', 'resetBtn', 'carSel']) { const e = $(id); if (e) e.style.display = 'none'; }

  // ---------- data ----------
  const getJSON = async (p) => { const r = await fetch(assetUrl(p)); if (!r.ok) throw new Error('could not load assets/' + p + ' (' + r.status + ')'); return r.json(); };
  const getBin = async (p) => { const r = await fetch(assetUrl(p)); if (!r.ok) throw new Error('could not load assets/' + p + ' (' + r.status + ')'); return r.arrayBuffer(); };
  const [WORLD, RD, META_OLD] = await Promise.all([getJSON(MAP + 'world.json'), getJSON(MAP + 'roads.json'), getJSON(MAP + 'meta.json').catch(() => ({}))]);
  const N = WORLD.size, Y0 = WORLD.y0, L0 = WORLD.landmarks;
  // world scale (tools/world/build_corridor.py --compress): game metres per real metre; distances and heights are compressed alike, so
  // slopes stay real. Real altitude (ecology, air density) = local y / SCALE + Y0; haze integrates over the real ray length.
  const SCALE = WORLD.scale || 1, INV_S = 1 / SCALE;
  // terrain levels, finest first; the last one (far) covers everything and has no detail maps
  const LVL = WORLD.levels.map((L, i) => ({ ...L, i, half: L.extent / 2, cx: L.center[0], cz: L.center[1], edge: 2 * L.res, fade: Math.max(250, 40 * L.res) }));
  const NL = LVL.length, LV = LVL.map((L) => L.name), FAR_I = NL - 1, MID_I = LV.indexOf('mid');
  const bins = await Promise.all(LV.map((k) => getBin(MAP + k + '.bin')));
  // CPU heights per level, kept as the file's 16-bit codes (local y = offset + code * scale; world.json encodes local y directly):
  // half the memory of Float32 copies, and decoding is linear, so it commutes with the bilinear filter below
  const HT = {}; LV.forEach((k, i) => { HT[k] = new Uint16Array(bins[i]); });
  const lvl = (k) => LVL[LV.indexOf(k)];
  const sampleLevel = (k, x, z) => {
    const L = lvl(k), gx = (x - (L.cx - L.half)) / L.res - 0.5, gz = ((L.cz + L.half) - z) / L.res - 0.5;
    const ix = Math.max(0, Math.min(N - 2, Math.floor(gx))), iz = Math.max(0, Math.min(N - 2, Math.floor(gz))), fx = Math.min(1, Math.max(0, gx - ix)), fz = Math.min(1, Math.max(0, gz - iz));
    const h = HT[k], a = h[iz * N + ix], b = h[iz * N + ix + 1], c = h[(iz + 1) * N + ix], d = h[(iz + 1) * N + ix + 1];
    return L.offset + L.scale * ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz);
  };
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const levelWeight = (L, x, z) => { if (L.i === FAR_I) return 1; const m = Math.max(Math.abs(x - L.cx), Math.abs(z - L.cz)); return 1 - smooth(L.half - L.edge - L.fade, L.half - L.edge, m); };
  const collisionH = (x, z) => { const s = structAt(x, z); return s ? s[1] : terrainH(x, z); };
  const terrainH = (x, z) => {     // same blend as the shaders: the finest level that fully covers the point, refined by finer ones fading in
    let b = FAR_I; for (let i = 0; i < NL; i++) if (levelWeight(LVL[i], x, z) >= 1) { b = i; break; }
    let h = sampleLevel(LV[b], x, z);
    for (let i = b - 1; i >= 0; i--) { const w = levelWeight(LVL[i], x, z); if (w > 0) h += (sampleLevel(LV[i], x, z) - h) * w; }
    return h;
  };
  // roads: the network, the drive route (pass -> Garda) as one polyline, and the old SS243 handle for the fixed shots
  const ROADS = RD.roads, RBY = Object.fromEntries(ROADS.map((r) => [r.id, r]));
  for (const r of ROADS) r.fl = r.flags ? Array.from(r.flags, (c) => +c) : new Array(r.points.length).fill(0);     // 0 road, 1 tunnel, 2 viaduct
  // The compact route joins the A22 to two-lane connectors. Taper the full
  // cross-section over 160 m instead of ending a carriageway at bare ground.
  for (const r of ROADS) {
    const pts = r.points, arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    const joins = [pts[0], pts[pts.length - 1]].map(p => ROADS.find(q => q !== r && q.class !== 'motorway' && [q.points[0], q.points[q.points.length - 1]].some(e => Math.hypot(e[0] - p[0], e[2] - p[2]) < 0.1)));
    r.cross = pts.map((p, i) => {
      if (r.class !== 'motorway') return { half: r.width / 2, shoulder: 1.2, motorway: 0, lane: 1.6 };
      const a = joins[0] ? 1 - smooth(0, 160, arc[i]) : 0, b = joins[1] ? 1 - smooth(0, 160, arc[arc.length - 1] - arc[i]) : 0;
      const t = 1 - a - b;
      // Reference layout: keep the opposing-traffic boundary on the centreline.
      // Only the outside edge widens; the dashed divider starts inside the widened road.
      const half = 9 + a * ((joins[0]?.width || 18) / 2 - 9) + b * ((joins[1]?.width || 18) / 2 - 9);
      return { half, shoulder: 0.6 + 0.6 * (a + b), motorway: t, lane: 1.6 + 4.025 * t };
    });
  }
  // Share the seam frame and marking distance across each motorway/connector join.
  // Independent endpoint tangents left thin wedges; resetting s broke the dash phase.
  const roadDirection = (r, i, radius = 1) => {
    if (r.joinDirs?.[i]) return r.joinDirs[i];
    const a = r.points[Math.max(0, i - radius)], b = r.points[Math.min(r.points.length - 1, i + radius)];
    const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const roadLength = r => r.points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.points[i][0], p[2] - r.points[i][2]), 0);
  for (const r of ROADS.filter(r => r.class === 'motorway')) {
    const ends = [0, r.points.length - 1];
    for (const i of ends) for (const q of ROADS.filter(q => q !== r && q.class !== 'motorway')) for (const j of [0, q.points.length - 1]) {
      if (Math.hypot(r.points[i][0] - q.points[j][0], r.points[i][2] - q.points[j][2]) >= 0.1) continue;
      const a = roadDirection(r, i), b = roadDirection(q, j), sign = a[0] * b[0] + a[1] * b[1] < 0 ? -1 : 1;
      const dx = a[0] + b[0] * sign, dz = a[1] + b[1] * sign, len = Math.hypot(dx, dz);
      (r.joinDirs ||= {})[i] = [dx / len, dz / len];
      (q.joinDirs ||= {})[j] = [dx / len * sign, dz / len * sign];
      if (i === 0 && j === q.points.length - 1) r.markOffset = roadLength(q);
    }
    for (const q of ROADS) if (q !== r && Math.hypot(q.points[0][0] - r.points.at(-1)[0], q.points[0][2] - r.points.at(-1)[2]) < 0.1) q.markOffset = (r.markOffset || 0) + roadLength(r);
  }
  const roadHalf = (r, i = 0) => r.cross[i].half;
  const roadShoulder = (r, i = 0) => r.cross[i].shoulder;
  // the surface the car drives on: the terrain, except in tunnels and on viaducts where it is the road itself
  // structures as segments (both ends flagged or either): the drive surface is interpolated along the segment, not taken from the
  // nearest road point (points are 2 m apart: on an 11 % viaduct that made 0.2 m steps under the wheels), over a band wide
  // enough that the 2 m collision grid never blends the deck with the ground below next to the wheels
  const STRUCT_GRID = new Map();
  // every road is in it: the car drives on the road surface itself within the paved width plus shoulder (flag 0), and on tunnels
  // and viaducts over a wider band (flags 1 and 2). Off the road it is the terrain, carved to match at the edges.
  for (const r of ROADS) { const P = r.points;
    for (let i = 0; i + 1 < P.length; i++) {
      const fl = r.fl[i] || r.fl[i + 1], hw = Math.max(roadHalf(r, i), roadHalf(r, i + 1)) + (fl ? 3.0 : 0.8);
      const a = P[i], b = P[i + 1], seg = [a[0], a[1], a[2], b[0], b[1], b[2], hw, fl, r.id];
      const k = Math.floor((a[0] + b[0]) / 32) + ',' + Math.floor((a[2] + b[2]) / 32);
      if (!STRUCT_GRID.has(k)) STRUCT_GRID.set(k, []); STRUCT_GRID.get(k).push(seg);
    } }
  const structAt = (x, z) => { let best = null, bd = Infinity; const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = STRUCT_GRID.get((gx + i) + ',' + (gz + j)); if (!l) continue;
      for (const q of l) { const dx = q[3] - q[0], dz = q[5] - q[2], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - q[0]) * dx + (z - q[2]) * dz) / L2));
        const px = q[0] + dx * t, pz = q[2] + dz * t, d = Math.hypot(x - px, z - pz);
        if (d < q[6] && d < bd) { bd = d; best = [px, q[1] + (q[4] - q[1]) * t, pz, q[6], q[7], q[8]]; } } }
    return best; };
  const TUNNELS = [];      // { pts: [[x,y,z]...], hw }
  for (const r of ROADS) { let cur = null; r.points.forEach((p, i) => { if (r.fl[i] === 1) { if (!cur) { cur = { pts: [], hw: r.width / 2 + 1.4, road: r.id }; if (i > 0) cur.pts.push(r.points[i - 1]); TUNNELS.push(cur); } cur.pts.push(p); } else if (cur) { cur.pts.push(p); cur = null; } }); }
  const PORTAL_SEGS = [];  // the first ~30 m inside each end, as segments for the terrain shader: x0, y0, z0, half width / x1, y1, z1, 0
  for (const t of TUNNELS) for (const end of [0, 1]) {
    const pts = end ? t.pts.slice().reverse() : t.pts; let acc = 0;
    // and ~8 m in front of the portal: the terrain grid (2-4 m) interpolates across the portal face, so the hill leaned onto the road
    // just before the tunnel (playtest: 'interrupted road right before the first tunnel'). Only the road's own volume is cut.
    { const a = pts[0], q = pts[Math.min(pts.length - 1, 2)], dx = a[0] - q[0], dz = a[2] - q[2], l = Math.hypot(dx, dz) || 1;
      PORTAL_SEGS.push([a[0] + dx / l * 8, a[1], a[2] + dz / l * 8, t.hw + 0.6], [a[0], a[1], a[2], 0]); }
    for (let k = 0; k + 3 < pts.length && acc < 36; k += 3) { const a = pts[k], b = pts[k + 3]; PORTAL_SEGS.push([a[0], a[1], a[2], t.hw + 0.6], [b[0], b[1], b[2], 0]); acc += Math.hypot(b[0] - a[0], b[2] - a[2]); }
  }
  const GL_PORTALS = `
uniform vec4 portalSeg[16]; uniform float nPortal;
bool inTunnelMouth(vec3 p) {
  for (int i = 0; i < 8; i++) {
    if (float(i) >= nPortal) break;
    vec4 a = portalSeg[2 * i], b = portalSeg[2 * i + 1];
    vec2 ab = b.xz - a.xz; float t = clamp(dot(p.xz - a.xz, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
    vec2 q = a.xz + ab * t; float y = mix(a.y, b.y, t);
    if (distance(p.xz, q) < a.w && p.y < y + 7.6 && p.y > y - 2.0) return true;
  }
  return false;
}
`;
  const REAL_PORTALS = []; for (let i = 0; i + 1 < PORTAL_SEGS.length; i += 2) REAL_PORTALS.push([PORTAL_SEGS[i], PORTAL_SEGS[i + 1]]);
  const PORTALS_ON = !QS.has('noportals');
  const portalArr = new Array(64).fill(0);
  // the segments within 500 m of the camera, nearest first (at most 8): most frames there are none and the terrain pays nothing
  const nearPortals = (cx, cz) => { if (!PORTALS_ON) return 0; const near = REAL_PORTALS.map((sg) => [Math.hypot(sg[0][0] - cx, sg[0][2] - cz), sg]).filter((d) => d[0] < 500).sort((a, b) => a[0] - b[0]).slice(0, 8);
    near.forEach(([, sg], i) => { portalArr.splice(i * 8, 8, ...sg[0], ...sg[1]); }); return near.length; };
  const ROAD = { points: RBY.ss243_existing.points, half_width: 3.4, shoulder: 1.2 };
  const ROUTE_PTS = (() => {
    const out = ROAD.points.slice().reverse();
    for (const id of RD.route.slice(1)) for (const p of RBY[id].points) { const q = out[out.length - 1]; if (Math.hypot(p[0] - q[0], p[2] - q[2]) > 0.5) out.push(p); }
    return out;
  })();
  const WATER = WORLD.water && WORLD.water.garda; let LAKE_BOX = [1e9, 1e9, -1e9, -1e9];
  const inLakeBox = (x, z) => x > LAKE_BOX[0] && x < LAKE_BOX[2] && z > LAKE_BOX[1] && z < LAKE_BOX[3];
  let lakeMaskAt = () => false;      // set once the lake mask is loaded: true over open water (with a 2-cell margin)
  // the ecology uses each patch's real altitude: world altitude minus the patch's vertical offset, blended by distance to its roads
  const PATCH_PTS = (() => { const pk = { ss243_existing: 'dolomites', ss242: 'dolomites', a22: 'bolzano', ss240: 'garda', ss45bis: 'garda' }; const acc = {};
    for (const r of ROADS) { const k = pk[r.id]; if (!k) continue; (acc[k] = acc[k] || []).push(...r.points.filter((_, i) => i % 40 === 0)); } return acc; })();
  const PATCH_K = Object.keys(PATCH_PTS);
  const POFF = new Map(), patchOffsetJS = (x, z) => { const key = Math.floor(x / 64) + ',' + Math.floor(z / 64); if (POFF.has(key)) return POFF.get(key); let ws = 0, o = 0; for (const [k, pts] of Object.entries(PATCH_PTS)) { let d = Infinity; for (const q of pts) d = Math.min(d, (q[0] - x) ** 2 + (q[2] - z) ** 2); const w = Math.exp(-Math.sqrt(d) / 1200); ws += w; o += w * WORLD.patches[k].y_offset; } POFF.set(key, o / ws); return o / ws; };      // cached per 64 m
  const PATCH_C = Object.entries(PATCH_PTS).map(([k, pts]) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[2], 0) / pts.length, WORLD.patches[k].y_offset]);

  // ---------- engine ----------
  const canvas = $('c');
  // the look-dev shaders are GLSL for now (WGSL ports come once the look is accepted): WebGL2 only
  // doNotHandleContextLost: Babylon otherwise keeps a CPU copy of every texture and vertex buffer to rebuild them after a lost
  // GPU context (about 400 MB here, part of what crashed phone and Safari tabs while loading). A lost context now asks for a reload.
  const engine = new BABYLON.Engine(canvas, true, { stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: QS.has('shot'), doNotHandleContextLost: true }, true);
  engine.onContextLostObservable.add(() => fail('The graphics context was lost (often low memory). Please reload the page.'));
  engine.useReverseDepthBuffer = true;
  // ---------- quality tier: a short GPU benchmark at load picks it (?quality=low|medium|high|ultra overrides); resolution then adapts ----------
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const TIERS = {
    low:    { scale: [0.6, 1.0, 0.75], msaa: 1, lodR: 170, rockB: 1, tfade: [900, 1800],  shadowNear: 1024, grassR: 0,  treeIn: 0,   treeOut: 0,   rocksR: 300, probe: 64,  probeRate: 4, glass: 0,   carMask: 256, photoAniso: 2 },
    medium: { scale: [0.75, 1.25, 1.0], msaa: 4, lodR: 240, rockB: 2, tfade: [1400, 3000], shadowNear: 2048, grassR: 22, treeIn: 75,  treeOut: 100, rocksR: 450, probe: 128, probeRate: 3, glass: 256, carMask: 512, photoAniso: 4 },
    high:   { scale: [1.0, DPR, Math.min(DPR, 1.5)], msaa: 4, lodR: 320, rockB: 2, tfade: [1800, 4000], shadowNear: 2048, grassR: 32, treeIn: 105, treeOut: 135, rocksR: 650, probe: 128, probeRate: 2, glass: 512, carMask: 512, photoAniso: 4 },
    ultra:  { scale: [1.0, DPR, DPR], msaa: 4, lodR: 450, rockB: 3, tfade: [2500, 6000], shadowNear: 4096, grassR: 44, treeIn: 150, treeOut: 190, rocksR: 900, probe: 256, probeRate: 1, glass: 512, carMask: 1024, photoAniso: 4 },
  };
  const benchGPU = () => {      // full-screen ALU + texture work into a 1024² target, timed to completion; ~3 ms on an AMD Radeon Pro 5500M
    try {
      const w = new BABYLON.EffectWrapper({ engine, name: 'bench', fragmentShader: `precision highp float; varying vec2 vUV;
        float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main() { vec2 p = vUV * 512.0; float s = 0.0; for (int i = 0; i < 96; i++) { vec2 f = fract(p), c = floor(p); s += mix(mix(h(c), h(c + vec2(1, 0)), f.x), mix(h(c + vec2(0, 1)), h(c + 1.0), f.x), f.y); p = p * 1.07 + 0.3; } gl_FragColor = vec4(s / 96.0); }` });
      const rt = engine.createRenderTargetTexture(1024, { generateMipMaps: false, type: BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE });
      const er = new BABYLON.EffectRenderer(engine);
      const run = (n) => { for (let i = 0; i < n; i++) er.render(w, rt); const px = new Uint8Array(4); engine._gl.readPixels(0, 0, 1, 1, engine._gl.RGBA, engine._gl.UNSIGNED_BYTE, px); };
      const wait = (t) => new Promise((r) => setTimeout(r, t));
      return (async () => {
        while (!w.effect.isReady()) await wait(20);
        run(3);
        const t0 = performance.now(); run(12); const ms = (performance.now() - t0) / 12;
        er.dispose(); w.dispose(); rt.dispose(); return ms;
      })();
    } catch (e) { console.warn('benchmark failed', e); return Promise.resolve(20); }
  };
  const benchMs = await benchGPU();
  let tierName = QS.get('quality');
  if (!TIERS[tierName]) tierName = isMobile ? (benchMs < 4 ? 'medium' : 'low') : benchMs < 1.0 ? 'ultra' : benchMs < 2.2 ? 'high' : benchMs < 7 ? 'medium' : 'low';     // AMD Radeon Pro 5500M ~3 ms -> medium
  const Q = TIERS[tierName];
  const SAFE = { on: false };     // set by the frame watchdog: drops the expensive passes after very long frames
  console.log('GPU benchmark', benchMs.toFixed(2), 'ms ->', tierName);
  let renderScale = +(QS.get('scale') || Q.scale[2]);
  CRUMB.ctx.tier = tierName;
  engine.setHardwareScalingLevel(1 / renderScale);
  const scene = new BABYLON.Scene(engine, { useFloatingOrigin: !QS.has('nofloat') });     // camera-relative rendering: no precision loss 10 km from the origin
  // built-in profiler (window.__prof): ms accumulated per per-frame callback (named by where it was registered) and per physics step part
  // slow shader readiness checks (synchronous compile/link waits), with the effect's name
  { const E = BABYLON.Effect.prototype, ck = E._checkIsReady; window.__compiles = [];
    if (ck) E._checkIsReady = function (...a) { const t = performance.now(); const r = ck.apply(this, a); const d = performance.now() - t; if (d > 100) window.__compiles.push([JSON.stringify(this.name).slice(0, 80), Math.round(d)]); return r; }; }
  // shader compile log: when each ShaderMaterial's effect starts compiling and when it reports ready
  window.__shaderLog = [];
  { const SM = BABYLON.ShaderMaterial.prototype, ir = SM.isReady;
    SM.isReady = function (...a) { const r = ir.apply(this, a); const L = window.__shaderLog, e = L.find((x) => x[0] === this.name);
      if (!e) L.push([this.name, Math.round(performance.now()), r ? Math.round(performance.now()) : null]); else if (r && e[2] === null) e[2] = Math.round(performance.now()); return r; }; }
  const MARKS = window.__marks = [], mark = (k) => { MARKS.push([k, Math.round(performance.now())]); CRUMB.set(k, { sec: Math.round(performance.now() / 100) / 10 }); };      // each milestone is also a crash breadcrumb
  const PROF = window.__prof = {}, prof = (k, f) => { const t = performance.now(); try { return f(); } finally { PROF[k] = (PROF[k] || 0) + performance.now() - t; } };
  { const o = scene.onBeforeRenderObservable, add0 = o.add.bind(o); let n = 0;
    o.add = (cb, ...r) => { const at = ((new Error().stack || '').split('\n')[2] || '').replace(/.*dolomites\.js[^:]*:/, 'line ').replace(/:\d+\)?$/, ''); const id = 'cb' + (n++) + ' ' + at; return add0((...a) => prof(id, () => cb(...a)), ...r); }; }
  scene.skipPointerMovePicking = true; scene.clearColor = new BABYLON.Color4(0.5, 0.6, 0.75, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_NONE;

  // ---------- look parameters (the debug panel edits these) ----------
  const PRESETS = {
    // Clear summer light from the Gardena / Torbole photo study; retain restrained saturation.
    summer: { fill: 1.45, penumbra: 0.04, sunAz: 252, sunEl: 32, haze: 0.7, fog: 0.0, fogBase: 1550, fogFalloff: 220, fogCol: [0.9, 0.94, 1.0], cloud: 0.22, exposure: 1.45, contrast: 1.04, saturation: 0.8, lut: 0.12, vignette: 0.6, bloom: 0.06, season: 0.22 },
    golden: { fill: 1.9, penumbra: 0.04, sunAz: 252, sunEl: 13, haze: 1.0, fog: 0.0, fogBase: 1550, fogFalloff: 220, fogCol: [1.0, 0.93, 0.85], cloud: 0.18, exposure: 1.7, contrast: 1.05, saturation: 0.8, lut: 0.35, vignette: 1.6, bloom: 0.12, season: 0.75 },
    overcast: { fill: 1.0, penumbra: 0.05, sunAz: 125, sunEl: 22, haze: 1.5, fog: 3.0, fogBase: 1950, fogFalloff: 160, fogCol: [0.9, 0.92, 0.95], cloud: 0.92, exposure: 1.9, contrast: 1.08, saturation: 0.95, lut: 0.35, vignette: 1.2, bloom: 0.05, season: 0.25 },
  };
  const P = Object.assign({}, PRESETS[QS.get('preset')] || PRESETS.summer);

  // ---------- atmosphere (CPU): sky LUT, sun colour, ambient cube; the shaders use the same coefficients for aerial perspective ----------
  const ATM = { R: 6360e3, Ra: 6420e3, bR: [5.802e-6, 13.558e-6, 33.1e-6], HR: 8000, bM0: 8e-6, HM: 1200, g: 0.78, E: 20 };
  const LUT_W = 128, LUT_H = 64;
  const sunVec = () => { const a = P.sunAz * Math.PI / 180, e = P.sunEl * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]; };
  const odToTop = (oy, dy, n, out) => {     // optical depth (rayleigh, mie) from radius oy along direction with vertical cosine dy; Infinity if the earth is in the way
    const b = oy * dy, c = oy * oy - ATM.Ra * ATM.Ra, tMax = -b + Math.sqrt(Math.max(0, b * b - c));
    if (dy < 0 && b * b - (oy * oy - ATM.R * ATM.R) > 0 && -b - Math.sqrt(b * b - (oy * oy - ATM.R * ATM.R)) > 0) { out[0] = out[1] = Infinity; return; }
    const seg = tMax / n; let r = 0, m = 0;
    for (let i = 0; i < n; i++) { const t = (i + 0.5) * seg, y = oy + t * dy, xh = t * Math.sqrt(Math.max(0, 1 - dy * dy)); const h = Math.hypot(xh, y) - ATM.R; r += Math.exp(-h / ATM.HR) * seg; m += Math.exp(-h / ATM.HM) * seg; }
    out[0] = r; out[1] = m;
  };
  const skyRadiance = (d, s, alt, bM, out) => {
    const oy = ATM.R + alt, b = oy * d[1];
    let tMax = -b + Math.sqrt(Math.max(0, b * b - (oy * oy - ATM.Ra * ATM.Ra)));
    const dg = b * b - (oy * oy - ATM.R * ATM.R); if (d[1] < 0 && dg > 0) tMax = Math.min(tMax, -b - Math.sqrt(dg));
    const n = 16, mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], g = ATM.g;
    const pR = 3 / (16 * Math.PI) * (1 + mu * mu), pM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
    let odR = 0, odM = 0; const sR = [0, 0, 0], sM = [0, 0, 0], tmp = [0, 0];
    // non-uniform steps: denser near the camera, where most of the visible haze is
    let tPrev = 0;
    for (let i = 0; i < n; i++) {
      const t1 = tMax * Math.pow((i + 1) / n, 2), seg = t1 - tPrev, t = (tPrev + t1) / 2; tPrev = t1;
      const px = d[0] * t, py = oy + d[1] * t, pz = d[2] * t, r = Math.hypot(px, py, pz), h = r - ATM.R;
      const hr = Math.exp(-h / ATM.HR) * seg, hm = Math.exp(-h / ATM.HM) * seg; odR += hr; odM += hm;
      const upx = px / r, upy = py / r, upz = pz / r, sdy = s[0] * upx + s[1] * upy + s[2] * upz;
      odToTop(r, sdy, 6, tmp); if (tmp[0] === Infinity) continue;
      for (let c = 0; c < 3; c++) { const a = Math.exp(-(ATM.bR[c] * (odR + tmp[0]) + bM * 1.11 * (odM + tmp[1]))); sR[c] += a * hr; sM[c] += a * hm; }
    }
    for (let c = 0; c < 3; c++) out[c] = ATM.E * (sR[c] * ATM.bR[c] * pR + sM[c] * bM * pM);
  };
  const lutData = new Float32Array(LUT_W * LUT_H * 4);
  const skyLUT = BABYLON.RawTexture.CreateRGBATexture(lutData, LUT_W, LUT_H, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE, BABYLON.Engine.TEXTURETYPE_FLOAT);
  skyLUT.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE; skyLUT.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  const lutDir = (u, v) => {     // must match skyDir() in GLSL
    const az = (u - 0.5) * 2 * Math.PI, sv = (v - 0.5) * 2, el = Math.sign(sv) * sv * sv * Math.PI / 2;
    return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  };
  const LIGHT = { sun: [1, 1, 1], amb: [], sunDir: [0, 1, 0] };
  const updateAtmosphere = () => {
    const s = sunVec(), alt = 2100, bM = ATM.bM0 * P.haze, c = [0, 0, 0];
    for (let j = 0; j < LUT_H; j++) for (let i = 0; i < LUT_W; i++) {
      const d = lutDir((i + 0.5) / LUT_W, (j + 0.5) / LUT_H);
      if (d[1] < 0.0) { d[1] = 0.0; }
      skyRadiance(d, s, alt, bM, c);
      const k = (j * LUT_W + i) * 4; lutData[k] = c[0]; lutData[k + 1] = c[1]; lutData[k + 2] = c[2]; lutData[k + 3] = 1;
    }
    skyLUT.update(lutData);
    // sun at the surface
    const od = [0, 0]; odToTop(ATM.R + alt, s[1], 24, od);
    const cl = 1 - 0.75 * Math.max(0, P.cloud - 0.45) / 0.55;      // overcast: the sun is mostly blocked
    LIGHT.sun = od[0] === Infinity ? [0, 0, 0] : ATM.bR.map((b) => ATM.E * Math.exp(-(b * od[0] + bM * 1.11 * od[1])) * cl);
    // limb softening: as the sun sinks below the horizon fade it smoothly
    const fadeSun = smooth(-0.6, 1.2, P.sunEl); LIGHT.sun = LIGHT.sun.map((v) => v * fadeSun);
    LIGHT.sunDir = s;
    // ambient cube: irradiance for the six axis normals from the LUT (sky above, ground bounce below)
    const ax = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], E = ax.map(() => [0, 0, 0]);
    let up = [0, 0, 0];
    for (let j = LUT_H / 2; j < LUT_H; j++) for (let i = 0; i < LUT_W; i += 2) {
      const v0 = (j - LUT_H / 2) / (LUT_H / 2), v1 = (j + 1 - LUT_H / 2) / (LUT_H / 2);
      const el0 = v0 * v0 * Math.PI / 2, el1 = v1 * v1 * Math.PI / 2, dOm = (Math.sin(el1) - Math.sin(el0)) * (4 * Math.PI / LUT_W);
      const d = lutDir((i + 0.5) / LUT_W, (j + 0.5) / LUT_H), k = (j * LUT_W + i) * 4;
      // cloud cover flattens the sky to a grey dome of similar brightness
      for (let a = 0; a < 6; a++) { const w = Math.max(0, d[0] * ax[a][0] + d[1] * ax[a][1] + d[2] * ax[a][2]) * dOm; for (let ch = 0; ch < 3; ch++) E[a][ch] += lutData[k + ch] * w; }
      for (let ch = 0; ch < 3; ch++) up[ch] += lutData[k + ch] * Math.max(0, d[1]) * dOm;
    }
    const groundAlb = [0.16, 0.17, 0.12], gE = [0, 1, 2].map((ch) => (up[ch] + LIGHT.sun[ch] * Math.max(0, s[1])) * groundAlb[ch] / Math.PI);
    // ground hemisphere: a down-facing normal sees the lit ground; side normals get half of it
    for (let a = 0; a < 6; a++) { const wDown = a === 3 ? 1 : a === 2 ? 0 : 0.5; for (let ch = 0; ch < 3; ch++) E[a][ch] += gE[ch] * Math.PI * wDown; }
    // overcast: mix towards a uniform grey irradiance
    const cloudy = smooth(0.3, 1.0, P.cloud), avg = [0, 1, 2].map((ch) => (up[ch] + LIGHT.sun[ch] * Math.max(0, s[1]) * (1 - cl)) * 0.9);
    for (let a = 0; a < 6; a++) for (let ch = 0; ch < 3; ch++) E[a][ch] = E[a][ch] * (1 - cloudy) + avg[ch] * (a === 3 ? 0.35 : a === 2 ? 1 : 0.7) * cloudy;
    LIGHT.amb = E;
    shadowDirty = true;
  };

  // ---------- shared GLSL ----------
  const GL_COMMON = `
precision highp float;
const float INV_S = ${INV_S.toFixed(6)};      // real metres per game metre (world scale)
uniform vec3 floatO;     // floating origin: Babylon's view-projection is relative to it
uniform vec3 camPos;
uniform vec3 sunDir; uniform vec3 sunCol;
uniform vec3 ambXp; uniform vec3 ambXn; uniform vec3 ambYp; uniform vec3 ambYn; uniform vec3 ambZp; uniform vec3 ambZn;
uniform sampler2D skyLUT;
uniform vec4 atm;      // haze mie scattering at sea level, y0 (altitude of local y = 0), fog density, time
uniform vec4 fogP;     // fog base altitude, fog falloff (m), cloud cover, season
uniform vec3 fogCol;
const float PI = 3.14159265;
const vec3 BR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
vec3 skyL(vec3 d) {
  float az = atan(d.z, d.x); float el = asin(clamp(d.y, -1.0, 1.0));
  float sv = sqrt(abs(el) / (PI * 0.5)) * sign(el);
  return textureLod(skyLUT, vec2(az / (2.0 * PI) + 0.5, 0.5 + 0.5 * sv), 0.0).rgb;     // explicit LOD: the azimuth wraps from 1 to 0 in one pixel, implicit derivatives drew a line down the sky there
}
vec3 ambient(vec3 n) {
  vec3 n2 = n * n;
  return n2.x * (n.x > 0.0 ? ambXp : ambXn) + n2.y * (n.y > 0.0 ? ambYp : ambYn) + n2.z * (n.z > 0.0 ? ambZp : ambZn);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
float fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
// micro-relief of the meadows near the camera (also displaces the mesh, so the shading normal is derived from this same function):
// tussocks and hummocks, plus terracettes - the stepped grazing paths that follow the contours on alpine pasture slopes
float microH(vec2 xz, float alt, float slope) {
  float meadow = 1.0 - smoothstep(0.3, 0.45, slope);
  float hum = (vnoise(xz * 0.45) - 0.5) * 0.36 + (vnoise(xz * 1.4 + 3.0) - 0.5) * 0.14;
  float band = smoothstep(0.04, 0.09, slope) * (1.0 - smoothstep(0.22, 0.32, slope)) * smoothstep(0.45, 0.6, vnoise(xz * 0.04));
  float terr = (abs(fract(alt / 0.85 + vnoise(xz * 0.12) * 1.5) - 0.5) * 2.0 - 0.5) * 0.26 * band;
  return (hum + terr) * meadow;
}
float expInt(float h0, float dy, float d, float H) {      // integral of exp(-h/H) along a straight ray of length d
  float x = dy * d / H;
  return exp(-h0 / H) * d * (abs(x) < 1e-3 ? 1.0 - 0.5 * x : (1.0 - exp(-x)) / x);
}
// fair-weather cumulus: one world-anchored layer at 3500 m real altitude, drifting with the wind. The sky dome draws it, and its
// shadow, projected along the sun, falls on everything (cloudShade): what is overhead and what shades the slopes agree.
const float CLOUD_Y = ${((3500 - Y0) * SCALE).toFixed(1)};
float cloudField(vec2 xz) {
  vec2 p = (xz + vec2(atm.w * 2.4, atm.w * 0.9)) / ${(1300 * SCALE).toFixed(1)};
  float n = vnoise(p) * 0.55 + vnoise(p * 2.3 + 7.1) * 0.3 + vnoise(p * 5.3 + 3.3) * 0.15;
  return smoothstep(1.0 - fogP.z * 1.35 - 0.06, 1.0 - fogP.z * 1.35 + 0.2, n);
}
const bool CLOUDS = ${!QS.has('noclouds')};      // &noclouds: compiled out (A/B timing)
uniform vec4 cloudT[10];      // the cumulus towers over the summits: centre x, z (drifting), radius, shadow strength
float cloudShade(vec3 p) {
  float t = (CLOUD_Y - p.y) / max(sunDir.y, 0.06);
  vec2 q = p.xz + sunDir.xz * t;
  float c = cloudField(q);
  for (int i = 0; i < 10; i++) { vec4 k = cloudT[i]; c = max(c, k.w * (1.0 - smoothstep(0.45, 1.0, length(q - k.xy) / max(k.z, 1.0)))); }
  return CLOUDS ? 1.0 - 0.7 * c : 1.0;
}
vec3 aerial(vec3 col, vec3 wpos) {
  vec3 v = wpos - camPos; float d = length(v); vec3 dir = v / max(d, 1e-3);
  d *= INV_S;      // the air between: the real distance
  float h0 = camPos.y * INV_S + atm.y;
  float odR = expInt(h0, dir.y, d, 8000.0), odM = expInt(h0, dir.y, d, 1200.0);
  vec3 tau = BR * odR + vec3(atm.x * 1.11 * odM);
  vec3 Ta = exp(-tau);
  vec3 sky = skyL(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z)));
  col = col * Ta + sky * (1.0 - Ta);
  // low cloud / valley fog: an exponential layer above fogBase, lit by the sky and a little sun
  float odF = expInt(h0 - fogP.x, dir.y, d, fogP.y) * atm.z * 1e-3;
  // patchy: the layer is thicker in some places than others (sampled near the point where the ray is closest to the fog base)
  float tF = clamp((fogP.x + fogP.y * 0.5 - h0) / (abs(dir.y) > 1e-3 ? dir.y : 1e-3), 0.0, d);
  vec3 pF = camPos + dir * (tF / INV_S);
  odF *= 0.25 + 1.5 * smoothstep(0.35, 0.75, fbm3(pF.xz * 0.0018 + atm.w * 0.002));
  float Tf = exp(-odF);
  float mu = dot(dir, sunDir);
  vec3 fl = fogCol * (ambYp * 0.9 / PI + sunCol * (0.08 + 0.25 * pow(max(mu, 0.0), 6.0)) * max(sunDir.y + 0.1, 0.0) * (1.0 - fogP.z * 0.7));
  return col * Tf + fl * (1.0 - Tf);
}
`;
  // level lookup, generated for however many levels the world has: heights (manual bilinear from an R32F array), normals,
  // detail maps (A: scree, outcrop, gully, canopy; B: road distance, vineyard, orchard/olive, urban) and one shadow texture per level
  const GL_LEVELS = `
uniform highp usampler2DArray hArr;      // 16-bit height codes (R16UI), decoded per level by lvHf
uniform float lvHf[${NL * 2}];
float hTex(ivec3 p) { return lvHf[p.z * 2] + lvHf[p.z * 2 + 1] * float(texelFetch(hArr, p, 0).r); }
uniform float lvDf[${NL * 4}];          // per level: centre x, centre z, half extent, texel size (floats: settable from ProceduralTexture too)
uniform float patchCf[${PATCH_C.length * 3}];     // per patch: centre x, z, vertical offset
vec4 LVD(int i) { return vec4(lvDf[i * 4], lvDf[i * 4 + 1], lvDf[i * 4 + 2], lvDf[i * 4 + 3]); }
vec3 PATCHC(int i) { return vec3(patchCf[i * 3], patchCf[i * 3 + 1], patchCf[i * 3 + 2]); }
const int NL = ${NL}, FAR_I = ${FAR_I}, MID_I = ${MID_I};
float lvW(int i, vec2 xz) {
  if (i == FAR_I) return 1.0;
  vec4 L = LVD(i); float m = max(abs(xz.x - L.x), abs(xz.y - L.y));
  float edge = 2.0 * L.w, fade = max(250.0, 40.0 * L.w);
  return 1.0 - smoothstep(L.z - edge - fade, L.z - edge, m);
}
vec2 lvUV(int i, vec2 xz) { vec4 L = LVD(i); return vec2(xz.x - (L.x - L.z), (L.y + L.z) - xz.y) / (2.0 * L.z); }
float hFetchL(int i, vec2 xz) {
  vec4 L = LVD(i);
  vec2 g = vec2(xz.x - (L.x - L.z), (L.y + L.z) - xz.y) / L.w - 0.5;
  vec2 f = fract(g); ivec2 c = ivec2(floor(g));
  ivec2 c0 = clamp(c, ivec2(0), ivec2(${N - 1})), c1 = clamp(c + 1, ivec2(0), ivec2(${N - 1}));
  float a = hTex(ivec3(c0, i)), b = hTex(ivec3(c1.x, c0.y, i)), cc = hTex(ivec3(c0.x, c1.y, i)), d = hTex(ivec3(c1, i));
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}
int baseLevel(vec2 xz) { for (int i = 0; i < NL; i++) if (lvW(i, xz) >= 1.0) return i; return FAR_I; }
float heightAt(vec2 xz) {
  int b = baseLevel(xz); float h = hFetchL(b, xz);
  for (int i = NL - 1; i >= 0; i--) { if (i >= b) continue; float w = lvW(i, xz); if (w > 0.0) h = mix(h, hFetchL(i, xz), w); }
  return h;
}
// weight of the fine (<= 4 m) levels at a point: where instanced detail (trees, rocks, grass) exists
float fineW(vec2 xz) { float w = 0.0; for (int i = 0; i < NL; i++) if (LVD(i).w <= 4.0) w = max(w, lvW(i, xz)); return w; }
// share of one patch at a point (soft: the regions blend over a few km)
float patchW(vec2 xz, int k) { float ws = 0.0, o = 0.0; for (int i = 0; i < ${PATCH_C.length}; i++) { float w = exp(-distance(xz, PATCHC(i).xy) / 800.0); ws += w; if (i == k) o = w; } return o / max(ws, 1e-6); }
float patchOffset(vec2 xz) { float ws = 0.0, o = 0.0; for (int i = 0; i < ${PATCH_C.length}; i++) { vec3 pc = PATCHC(i); float w = exp(-distance(xz, pc.xy) / 1200.0); ws += w; o += w * pc.z; } return o / max(ws, 1e-6); }
`;
  const GL_DETAIL = `
uniform highp sampler2DArray nArr; uniform highp sampler2DArray aArr; uniform highp sampler2DArray bArr;
// level weights for the current point, computed once and reused; loops unrolled at build time (constant indices:
// dynamic indexing into local arrays and samplers is slow on many GPUs). Coarsest first, finer levels blended over it.
${LVL.map((L) => `float cW${L.i};`).join(' ')}
void levelSetup(vec2 xz) { ${LVL.map((L) => `cW${L.i} = lvW(${L.i}, xz);`).join(' ')} }
${['nArr', 'aArr', 'bArr'].map((t) => {
    const last = t === 'nArr' ? FAR_I : FAR_I - 1;
    const T = (i) => `texture(${t}, vec3(lvUV(${i}, xz), ${i}.0))`;
    // base = finest level covering the point fully (one fetch in the common case), then finer partial levels blended over it
    let body = `if (cW0 >= 1.0) return ${T(0)}; vec4 v; int b;`;
    for (let i = 1; i <= last; i++) body += ` ${i > 1 ? 'else ' : ''}if (${i === last ? 'true' : `cW${i} >= 1.0`}) { v = ${T(i)}; b = ${i}; }`;
    for (let i = last - 1; i >= 0; i--) body += ` if (${i} < b && cW${i} > 0.0) v = mix(v, ${T(i)}, cW${i});`;
    return `vec4 chain_${t}(vec2 xz) { ${body} return v; }`;
  }).join('\n')}
vec4 nrmData(vec2 xz) { return chain_nArr(xz); }
vec4 detailA(vec2 xz) { return chain_aArr(xz); }
vec4 detailB(vec2 xz) { return chain_bArr(xz); }
`;
  const GL_SHADOWED = `
${LVL.map((L) => `uniform sampler2D s${L.i};`).join(' ')}
float shadowL(int i, vec2 uv) { ${LVL.map((L) => `if (i == ${L.i}) return texture2D(s${L.i}, uv).r;`).join(' ')} return 1.0; }
float sunShadow(vec2 xz) {
  int b = baseLevel(xz); float s = shadowL(b, lvUV(b, xz));
  for (int i = NL - 1; i >= 0; i--) { if (i >= b) continue; float w = lvW(i, xz); if (w > 0.0) s = mix(s, shadowL(i, lvUV(i, xz)), w); }
  return s;
}
`;
  const LEVEL_UNIFORMS = ['lvDf', 'lvHf', 'patchCf'], LEVEL_SAMPLERS = ['hArr', ...LVL.map((L) => 's' + L.i)];

  // ---------- the car on the ground: a sun-projected mask of a low-poly stand-in (soft, follows the car) and an analytic contact shadow ----------
  const GL_CAR = `
uniform sampler2D carMask; uniform mat4 carShadowM; uniform vec4 carP; uniform vec4 carF;
float carSunShadow(vec3 p) {
  if (carP.w < 0.5 || distance(p.xz, carP.xz) > 10.0) return 1.0;
  vec4 q = carShadowM * vec4(p, 1.0); vec2 uv = q.xy / q.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture2D(carMask, uv + vec2(float(i), float(j)) * (1.6 / ${Q.carMask.toFixed(1)})).r;
  return 1.0 - s / 9.0 * 0.9;
}
float carAO(vec3 p) {
  if (carP.w < 0.5) return 1.0;
  vec2 d = p.xz - carP.xz, f = carF.xy, r = vec2(f.y, -f.x);
  vec2 l = vec2(dot(d, r), dot(d, f));
  vec2 q = abs(l) - vec2(carF.z, carF.w);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float h = max(p.y - carP.y, 0.0);
  return 1.0 - 0.72 * (1.0 - smoothstep(-0.35, 0.8, sd)) * (1.0 - smoothstep(0.0, 0.7, h));
}
`;
  const shadowCam = new BABYLON.FreeCamera('carShadowCam', new V3(0, 50, 0), scene);
  shadowCam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA; shadowCam.orthoLeft = -7; shadowCam.orthoRight = 7; shadowCam.orthoTop = 7; shadowCam.orthoBottom = -7;
  shadowCam.minZ = 1; shadowCam.maxZ = 120; shadowCam.layerMask = 0x20000000;
  const carMaskRT = new BABYLON.RenderTargetTexture('carMask', Q.carMask, scene, false);
  carMaskRT.activeCamera = shadowCam; carMaskRT.clearColor = new BABYLON.Color4(0, 0, 0, 1); carMaskRT.refreshRate = 1;
  scene.customRenderTargets.push(carMaskRT);
  const carState = { on: 0, pos: V3.Zero(), fwd: new V3(0, 0, 1), halfW: 0.85, halfL: 2.0, M: BABYLON.Matrix.Identity() };
  const bindCar = (m) => { m.setTexture('carMask', carMaskRT); m.setMatrix('carShadowM', carState.M); m.setVector4('carP', new BABYLON.Vector4(carState.pos.x, carState.pos.y, carState.pos.z, carState.on)); m.setVector4('carF', new BABYLON.Vector4(carState.fwd.x, carState.fwd.z, carState.halfW, carState.halfL)); };

  // ---------- terrain textures: every level packed into texture arrays ----------
  // one image at a time, and the bitmap and canvas freed at once: decoding all ~26 maps in parallel (bitmap + 2048² canvas +
  // pixel copy each) made a ~1.9 GB peak while loading, enough to crash phone tabs (2026-10-19)
  const imgBytes = async (p) => {
    const bmp = await createImageBitmap(await (await fetch(assetUrl(p))).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    bmp.close(); cv.width = cv.height = 0; return d;
  };
  // GPU arrays are built in a block so the staging copies (300+ MB) are freed after upload (the engine keeps no copies either)
  let hArr, nArr, aArr, bArr;
  // CPU detail lookups need three answers only: one byte per texel, bit 0 open ground for grass (no canopy, scree, outcrop, town,
  // vines or orchards), bit 1 vineyard, bit 2 orchard/olive. 4 MB per detail level instead of two 16 MB copies.
  const DETAIL_F = {};
  {
    // no mipmaps: Babylon does not build them for raw 2D arrays, and sampling missing levels returned garbage at distance
    const mkArr = (d) => { const t = new BABYLON.RawTexture2DArray(d, N, N, NL, BABYLON.Engine.TEXTUREFORMAT_RGBA, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE); t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE; return t; };
    // one staging array at a time (each ~100 MB), dropped right after its upload
    let hData = new Uint16Array(N * N * NL); LV.forEach((k, i) => hData.set(HT[k], i * N * N));
    hArr = new BABYLON.RawTexture2DArray(hData, N, N, NL, BABYLON.Engine.TEXTUREFORMAT_RED_INTEGER, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE, BABYLON.Engine.TEXTURETYPE_UNSIGNED_SHORT);
    hData = null;
    let nData = new Uint8Array(N * N * 4 * NL);
    for (const L of LVL) nData.set(await imgBytes(MAP + L.name + '_n.png'), L.i * N * N * 4);
    nArr = mkArr(nData); nData = null; mark('normal maps uploaded');
    let aData = new Uint8Array(N * N * 4 * NL), bData = new Uint8Array(N * N * 4 * NL);
    for (const L of LVL) {
      const o = L.i * N * N * 4;
      if (L.detail) {
        const m = await imgBytes(MAP + L.name + '_m.png'), c = await imgBytes(MAP + L.name + '_c.png'), r = await imgBytes(MAP + L.name + '_r.png'), lu = await imgBytes(MAP + L.name + '_l.png');
        const F = new Uint8Array(N * N);
        for (let p = 0; p < N * N; p++) { const q = p * 4;
          aData[o + q] = m[q]; aData[o + q + 1] = m[q + 1]; aData[o + q + 2] = m[q + 2]; aData[o + q + 3] = c[q];
          bData[o + q] = r[q]; bData[o + q + 1] = lu[q]; bData[o + q + 2] = lu[q + 1]; bData[o + q + 3] = lu[q + 2];
          const scree = m[q], outcrop = m[q + 1], canopy = c[q], vine = lu[q], orchard = lu[q + 1], urban = lu[q + 2];
          F[p] = (canopy < 8 && scree < 90 && outcrop < 170 && urban < 60 && vine < 60 && orchard < 60 ? 1 : 0) | (vine >= 140 ? 2 : 0) | (orchard >= 140 ? 4 : 0); }
        DETAIL_F[L.name] = F;
      }
    }
    aArr = mkArr(aData); aData = null; bArr = mkArr(bData); bData = null; mark('detail maps uploaded');
  }
  const lvHArr = LVL.flatMap((L) => [L.offset, L.scale]);
  const lvDArr = LVL.flatMap((L) => [L.cx, L.cz, L.half, L.res]), patchCArr = PATCH_C.flat();
  // CPU lookup of the detail maps at a world point (finest covering detail level)
  const detailAt = (x, z) => {
    for (const L of LVL) { if (!L.detail || levelWeight(L, x, z) < 0.5) continue;
      const c = Math.max(0, Math.min(N - 1, Math.floor((x - (L.cx - L.half)) / L.res))), r = Math.max(0, Math.min(N - 1, Math.floor(((L.cz + L.half) - z) / L.res))), f = DETAIL_F[L.name][r * N + c];
      return { open: (f & 1) > 0, vine: (f & 2) > 0, orchard: (f & 4) > 0 }; }
    return null;
  };
  // ---------- detail texture arrays (CC0 scans, packed by tools/terrain/pack_textures.py) ----------
  const TEX_INFO = await getJSON('textures/terrain/terrain_layers.json');
  const loadStrip = async (p) => {
    const blob = await (await fetch(assetUrl(p))).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = new Uint8Array(cx.getImageData(0, 0, bmp.width, bmp.height).data.buffer); bmp.close(); cv.width = cv.height = 0; return d;
  };
  const texArr = {};
  {
    const S = TEX_INFO.size, NL = TEX_INFO.layers.length;
    for (const [k, src] of [['alb', 'textures/terrain/albedo.jpg'], ['nh', 'textures/terrain/nh.jpg']]) {      // one after the other (100 MB each)
      const t = new BABYLON.RawTexture2DArray(await loadStrip(src), S, S, NL, BABYLON.Engine.TEXTUREFORMAT_RGBA, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
      t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = Q.photoAniso; texArr[k] = t;      // 8x cost 10-15 % of the GPU frame for no visible difference over 4x (tools/gpu_profile.js, 2026-10-16)
    }
  }


  // ---------- sun shadows on the terrain: one GPU pass per level whenever the sun moves ----------
  BABYLON.Effect.ShadersStore.terrainShadowPixelShader = GL_COMMON.replace('precision highp float;', 'precision highp float;\nvarying vec2 vUV;') + GL_LEVELS + `
uniform vec4 thisL; uniform float pen; uniform float cheap;
void main() {
  vec2 xz = vec2(thisL.x - thisL.z + vUV.x * 2.0 * thisL.z, thisL.y + thisL.z - vUV.y * 2.0 * thisL.z);
  float h0 = heightAt(xz) + 1.5;
  vec2 sd = normalize(sunDir.xz + 1e-5); float tanE = sunDir.y / max(length(sunDir.xz), 1e-4);
  float t = max(thisL.w * 0.75, 1.5), occ = -1e9;
  // cheap: a quick first fill (14 coarse steps) so the texture is never garbage while the full tiles come in
  int n = cheap > 0.5 ? 14 : 72; float grow = cheap > 0.5 ? 1.9 : 1.13;
  for (int i = 0; i < 72; i++) {
    if (i >= n) break;
    vec2 q = xz + sd * t;
    // full level blend only near the texel; further out one coarse level (4 fetches) is enough for a ridge's shadow
    float hq = (t < 600.0 && cheap < 0.5) ? heightAt(q) : hFetchL(lvW(MID_I, q) >= 1.0 ? MID_I : FAR_I, q);
    occ = max(occ, (hq - h0) / t);
    if (occ > tanE + pen) break;      // already fully shadowed
    t *= grow;
    if (t > 26000.0) break;
  }
  // sun disc ~0.53 deg plus a little extra softness for scattering in the air
  float s = smoothstep(-pen, pen, tanE - occ);
  gl_FragColor = vec4(s, s, s, 1.0);
}`;
  const shadowTex = {};
  for (const L of LVL) {
    const size = L.i === 0 ? Q.shadowNear : L.res <= 4 ? 2048 : 1024;
    const pt = new BABYLON.ProceduralTexture('shadow_' + L.name, size, 'terrainShadow', scene, null, false, false);
    pt.refreshRate = 0; pt.wrapU = pt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    pt.setTexture('hArr', hArr); pt.setFloats('lvDf', lvDArr); pt.setFloats('lvHf', lvHArr); pt.setFloats('patchCf', patchCArr);
    pt.setVector4('thisL', new BABYLON.Vector4(L.cx, L.cz, L.half, L.res)); pt.setTexture('skyLUT', skyLUT); pt.setVector3('sunDir', new V3(0, 1, 0)); pt.setFloat('pen', 0.02); pt.setFloat('cheap', 1);   // every uniform must be set before the effect compiles
    pt.isEnabled = false; pt.autoClear = false; pt.size_ = size;
    // a tile, when set, limits the pass to that rectangle (GL scissor); off again right after
    pt.onBeforeGenerationObservable.add(() => { const tl = pt.tile_; if (!tl) return; const gl = engine._gl; gl.enable(gl.SCISSOR_TEST); gl.scissor(tl[0], tl[1], tl[2], tl[3]); });
    pt.onGeneratedObservable.add(() => { const gl = engine._gl; gl.disable(gl.SCISSOR_TEST); pt.isEnabled = false; });
    shadowTex[L.name] = pt;
  }
  // terrain shadows are rendered in pieces: one cheap full-texture pass per level, then 256 px tiles at full quality,
  // a pixel budget per frame. No single GPU submission is ever a whole 2048 px ray-march (that stalled the GPU for seconds).
  const SHADOW_TILE = 256, SHADOW_BUDGET = QS.has('shadowbudget') ? +QS.get('shadowbudget') : 2 * 256 * 256;
  let shadowDirty = true, shadowJobs = [];
  const refreshShadows = () => {
    const s = LIGHT.sunDir; shadowJobs = [];
    if (QS.has('shadowold')) {      // comparison only: every level at full quality in one frame, as before
      for (const k of LV) { shadowTex[k].setVector3('sunDir', new V3(s[0], s[1], s[2])); shadowTex[k].setFloat('pen', P.penumbra); shadowJobs.push({ k, tile: null, cheap: 0, px: 0 }); }
      shadowDirty = false; return;
    }
    for (const k of LV) { shadowTex[k].setVector3('sunDir', new V3(s[0], s[1], s[2])); shadowTex[k].setFloat('pen', P.penumbra); shadowJobs.push({ k, tile: null, cheap: 1, px: (shadowTex[k].size_ * shadowTex[k].size_) / 16 }); }
    for (const k of LV) { const n = shadowTex[k].size_; for (let y = 0; y < n; y += SHADOW_TILE) for (let x = 0; x < n; x += SHADOW_TILE) shadowJobs.push({ k, tile: [x, y, Math.min(SHADOW_TILE, n - x), Math.min(SHADOW_TILE, n - y)], cheap: 0, px: SHADOW_TILE * SHADOW_TILE }); }
    shadowDirty = false;
  };
  // one job per texture per frame (a procedural texture renders once per frame), within the pixel budget
  window.__shadowJobs = () => shadowJobs.length;
  const shadowStep = () => {
    let used = 0; const busy = new Set();
    for (let i = 0; i < shadowJobs.length && used < SHADOW_BUDGET; ) {
      const j = shadowJobs[i];
      if (busy.has(j.k)) { i++; continue; }
      const pt = shadowTex[j.k]; pt.tile_ = j.tile; pt.setFloat('cheap', j.cheap); pt.isEnabled = true; pt.resetRefreshCounter();
      busy.add(j.k); used += j.px; shadowJobs.splice(i, 1);
    }
  };

  // ---------- terrain mesh: CDLOD ----------
  const GRID = 32;
  const grid = new BABYLON.Mesh('terrain', scene);
  {
    const pos = [], idx = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) pos.push(i / GRID, 0, j / GRID);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1;
      // alternate the diagonal so the mesh has no directional bias
      if ((i + j) % 2) idx.push(a, b, c, b, d, c); else idx.push(a, d, c, a, b, d);
    }
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.applyToMesh(grid);
  }
  grid.alwaysSelectAsActiveMesh = true; grid.isPickable = false; grid.doNotSyncBoundingInfo = true;
  const LEAF = 32, ROOT = LVL[FAR_I].extent, ROOT_X = LVL[FAR_I].cx - ROOT / 2, ROOT_Z = LVL[FAR_I].cz - ROOT / 2, NLOD = Math.round(Math.log2(ROOT / LEAF)) + 1;     // 32 m leaves: 1 m cells near the camera
  const RANGE0 = +(QS.get('lodr') || Q.lodR);
  const ranges = []; for (let i = 0; i < NLOD; i++) ranges.push(RANGE0 * Math.pow(2, i - 1));     // RANGE0 stays the reach of 2 m cells
  const morphK = []; for (let i = 0; i < NLOD; i++) { const end = ranges[i], start = end * 0.72; morphK.push(start, 1 / (end - start), 0, 0); }
  // rock LOD bias (2026-10-17): a heightfield wall gets few vertices for its height (a 4 m cell on an 80 degree wall spans 23 m
  // of rock), so steep rock is selected and morphed as if ROCK_B times closer. The bias comes from a 32 m grid of steepness over
  // the two 2 m levels (an R8 texture the vertex shader samples bilinearly); selection uses a max pyramid of the same bytes,
  // an upper bound of the shader's value over each node, so a coarse node's edge is always fully morphed next to a finer one
  // (no cracks). &rockb=0 turns it off.
  const ROCK_B = Math.max(0, +(QS.get('rockb') ?? Q.rockB ?? 2));
  const RG_T0 = performance.now(); let rockBV = ROCK_B;
  const RG = (() => {
    const C = 32, src = LVL.filter((L) => L.res <= 2);
    if (!src.length || ROCK_B === 0) return null;
    const x0 = Math.min(...src.map((L) => L.cx - L.half)) - C, z0 = Math.min(...src.map((L) => L.cz - L.half)) - C;
    const x1 = Math.max(...src.map((L) => L.cx + L.half)) + C, z1 = Math.max(...src.map((L) => L.cz + L.half)) + C;
    let N = 1; while (N * C < Math.max(x1 - x0, z1 - z0)) N *= 2;
    const S8 = 8, n8 = N * C / S8, H = new Float32Array((n8 + 1) * (n8 + 1));
    for (let j = 0; j <= n8; j++) for (let i = 0; i <= n8; i++) H[j * (n8 + 1) + i] = terrainH(x0 + i * S8, z0 + j * S8);
    const raw = new Float32Array(N * N), k = C / S8;
    for (let j = 1; j < n8; j++) for (let i = 1; i < n8; i++) {
      const o = j * (n8 + 1) + i, gx = (H[o + 1] - H[o - 1]) / (2 * S8), gz = (H[o + n8 + 1] - H[o - n8 - 1]) / (2 * S8);
      const s = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz), v = Math.min(1, Math.max(0, (s - 0.25) / 0.2));      // 41 to 55 degrees
      const c = ((j / k) | 0) * N + ((i / k) | 0); if (v > raw[c]) raw[c] = v;
    }
    const out = new Uint8Array(N * N);      // widen by one cell (max), then a 3x3 blur: the bias rises before the wall, not on it
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      let acc = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { let m = 0; for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) { const jj = j + b + d, ii = i + a + e; if (jj >= 0 && jj < N && ii >= 0 && ii < N) m = Math.max(m, raw[jj * N + ii]); } acc += m; }
      out[j * N + i] = Math.round(acc / 9 * 255);
    }
    const pyr = [out]; for (let n = N; n > 1; n >>= 1) { const a = pyr[pyr.length - 1], h = n >> 1, b = new Uint8Array(h * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < h; i++) b[j * h + i] = Math.max(a[2 * j * n + 2 * i], a[2 * j * n + 2 * i + 1], a[(2 * j + 1) * n + 2 * i], a[(2 * j + 1) * n + 2 * i + 1]); pyr.push(b); }
    const tex = new BABYLON.RawTexture(out, N, N, BABYLON.Constants.TEXTUREFORMAT_RED, scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE);
    tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    // the largest bias any point of the box [bx0, bx1] x [bz0, bz1] can get (bilinear support: one cell around)
    const bmax = (bx0, bz0, bx1, bz1) => {
      const i0 = Math.floor((bx0 - x0) / C - 1), i1 = Math.floor((bx1 - x0) / C + 1), j0 = Math.floor((bz0 - z0) / C - 1), j1 = Math.floor((bz1 - z0) / C + 1);
      if (i1 < 0 || j1 < 0 || i0 >= N || j0 >= N) return 1;
      let p = 0; while ((Math.max(i1 - i0, j1 - j0) >> p) > 2) p++;
      const a = pyr[p], n = N >> p; let m = 0;
      for (let j = Math.max(0, j0 >> p); j <= Math.min(n - 1, j1 >> p); j++) for (let i = Math.max(0, i0 >> p); i <= Math.min(n - 1, i1 >> p); i++) m = Math.max(m, a[j * n + i]);
      return 1 + rockBV * m / 255;
    };
    return { x0, z0, N, C, out, size: N * C, tex, bmax, cells: out.reduce((s, v) => s + (v > 0), 0), ms: performance.now() - RG_T0 };
  })();
  const rockBias = RG ? RG.bmax : () => 1;
  let nodeBuf = new Float32Array(16 * 2048), nodeCount = 0;
  const addNode = (x0, z0, size) => {
    if (nodeCount * 16 >= nodeBuf.length) { const nb = new Float32Array(nodeBuf.length * 2); nb.set(nodeBuf); nodeBuf = nb; }
    const o = nodeCount * 16, lod = Math.round(Math.log2(size / LEAF));
    nodeBuf.fill(0, o, o + 16); nodeBuf[o] = size; nodeBuf[o + 3] = lod; nodeBuf[o + 5] = 1; nodeBuf[o + 10] = size; nodeBuf[o + 12] = x0; nodeBuf[o + 14] = z0; nodeBuf[o + 15] = 1;
    nodeCount++;
  };
  const boxDist = (x0, z0, size, cx, cz) => { const dx = Math.max(x0 - cx, 0, cx - (x0 + size)), dz = Math.max(z0 - cz, 0, cz - (z0 + size)); return Math.hypot(dx, dz); };
  let camFwd = [0, 1];
  const visible = (x0, z0, size, cx, cz) => {     // cheap 2D cull: drop nodes entirely behind the camera
    const r = size * 0.7072, mx = x0 + size / 2 - cx, mz = z0 + size / 2 - cz;
    return mx * camFwd[0] + mz * camFwd[1] > -r - 30;
  };
  const select = (x0, z0, size, lod, cx, cz) => {
    const d = boxDist(x0, z0, size, cx, cz) / rockBias(x0, z0, x0 + size, z0 + size);
    if (d > ranges[lod]) return false;
    if (!visible(x0, z0, size, cx, cz)) return true;
    if (lod === 0 || d > ranges[lod - 1]) { addNode(x0, z0, size); return true; }
    const h = size / 2;
    for (const [ox, oz] of [[0, 0], [h, 0], [0, h], [h, h]]) if (!select(x0 + ox, z0 + oz, h, lod - 1, cx, cz)) { if (visible(x0 + ox, z0 + oz, h, cx, cz)) addNode(x0 + ox, z0 + oz, h); }
    return true;
  };
  let lastSel = null;
  const updateTerrain = (cam) => {
    const p = cam.position, f = cam.getDirection(V3.Forward()), fl = Math.hypot(f.x, f.z) || 1;
    const key = [Math.round(p.x), Math.round(p.z), Math.round(f.x / fl * 20), Math.round(f.z / fl * 20)].join(',');
    if (key === lastSel) return; lastSel = key;
    camFwd = [f.x / fl, f.z / fl];
    if (Math.abs(f.y) > 0.8) camFwd = [0, 0];     // looking straight down: keep everything
    nodeCount = 0;
    const hfAbove = Math.max(0, p.y - terrainH(p.x, p.z));
    // height above ground counts towards the distance (CDLOD measures in 3D; we keep 2D selection and fold the height in)
    const cx = p.x, cz = p.z;
    select(ROOT_X, ROOT_Z, ROOT, NLOD - 1, cx, cz);
    grid.thinInstanceSetBuffer('matrix', nodeBuf.subarray(0, nodeCount * 16), 16, false);
    void hfAbove;
  };

  BABYLON.Effect.ShadersStore.terrainVertexShader = GL_COMMON + GL_LEVELS + GL_DETAIL + `
attribute vec3 position;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);     // compiled without instances: draw nothing
#endif
uniform mat4 viewProjection;
uniform vec4 morphK[${NLOD}];
uniform sampler2D rockLod; uniform vec4 rockG;     // rock LOD bias: grid origin xz, 1/size, ROCK_B
varying vec3 vPos;
float rockB(vec2 p) { return 1.0 + rockG.w * textureLod(rockLod, (p - rockG.xy) * rockG.z, 0.0).r; }
void main() {
  float size = world0.x; int lod = int(world0.w + 0.5); vec2 org = world3.xz;
  vec2 gp = position.xz;
  vec2 wp = org + gp * size;
  vec4 mk = morphK[lod];
  float m = clamp((distance(wp, camPos.xz) / rockB(wp) - mk.x) * mk.y, 0.0, 1.0);
  wp -= fract(gp * ${GRID / 2}.0) * (2.0 / ${GRID}.0) * size * m;
  float h = heightAt(wp);
  // carve the walls: the 2.5 m survey rounds them into domes; on steep rock push the surface in and out sideways
  // into vertical pillars, gullies and blocky offsets (a function of world position, so LODs and morphing agree)
  float dCam = distance(wp, camPos.xz);
  vec4 nd = textureLod(nArr, vec3(lvUV(MID_I, wp), float(MID_I)), 0.0);     // 16 m slope: big walls only, never small road banks
  levelSetup(wp); float roadD = detailB(wp).r * 25.5;
  vec2 nxz = nd.rg * 2.0 - 1.0; float slope = 1.0 - sqrt(max(0.0, 1.0 - dot(nxz, nxz)));
  float rockW = ${QS.has('nocarve') ? '0.0 *' : ''} smoothstep(0.36, 0.58, slope) * (1.0 - smoothstep(2500.0, 4500.0, dCam));
  // not on road cuts and banks: only walls well away from the road, and fully only on big walls (low sky visibility = deep in rock)
  if (rockW > 0.0) rockW *= smoothstep(12.0, 25.0, roadD);
  rockW *= smoothstep(0.85, 0.6, nd.b) * 0.7 + 0.3 * smoothstep(0.5, 0.7, slope);
  if (rockW > 0.0) {
    vec2 hn = normalize(nxz + 1e-5), t = vec2(-hn.y, hn.x);
    float along = dot(wp, t), alt = h * INV_S + atm.y;
    float r1 = 1.0 - abs(2.0 * vnoise(vec2(along / 24.0, alt / 110.0)) - 1.0);
    float r2 = 1.0 - abs(2.0 * vnoise(vec2(along / 9.0 + 3.1, alt / 38.0)) - 1.0);
    float blocky = floor(vnoise(vec2(along / 14.0 + 7.0, alt / 90.0)) * 3.0) / 3.0;     // blocks are tall: steps run up the wall, not across it
    // detail the mesh can carry: each band only where cells are well below its wavelength (else it aliases into spikes). The cell
    // size is estimated from the biased distance, a smooth function of position, so neighbouring nodes carve the same (no cracks)
    float cell = max(1.0, 2.5 * dCam / rockB(wp) / ${(RANGE0).toFixed(1)});
    float k1 = 1.0 - smoothstep(3.0, 6.0, cell), k2 = 1.0 - smoothstep(1.0, 2.5, cell), k3 = 1.0 - smoothstep(1.0, 1.7, cell);
    // fine rock: vertical flutes and cracks (joints run up the wall), and bedding ledges every ~14 m of real height, where
    // the face creeps out up each bed and steps back at its top
    float r3 = 1.0 - abs(2.0 * vnoise(vec2(along / 4.2 + 11.0, alt / 30.0)) - 1.0);
    float crack = smoothstep(0.82, 0.97, vnoise(vec2(along / 7.0 + 5.0, alt / 60.0)));
    float bed = fract(alt / 14.0 + 0.35 * vnoise(vec2(along / 70.0, alt / 200.0)));
    float k2l = 1.0 - smoothstep(1.5, 3.0, cell);
    wp += hn * rockW * (k1 * (5.5 * r1 - 4.0 + 2.5 * blocky - 1.25) + k2 * (2.2 * r2 - 1.1) + k2l * (1.6 * bed - 0.8) + k3 * (1.1 * r3 - 0.55 - 1.4 * crack));
  }
  float mfade = 1.0 - smoothstep(90.0, 140.0, dCam);
  if (mfade > 0.0) mfade *= smoothstep(5.8, 8.6, roadD) * fineW(wp);
  if (mfade > 0.0) h += microH(wp, h * INV_S + atm.y, slope) * mfade;
  vPos = vec3(wp.x, h, wp.y);
  gl_Position = viewProjection * vec4(vPos - floatO, 1.0);
}`;
  BABYLON.Effect.ShadersStore.terrainFragmentShader = GL_COMMON + GL_LEVELS + GL_DETAIL + GL_SHADOWED + GL_CAR + GL_PORTALS + `
// baked noise (tools/terrain/make_noise.py): same distributions as the hash versions, a texture fetch each
uniform sampler2D noiseTex;
float tfbm(vec2 p) { return texture2D(noiseTex, p * (1.0 / 64.0)).r; }
float tfbm3(vec2 p) { return texture2D(noiseTex, p * (1.0 / 64.0)).g; }
float tvn(vec2 p) { return texture2D(noiseTex, p * (1.0 / 64.0)).b; }
#define fbm tfbm
#define fbm3 tfbm3
#define vnoise tvn
uniform highp sampler2DArray texAlb; uniform highp sampler2DArray texNH;
uniform vec3 layerTint[6]; uniform vec3 layerGain[6]; uniform vec3 layerMean[6]; uniform float layerScale[6]; uniform float layerBump[6];
float sunShadowC(vec2 xz) {     // terrain shadow with the precomputed level weights, unrolled
  if (cW0 >= 1.0) return texture2D(s0, lvUV(0, xz)).r;
  float s; int b;
  ${LVL.slice(1).map((L) => `${L.i > 1 ? 'else ' : ''}if (${L.i === FAR_I ? 'true' : `cW${L.i} >= 1.0`}) { s = texture2D(s${L.i}, lvUV(${L.i}, xz)).r; b = ${L.i}; }`).join(' ')}
  ${LVL.slice(0, FAR_I).reverse().map((L) => `if (${L.i} < b && cW${L.i} > 0.0) s = mix(s, texture2D(s${L.i}, lvUV(${L.i}, xz)).r, cW${L.i});`).join('\n  ')}
  return s;
}
uniform float waterY; uniform vec4 lakeBox; const bool SHORE_OFF = ${QS.has('noshore')};
varying vec3 vPos;
// repetition-free sampling (after I. Quilez, "texture repetition", technique 3): a low-frequency noise picks one of 8 offsets per patch
// and neighbouring patches are blended, so the same tile never lines up twice
void noTile(vec2 uv, float layer, out vec3 a, out vec3 b) {
  float k = vnoise(uv * 0.13);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float l = k * 8.0, f = fract(l), ia = floor(l), ib = ia + 1.0;
  vec2 oa = sin(vec2(3.0, 7.0) * ia), ob = sin(vec2(3.0, 7.0) * ib);
  vec3 a1 = textureGrad(texAlb, vec3(uv + oa, layer), dx, dy).rgb, a2 = textureGrad(texAlb, vec3(uv + ob, layer), dx, dy).rgb;
  vec3 b1 = textureGrad(texNH, vec3(uv + oa, layer), dx, dy).rgb, b2 = textureGrad(texNH, vec3(uv + ob, layer), dx, dy).rgb;
  float t = smoothstep(0.2, 0.8, f - 0.1 * dot(a1 - a2, vec3(1.0)));
  a = mix(a1, a2, t); b = mix(b1, b2, t);
}
void main() {
  if (nPortal > 0.0 && inTunnelMouth(vPos)) discard;      // the tunnel portals open the mountain
  vec2 xz = vPos.xz;
  levelSetup(xz);
  vec4 nd = nrmData(xz);
  vec3 N = vec3(nd.r * 2.0 - 1.0, 0.0, nd.g * 2.0 - 1.0); N.y = sqrt(max(0.0, 1.0 - dot(N.xz, N.xz)));
  float vis = nd.b, curv = nd.a - 0.5;      // curv > 0: convex ridge, < 0: hollow
  float altW = vPos.y * INV_S + atm.y, alt = altW - patchOffset(vPos.xz);     // real altitude of the place (ecology), not the world altitude
  float dist = distance(vPos, camPos);
  vec4 dA = detailA(vPos.xz), dB = detailB(vPos.xz);
  float fw = fineW(vPos.xz);
  float slope = 1.0 - N.y;
  float mfade = 1.0 - smoothstep(90.0, 140.0, dist);
  if (mfade > 0.0) mfade *= smoothstep(5.8, 8.6, dB.r * 25.5) * fw;
  if (mfade > 0.0) {
    float e = 0.35, a0 = alt - microH(xz, alt, slope);
    float gx = microH(xz + vec2(e, 0.0), a0, slope) - microH(xz - vec2(e, 0.0), a0, slope);
    float gz = microH(xz + vec2(0.0, e), a0, slope) - microH(xz - vec2(0.0, e), a0, slope);
    N = normalize(N + vec3(-gx, 0.0, -gz) / (2.0 * e) * mfade);
  }
  // faceted rock: on walls shade with the carved geometry itself (flat per triangle, which reads as angular rock)
  vec3 Ng = normalize(cross(dFdx(vPos), dFdy(vPos))); if (dot(Ng, camPos - vPos) < 0.0) Ng = -Ng;
  N = normalize(mix(N, Ng, smoothstep(0.36, 0.6, slope) * 0.7 * (1.0 - smoothstep(1500.0, 3500.0, dist))));

  // ---- material weights: slope, altitude, aspect, curvature, noise ----
  float n1 = fbm(xz * 0.011), n2 = fbm(xz * 0.07 + 13.0), n3 = vnoise(xz * 0.9);
  vec3 mk = dA.rgb;     // scree, outcrops, gullies (offline)
  float southness = -N.z;     // faces facing south get more sun: drier, more rock and golden grass
  float nonDol = 1.0 - patchW(xz, ${PATCH_K.indexOf('dolomites')});     // outside the Dolomites: wooded porphyry and limestone hills, steep ground stays green
  float rockLine = 0.30 + 0.1 * nonDol - 0.10 * smoothstep(2250.0, 2700.0, alt) + (n1 - 0.5) * 0.12 - 0.04 * smoothstep(0.0, 0.2, curv);
  float rock = smoothstep(rockLine - 0.05, rockLine + 0.05, slope);
  rock = max(rock, smoothstep(2650.0, 2850.0, alt + n1 * 120.0) * smoothstep(0.05, 0.15, slope));
  // limestone breaking through the meadow: small outcrops and rock bands on convex ground
  float outcrop = smoothstep(0.62, 0.82, mk.g + (fbm3(xz * 0.11 + 7.0) - 0.5) * 0.7) * smoothstep(1950.0, 2050.0, alt);
  rock = max(rock, outcrop * 0.95);
  // scree: moderate slopes high up, below the walls, in hollows; fades out downslope into grass
  // scree: traced downslope from the real cliffs offline; ragged edges, grass tongues reaching up the gullies' sides
  float scree = clamp((mk.r - 0.18 + (n2 - 0.5) * 0.45 + (vnoise(xz * 0.05) - 0.5) * 0.3) * 2.2, 0.0, 1.0);
  // meadow: green to golden (season), drier on south faces and convex ridges, lusher in hollows
  float dry = clamp(fogP.w + 0.18 * southness + 0.8 * curv + (n1 - 0.5) * 0.3 + (n2 - 0.5) * 0.1, 0.0, 1.0);
  float krumm = smoothstep(0.58, 0.68, fbm(xz * 0.035 + 5.0)) * smoothstep(1850.0, 2000.0, alt) * (1.0 - smoothstep(2250.0, 2400.0, alt)) * smoothstep(0.06, 0.14, slope);
  // bare soil / gravel on worn convex ground and along trails
  float soil = smoothstep(0.72, 0.85, n2 + 0.6 * max(curv, 0.0) + 0.15 * slope) * (1.0 - rock);
  // layer weights: 0 rock, 1 scree, 2 green grass, 3 dry grass, 4 gravel
  float w[5];
  w[0] = rock; w[1] = scree * (1.0 - rock);
  float meadow = (1.0 - rock) * (1.0 - w[1]);
  w[4] = soil * meadow * 0.7;
  meadow *= 1.0 - w[4];
  // below ~1500 m outside the Dolomites the meadows are hay and pasture, greener and duller than alpine turf: golden grass there read as sand
  dry -= 0.22 * nonDol * (1.0 - smoothstep(1200.0, 1800.0, alt));
  float dryW = smoothstep(0.1, 0.95, dry);
  w[2] = meadow * (1.0 - dryW); w[3] = meadow * dryW;

  // ---- detail textures: photo-scanned sets in two texture arrays, sampled at two scales, height-blended ----
  float tfade = 1.0 - smoothstep(${Q.tfade[0].toFixed(1)}, ${Q.tfade[1].toFixed(1)}, dist);       // beyond this only the averaged colours remain
  vec3 albL[5]; vec3 nrmL[5]; float hL[5];
  // macro variation shared by all layers (breaks up repetition over tens of metres)
  float mv = fbm3(xz * 0.021 + 3.7);
  for (int i = 0; i < 5; i++) { albL[i] = layerTint[i]; nrmL[i] = vec3(0.0, 0.0, 1.0); hL[i] = 0.5; }
  if (tfade > 0.0) {
    for (int i = 1; i < 5; i++) {
      if (w[i] < 0.01) continue;
      float sc = layerScale[i];
      // two rotated samplings, one 4.7x larger; the larger one only modulates
      vec2 uv1 = xz / sc, uv2 = mat2(0.8, 0.6, -0.6, 0.8) * xz / (sc * 4.7);
      if (dist < 60.0) {      // one parallax step from the scan's height: the ground gets depth up close
        vec3 V = normalize(camPos - vPos);
        float hp = texture(texNH, vec3(uv1, float(i))).b;
        uv1 += V.xz / max(V.y, 0.25) * (hp - 0.5) * 0.06 / sc * (1.0 - smoothstep(30.0, 60.0, dist));
      }
      vec3 a1, b1, a2, b2;
      if (dist < 450.0) { noTile(uv1, float(i), a1, b1); noTile(uv2, float(i), a2, b2); }
      else { a1 = texture(texAlb, vec3(uv1, float(i))).rgb; b1 = texture(texNH, vec3(uv1, float(i))).rgb; a2 = texture(texAlb, vec3(uv2, float(i))).rgb; b2 = texture(texNH, vec3(uv2, float(i))).rgb; }
      a1 = pow(a1, vec3(2.2)); a2 = pow(a2, vec3(2.2));
      if (i == 3) { vec3 lw3 = vec3(0.3, 0.55, 0.15); a1 = mix(dot(a1, lw3) / dot(layerMean[3], lw3) * layerMean[3], a1, 0.15); }     // the dry-grass scan has pink leaves: pull them to the scan's mean hue
      vec3 a = a1 * clamp(a2 / max(layerMean[i], vec3(0.01)), 0.5, 1.6);
      albL[i] = mix(layerTint[i], a * layerGain[i], tfade);
      vec2 dn = (b1.rg * 2.0 - 1.0) + 0.6 * (b2.rg * 2.0 - 1.0);
      nrmL[i] = vec3(dn * tfade * layerBump[i], 1.0);
      hL[i] = mix(0.5, b1.b * 0.7 + b2.b * 0.3, tfade);
    }
    if (w[0] > 0.01) {
      // rock: triplanar so cliffs don't smear; walls get vertical structure from the x and z projections
      vec3 bw = pow(abs(N), vec3(4.0)); bw /= dot(bw, vec3(1.0));
      float sc = layerScale[0];
      vec3 P = vec3(xz.x, alt, xz.y) / sc;
      vec3 ax = pow(texture(texAlb, vec3(P.zy * vec2(1.0, -1.0), 0.0)).rgb, vec3(2.2)), ay = pow(texture(texAlb, vec3(P.xz, 0.0)).rgb, vec3(2.2)), az = pow(texture(texAlb, vec3(P.xy * vec2(1.0, -1.0), 0.0)).rgb, vec3(2.2));
      vec3 nx = texture(texNH, vec3(P.zy * vec2(1.0, -1.0), 0.0)).rgb, ny = texture(texNH, vec3(P.xz, 0.0)).rgb, nz = texture(texNH, vec3(P.xy * vec2(1.0, -1.0), 0.0)).rgb;
      vec3 a = ax * bw.x + ay * bw.y + az * bw.z;
      // a coarser triplanar for the large forms of the walls
      vec3 Q = P / 6.3;
      vec3 m2 = pow(texture(texAlb, vec3(Q.zy, 0.0)).rgb, vec3(2.2)) * bw.x + pow(texture(texAlb, vec3(Q.xz, 0.0)).rgb, vec3(2.2)) * bw.y + pow(texture(texAlb, vec3(Q.xy, 0.0)).rgb, vec3(2.2)) * bw.z;
      a *= clamp(m2 / max(layerMean[0], vec3(0.01)), 0.45, 1.7);
      // (the bedded-rock scan was dropped: its layers tiled into regular horizontal rows; the lower tiers are a tint below)
      albL[0] = mix(layerTint[0], a * layerGain[0], tfade);
      // whiteout-style: each projection's tangent normal applied in its own plane, then combined in world space
      vec2 tx = nx.rg * 2.0 - 1.0, ty = ny.rg * 2.0 - 1.0, tz = nz.rg * 2.0 - 1.0;
      vec3 wn = vec3(0.0, tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z;
      nrmL[0] = wn * tfade * layerBump[0];      // already world space
      hL[0] = mix(0.5, nx.b * bw.x + ny.b * bw.y + nz.b * bw.z, tfade);
    }
  }
  // height blend: the layer that is higher at this spot wins at transitions (rock pokes through grass, grass fills gravel)
  float ws[5]; float mx = 0.0;
  for (int i = 0; i < 5; i++) { ws[i] = w[i] > 0.0 ? w[i] + hL[i] * 0.6 : -1.0; mx = max(mx, ws[i]); }
  float tot = 0.0; vec3 alb = vec3(0.0), dN = vec3(0.0);
  for (int i = 0; i < 5; i++) { float k = max(ws[i] - mx + 0.25, 0.0) * step(0.001, w[i]); tot += k; alb += albL[i] * k; dN += nrmL[i] * k; }
  alb /= max(tot, 1e-4); dN /= max(tot, 1e-4);
  // cavities of the scans: dirt and shade between stones and tufts (strongest up close, where it reads)
  float hb = 0.0; for (int i = 0; i < 5; i++) { float k = max(ws[i] - mx + 0.25, 0.0) * step(0.001, w[i]); hb += hL[i] * k; } hb /= max(tot, 1e-4);
  alb *= mix(1.0, mix(0.55, 1.15, smoothstep(0.2, 0.8, hb)), 0.8 * (1.0 - smoothstep(40.0, 400.0, dist)));
  dN *= 1.0 + 0.8 * (1.0 - smoothstep(20.0, 150.0, dist));
  // dolomite colour: pale, warm ochre patches, dark water streaks down the walls, browner lower beds
  float rk = w[0] * step(0.001, w[0]) / max(tot, 1e-4) * max(ws[0] - mx + 0.25, 0.0);
  // where the land-cover data has forest, steep ground is wooded, not bare rock (Lake Garda's limestone slopes): canopy suppresses rock
  float forestC = smoothstep(2.0, 7.0, dA.a * 63.75);
  rk *= 1.0 - forestC * 0.85;
  // ---- wall structure: vertical fluting, bedding bands and ledges, black water streaks down the gullies ----
  vec2 wt = normalize(vec2(-N.z, N.x) + 1e-4);
  float along = dot(xz, wt);
  float fineK = 1.0 - smoothstep(250.0, 1200.0, dist);
  float flute = vnoise(vec2(along * 0.35, alt * 0.02)) * 0.6 + (vnoise(vec2(along * 1.3, alt * 0.07)) - 0.5) * 0.4 * fineK + 0.2;
  float fluteB = vnoise(vec2((along + 0.6) * 0.35, alt * 0.02)) * 0.6 + (vnoise(vec2((along + 0.6) * 1.3, alt * 0.07)) - 0.5) * 0.4 * fineK + 0.2;
  float bandC = alt + (fbm3(xz * 0.012) - 0.5) * 26.0;
  float strata = fract(bandC / 9.0), big = fract(bandC / 57.0);
  float ledge = smoothstep(0.84, 0.92, strata) * (1.0 - smoothstep(0.95, 1.0, strata)) * smoothstep(0.55, 0.8, vnoise(vec2(along * 0.025, bandC * 0.11)));     // broken, not continuous rings
  float bigLedge = smoothstep(0.88, 0.94, big) * (1.0 - smoothstep(0.97, 1.0, big));
  float streak = clamp(smoothstep(0.58, 0.86, vnoise(vec2(along * 0.08, alt * 0.0035))) * 0.6 + mk.b * 0.9, 0.0, 1.0) * smoothstep(0.35, 0.55, slope);
  vec3 rockTone = mix(vec3(0.93, 0.95, 1.0), vec3(1.2, 1.0, 0.78), smoothstep(0.5, 0.85, n2 + 0.3 * fbm3(xz * 0.004)));
  rockTone *= (0.88 + 0.24 * flute) * (1.0 - 0.5 * streak);
  alb *= mix(vec3(1.0), rockTone, rk);
  // low-altitude limestone (Garda, the Adige valley) is weathered grey with scrub in every crack, not the pale Dolomite walls
  alb *= mix(vec3(1.0), vec3(0.62, 0.64, 0.6), rk * max(1.0 - smoothstep(1300.0, 1900.0, alt), nonDol * (1.0 - smoothstep(2100.0, 2500.0, alt))));
  // around Bolzano the mountains are quartz porphyry: dark red-brown and grey, never the pale dolomite (which reads as snow there)
  float porph = patchW(xz, ${PATCH_K.indexOf('bolzano')});
  alb *= mix(vec3(1.0), vec3(0.62, 0.5, 0.45) * (0.85 + 0.3 * n2), clamp(rk + w[1], 0.0, 1.0) * porph);
  alb *= 1.0 - 0.42 * w[1] * nonDol;      // scree outside the Dolomites: dark debris, not pale dolomite gravel
  // around Bolzano the cliffs are broken, darker rock with pines and scrub on every ledge (never a bare pale face)
  // (and every distant non-Dolomite cliff: at a few km pale limestone with pines on its ledges reads mid-grey, not as snow; Garda keeps
  // its pale limestone up close)
  float darkR = max(porph, nonDol * smoothstep(800.0, 2500.0, dist));
  float scrubR = smoothstep(0.3, 0.55, fbm3(xz * 0.018 + 4.0) + 0.25 * bigLedge) * clamp(rk + w[1], 0.0, 1.0) * darkR;
  alb *= 1.0 - 0.62 * clamp(rk + w[1], 0.0, 1.0) * darkR;
  alb = mix(alb, vec3(0.03, 0.045, 0.025) * (0.8 + 0.4 * n3), scrubR * 0.9);
  // lower tiers of the Sella and Cir: darker, browner beds (a tint; varies along the wall so it never forms a line)
  alb *= mix(vec3(1.0), vec3(0.78, 0.74, 0.68), rk * (1.0 - smoothstep(2250.0, 2450.0, alt + (vnoise(vec2(along * 0.01, 0.5)) - 0.5) * 220.0)) * 0.7);
  // grass and dwarf shrubs on the broad ledges of the walls (the Sella's cengia)
  float grassLedge = clamp(bigLedge * 1.2 + ledge * 0.35, 0.0, 1.0) * rk * (1.0 - smoothstep(0.55, 0.75, slope)) * smoothstep(0.4, 0.6, fbm3(xz * 0.03));
  alb = mix(alb, mix(albL[3], albL[2], 0.5) * 0.8, grassLedge);
  // scree: darker debris lines down the fans
  alb *= 1.0 - 0.25 * w[1] * smoothstep(0.3, 0.8, mk.b + vnoise(vec2(dot(xz, wt) * 0.25, alt * 0.01)) * 0.5);
  // large-scale colour variation and dwarf-pine clumps on the meadows
  alb *= 0.7 + 0.6 * mv;
  // russet and olive patches in the meadow (heather, bilberry, damp hollows)
  float pt = fbm3(xz * 0.045 + 21.0);
  alb = mix(alb, alb * mix(vec3(1.08, 0.92, 0.72), vec3(0.75, 1.0, 0.75), smoothstep(0.0, 0.1, -curv)), (1.0 - rk) * (1.0 - w[1]) * smoothstep(0.55, 0.75, pt) * 0.6);     // ochre-brown and damp-green patches
  alb = mix(alb, vec3(0.03, 0.045, 0.022), krumm * 0.85 * (1.0 - rk));
  // forests: needle litter and shade under the canopy; beyond the instanced trees (outside the near level) the canopy is painted in
  float canopy = dA.a * 63.75;
  float forest = smoothstep(2.0, 7.0, canopy) * (1.0 - rk);
  // under the trees: needle litter near the camera; further away the ground between instanced trees reads as canopy from above
  vec3 canopyCol = mix(vec3(0.018, 0.032, 0.02), vec3(0.06, 0.045, 0.015), smoothstep(0.4, 0.9, fogP.w) * 0.35) * (0.75 + 0.5 * vnoise(xz * 0.15));
  alb = mix(alb, mix(vec3(0.045, 0.04, 0.03) * (0.8 + 0.4 * n3), canopyCol, smoothstep(120.0, 500.0, dist)), forest * mix(0.8, 0.95, smoothstep(120.0, 500.0, dist)));
  float farForest = forest * (1.0 - fw * step(dist, 3500.0)) * smoothstep(0.0, 1.0, (1.0 - fw) + smoothstep(2500.0, 3500.0, dist));
  alb = mix(alb, mix(vec3(0.018, 0.03, 0.016), vec3(0.06, 0.045, 0.015), smoothstep(0.4, 0.9, fogP.w) * 0.5) * (0.7 + 0.6 * vnoise(xz * 0.15)), farForest);
  vec3 albDbg1 = alb;
  // ---- cultivated land and the lake shore (OSM landuse; real places only) ----
  float vine = dB.g * (1.0 - rk), orch = dB.b * (1.0 - rk), urb = dB.a * (1.0 - rk);
  if (vine > 0.01) {      // vine rows along the contour: soil between, green-gold rows
    vec2 cdir = normalize(vec2(-N.z, N.x) + 1e-4); float row = abs(fract(dot(xz, vec2(-cdir.y, cdir.x)) / 2.4) - 0.5) * 2.0;
    vec3 soil = vec3(0.16, 0.12, 0.08) * (0.8 + 0.4 * n3), leaves = mix(vec3(0.07, 0.1, 0.03), vec3(0.2, 0.15, 0.04), fogP.w);
    alb = mix(alb, mix(leaves, soil, smoothstep(0.35, 0.6, row)), vine * (1.0 - smoothstep(600.0, 2500.0, dist) * 0.6));
  }
  // orchards: mown grass alleys between hedge rows 3.6 m apart, one direction per 150 m field (as the rows built near the road)
  vec2 fc = floor(xz / 150.0); float fh1 = fract(sin(fc.x * 12.9898 + fc.y * 78.233) * 43758.5453), fh2 = fract(sin(fc.y * 12.9898 + fc.x * 78.233) * 43758.5453);
  float fa = 0.6 + step(0.5, fh1) * 1.5708 + (fh2 - 0.5) * 0.25;
  float rf = fract((dot(xz, vec2(-sin(fa), cos(fa))) - 1.8) / 3.6), onRow = 1.0 - smoothstep(0.14, 0.26, min(rf, 1.0 - rf));
  vec3 orchC = mix(mix(vec3(0.075, 0.1, 0.04), vec3(0.11, 0.1, 0.06), n2 * 0.5), vec3(0.035, 0.06, 0.022), mix(0.45, onRow, 1.0 - smoothstep(700.0, 1500.0, dist)));
  alb = mix(alb, orchC * (0.85 + 0.3 * vnoise(xz * 0.35)), orch * 0.9 * step(0.01, orch));
  // built-up land: paved streets and squares (stone slabs with joints, asphalt patches, wear), not lawn; branch-free
  { vec2 sq = abs(fract(xz / vec2(1.2, 0.8) + vec2(0.5 * step(0.5, fract(xz.y / 1.6)), 0.0)) - 0.5);
    float joint = smoothstep(0.47, 0.5, max(sq.x, sq.y));
    float asph = smoothstep(0.45, 0.6, vnoise(xz * 0.04));
    vec3 slab = vec3(0.34, 0.31, 0.27) * (0.85 + 0.3 * n3) * (1.0 - 0.35 * joint), tar = vec3(0.11, 0.11, 0.115) * (0.85 + 0.3 * n3);
    vec3 pave = mix(slab, tar, asph) * (0.9 + 0.2 * vnoise(xz * 0.6));
    alb = mix(alb, pave * 0.8, smoothstep(0.15, 0.6, urb) * 0.6 * (0.6 + 0.4 * smoothstep(0.35, 0.65, vnoise(xz * 0.05)))); }      // residential land includes gardens: patchy paving
  // Garda beaches: pale limestone pebbles from below the waterline up to ~2.5 m where the shore is gentle, wet and darker near the water
  float above = vPos.y - waterY;
  float nearLake = step(lakeBox.x, xz.x) * step(xz.x, lakeBox.z) * step(lakeBox.y, xz.y) * step(xz.y, lakeBox.w) * step(-40.0, above) * (1.0 - smoothstep(90.0, 130.0, alt));     // the Adige valley lies far below the water's world height, and in the patch blend near Nago the ground dips under it at ~200 m real altitude: beaches only near the lake's 65 m
  float shore = SHORE_OFF ? 0.0 : (1.0 - smoothstep(0.5, 1.4 + 0.8 * vnoise(xz * 0.03), above)) * smoothstep(0.75, 0.92, N.y) * step(-1000.0, waterY);
  shore = max(shore, SHORE_OFF ? 0.0 : clamp((waterY + 0.9 - vPos.y) / 0.7, 0.0, 1.0) * step(-1000.0, waterY));
  float peb = vnoise(xz * 3.1) * 0.6 + vnoise(xz * 9.0) * 0.4;
  float pebD = smoothstep(0.55, 0.8, vnoise(xz * 14.0)) * 0.35 + smoothstep(0.6, 0.85, vnoise(xz * 5.0 + 7.0)) * 0.25;      // darker stones and damp patches
  vec3 beach = mix(vec3(0.34, 0.325, 0.3), vec3(0.24, 0.225, 0.2), peb) * (1.0 - pebD) * mix(0.6, 1.0, smoothstep(-0.2, 0.5, above));
  alb = mix(alb, beach, shore * nearLake * (1.0 - rk * 0.6) * (1.0 - urb * 0.7));
  vec3 albDbg2 = alb;
  // perturb the macro normal (tangent frame: x east, z north on flat ground)
  vec3 T = normalize(vec3(N.y, -N.x, 0.0)), B = normalize(cross(T, N));
  vec3 Nd = rk > 0.5 ? normalize(N + dN) : normalize(N + T * dN.x + B * -dN.y);
  // ledges catch the light from above, flutes shade sideways
  Nd = normalize(Nd + rk * (vec3(0.0, 0.5, 0.0) * bigLedge * smoothstep(0.55, 0.8, vnoise(vec2(along * 0.02, alt * 0.01))) + vec3(wt.x, 0.0, wt.y) * (fluteB - flute) * 1.2));
  N = Nd;
  float rock2 = rk;

  // ---- lighting ----
  vec3 L = sunDir;
  float cao = carAO(vPos);
  float sh = sunShadowC(xz) * carSunShadow(vPos) * cloudShade(vPos);
  float ndl = max(dot(N, L), 0.0);
  // rock reads warmer and brighter in grazing light: a touch of wrap on rough surfaces
  float wrap = max((dot(N, L) + 0.15) / 1.15, 0.0) * 0.35 * rock2;
  // a forest seen from afar is mostly crowns shading each other: less direct sun on the painted canopy than on bare ground
  vec3 direct = sunCol * (ndl + wrap) * sh * (1.0 - 0.6 * forest * smoothstep(120.0, 500.0, dist));
  float ao = mix(0.55, 1.0, vis) * (1.0 + 0.6 * min(curv, 0.0));
  vec3 amb = ambient(N) * ao * cao / PI * mix(1.0, vis, 0.7) * 2.1 * (1.0 - 0.45 * forest);
  vec3 col = alb * (direct / PI + amb);
  col = aerial(col, vPos);
  // Southern wooded slopes and atmospheric blues were too chromatic against the lake.
  // Keep luminance and the approved alpine palette; fade the correction across patches.
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), nonDol * 0.28);
  gl_FragColor = vec4(col, 1.0);
  ${DBG === 1 ? 'gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);' : DBG === 2 ? 'gl_FragColor = vec4(fract(alt / 100.0), fract(alt / 1000.0), vis, 1.0);' : DBG === 3 ? 'gl_FragColor = vec4(alb, 1.0);' : DBG === 4 ? 'gl_FragColor = vec4(vec3(sh), 1.0);' : DBG === 5 ? 'gl_FragColor = vec4(dA.rgb, 1.0);' : DBG === 6 ? 'gl_FragColor = vec4(dB.r, dB.g, dB.a, 1.0);' : DBG === 7 ? 'gl_FragColor = vec4(fract(float(baseLevel(xz)) / 6.0 + 0.01), fw, dA.a, 1.0);' : DBG === 8 ? 'gl_FragColor = vec4(texture(aArr, vec3(lvUV(0, xz), 0.0)).rgb, 1.0);' : DBG === 9 ? 'gl_FragColor = vec4(texture(nArr, vec3(lvUV(0, xz), 0.0)).rgb, 1.0);' : DBG === 10 ? 'gl_FragColor = vec4(lvUV(0, xz), 0.0, 1.0);' : DBG === 11 ? 'gl_FragColor = vec4(w[0], w[1], w[2] + w[3], 1.0);' : DBG === 12 ? 'gl_FragColor = vec4(albL[2], 1.0);' : DBG === 13 ? 'gl_FragColor = vec4(vec3(tfade), 1.0);' : DBG === 14 ? 'gl_FragColor = vec4(albDbg1, 1.0);' : DBG === 15 ? 'gl_FragColor = vec4(albDbg2, 1.0);' : DBG === 16 ? 'gl_FragColor = vec4(dB.g, dB.b, dB.a, 1.0);' : DBG === 17 ? 'gl_FragColor = vec4(step(0.5, shore), step(0.5, vine) + step(0.5, orch) * 0.5, step(0.5, urb), 1.0);' : DBG === 19 ? 'gl_FragColor = vec4(vPos.y < -400.0 ? 1.0 : 0.0, 0.0, 0.0, 1.0);' : DBG === 20 ? 'gl_FragColor = vec4(0.0, (waterY + 2.5 - vPos.y) > 0.0 ? 1.0 : 0.0, 0.0, 1.0);' : DBG === 18 ? 'gl_FragColor = vec4(step(waterY + 2.5, vPos.y), step(0.0, waterY + 600.0), step(0.0, vPos.y), 1.0);' : DBG === 21 ? 'gl_FragColor = vec4(vec3(clamp(dA.a * 63.75 / 20.0, 0.0, 1.0)), 1.0);' : DBG === 22 ? 'gl_FragColor = vec4(rk, forestC, w[3], 1.0);' : ''}
}`;
  const terrainMat = new BABYLON.ShaderMaterial('terrainMat', scene, { vertex: 'terrain', fragment: 'terrain' }, {
    attributes: ['position'],
    uniforms: ['floatO', 'viewProjection', 'morphK', 'portalSeg', 'nPortal', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS, 'layerTint', 'layerGain', 'layerMean', 'layerScale', 'layerBump', 'carShadowM', 'carP', 'carF', 'waterY', 'lakeBox', 'rockG'],
    samplers: [...LEVEL_SAMPLERS, 'nArr', 'aArr', 'bArr', 'skyLUT', 'texAlb', 'texNH', 'carMask', 'noiseTex', 'rockLod'],
  });
  if (RG) { terrainMat.setTexture('rockLod', RG.tex); terrainMat.setVector4('rockG', new BABYLON.Vector4(RG.x0, RG.z0, 1 / RG.size, ROCK_B)); }
  else { const z = new BABYLON.RawTexture(new Uint8Array(1), 1, 1, BABYLON.Constants.TEXTUREFORMAT_RED, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE); terrainMat.setTexture('rockLod', z); terrainMat.setVector4('rockG', new BABYLON.Vector4(0, 0, 0, 0)); }
  window.__rockLodSet = (b) => { if (!RG) return; rockBV = b == null ? ROCK_B : b; terrainMat.setVector4('rockG', new BABYLON.Vector4(RG.x0, RG.z0, 1 / RG.size, rockBV)); lastSel = null; };      // A/B hook
  window.__rockLod = RG ? { B: ROCK_B, cells: RG.cells, size: RG.size, ms: Math.round(RG.ms) } : null;
  terrainMat.setArray4('morphK', morphK); terrainMat.setArray4('portalSeg', portalArr); terrainMat.setFloat('nPortal', 0); terrainMat.setVector4('lakeBox', new BABYLON.Vector4(...LAKE_BOX));
  {
    // target average albedo per layer (linear): the scans are re-tinted to these so the palette stays under our control
    const TARGET = [[0.25, 0.24, 0.225], [0.27, 0.265, 0.25], [0.075, 0.105, 0.04], [0.165, 0.135, 0.075], [0.24, 0.22, 0.19], [0.17, 0.16, 0.145]];
    const means = TEX_INFO.layers.map((l) => TEX_INFO.linear_mean_albedo[l]);
    terrainMat.setArray3('layerTint', TARGET.flat()); terrainMat.setArray3('layerMean', means.flat());
    terrainMat.setArray3('layerGain', TARGET.map((t, i) => t.map((v, c) => v / Math.max(0.01, means[i][c]))).flat());
    terrainMat.setFloats('layerScale', [9.0, 3.5, 2.2, 2.6, 2.0, 11.0]);
    terrainMat.setFloats('layerBump', [0.9, 0.8, 0.6, 0.7, 0.6, 0.9]);
    terrainMat.setTexture('texAlb', texArr.alb); terrainMat.setTexture('texNH', texArr.nh);
    { const nt = new BABYLON.Texture(assetUrl('textures/terrain/noise.png'), scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE); nt.gammaSpace = false; nt.wrapU = nt.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; nt.anisotropicFilteringLevel = 1; terrainMat.setTexture('noiseTex', nt); }      // noise anisotropy 1x: invisible on this soft colour noise, and costly (~30 reads per pixel)
    terrainMat.setTexture('nArr', nArr); terrainMat.setTexture('aArr', aArr); terrainMat.setTexture('bArr', bArr); terrainMat.setFloat('waterY', WATER ? WATER.y : -1e5);
  }
  grid.material = terrainMat;
  // the thin-instance buffer must exist before the first frame
  updateTerrain({ position: new V3(0, 200, 0), getDirection: () => new V3(0, 0, 1) });
  const updateTerrain0 = 0; void updateTerrain0;

  // materials sharing the world lighting get the same uniforms every frame
  const worldMats = [terrainMat];
  const bindLevels = (m) => {
    m.setTexture('hArr', hArr); m.setFloats('lvDf', lvDArr); m.setFloats('lvHf', lvHArr); m.setFloats('patchCf', patchCArr);
    for (const L of LVL) m.setTexture('s' + L.i, shadowTex[L.name]);
    m.setTexture('skyLUT', skyLUT);
  };
  bindLevels(terrainMat); bindCar(terrainMat);

  // ---------- roads: every road of the network as a ribbon (paved width, shoulders, gravel lip); markings drawn in the shader ----------
  const roadMeshes = [];
  for (const r of ROADS) {
    const pts = r.points, lip = 1.0;
    const pos = [], uv = [], uv2 = [], nrm = [], idx = [];
    let s = r.markOffset || 0;
    for (let i = 0; i < pts.length; i++) {
      const pw = roadHalf(r, i), sh = roadShoulder(r, i), offs = [-(pw + sh + lip), -(pw + sh), -pw, 0, pw, pw + sh, pw + sh + lip];
      const p = pts[i], [tx, tz] = roadDirection(r, i);
      if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
      const nx = tz, nz = -tx;       // right-hand side
      for (let k = 0; k < offs.length; k++) {
        const x = p[0] + nx * offs[k], z = p[2] + nz * offs[k];
        // the outer lip rides over the highest ground around it, so a cut bank cannot poke through the gravel
        const onStruct = r.fl[i] > 0;
        let yl = -Infinity; if ((k === 0 || k === 6) && !onStruct) for (const [a2, b2] of [[0, 0], [1, 0], [-1, 0], [0, 0.8], [0, -0.8]]) yl = Math.max(yl, terrainH(x + tx * a2 + nx * b2, z + tz * a2 + nz * b2));
        const y = (k === 0 || k === 6) && !onStruct ? Math.min(Math.max(yl, p[1] - 0.6), p[1] + 0.6) + 0.18 : p[1] + (k === 1 || k === 5 ? 0.08 : 0.05);     // the lip never climbs a cut face or a tunnel mound
        pos.push(x, y, z); uv.push(offs[k], s); uv2.push(pw, r.cross[i].motorway); nrm.push(0, 1, 0);
      }
    }
    const W = 7;
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < W - 1; k++) { const a = i * W + k, b = a + 1, c = a + W, d = c + 1; idx.push(a, b, c, b, d, c); }
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.uvs = uv; vd.uvs2 = uv2;
    BABYLON.VertexData.ComputeNormals(pos, idx, nrm); vd.normals = nrm;
    const m = new BABYLON.Mesh('road_' + r.id, scene); vd.applyToMesh(m); roadMeshes.push(m);
  }
  var road = roadMeshes[0];
  BABYLON.Effect.ShadersStore.roadVertexShader = `precision highp float; uniform vec3 floatO;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec2 uv2;
uniform mat4 viewProjection; varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying vec2 vUV2;
void main() { vPos = position; vN = normal; vUV = uv; vUV2 = uv2; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
  BABYLON.Effect.ShadersStore.roadFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + GL_CAR + `
varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying vec2 vUV2;
float roadStripe(float d, float halfWidth) {
  float aa = max(0.008, fwidth(d) * 0.7);
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(d));
}
void main() {
  vec3 N = normalize(vN);
  float m = vUV.x, s = vUV.y, pw = vUV2.x, am = abs(m);
  float motorway = clamp(vUV2.y, 0.0, 1.0);
  float edge = pw - mix(0.195, 1.5, motorway);
  float divider = edge * 0.5; // midway between centreline and outside edge
  float split = smoothstep(0.0, 1.0, motorway);
  float n = fbm3(vPos.xz * 1.7), n2 = vnoise(vPos.xz * 23.0);
  vec3 asphalt = vec3(0.075, 0.075, 0.078) * (0.8 + 0.35 * n + 0.2 * n2) * mix(1.0, 0.85, motorway);
  float lane = fract(am / max(2.5, edge / (1.0 + split)));
  float tr = exp(-pow((lane - 0.28) * 7.0, 2.0)) + exp(-pow((lane - 0.72) * 7.0, 2.0));
  asphalt *= 1.0 + 0.18 * tr;
  vec3 gravel = vec3(0.30, 0.28, 0.25) * (0.75 + 0.5 * n2);
  vec3 alb = am > pw ? gravel : asphalt;
  float dashAA = max(0.02, fwidth(s));
  float dash = 1.0 - smoothstep(2.25 - dashAA, 2.25 + dashAA, abs(mod(s + 6.0, 12.0) - 6.0));
  dash = mix(dash, 0.375, smoothstep(4.0, 12.0, dashAA));
  // Continuous opposing-traffic boundary, never a diverging median.
  float centrePaint = roadStripe(am, 0.075) * mix(dash, 1.0, smoothstep(0.0, 0.04, motorway));
  float lanePaint = roadStripe(am - divider, 0.08) * dash * smoothstep(6.0, 6.15, edge);
  float paint = max(roadStripe(am - edge, 0.075), max(centrePaint, lanePaint));
  alb = mix(alb, vec3(0.62, 0.62, 0.6), clamp(paint, 0.0, 1.0) * (0.75 + 0.25 * n2) * step(am, pw));
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  // in a tunnel (the mountain more than ~3 m overhead) there is no sun and little sky: sodium lamp pools every 14 m instead
  float indoor = smoothstep(2.0, 4.0, heightAt(vPos.xz) - vPos.y);
  vec3 col = alb * (sunCol * max(dot(N, sunDir), 0.0) * sh * carSunShadow(vPos) * (1.0 - indoor) + ambient(N) * 1.4 * carAO(vPos) * (1.0 - indoor * 0.92)) / PI;
  float lamp = exp(-pow((fract(s / 14.0) - 0.5) * 5.0, 2.0)) * exp(-am * am * 0.03);
  col += alb * vec3(1.0, 0.72, 0.38) * (0.25 + 1.4 * lamp) * carAO(vPos) * indoor;
  col = aerial(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}`;
  const roadMat = new BABYLON.ShaderMaterial('roadMat', scene, { vertex: 'road', fragment: 'road' }, {
    attributes: ['position', 'normal', 'uv', 'uv2'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS, 'carShadowM', 'carP', 'carF'],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'carMask'],
  });
  roadMat.zOffset = -2; for (const m of roadMeshes) { m.material = roadMat; m.renderingGroupId = 1; m.isPickable = false; } bindLevels(roadMat); worldMats.push(roadMat); bindCar(roadMat);

  // ---------- tunnels: an arched concrete tube along every tunnel run, portal facades, lamps; the terrain is cut out at the portals ----------
  BABYLON.Effect.ShadersStore.tunnelVertexShader = `precision highp float; uniform vec3 floatO;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
uniform mat4 viewProjection; varying vec3 vPos; varying vec3 vN; varying vec2 vUV;
void main() { vPos = position; vN = normal; vUV = uv; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
  BABYLON.Effect.ShadersStore.tunnelFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
varying vec3 vPos; varying vec3 vN; varying vec2 vUV;
void main() {
  vec3 N = normalize(vN);
  float s = vUV.x, inside = step(0.0, vUV.y);
  float n = vnoise(vPos.xz * 2.1 + vPos.y * 1.7) * 0.5 + vnoise(vPos.xy * 0.7) * 0.5;
  vec3 alb = vec3(0.36, 0.35, 0.33) * (0.75 + 0.4 * n);
  if (inside < 0.5) {      // portal headwall: weathered cast concrete, 1.2 m formwork lifts, dark streaks running down from the coping
    float lift = smoothstep(0.03, 0.0, abs(fract(vPos.y / 1.2) - 0.5) - 0.47);
    float streak = smoothstep(0.55, 0.85, vnoise(vec2(dot(vPos.xz, vec2(0.7, 0.7)) * 1.3, vPos.y * 0.08)));
    alb = vec3(0.22, 0.215, 0.2) * (0.8 + 0.35 * n) * (1.0 - 0.25 * lift) * (1.0 - 0.35 * streak);
  }
  // lamp pools every 14 m on the walls, warm sodium light; daylight fades in over the first 40 m from each portal
  float lamp = exp(-pow((fract(s / 14.0) - 0.5) * 4.5, 2.0));      // broad pools: narrow ones read as steps through the portal
  float day = inside < 0.5 ? 1.0 : clamp(1.0 - vUV.y / 40.0, 0.0, 1.0);
  vec3 col = alb * (vec3(1.0, 0.72, 0.38) * (0.55 + 0.75 * lamp) * inside + ambient(N) / PI * 1.2 * day + sunCol * max(dot(N, sunDir), 0.0) * (sunShadow(vPos.xz) * cloudShade(vPos)) * day * (1.0 - inside) / PI);
  if (N.y < -0.5 && abs(fract(s / 14.0) - 0.5) < 0.04 && inside > 0.5) col += vec3(4.0, 2.6, 1.2);      // the lamps themselves (small fittings)
  gl_FragColor = vec4(aerial(col, vPos), 1.0);
}`;
  const tunnelMeshes = [];
  for (const t of TUNNELS) {
    const P = t.pts, n = P.length; if (n < 3) continue;
    const prof = [];     // arch cross-section (x across, y up), counter-clockwise seen from the entrance
    const R = t.hw, wallH = 4.2; prof.push([R, -0.3], [R, wallH]); for (let k = 1; k < 10; k++) { const a = k / 10 * Math.PI; prof.push([Math.cos(a) * R, wallH + Math.sin(a) * R * 0.55]); } prof.push([-R, wallH], [-R, -0.3]);
    const pos = [], nrm = [], uv = [], idx = []; let sAcc = 0; const total = (() => { let a = 0; for (let i = 1; i < n; i++) a += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]); return a; })();
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; let tx = b[0] - a[0], tz = b[2] - a[2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) sAcc += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
      const rx = tz, rz = -tx;
      for (const [u, v] of prof) { pos.push(P[i][0] + rx * u, P[i][1] + v, P[i][2] + rz * u); const ny = v > wallH ? -(v - wallH) / (R * 0.55) : 0, nh = v > wallH ? -u / R : -Math.sign(u); nrm.push(rx * nh, ny, rz * nh); uv.push(sAcc, 0); }
    }
    const W = prof.length;
    for (let q = 1; q < uv.length; q += 2) uv[q] = Math.min(uv[q - 1], total - uv[q - 1]);
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < W - 1; k++) { const a = i * W + k, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
    // portals: a concrete headwall around the arch that stops just above the hillside it retains, plus wing walls out to the cut slopes
    for (const end of [0, n - 1]) {
      const p = P[end], q = P[end === 0 ? 1 : n - 2], tl = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1, fx = -(q[0] - p[0]) / tl, fz = -(q[2] - p[2]) / tl;
      // the tube's own lateral axis at this end, so the headwall hole matches the arch exactly
      const a0 = P[Math.max(0, end - 1)], b0 = P[Math.min(n - 1, end + 1)]; let ttx = b0[0] - a0[0], ttz = b0[2] - a0[2]; const ttl = Math.hypot(ttx, ttz) || 1; ttx /= ttl; ttz /= ttl;
      const ux = ttz, uz = -ttx, archTop = wallH + R * 0.55;
      const W3 = (u, y) => [p[0] + ux * u, y, p[2] + uz * u];
      const top = (u) => Math.min(p[1] + 14, Math.max(terrainH(p[0] + ux * u, p[2] + uz * u) + 0.6, p[1] + archTop + 0.9));
      const quad = (A, B, C, D) => { const o = pos.length / 3; for (const v of [A, B, C, D]) { pos.push(v[0], v[1], v[2]); nrm.push(fx, 0, fz); uv.push(end ? total : 0, -1); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
      // over the arch: one strip per profile segment, from the arch edge up to the wall top
      for (let k = 1; k < W - 2; k++) { const [u0, v0] = prof[k], [u1, v1] = prof[k + 1]; quad(W3(u0, p[1] + v0), W3(u1, p[1] + v1), W3(u1, top(u1)), W3(u0, top(u0))); }
      // wing walls either side of the opening
      for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {
        const u0 = sd * (R + k * 1.6), u1 = sd * (R + (k + 1) * 1.6);
        quad(W3(u0, p[1] - 0.3), W3(u1, p[1] - 0.3), W3(u1, top(u1)), W3(u0, top(u0)));
      }
      // coping: a 0.8 m deep top on the headwall, set back into the hill
      for (let k = -6; k < 6; k++) { const u0 = (R + 6.4) * k / 6, u1 = (R + 6.4) * (k + 1) / 6, y0 = top(u0), y1 = top(u1);
        const o = pos.length / 3; for (const v of [W3(u0, y0), W3(u1, y1), [p[0] + ux * u1 - fx * 0.8, y1, p[2] + uz * u1 - fz * 0.8], [p[0] + ux * u0 - fx * 0.8, y0, p[2] + uz * u0 - fz * 0.8]]) { pos.push(v[0], v[1], v[2]); nrm.push(0, 1, 0); uv.push(end ? total : 0, -1); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
    }
    const m = new BABYLON.Mesh('tunnel', scene), vd = new BABYLON.VertexData(); vd.positions = pos; vd.normals = nrm; vd.uvs = uv; vd.indices = idx; vd.applyToMesh(m);
    m.tunnelLen = total; tunnelMeshes.push(m);
  }
  if (tunnelMeshes.length) {
    const tunnelMat = new BABYLON.ShaderMaterial('tunnelMat', scene, { vertex: 'tunnel', fragment: 'tunnel' }, {
      attributes: ['position', 'normal', 'uv'],
      uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS],
      samplers: [...LEVEL_SAMPLERS, 'skyLUT'],
    });
    tunnelMat.backFaceCulling = false; bindLevels(tunnelMat); worldMats.push(tunnelMat);
    for (const m of tunnelMeshes) { m.material = tunnelMat; m.renderingGroupId = 1; m.isPickable = false; m.freezeWorldMatrix(); }
  }

  // ---------- props (chapel, hut, walls, signs): vertex-coloured, lit like the terrain ----------
  BABYLON.Effect.ShadersStore.propVertexShader = `precision highp float; uniform vec3 floatO;
attribute vec3 position; attribute vec3 normal; attribute vec4 color;
uniform mat4 world; uniform mat4 viewProjection; varying vec3 vPos; varying vec3 vN; varying vec4 vCol;
void main() { vec4 w = world * vec4(position, 1.0); vPos = w.xyz + floatO; vN = normalize(mat3(world) * normal); vCol = color; gl_Position = viewProjection * w; }`;     // world is origin-relative under floating origin
  BABYLON.Effect.ShadersStore.propFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform highp sampler2DArray propAlb; uniform highp sampler2DArray propNH; uniform vec3 propMean[6]; uniform float propScale[6];
varying vec3 vPos; varying vec3 vN; varying vec4 vCol;
void main() {
  vec3 N = normalize(vN);
  if (dot(N, camPos - vPos) < 0.0 && abs(N.y) < 0.9) N = -N;      // seen from inside a wall: light the side we see
  float n = vnoise(vPos.xy * 3.1 + vPos.zy * 2.3) * 0.5 + vnoise(vPos.xz * 9.0) * 0.5;
  vec3 alb = vCol.rgb * (0.88 + 0.24 * n);
  int lid = int(vCol.a * 8.0);
  vec3 V = normalize(camPos - vPos);
  if (lid == 6) {          // window glass: dark interior, sky and sun reflected with Fresnel
    vec3 R = reflect(-V, N); float f = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 refl = skyL(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * (R.y < 0.0 ? 0.25 : 1.0);
    float spec = pow(max(dot(R, sunDir), 0.0), 400.0) * 40.0 * (sunShadow(vPos.xz) * cloudShade(vPos));
    vec3 inside = vec3(0.012, 0.01, 0.008) * (0.6 + 0.8 * vnoise(vPos.xz * 1.3 + vPos.y));
    gl_FragColor = vec4(aerial(inside * ambient(N) * 0.5 + (refl + sunCol * spec) * mix(0.08, 1.0, f), vPos), 1.0); return;
  }
  float specK = lid == 7 ? 1.0 : 0.0;
  // ground height once, shared by the painted facades and the dirt band
  float hG = heightAt(vPos.xz);
  // painted facades on simple massing (vertex alpha 1.5 lake towns / 1.75 alpine): computed for every fragment and blended in, with
  // no branch, no early return and no extra height lookup. The branched version (early return + a second heightAt inside the
  // branch) ran for seconds per frame on the AMD 5500M under ANGLE/Metal and hung the GPU.
  float fac = step(1.2, vCol.a) * step(abs(N.y), 0.5);
  float lake = step(vCol.a, 1.6);
  vec2 tg = normalize(vec2(N.z, -N.x) + vec2(1e-4, 0.0));
  float along = dot(vPos.xz, tg), up = vPos.y - hG - 0.6;
  float bay = fract(along / 3.0), fl = fract(up / 3.0), fi = floor(up / 3.0);
  float win = step(0.36, bay) * step(bay, 0.64) * step(0.3, fl) * step(fl, 0.8) * step(0.0, fi);
  float sur = step(0.33, bay) * step(bay, 0.67) * step(0.27, fl) * step(fl, 0.83) * step(0.0, fi);
  float shut = (step(0.21, bay) * step(bay, 0.36) + step(0.64, bay) * step(bay, 0.79)) * step(0.3, fl) * step(fl, 0.8) * step(1.0, fi);
  float wallId = floor(dot(vPos.xz, N.xz) * 0.5);
  vec3 pers = mix(vec3(0.11, 0.06, 0.03), mix(vec3(0.05, 0.16, 0.08), vec3(0.16, 0.09, 0.04), step(0.6, hash12(vec2(wallId, 3.0)))), lake);
  vec3 albF = vCol.rgb * (0.9 + 0.2 * n);
  albF = mix(albF, vec3(0.6, 0.58, 0.53), lake * sur * (1.0 - win));
  albF = mix(albF, pers * (0.85 + 0.3 * step(0.5, fract(up * 6.0))), shut * (1.0 - win));
  alb = mix(alb, albF, fac);
  if (vCol.a < 0.95 && lid < 6) {
    // photo-scanned surfaces, mapped by world position (boards run horizontally on walls), with their normal maps
    int li = int(vCol.a * 8.0); float layer = float(li);
    vec3 bw = pow(abs(N), vec3(6.0)); bw /= dot(bw, vec3(1.0));
    vec3 P = vPos / propScale[li];
    vec2 ux = vec2(P.z, -P.y), uy = P.xz, uz = vec2(P.x, -P.y);
    vec3 a = pow(texture(propAlb, vec3(ux, layer)).rgb, vec3(2.2)) * bw.x + pow(texture(propAlb, vec3(uy, layer)).rgb, vec3(2.2)) * bw.y + pow(texture(propAlb, vec3(uz, layer)).rgb, vec3(2.2)) * bw.z;
    vec2 tx = texture(propNH, vec3(ux, layer)).rg * 2.0 - 1.0, ty = texture(propNH, vec3(uy, layer)).rg * 2.0 - 1.0, tz = texture(propNH, vec3(uz, layer)).rg * 2.0 - 1.0;
    N = normalize(N + (vec3(0.0, -tx.y, tx.x) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, -tz.y, 0.0) * bw.z) * 0.8);
    alb = a * vCol.rgb / max(propMean[li], vec3(0.01)) * (0.9 + 0.2 * n);
  }
  // dirt and damp near the ground
  float g = clamp((vPos.y - hG) / 0.8, 0.0, 1.0);
  alb *= mix(0.6, 1.0, g);
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  vec3 col = alb * (sunCol * max(dot(N, sunDir), 0.0) * sh + ambient(N) * mix(0.5, 1.0, g) * 0.95) / PI;
  if (specK > 0.0) { vec3 H = normalize(V + sunDir); col += sunCol * pow(max(dot(N, H), 0.0), 40.0) * 0.12 * sh + skyL(normalize(vec3(reflect(-V, N).x, max(reflect(-V, N).y, 0.02), reflect(-V, N).z))) * 0.04 * (0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0)); }
  { vec3 R = reflect(-V, N); float f = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 glassC = vec3(0.012, 0.01, 0.008) * ambient(N) * 0.5 + skyL(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * mix(0.08, 1.0, f) * 0.6;
    col = mix(col, glassC, fac * win); }
  col = aerial(col, vPos);
  gl_FragColor = vec4(col, 1.0);
}`;
  const propMat = new BABYLON.ShaderMaterial('propMat', scene, { vertex: 'prop', fragment: 'prop' }, {
    attributes: ['position', 'normal', 'color'],
    uniforms: ['floatO', 'world', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS, 'propMean', 'propScale'],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'propAlb', 'propNH'],
  });
  {
    const info = await getJSON('textures/props/props_layers.json'), S = info.size, NL = info.layers.length;
    const [a, b] = await Promise.all([loadStrip('textures/props/albedo.jpg'), loadStrip('textures/props/nh.jpg')]);
    for (const [k, d] of [['propAlb', a], ['propNH', b]]) { const t = new BABYLON.RawTexture2DArray(d, S, S, NL, BABYLON.Engine.TEXTUREFORMAT_RGBA, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE); t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 8; propMat.setTexture(k, t); }
    propMat.setArray3('propMean', info.layers.map((l) => info.linear_mean_albedo[l]).flat());
    propMat.setFloats('propScale', [2.4, 2.0, 3.0, 2.6, 1.6, 1.6]);
  }
  propMat.backFaceCulling = false;     // generated boxes and roofs mix face orientations; normals are explicit
  bindLevels(propMat); worldMats.push(propMat);
  const tint = (m, c) => { const n = m.getTotalVertices(), a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]], i * 4); m.setVerticesData('color', a); return m; };
  const prism = (name, w, h, len) => {     // gable roof: triangle in x/y extruded along z, flat-shaded
    const x = w / 2, z = len / 2, P = [[-x, 0, -z], [x, 0, -z], [0, h, -z], [-x, 0, z], [x, 0, z], [0, h, z]];
    const tris = [[0, 2, 1], [3, 4, 5], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 4], [0, 1, 4], [0, 4, 3]], pos = [], idx = [];
    tris.forEach((t) => { t.forEach((k) => { pos.push(...P[k]); idx.push(idx.length); }); });
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; const nr = []; BABYLON.VertexData.ComputeNormals(pos, idx, nr); vd.normals = nr; vd.uvs = new Array(pos.length / 3 * 2).fill(0);
    const m = new BABYLON.Mesh(name, scene); vd.applyToMesh(m); return m;
  };
  const placeProp = (parts, x, z, yaw, sink = 0.3) => {
    const m = BABYLON.Mesh.MergeMeshes(parts, true, true); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false;
    // sit on the lowest ground under the footprint so nothing floats
    const bb = m.getBoundingInfo().boundingBox; let gy = Infinity;
    for (const [u, v] of [[bb.minimum.x, bb.minimum.z], [bb.maximum.x, bb.minimum.z], [bb.minimum.x, bb.maximum.z], [bb.maximum.x, bb.maximum.z], [0, 0]]) {
      const c = Math.cos(yaw), s = Math.sin(yaw); gy = Math.min(gy, terrainH(x + u * c + v * s, z - u * s + v * c));
    }
    m.position.set(x, gy - sink, z); m.rotation.y = yaw; m.freezeWorldMatrix(); return m;
  };
  // San Mauriz chapel (2003) just west of the pass: white nave, steep shingle roof, a ridge turret with a slender spire
  {
    const WHITE = [0.6, 0.585, 0.55, 2.5 / 8], ROOF = [0.12, 0.105, 0.095, 4.5 / 8], STONE = [0.32, 0.30, 0.28, 3.5 / 8], DOOR = [0.16, 0.09, 0.05, 1.5 / 8];
    const p = [];
    const box = (w, h, d, x, y, z, c) => { const b = BABYLON.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, scene); b.position.set(x, y, z); p.push(tint(b, c)); return b; };
    box(5.8, 0.8, 9.0, 0, 0.4, 0, STONE);
    box(5.4, 3.8, 8.6, 0, 2.7, 0, WHITE);
    const gw = prism('g', 5.4, 3.2, 8.6); gw.position.set(0, 4.6, 0); p.push(tint(gw, WHITE));
    const rf = prism('r', 6.4, 3.75, 9.6); rf.position.set(0, 4.45, 0.15); p.push(tint(rf, ROOF));
    box(1.5, 3.4, 1.5, 0, 8.6, 3.0, WHITE);
    const sp = BABYLON.MeshBuilder.CreateCylinder('sp', { height: 3.6, diameterTop: 0, diameterBottom: 2.3, tessellation: 4 }, scene); sp.rotation.y = Math.PI / 4; sp.position.set(0, 12.1, 3.0); p.push(tint(sp, ROOF));
    box(1.3, 2.3, 0.15, 0, 1.95, 4.33, DOOR);
    for (const sx of [-1, 1]) box(0.12, 1.3, 0.7, sx * 2.72, 3.0, 0.5, [0.08, 0.08, 0.09]);
    const c = L0.chapel_san_mauriz;
    var chapel = placeProp(p, c[0], c[2], Math.atan2(-22, -34), 0.5);
  }
  BABYLON.Effect.ShadersStore.proxyVertexShader = `precision highp float; uniform vec3 floatO;
attribute vec3 position; attribute vec3 normal; attribute vec4 color;
uniform mat4 viewProjection; varying vec3 vPos; varying vec3 vN; varying vec3 vCol;
void main() { vPos = position; vN = normal; vCol = color.rgb; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
  BABYLON.Effect.ShadersStore.proxyFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
varying vec3 vPos; varying vec3 vN; varying vec3 vCol;
void main() {
  vec3 N = normalize(vN);
  vec3 col = vCol * (sunCol * max(dot(N, sunDir), 0.0) * (sunShadow(vPos.xz) * cloudShade(vPos)) + ambient(N)) / PI;
  gl_FragColor = vec4(aerial(col, vPos), 1.0);
}`;
  const proxyMat = new BABYLON.ShaderMaterial('proxyMat', scene, { vertex: 'proxy', fragment: 'proxy' }, {
    attributes: ['position', 'normal', 'color'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT'],
  });
  bindLevels(proxyMat); worldMats.push(proxyMat);
  // ---------- signs of life: real buildings (OSM footprints), malgas, guard rails, road posts, fences, crosses, lifts, cows ----------
  const PROPS = await getJSON(MAP + 'props.json');
  const Geo = () => {      // accumulates coloured boxes and gable prisms into a few big meshes (one draw each; split every ~400k vertices)
    let pos = [], nrm = [], col = [], idx = [], doneTris = 0; const chunks = [];
    const flush = () => { if (!idx.length) return; const v = new BABYLON.VertexData(); v.positions = new Float32Array(pos); v.normals = new Float32Array(nrm); v.colors = new Float32Array(col); v.indices = new Uint32Array(idx); doneTris += idx.length / 3; chunks.push(v); pos = []; nrm = []; col = []; idx = []; };
    const room = () => { if (pos.length > 1200000) flush(); };
    const quad = (a, b, c, d, n, k) => { room(); const o = pos.length / 3; for (const p of [a, b, c, d]) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); col.push(k[0], k[1], k[2], k[3] === undefined ? 1 : k[3]); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    const tri = (a, b, c, n, k) => { room(); const o = pos.length / 3; for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); col.push(k[0], k[1], k[2], k[3] === undefined ? 1 : k[3]); } idx.push(o, o + 1, o + 2); };
    // frame: origin o (x, y, z), yaw so that local +z points along (sin yaw, cos yaw)
    const T = (o, yaw, x, y, z) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [o[0] + x * c + z * s, o[1] + y, o[2] - x * s + z * c]; };
    const R = (yaw, x, y, z) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x * c + z * s, y, -x * s + z * c]; };
    const box = (o, yaw, cx, cy, cz, hx, hy, hz, k) => {
      const P = (x, y, z) => T(o, yaw, cx + x, cy + y, cz + z);
      quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), R(yaw, 0, 0, 1), k);
      quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), R(yaw, 0, 0, -1), k);
      quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), R(yaw, 1, 0, 0), k);
      quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), R(yaw, -1, 0, 0), k);
      quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [0, 1, 0], k);
    };
    // gable roof over a w (x) by l (z) footprint at height y, ridge along z, rise h, overhang ov; gable ends in wall colour kw
    const roof = (o, yaw, y, w, l, h, ov, k, kw) => {
      const hx = w / 2 + ov, hz = l / 2 + ov, P = (x, yy, z) => T(o, yaw, x, yy, z), sl = Math.hypot(hx, h);
      quad(P(-hx, y - ov * h / hx, hz), P(0, y + h, hz), P(0, y + h, -hz), P(-hx, y - ov * h / hx, -hz), R(yaw, -h / sl, hx / sl, 0), k);
      quad(P(0, y + h, hz), P(hx, y - ov * h / hx, hz), P(hx, y - ov * h / hx, -hz), P(0, y + h, -hz), R(yaw, h / sl, hx / sl, 0), k);
      quad(P(-hx, y - ov * h / hx - 0.12, hz), P(hx, y - ov * h / hx - 0.12, hz), P(hx, y - ov * h / hx, hz), P(-hx, y - ov * h / hx, hz), R(yaw, 0, 0, 1), k);
      for (const sz of [1, -1]) { const z = sz * l / 2; tri(P(-w / 2, y, z), P(w / 2, y, z), P(0, y + h * (w / 2) / hx, z), R(yaw, 0, 0, sz), kw); }
    };
    // hipped roof (lake towns): four slopes over a w by l footprint, eaves overhang ov, rise h
    const hip = (o, yaw, y, w, l, h, ov, k) => {
      const hx = w / 2 + ov, hz = l / 2 + ov, r = Math.max(0, hz - hx), P = (x, yy, z) => T(o, yaw, x, yy, z), ye = y - ov * h / (w / 2);
      const s1 = Math.hypot(hx, h + ov * h / (w / 2));
      quad(P(-hx, ye, hz), P(0, y + h, r), P(0, y + h, -r), P(-hx, ye, -hz), R(yaw, -h / s1, hx / s1, 0), k);
      quad(P(0, y + h, r), P(hx, ye, hz), P(hx, ye, -hz), P(0, y + h, -r), R(yaw, h / s1, hx / s1, 0), k);
      tri(P(hx, ye, hz), P(0, y + h, r), P(-hx, ye, hz), R(yaw, 0, hx / s1, h / s1), k);
      tri(P(-hx, ye, -hz), P(0, y + h, -r), P(hx, ye, -hz), R(yaw, 0, hx / s1, -h / s1), k);
      quad(P(-hx, ye - 0.18, hz), P(hx, ye - 0.18, hz), P(hx, ye, hz), P(-hx, ye, hz), R(yaw, 0, 0, 1), k);
      quad(P(hx, ye - 0.18, -hz), P(-hx, ye - 0.18, -hz), P(-hx, ye, -hz), P(hx, ye, -hz), R(yaw, 0, 0, -1), k);
      quad(P(hx, ye - 0.18, hz), P(hx, ye - 0.18, -hz), P(hx, ye, -hz), P(hx, ye, hz), R(yaw, 1, 0, 0), k);
      quad(P(-hx, ye - 0.18, -hz), P(-hx, ye - 0.18, hz), P(-hx, ye, hz), P(-hx, ye, -hz), R(yaw, -1, 0, 0), k);
      quad(P(-hx, ye - 0.18, -hz), P(hx, ye - 0.18, -hz), P(hx, ye - 0.18, hz), P(-hx, ye - 0.18, hz), [0, -1, 0], k);
    };
    // vds() hands the chunks over and forgets them: the builders live on in cell maps, and keeping the chunks kept every
    // building's vertex arrays alive (214 MB) after upload (memory work, 2026-10-19)
    let tris = 0; const vds = () => { flush(); return chunks.splice(0); };
    return { box, roof, hip, quad, vds, count: () => doneTris + idx.length / 3 };
  };
  // albedo targets; the 4th value picks the texture layer (assets/textures/props: 0 weathered boards, 1 dark planks, 2 plaster, 3 stone wall, 4 shingles, 5 galvanised steel)
  const L = (i) => (i + 0.5) / 8, LYR = L;     // LYR: same, for code where L is a building's length
  const C = { stone: [0.26, 0.25, 0.235, L(3)], plaster: [0.42, 0.405, 0.375, L(2)], wood: [0.1, 0.06, 0.033, L(1)], woodOld: [0.15, 0.115, 0.085, L(0)], shingle: [0.1, 0.085, 0.075, L(4)], metal: [0.17, 0.16, 0.15, L(5)], redRoof: [0.22, 0.08, 0.05, L(5)],
    win: [0.025, 0.03, 0.035], steel: [0.2, 0.205, 0.21, L(5)], white: [0.45, 0.45, 0.43, L(2)], black: [0.03, 0.03, 0.03], cowB: [0.12, 0.07, 0.035], cowG: [0.2, 0.18, 0.15] };
  const groundUnder = (cx, cz, l, w, yaw) => { let g = Infinity; for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const p = [cx + (a * w / 2) * Math.cos(yaw) + (b * l / 2) * Math.sin(yaw), cz - (a * w / 2) * Math.sin(yaw) + (b * l / 2) * Math.cos(yaw)]; g = Math.min(g, terrainH(p[0], p[1])); } return g; };
  let G = Geo(); const G_MAIN = G; const vineMeshes = [];
  // promote the two biggest huts near the road to working malgas (Malga Cir and Rifugio Jimmy are already tagged)
  PROPS.buildings.filter((b) => b.cls === 'hut' && roadDistApprox(b.c[0], b.c[1]) < 450).sort((a, b) => b.len * b.wid - a.len * a.wid).slice(0, 2).forEach((b) => { b.cls = 'malga'; });
  function roadDistApprox(x, z) { let d = 1e9; for (const r of ROADS) for (let i = 0; i < r.points.length; i += 5) { const p = r.points[i]; d = Math.min(d, (p[0] - x) ** 2 + (p[2] - z) ** 2); } return Math.sqrt(d); }
  const malgas = [];
  const bldGrid = new Map();     // footprints, for keeping grass out of houses
  for (const b of PROPS.buildings) { const r = Math.hypot(b.len, b.wid) / 2 + 2.5; for (let gx = Math.floor((b.c[0] - r) / 16); gx <= Math.floor((b.c[0] + r) / 16); gx++) for (let gz = Math.floor((b.c[1] - r) / 16); gz <= Math.floor((b.c[1] + r) / 16); gz++) { const k = gx + ',' + gz; if (!bldGrid.has(k)) bldGrid.set(k, []); bldGrid.get(k).push([b.c[0], b.c[1], r]); } }
  var inBuilding = (x, z) => { const l = bldGrid.get(Math.floor(x / 16) + ',' + Math.floor(z / 16)); if (!l) return false; for (const [cx, cz, r] of l) if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true; return false; };
  // facade kit (local frame: x across the width W, z along the length L, y up from the stone base).
  // Every attachment starts a few cm inside the wall it hangs on: no coplanar faces, so nothing z-fights when drawn double-sided.
  const GLASS = [0.02, 0.022, 0.025, (6 + 0.5) / 8], METAL = (k) => [k[0], k[1], k[2], (7 + 0.5) / 8];
  const RED = [0.42, 0.02, 0.02], PINK = [0.5, 0.12, 0.2], GLEAF = [0.035, 0.08, 0.02];
  let flowerSeed = 1; const frnd = () => { flowerSeed = (flowerSeed * 16807) % 2147483647; return flowerSeed / 2147483647; };
  // one window on a wall: face = 'x+', 'x-', 'z+', 'z-'; u = position along the wall, y0 = sill height
  const windowAt = (o, yaw, W, L, face, u, y0, w, h, opt) => {
    const ax = face[0] === 'x', sg = face[1] === '+' ? 1 : -1, d0 = (ax ? W : L) / 2;
    // place a box given (along, up, out) offsets and half sizes; out is measured from the wall plane
    const B = (au, ay, ao, hu, hy, ho, k) => ax ? G.box(o, yaw, sg * (d0 + ao), ay, au, ho, hy, hu, k) : G.box(o, yaw, au, ay, sg * (d0 + ao), hu, hy, ho, k);
    const fr = opt.frame, t = 0.07;
    B(u, y0 + h / 2, 0.0, w / 2 + t, h / 2 + t, 0.05, fr);                                         // frame (a slab behind the glass, showing round its edge)
    B(u, y0 + h / 2, 0.03, w / 2, h / 2, 0.03, GLASS);                                              // glass, proud of the frame
    B(u, y0 + h / 2, 0.055, 0.025, h / 2, 0.012, fr); B(u, y0 + h * 0.62, 0.055, w / 2, 0.022, 0.012, fr);   // mullion and transom
    B(u, y0 - 0.04, 0.05, w / 2 + 0.12, 0.04, 0.1, opt.sill || fr);                                 // sill, projecting
    if (opt.shutters) for (const s2 of [-1, 1]) {
      const cu = u + s2 * (w / 2 + t + w / 4 + 0.02);
      B(cu, y0 + h / 2, 0.03, w / 4, h / 2 + 0.04, 0.025, opt.shutters);

    }
    if (opt.flowers) {                                                                                // geranium box under the sill
      B(u, y0 - 0.2, 0.14, w / 2 + 0.06, 0.1, 0.12, C.wood);
      for (let k = 0; k < 4; k++) { const fu = u - w / 2 + (k + frnd()) * w / 4, s3 = 0.07 + frnd() * 0.05; B(fu, y0 - 0.06 + s3, 0.14 + (frnd() - 0.5) * 0.12, s3, s3, s3, k % 3 ? (frnd() < 0.8 ? RED : PINK) : GLEAF); }
    }
  };
  const balcony = (o, yaw, W, L, side, yFloor, len, depth, opt) => {      // timber balcony along a long wall: slab, slatted balustrade, top rail, flower boxes
    const sg = side, x0 = W / 2, xs = sg * (x0 + depth / 2 - 0.05);
    G.box(o, yaw, xs, yFloor - 0.06, 0, depth / 2 + 0.05, 0.06, len / 2, C.wood);
    const n = Math.round(len / 0.36), xr = sg * (x0 + depth - 0.04);
    for (let k = 0; k <= n; k++) G.box(o, yaw, xr, yFloor + 0.5, -len / 2 + k * len / n, 0.025, 0.46, 0.055, C.woodOld);
    G.box(o, yaw, xr, yFloor + 0.98, 0, 0.06, 0.04, len / 2 + 0.03, C.wood);
    for (const ez of [-1, 1]) { G.box(o, yaw, sg * (x0 + depth / 2 - 0.02), yFloor + 0.5, ez * (len / 2 - 0.03), depth / 2 - 0.03, 0.46, 0.025, C.woodOld); }
    if (opt.flowers) {
      G.box(o, yaw, sg * (x0 + depth + 0.08), yFloor + 0.9, 0, 0.1, 0.1, len / 2 - 0.1, C.wood);
      const m = Math.round(len * 2.5);
      for (let k = 0; k < m; k++) { const fz = -len / 2 + 0.15 + (k + frnd()) * (len - 0.3) / m, s3 = 0.04 + frnd() * 0.04;
        G.box(o, yaw, sg * (x0 + depth + 0.08 + (frnd() - 0.4) * 0.15), yFloor + 1.0 + s3 + frnd() * 0.1 - (frnd() < 0.3 ? 0.25 : 0), fz, s3, s3 * (frnd() < 0.3 ? 2.4 : 1), s3, k % 4 ? (frnd() < 0.85 ? RED : PINK) : GLEAF); }
    }
  };
  const door = (o, yaw, W, L, face, u, k) => {
    const ax = face[0] === 'x', sg = face[1] === '+' ? 1 : -1, d0 = (ax ? W : L) / 2;
    const B = (au, ay, ao, hu, hy, ho, kk) => ax ? G.box(o, yaw, sg * (d0 + ao), ay, au, ho, hy, hu, kk) : G.box(o, yaw, au, ay, sg * (d0 + ao), hu, hy, ho, kk);
    B(u, 0.6 + 1.1, 0.02, 0.55, 1.1, 0.04, k); B(u, 0.6 + 2.3, 0.02, 0.7, 0.08, 0.07, C.woodOld);
    for (let i = 0; i < 4; i++) B(u, 0.75 + i * 0.5, 0.06, 0.45, 0.015, 0.015, C.woodOld);
    B(u, 0.6 + 2.75, 0.55, 0.95, 0.05, 0.6, C.shingle);                                             // little canopy
    B(u, 0.3, 0.45, 0.8, 0.3, 0.45, C.stone);                                                       // step
  };
  const chimney = (o, yaw, x, z, top) => { G.box(o, yaw, x, top - 1.2, z, 0.35, 1.6, 0.35, C.plaster); G.box(o, yaw, x, top + 0.45, z, 0.45, 0.05, 0.45, C.metal); };
  const PLASTER = [[0.44, 0.42, 0.38, L(2)], [0.47, 0.42, 0.32, L(2)], [0.42, 0.4, 0.38, L(2)], [0.48, 0.38, 0.24, L(2)]];
  const PLASTER_LAKE = [[0.5, 0.4, 0.28, L(2)], [0.5, 0.33, 0.22, L(2)], [0.48, 0.44, 0.34, L(2)], [0.46, 0.42, 0.36, L(2)], [0.42, 0.3, 0.24, L(2)]], TERRACOTTA = [0.3, 0.12, 0.07, L(5)];
  // Garda waterfront reference: ochre, faded coral, ivory, sage and rose plaster.
  // Share each building's colour between full geometry and distant massing.
  const PLASTER_GARDA = [[0.42, 0.29, 0.14, L(2)], [0.4, 0.17, 0.115, L(2)], [0.48, 0.43, 0.34, L(2)], [0.3, 0.37, 0.28, L(2)], [0.43, 0.275, 0.25, L(2)]];
  const townPlaster = (b, rr) => { const palette = b.patch === 'garda' ? PLASTER_GARDA : PLASTER_LAKE; return palette[Math.floor(rr * 13) % palette.length]; };
  // Older exports collapsed every large footprint to "hotel". Prefer source tags on new
  // exports; broad, unnamed blocks use a conservative hall fallback, never a scaled-up house.
  const isHall = b => ['industrial', 'warehouse', 'commercial', 'retail'].includes(b.use) ||
    ((!b.use || b.use === 'yes') && b.cls === 'hotel' && (b.patch !== 'garda' || ['riva', 'torbole'].every(name => { const lm = L0[name]; return !lm || Math.hypot(b.c[0] - lm[0], b.c[1] - lm[lm.length - 1]) > 450; })) && Math.min(b.len, b.wid) > 28 && b.len * b.wid > 1400 && !/hotel|albergo|residen|school|scuola|ospedale/i.test(b.name || ''));
  const roofRise = w => Math.min(3.4, w * 0.2);
  const townRoof = rr => [[0.22, 0.13, 0.10, L(5)], [0.27, 0.17, 0.13, L(5)], [0.19, 0.15, 0.13, L(5)], [0.24, 0.145, 0.11, L(5)]][Math.floor(rr * 19) % 4];
  const hallBuilding = (b, o, yaw, len, wid, rr) => {
    const h = 5.5 + rr * 3.5, wall = [0.34 + rr * 0.07, 0.34 + rr * 0.065, 0.32 + rr * 0.07, L(2)];
    const roof = [0.19 + rr * 0.07, 0.205 + rr * 0.07, 0.205 + rr * 0.07, L(7)], trim = [0.22, 0.235, 0.23, L(7)];
    G.box(o, yaw, 0, h / 2, 0, wid / 2, h / 2, len / 2, wall);
    G.box(o, yaw, 0, 0.55, 0, wid / 2 + 0.03, 0.55, len / 2 + 0.03, C.stone);
    G.box(o, yaw, 0, h, 0, wid / 2 + 0.2, 0.25, len / 2 + 0.2, roof);
    // Low roof bays and skylights break up the real large footprint without giant hip roofs.
    const bays = Math.min(8, Math.max(2, Math.round(wid / 14))), bw = wid / bays;
    for (let j = 0; j < bays; j++) {
      const x = -wid / 2 + (j + 0.5) * bw;
      G.box(o, yaw, x, h + 0.32, 0, 0.12, 0.12, len / 2, trim);
      G.box(o, yaw, x + bw * 0.15, h + 0.4, 0, bw * 0.09, 0.12, len * 0.32, [0.15, 0.19, 0.19, L(7)]);
    }
    const baysL = Math.min(16, Math.max(2, Math.floor(len / 12)));
    for (const sd of [-1, 1]) {
      G.box(o, yaw, sd * (wid / 2 + 0.03), h - 1.3, 0, 0.03, 0.5, len * 0.46, [0.075, 0.10, 0.105, L(7)]);
      for (let j = 0; j < baysL; j++) {
        const z = -len / 2 + (j + 0.5) * len / baysL;
        G.box(o, yaw, sd * (wid / 2 + 0.06), 2.0, z, 0.05, 1.8, 1.9, trim);
      }
    }
  };
  const SHUTTER = [[0.04, 0.12, 0.06], [0.11, 0.06, 0.03], [0.05, 0.07, 0.1]], FRAME_W = [0.5, 0.48, 0.44, L(2)];
  // road distance grid for the buildings (full facades near the road, simple massing further away)
  const bRoadGrid = new Map(); for (const r of ROADS) r.points.forEach((p, i) => { if (i % 4) return; const k = Math.floor(p[0] / 64) + ',' + Math.floor(p[2] / 64); if (!bRoadGrid.has(k)) bRoadGrid.set(k, []); bRoadGrid.get(k).push(p); });
  const bRoadDist = (x, z) => { let d = 1e9; const gx = Math.floor(x / 64), gz = Math.floor(z / 64); for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) { const l = bRoadGrid.get((gx + i) + ',' + (gz + j)); if (l) for (const p of l) d = Math.min(d, (p[0] - x) ** 2 + (p[2] - z) ** 2); } return Math.sqrt(d); };
  let nSimple = 0;
  // Keep full facades distributed across the towns instead of spending the entire
  // lake budget on the first roadside cluster. Waterfront streets count even off-route.
  { const ds = PROPS.buildings.filter(b => b.patch && b.patch !== 'dolomites').map(b => [bRoadDist(b.c[0], b.c[1]), b]).sort((a, b) => a[0] - b[0]);
    const districts = new Map();
    ds.forEach(([d, b], i) => {
      b.full = !isHall(b) && b.patch !== 'garda' && i < 150 && d < 120 && b.len * b.wid < 400 && b.cls !== 'hotel';
      if (b.patch !== 'garda' || isHall(b) || b.cls === 'hut' || b.len * b.wid > 1000 || Math.max(b.len, b.wid) > 60) return;
      let score = d;
      if (WATER && Math.abs(terrainH(b.c[0], b.c[1]) - WATER.y) < 60) for (const name of ['riva', 'torbole']) {
        const lm = L0[name]; if (lm) score = Math.min(score, Math.hypot(b.c[0] - lm[0], b.c[1] - lm[lm.length - 1]) * 0.45);
      }
      if (score > 180) return;
      const key = Math.floor(b.c[0] / 256) + ',' + Math.floor(b.c[1] / 256);
      if (!districts.has(key)) districts.set(key, []);
      districts.get(key).push({ b, score, cost: (b.len + b.wid) * Math.max(2, b.levels || 3) });
    });
    const groups = [...districts.values()]; for (const group of groups) group.sort((a, b) => a.score - b.score);
    groups.sort((a, b) => a[0].score - b[0].score);
    let count = 0, cost = 0;
    for (let rank = 0; rank < 14; rank++) for (const group of groups) {
      const q = group[rank]; if (!q || count >= 300 || cost + q.cost > 55000) continue;
      q.b.full = true; count++; cost += q.cost;
    }
  }
  // Full and simple versions swap together in 256 m cells, within ~400 m.
  const BCELL = 256, bcells = new Map();
  const SCELL = 1024, scells = new Map();
  const scell = (b) => { const k = Math.floor(b.c[0] / SCELL) + ',' + Math.floor(b.c[1] / SCELL); if (!scells.has(k)) scells.set(k, Geo()); return scells.get(k); };
  const bcell = (b) => { const k = Math.floor(b.c[0] / BCELL) + ',' + Math.floor(b.c[1] / BCELL); if (!bcells.has(k)) bcells.set(k, { cx: (Math.floor(b.c[0] / BCELL) + 0.5) * BCELL, cz: (Math.floor(b.c[1] / BCELL) + 0.5) * BCELL, simple: Geo(), full: Geo(), hasFull: false }); return bcells.get(k); };
  const simpleBuilding = (b, o, yaw, L, W, rr) => {
    if (b.cls === 'castle') {      // stone, roofless: towers tall, ruins low, the palas in between (as the full version)
      const h = b.part === 'tower' ? 17 + rr * 7 : b.part === 'ruin' ? 4 + rr * 3 : 8 + rr * 6;
      G.box(o, yaw, 0, h / 2, 0, W / 2, h / 2, L / 2, C.stone); G.box(o, yaw, 0, h + 0.5, 0, W / 2 + 0.2, 0.5, L / 2 + 0.2, [0.3, 0.27, 0.24, LYR(3)]); return;
    }
    const lake = b.patch === 'garda' || b.patch === 'bolzano';
    if (lake && isHall(b)) { hallBuilding(b, o, yaw, L, W, rr); return; }
    const nf = b.cls === 'hut' ? 1 : b.cls === 'castle' ? 3 : Math.max(2, Math.min(lake && b.cls === 'hotel' ? 6 : 5, b.levels || 2)), Hs = 0.6 + nf * (lake ? 3.1 : 2.9);
    const pl = lake ? townPlaster(b, rr) : b.cls === 'hut' ? C.woodOld : PLASTER[Math.floor(rr * 11) % 4];
    const facade = b.cls !== 'hut' && b.cls !== 'castle';
    if (b.cls === 'hut' && !lake && barnKind(b) === 'tabla') { G.box(o, yaw, 0, 1.2, 0, W / 2, 1.2, L / 2, C.white); G.box(o, yaw, 0, 2.4 + 1.3, 0, W / 2 - 0.03, 1.3, L / 2 - 0.03, C.woodOld); G.roof(o, yaw, 5.0, W, L, W * 0.55, 0.8, C.shingle, C.woodOld); return; }
    G.box(o, yaw, 0, Hs / 2, 0, W / 2, Hs / 2, L / 2, b.cls === 'castle' ? C.stone : b.cls === 'hut' ? (lake ? pl : C.woodOld) : facade ? [pl[0], pl[1], pl[2], lake ? 1.5 : 1.75] : pl);
    if (lake && facade) {
      G.hip(o, yaw, Hs, W, L, roofRise(W), 0.55, townRoof(rr));
      // Readable silhouettes between full-detail cells: plinth, cornice and entrance.
      if (b.patch === 'garda' && L * W < 1000 && bRoadDist(b.c[0], b.c[1]) < 240) {
        G.box(o, yaw, 0, 0.4, 0, W / 2 + 0.06, 0.4, L / 2 + 0.06, C.stone);
        G.box(o, yaw, 0, Hs - 0.12, 0, W / 2 + 0.16, 0.12, L / 2 + 0.16, FRAME_W);
        G.box(o, yaw, 0, 3.6, 0, W / 2 + 0.06, 0.07, L / 2 + 0.06, FRAME_W);
        G.box(o, yaw, W / 2 + 0.04, 1.65, 0, 0.04, 1.1, 0.65, C.woodOld);
      }
    }
    else G.roof(o, yaw, Hs, W, L, W * (lake ? 0.24 : 0.4), lake ? 0.5 : 1.0, lake ? TERRACOTTA : b.cls === 'hut' ? C.shingle : rr < 0.35 ? C.redRoof : C.metal, pl);
  };
  // Dolomites outbuildings by reference type (ref/val-gardena): tablà hay barns on the bigger footprints, log huts, stone-and-timber sheds
  function barnKind(b) { const h = Math.abs(Math.sin(b.c[0] * 0.731 + b.c[1] * 1.37) * 4371.3) % 1; return QS.has('nostage1') ? 'log' : b.len * b.wid > 34 && h < 0.75 ? 'tabla' : h < 0.55 ? 'log' : 'stone'; }
  const BCOLL = [];      // collision boxes for the buildings (physics adds the ones near the car, see placeHeightfield)
  for (const b of PROPS.buildings) {
    const yaw = Math.PI / 2 - b.ang, L = Math.max(4, b.len), W = Math.max(3.5, b.wid);
    const g = groundUnder(b.c[0], b.c[1], L, W, yaw), o = [b.c[0], g - 0.4, b.c[1]];
    BCOLL.push({ x: b.c[0], z: b.c[1], y: g - 1.5, yaw, hx: W / 2, hz: L / 2 });
    const cell = bcell(b), rr0 = Math.abs((b.c[0] * 7.1 + b.c[1] * 3.7) % 1);
    if (b.patch && b.patch !== 'dolomites' && b.cls !== 'castle' && !b.full) { G = scell(b); simpleBuilding(b, o, yaw, L, W, rr0); nSimple++; G = G_MAIN; continue; }
    G = cell.simple; simpleBuilding(b, o, yaw, L, W, rr0);
    G = cell.full; cell.hasFull = true;
    const h1 = (b.c[0] * 7.1 + b.c[1] * 3.7) % 1, rr = Math.abs(h1);
    flowerSeed = 1 + Math.floor(rr * 1e6);
    const lakeStyle = b.patch === 'garda' || b.patch === 'bolzano';
    const shut = SHUTTER[Math.floor(rr * 7) % 3], plaster = lakeStyle ? townPlaster(b, rr) : PLASTER[Math.floor(rr * 11) % 4];
    const winRow = (yb, h, w, opt, faces = ['x+', 'x-']) => {
      for (const f of faces) { const len = f[0] === 'x' ? L : W, n = Math.max(1, Math.floor((len - 1.2) / (opt.spacing || 2.6)));
        for (let i = 0; i < n; i++) { if (opt.skip && opt.skip(f, i, n)) continue; windowAt(o, yaw, W, L, f, -len / 2 + (i + 0.5) * len / n, yb, w, h, opt); } }
    };
    if (b.cls === 'hut' && lakeStyle) {
      // lake towns and the Adige valley: a small plastered outbuilding (garage, store, boathouse) with a low terracotta roof
      const H = 2.8 + rr * 0.8;
      G.box(o, yaw, 0, 0.3, 0, W / 2 + 0.05, 0.3, L / 2 + 0.05, C.stone);
      G.box(o, yaw, 0, 0.6 + H / 2, 0, W / 2, H / 2, L / 2, plaster);
      door(o, yaw, W, L, 'z+', 0, rr < 0.5 ? [0.18, 0.2, 0.17] : C.wood);
      if (L > 5) windowAt(o, yaw, W, L, 'x+', 0, 1.7, 0.6, 0.7, { frame: [0.6, 0.58, 0.53, LYR(2)], shutters: SHUTTER[0] });
      G.hip(o, yaw, 0.6 + H, W, L, W * 0.18, 0.35, TERRACOTTA);
    } else if (b.cls === 'hut' && barnKind(b) === 'tabla') {
      // Val Gardena hay barn (tablà; ref/val-gardena 11, 23): white plaster byre below, a weathered board hayloft above with a slatted
      // gable, a steep shingle roof with deep eaves, and a timber ramp up to the loft door on one long side
      G.box(o, yaw, 0, 1.2, 0, W / 2, 1.2, L / 2, C.white);
      G.box(o, yaw, 0, 2.4 + 1.3, 0, W / 2 - 0.03, 1.3, L / 2 - 0.03, C.woodOld);
      for (let k = -3; k <= 3; k++) for (const sz of [1, -1]) G.box(o, yaw, k * W / 8, 4.2 + (1 - Math.abs(k) / 4) * W * 0.18, sz * (L / 2 - 0.01), 0.03, (1 - Math.abs(k) / 4) * W * 0.22 + 0.2, 0.025, C.wood);      // slatted gable
      G.box(o, yaw, 0, 2.42, 0, W / 2 + 0.06, 0.06, L / 2 + 0.06, C.wood);      // the loft floor beam
      door(o, yaw, W, L, 'z+', -W * 0.2, C.wood); if (L > 6) windowAt(o, yaw, W, L, 'x+', -L * 0.2, 1.2, 0.5, 0.45, { frame: C.wood });
      const rw = Math.min(2.4, W * 0.5); G.box(o, yaw, W / 2 + 1.6, 1.25, 0, 1.6, 0.06, rw / 2, C.woodOld); G.box(o, yaw, W / 2 + 3.1, 0.6, 0, 0.12, 0.6, rw / 2, C.stone);      // ramp and its stone head
      G.box(o, yaw, W / 2 + 0.03, 3.45, 0, 0.04, 0.95, rw / 2 - 0.1, C.wood);      // loft door
      G.roof(o, yaw, 5.0, W, L, W * 0.55, 0.8, C.shingle, C.woodOld);
    } else if (b.cls === 'hut' && barnKind(b) === 'stone') {
      // stone-and-timber shed (ref 24): rubble walls to the eaves on the uphill side, boards above, low shingle roof
      G.box(o, yaw, 0, 0.9, 0, W / 2, 0.9, L / 2, C.stone);
      G.box(o, yaw, 0, 1.8 + 0.8, 0, W / 2 - 0.04, 0.8, L / 2 - 0.04, C.woodOld);
      door(o, yaw, W, L, 'z+', 0, C.wood);
      G.roof(o, yaw, 3.4, W, L, W * 0.42, 0.6, C.shingle, C.woodOld);
    } else if (b.cls === 'hut') {
      const wall = rr < 0.5 ? C.woodOld : C.wood, H = 2.6;
      G.box(o, yaw, 0, 0.55, 0, W / 2, 0.55, L / 2, C.stone);
      G.box(o, yaw, 0, 1.1 + H / 2, 0, W / 2 - 0.05, H / 2, L / 2 - 0.05, wall);
      for (let k = 0; k < 3; k++) G.box(o, yaw, 0, 1.1 + 0.3 + k * 0.85, 0, W / 2 - 0.02, 0.025, L / 2 - 0.02, C.wood);       // log courses
      if (L > 5) windowAt(o, yaw, W - 0.1, L - 0.1, 'x+', 0, 2.0, 0.6, 0.6, { frame: C.wood, shutters: shut });
      door(o, yaw, W - 0.1, L - 0.1, 'z+', 0, C.wood);
      G.roof(o, yaw, 1.1 + H, W, L, W * 0.5, 0.5, C.shingle, wall);
    } else if (b.cls === 'malga') {
      // stone and plaster ground floor, timber upper floor with a geranium balcony, deep shingle roof
      G.box(o, yaw, 0, 1.6, 0, W / 2, 1.6, L / 2, plaster);
      G.box(o, yaw, 0, 3.2 + 1.3, 0, W / 2 - 0.02, 1.3, L / 2 - 0.02, C.wood);
      winRow(1.1, 1.0, 0.8, { frame: C.woodOld, shutters: shut, spacing: 3.2 });
      winRow(3.6, 1.1, 0.8, { frame: C.woodOld, spacing: 3.2 });
      door(o, yaw, W, L, 'z+', 0, C.wood);
      balcony(o, yaw, W - 0.04, L, 1, 3.2, L * 0.85, 1.2, { flowers: true });
      G.roof(o, yaw, 5.8, W, L, W * 0.38, 1.3, C.shingle, C.wood);
      chimney(o, yaw, W * 0.2, L * 0.2, 5.8 + W * 0.38 * 0.6);
      malgas.push({ x: b.c[0], z: b.c[1], yaw, L, W });
    } else if (b.cls === 'castle') {
      // stone keep or palas: tall rubble walls, small windows, a hipped-looking low roof or crenellations
      // OSM parts: towers (man_made=tower) rise well above the walls, ruins are roofless broken walls, halls are the palas
      const part = b.part || 'hall', STONE2 = [0.3, 0.27, 0.24, LYR(3)];
      if (part === 'tower') {
        const Ht = 17 + rr * 7, r = Math.min(W, L) / 2;
        G.box(o, yaw, 0, Ht / 2, 0, r, Ht / 2, r, C.stone); G.box(o, yaw + Math.PI / 4, 0, Ht / 2, 0, r * 0.93, Ht / 2, r * 0.93, C.stone);     // an octagon: reads round, as the Firmiano towers are
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; G.box(o, yaw + a, 0, Ht + 0.6, r * 0.93, 0.6, 0.6, 0.35, STONE2); }
        G.box(o, yaw, 0, Ht * 0.6, r + 0.02, 0.25, 0.6, 0.02, C.win); G.box(o, yaw, 0, Ht * 0.82, -r - 0.02, 0.25, 0.5, 0.02, C.win);
      } else if (part === 'ruin') {
        const Hr = 4 + rr * 4;
        for (const [sx, sz, hx, hz] of [[1, 0, 0.6, L / 2], [-1, 0, 0.6, L / 2], [0, 1, W / 2, 0.6], [0, -1, W / 2, 0.6]]) {
          const h = Hr * (0.55 + 0.45 * Math.abs(Math.sin((sx * 3 + sz * 7 + rr * 13)))); G.box(o, yaw, sx * (W / 2 - 0.6), h / 2, sz * (L / 2 - 0.6), hx, h / 2, hz, STONE2);
          G.box(o, yaw, sx * (W / 2 - 0.6) + sz * W * 0.2, h + 0.8, sz * (L / 2 - 0.6) + sx * L * 0.15, Math.min(hx, 1.6), 0.8, Math.min(hz, 1.6), STONE2);     // a broken stub
        }
      } else {
        const Hc = 8 + rr * 6;
        G.box(o, yaw, 0, Hc / 2, 0, W / 2, Hc / 2, L / 2, C.stone);
        G.box(o, yaw, 0, 0.9, 0, W / 2 + 0.25, 0.9, L / 2 + 0.25, STONE2);      // battered plinth
        for (let k = 0; k < Math.floor(L / 3); k++) for (const sx of [-1, 1]) G.box(o, yaw, sx * W / 2, Hc + 0.5, -L / 2 + 1.5 + k * 3, 0.45, 0.5, 0.75, C.stone);
        for (let k = 0; k < Math.floor(W / 3); k++) for (const sz of [-1, 1]) G.box(o, yaw, -W / 2 + 1.5 + k * 3, Hc + 0.5, sz * L / 2, 0.75, 0.5, 0.45, C.stone);
        winRow(Hc * 0.55, 1.1, 0.5, { frame: C.stone, spacing: 4.5 });
      }
    } else if (b.cls === 'church' && !lakeStyle) {
      G.box(o, yaw, 0, 4, 0, W / 2, 4, L / 2, plaster); G.roof(o, yaw, 8, W, L, W * 0.6, 0.4, C.redRoof, plaster);
      G.box(o, yaw, 0, 11, L / 2 - 1.8, 1.8, 11, 1.8, plaster);
    } else if (lakeStyle && (b.cls === 'house' || b.cls === 'hotel')) {
      // lake towns (Riva, Torbole, Arco, the Adige villages): pastel plaster to the eaves, white window surrounds, green or brown
      // persiane on every window, a stone plinth and string course, shopfronts with striped awnings on the street, small iron balconies
      // on the piano nobile, a cornice and a low hipped terracotta roof
      const nf = Math.max(2, Math.min(b.cls === 'hotel' ? 6 : 5, b.levels || 3)), fh = 3.1, wallTop = 0.6 + nf * fh;
      const IRON = [0.03, 0.03, 0.03, LYR(5)], WHITE = [0.6, 0.58, 0.53, LYR(2)], AW = [[0.4, 0.06, 0.05], [0.07, 0.2, 0.12], [0.08, 0.12, 0.3], [0.45, 0.3, 0.06]][Math.floor(rr * 17) % 4];
      const shopStreet = bRoadDist(b.c[0], b.c[1]) < 25;
      const persiane = [[0.05, 0.16, 0.08], [0.09, 0.2, 0.12], [0.16, 0.09, 0.04], [0.32, 0.3, 0.27]][Math.floor(rr * 23) % 4];
      G.box(o, yaw, 0, 0.6 + (nf * fh) / 2 - 0.3, 0, W / 2, (nf * fh) / 2, L / 2, plaster);
      G.box(o, yaw, 0, 0.55, 0, W / 2 + 0.07, 0.55, L / 2 + 0.07, C.stone);                                   // plinth
      G.box(o, yaw, 0, 0.6 + fh - 0.1, 0, W / 2 + 0.06, 0.1, L / 2 + 0.06, WHITE);                           // string course
      G.box(o, yaw, 0, wallTop - 0.15, 0, W / 2 + 0.18, 0.15, L / 2 + 0.18, WHITE);                           // cornice
      for (let f = 0; f < nf; f++) {
        const yb = 0.6 + f * fh + 0.9;
        if (f === 0 && shopStreet) {
          for (const fc of ['x+', 'x-']) { const n = Math.max(1, Math.floor((L - 1) / 4.2));
            for (let i = 0; i < n; i++) { const u = -L / 2 + (i + 0.5) * L / n, sg = fc[1] === '+' ? 1 : -1;
              G.box(o, yaw, sg * (W / 2 + 0.02), 1.75, u, 0.05, 1.15, 1.45, GLASS);                            // shop window
              G.box(o, yaw, sg * (W / 2 + 0.06), 2.95, u, 0.04, 0.05, 1.55, IRON);
              // striped awning: a sloped plane out to 1.4 m
              const T2 = (x, y, z) => { const c = Math.cos(yaw), s2 = Math.sin(yaw); return [o[0] + x * c + z * s2, o[1] + y, o[2] - x * s2 + z * c]; };
              for (let k = 0; k < 6; k++) { const z0 = u - 1.5 + k * 0.5, z1 = z0 + 0.5, kk = k % 2 ? [0.62, 0.6, 0.55, LYR(2)] : [AW[0], AW[1], AW[2], LYR(2)];
                G.quad(T2(sg * (W / 2 + 0.05), 3.25, z0), T2(sg * (W / 2 + 0.05), 3.25, z1), T2(sg * (W / 2 + 1.45), 2.6, z1), T2(sg * (W / 2 + 1.45), 2.6, z0), [0, 1, 0], kk);
                G.quad(T2(sg * (W / 2 + 1.45), 2.6, z0), T2(sg * (W / 2 + 1.45), 2.6, z1), T2(sg * (W / 2 + 1.45), 2.35, z1), T2(sg * (W / 2 + 1.45), 2.35, z0), [sg * Math.cos(yaw), 0, -sg * Math.sin(yaw)], kk); } } }
          winRow(yb, 1.5, 1.0, { frame: WHITE, shutters: persiane, spacing: 3.0 }, ['z+', 'z-']);
        } else {
          winRow(yb, f === 0 ? 1.2 : 1.55, f === 0 ? 0.8 : 1.0, { frame: WHITE, shutters: f === 0 ? null : persiane, sill: WHITE, flowers: f === 1 && rr < 0.32, spacing: 3.0,
            skip: (fc, i, n) => f === 0 && fc === 'x+' && i === Math.floor(n / 2) }, ['x+', 'x-', 'z+', 'z-']);
        }
        if (f === 1) for (const sd of [-1, 1]) {          // a small iron balcony in the middle of each long side
          G.box(o, yaw, sd * (W / 2 + 0.45), 0.6 + fh - 0.05, 0, 0.45, 0.07, 1.0, C.stone);
          G.box(o, yaw, sd * (W / 2 + 0.88), 0.6 + fh + 1.0, 0, 0.035, 0.035, 1.04, IRON);
          for (let k = -4; k <= 4; k++) G.box(o, yaw, sd * (W / 2 + 0.88), 0.6 + fh + 0.5, k * 0.25, 0.018, 0.5, 0.018, IRON);
          for (const ez of [-1, 1]) {
            G.box(o, yaw, sd * (W / 2 + 0.45), 0.6 + fh + 1.0, ez, 0.43, 0.035, 0.035, IRON);
            for (const ex of [0.25, 0.5, 0.75]) G.box(o, yaw, sd * (W / 2 + ex), 0.6 + fh + 0.5, ez, 0.018, 0.5, 0.018, IRON);
          }
        }
      }
      if (!shopStreet) door(o, yaw, W, L, 'x+', 0, C.wood);
      if (rr < 0.45) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        G.box(o, yaw, sx * (W / 2 - 0.12), wallTop / 2, sz * (L / 2 - 0.12), 0.16, wallTop / 2, 0.16, WHITE);
      }
      G.hip(o, yaw, wallTop, W, L, roofRise(W), 0.7, townRoof(rr));
      chimney(o, yaw, -W * 0.15, L * 0.25, wallTop + roofRise(W) * 0.6);
    } else if (lakeStyle && b.cls === 'church') {
      const Hc = 10; G.box(o, yaw, 0, Hc / 2, 0, W / 2, Hc / 2, L / 2, plaster); G.roof(o, yaw, Hc, W, L, W * 0.3, 0.4, TERRACOTTA, plaster);
      // campanile: a slender stone tower with an open belfry and a pyramid cap
      const tx = W / 2 + 2.2, tz = -L / 2 + 2.4, th = 26 + rr * 12;
      G.box(o, yaw, tx, th / 2, tz, 2.0, th / 2, 2.0, C.stone);
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) G.box(o, yaw, tx + ax * 2.02, th - 2.6, tz + az * 2.02, ax ? 0.03 : 0.6, 1.4, az ? 0.03 : 0.6, C.black);
      G.box(o, yaw, tx, th + 0.2, tz, 2.3, 0.2, 2.3, C.stone);
      G.hip(o, yaw, th + 0.4, 4.2, 4.2, 4.5, 0.1, TERRACOTTA);
    } else {
      // hotels and houses: stone plinth, plaster floors with shuttered windows, a timber top floor with balconies and geraniums
      const nf = b.cls === 'hotel' ? Math.min(4, b.levels) : Math.max(2, Math.min(3, b.levels)), fh = 2.9, wallTop = 0.6 + nf * fh;
      G.box(o, yaw, 0, 0.3, 0, W / 2 + 0.08, 0.3, L / 2 + 0.08, C.stone);
      G.box(o, yaw, 0, 0.6 + (nf - 1) * fh / 2, 0, W / 2, (nf - 1) * fh / 2, L / 2, plaster);
      G.box(o, yaw, 0, wallTop - fh / 2, 0, W / 2 - 0.02, fh / 2, L / 2 - 0.02, C.wood);
      // corner quoins on the plaster floors
      for (const [qx, qz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let k = 0; k < (nf - 1) * 4; k++) G.box(o, yaw, qx * (W / 2 - 0.15), 0.85 + k * fh / 4, qz * (L / 2 - 0.15), 0.18 + (k % 2) * 0.1, 0.16, 0.18 + ((k + 1) % 2) * 0.1, C.stone);
      for (let f = 0; f < nf; f++) {
        const top = f === nf - 1, yb = 0.6 + f * fh + 0.85;
        winRow(yb, 1.35, 1.0, { frame: top ? C.woodOld : FRAME_W, shutters: top ? null : shut, flowers: f > 0 && !top, spacing: 2.7,
          skip: (fc, i, n) => f === 0 && fc === 'x+' && i === Math.floor(n / 2) }, ['x+', 'x-', 'z+', 'z-']);
        if (f > 0) for (const sd of [-1, 1]) if (top || b.cls === 'hotel') balcony(o, yaw, W - (top ? 0.04 : 0), L, sd, 0.6 + f * fh, L * 0.86, 1.3, { flowers: true });
      }
      door(o, yaw, W, L, 'x+', 0, C.wood);
      G.roof(o, yaw, wallTop, W, L, W * (b.cls === 'hotel' ? 0.3 : lakeStyle ? 0.22 : 0.4), lakeStyle ? 0.6 : 1.4, lakeStyle ? TERRACOTTA : rr < 0.35 ? C.redRoof : rr < 0.7 ? C.metal : C.shingle, lakeStyle ? plaster : C.wood);
      chimney(o, yaw, -W * 0.18, L * 0.25, wallTop + W * 0.3 * 0.55); if (L > 16) chimney(o, yaw, W * 0.18, -L * 0.3, wallTop + W * 0.3 * 0.55);
    }
  }
  G = G_MAIN;
  // vineyards (vigneti) near the road: real rows from the OSM vineyard landuse, within ~450 m of the road. On slopes the rows follow
  // the contour; on the valley floor they run straight per field (Trentino pergolas: a canopy on posts, 2.2 m high)
  if (!QS.has('novines')) {
    const VG = new Map(), VC = 192, vcell = (x, z) => { const k = Math.floor(x / VC) + ',' + Math.floor(z / VC); if (!VG.has(k)) VG.set(k, Geo()); return VG.get(k); };
    const LEAF1 = [0.05, 0.09, 0.025, 1], LEAF2 = [0.09, 0.11, 0.03, 1], POST = [0.22, 0.2, 0.17, L(1)];
    let nRows = 0;
    const roadNear = (x, z) => bRoadDist(x, z);
    for (const L_ of LVL) {
      if (!L_.detail || L_.res > 4) continue;
      const step = 8;
      for (let x = L_.cx - L_.half; x < L_.cx + L_.half; x += step) for (let z = L_.cz - L_.half; z < L_.cz + L_.half; z += step) {
        const d = detailAt(x, z); if (!d || !d.vine) continue;
        if (levelWeight(L_, x, z) < 0.99) continue;
        const rd = roadNear(x, z); if (rd > 450 || rd < 9) continue;      // visible from the road: the Adige vineyards sit a few hundred metres off the A22
        if (structAt(x, z)) continue;
        const h0 = terrainH(x, z), gx = terrainH(x + 3, z) - terrainH(x - 3, z), gz = terrainH(x, z + 3) - terrainH(x, z - 3), sl = Math.hypot(gx, gz) / 6;
        let dx, dz;
        if (sl > 0.06) { dx = -gz; dz = gx; const l = Math.hypot(dx, dz); dx /= l; dz /= l; }          // contour
        else { const a = (Math.abs(Math.sin(Math.floor(x / 90) * 12.9898 + Math.floor(z / 90) * 78.233) * 43758.5) % 1) * 3.14159; dx = Math.cos(a); dz = Math.sin(a); }
        const pergola = sl <= 0.06, G2 = vcell(x, z);
        // rows across this 8 m cell, 2.4 m apart, each an 8 m run of hedge
        const nx = -dz, nz = dx;
        for (let r = -1; r <= 1; r++) {
          const off = r * 2.4 + ((((x * nx + z * nz) % 2.4) + 2.4) % 2.4) * -1 + 1.2;
          const cx = x + nx * off, cz = z + nz * off, yaw = Math.atan2(dx, dz);
          const g = terrainH(cx, cz);
          const k = (Math.floor(cx * 3.1 + cz * 1.7) & 1) ? LEAF1 : LEAF2;
          if (pergola) {
            G2.box([cx, g, cz], yaw, 0, 2.05, 0, 1.15, 0.22, step / 2, k);              // the canopy
            G2.box([cx, g, cz], yaw, 0, 1.0, -step / 2 + 0.3, 0.05, 1.0, 0.05, POST);
          } else {
            G2.box([cx, g, cz], yaw, 0, 0.95, 0, 0.22, 0.6, step / 2, k);                 // the hedge of leaves on its wires
            G2.box([cx, g, cz], yaw, 0, 0.4, 0, 0.06, 0.4, step / 2, [0.12, 0.09, 0.06, L(1)]);
          }
          nRows++;
        }
      }
    }
    for (const [k, gg] of VG) for (const v of gg.vds()) { const m = new BABYLON.Mesh('vines_' + k, scene); v.applyToMesh(m); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false; m.freezeWorldMatrix(); vineMeshes.push(m); }
    console.log('vineyard row pieces', nRows);
  }
  // apple orchards of the Adige valley (OSM orchard landuse; at Garda the same class is olive groves, kept as single trees):
  // rows 3.6 m apart of trees trained into a narrow ~3.4 m hedge on posts, in straight runs per field, within ~450 m of the road
  if (!QS.has('noorchards')) {
    const OG = new Map(), OC = 192, ocell = (x, z) => { const k = Math.floor(x / OC) + ',' + Math.floor(z / OC); if (!OG.has(k)) OG.set(k, Geo()); return OG.get(k); };
    // the patch owning a point: the one with the nearest road (as the scatter decides; patch centres put Nago in the Bolzano patch)
    const patchAt = (x, z) => { let bk = null, bd = Infinity; for (const [k, pts] of Object.entries(PATCH_PTS)) for (const q of pts) { const d = (q[0] - x) ** 2 + (q[2] - z) ** 2; if (d < bd) { bd = d; bk = k; } } return bk; };
    const LEAVES = [[0.055, 0.095, 0.03, 1], [0.07, 0.11, 0.035, 1], [0.06, 0.1, 0.028, 1], [0.08, 0.105, 0.04, 1]], TRUNKS = [0.09, 0.075, 0.06, L(1)], POSTC = [0.3, 0.29, 0.27, L(3)];
    const hsh = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
    let nRows = 0;
    for (const L_ of LVL) {
      if (!L_.detail || L_.res > 4) continue;
      const step = 10;
      for (let x = L_.cx - L_.half; x < L_.cx + L_.half; x += step) for (let z = L_.cz - L_.half; z < L_.cz + L_.half; z += step) {
        const d = detailAt(x, z); if (!d || !d.orchard) continue;
        if (levelWeight(L_, x, z) < 0.99) continue;
        const rd = bRoadDist(x, z); if (rd > 450 || rd < 10) continue;
        if (structAt(x, z) || patchAt(x, z) !== 'bolzano') continue;
        const gx = terrainH(x + 3, z) - terrainH(x - 3, z), gz = terrainH(x, z + 3) - terrainH(x, z - 3); if (Math.hypot(gx, gz) / 6 > 0.15) continue;
        // one direction per ~150 m field, along or across the valley's main axis (fields are laid out on the old drainage grid)
        const fx = Math.floor(x / 150), fz = Math.floor(z / 150), a = 0.6 + (hsh(fx, fz) < 0.5 ? 0 : Math.PI / 2) + (hsh(fz, fx) - 0.5) * 0.25;
        const dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx, yaw = Math.atan2(dx, dz), G2 = ocell(x, z);
        for (let r = -2; r <= 2; r++) {
          const off = r * 3.6 - ((((x * nx + z * nz) % 3.6) + 3.6) % 3.6) + 1.8;
          if (Math.abs(off) > step / 2) continue;
          // each row piece: four trees ~2.5 m apart whose crowns touch (a hedge), a line of trunks, a post at one end
          for (let t = 0; t < 4; t++) {
            const along = -step / 2 + 1.25 + t * 2.5, cx = x + nx * off + dx * along, cz = z + nz * off + dz * along, g = terrainH(cx, cz);
            const h1 = hsh(cx, cz), h2 = hsh(cz, cx), k = LEAVES[Math.floor(h1 * 4) % 4];
            G2.box([cx, g, cz], yaw, 0, 1.7, 0, 0.62 + 0.18 * h1, 0.8, 1.4, k);
            G2.box([cx, g, cz], yaw, 0, 2.85 + 0.15 * h2, 0, 0.4 + 0.12 * h2, 0.4 + 0.15 * h2, 1.2 + 0.15 * h1, k);
          }
          const cx = x + nx * off, cz = z + nz * off, g = terrainH(cx, cz);
          G2.box([cx, g, cz], yaw, 0, 0.45, 0, 0.07, 0.45, step / 2, TRUNKS);
          G2.box([cx, g, cz], yaw, 0, 1.9, -step / 2 + 0.1, 0.06, 1.9, 0.06, POSTC);
          nRows++;
        }
      }
    }
    let ot = 0; for (const [k, gg] of OG) for (const v of gg.vds()) { ot += v.indices.length / 3; const m = new BABYLON.Mesh('orchard_' + k, scene); v.applyToMesh(m); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false; m.freezeWorldMatrix(); vineMeshes.push(m); }
    console.log('orchard row pieces', nRows, 'triangles', ot);
  }
  // viaducts: concrete deck edges and underside, piers every ~32 m down to the ground
  const CONC = [0.36, 0.35, 0.33, L(2)];
  for (const RR of ROADS) {
    const P = RR.points, n = P.length;
    const dir = (i) => roadDirection(RR, i, 2);
    let since = 0;
    for (let i = 0; i < n - 1; i++) {
      if (RR.fl[i] !== 2 || RR.fl[i + 1] !== 2) { since = 0; continue; }
      const d = dir(i), nx = d[1], nz = -d[0], a = P[i], b = P[i + 1];
      const hw = roadHalf(RR, i) + roadShoulder(RR, i) + 0.4;
      const E = (p, side, dy) => { const w = roadHalf(RR, p === a ? i : i + 1) + roadShoulder(RR, p === a ? i : i + 1) + 0.4; return [p[0] + nx * w * side, p[1] + dy, p[2] + nz * w * side]; };
      for (const side of [-1, 1]) G.quad(E(a, side, 0.1), E(b, side, 0.1), E(b, side, -1.4), E(a, side, -1.4), [nx * side, 0, nz * side], CONC);
      G.quad(E(a, -1, -1.4), E(b, -1, -1.4), E(b, 1, -1.4), E(a, 1, -1.4), [0, -1, 0], CONC);
      since += 2;
      if (since >= 32) { since = 0; const g = terrainH(a[0], a[2]), h = a[1] - 1.4 - g; if (h > 1.5) { const yaw = Math.atan2(d[0], d[1]); G.box([a[0], g - 1, a[2]], yaw, 0, (h + 1) / 2, 0, hw * 0.55, (h + 1) / 2, 1.1, CONC); G.box([a[0], a[1] - 1.4, a[2]], yaw, 0, -0.4, 0, hw * 0.9, 0.4, 1.3, CONC); } }
    }
  }
  // castle curtain walls (OSM outlines of the castle precincts): 8 m rubble walls with merlons
  for (const wl of (PROPS.castle_walls || [])) for (let i = 0; i < wl.length - 1; i++) {
    const a = wl[i], b2 = wl[i + 1], len = Math.hypot(b2[0] - a[0], b2[1] - a[1]); if (len < 0.5) continue;
    const yaw = Math.atan2(b2[0] - a[0], b2[1] - a[1]), mx = (a[0] + b2[0]) / 2, mz = (a[1] + b2[1]) / 2, g = Math.min(terrainH(a[0], a[1]), terrainH(b2[0], b2[1])) - 1;
    G.box([mx, g, mz], yaw, 0, 5, 0, 0.9, 5, len / 2 + 0.4, C.stone);
    for (let k = 0; k < Math.floor(len / 2.2); k++) G.box([a[0] + (b2[0] - a[0]) * (k + 0.5) / Math.floor(len / 2.2), g, a[1] + (b2[1] - a[1]) * (k + 0.5) / Math.floor(len / 2.2)], yaw, 0, 10.5, 0, 0.9, 0.6, 0.55, C.stone);
  }
  // cows grazing near the malgas (replaced by the pasture herds unless &nostage1)
  if (QS.has('nostage1')) for (const m of malgas) {
    for (let i = 0; i < 6; i++) {
      const a = m.yaw + 1.3 + i * 0.9, r = m.W + 9 + (i % 3) * 6, x = m.x + Math.sin(a) * r, z = m.z + Math.cos(a) * r, yaw = a * 2.3 + i, g = terrainH(x, z), o = [x, g, z];
      const k = i % 3 ? C.cowB : C.cowG;
      G.box(o, yaw, 0, 1.05, 0, 0.32, 0.33, 0.8, k); G.box(o, yaw, 0, 0.95, 0.95, 0.15, 0.17, 0.25, k);
      for (const [lx, lz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) G.box(o, yaw, lx, 0.38, lz, 0.07, 0.38, 0.07, k);
    }
  }
  // the roads: guard rails on the drop side and round hairpins (both sides on the motorway, with a painted centreline), delineator posts, bend warnings
  for (const RR of ROADS) {
    const P = RR.points, mwR = RR.class === 'motorway', hw = (i) => roadHalf(RR, i) + roadShoulder(RR, i), n = P.length;
    const dir = (i) => { const a = P[Math.max(0, i - 2)], b = P[Math.min(n - 1, i + 2)]; const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const turn = (i) => { const a = dir(Math.max(0, i - 6)), b = dir(Math.min(n - 1, i + 6)); return a[0] * b[1] - a[1] * b[0]; };
    for (const side of [-1, 1]) {
      const flag = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const d = dir(i), nx = d[1] * side, nz = -d[0] * side, x = P[i][0] + nx * (hw(i) + 3), z = P[i][2] + nz * (hw(i) + 3);
        const drop = P[i][1] - terrainH(x, z), outside = turn(i) * side < -0.25;
        if (RR.fl[i] === 2 || ((drop > 1.6 || outside || mwR) && RR.fl[i] !== 1)) flag[i] = 1;
      }
      const grow = flag.slice(); for (let i = 0; i < n; i++) if (flag[i]) for (let k = -4; k <= 4; k++) if (i + k >= 0 && i + k < n && RR.fl[i + k] !== 1) grow[i + k] = 1;
      // W-beam as continuous ribbons (no steps between segments): upper ridge, recessed valley, lower ridge, plus posts every 4 m
      const railPt = (i, off, dy) => { const d = dir(i), nx = d[1] * side, nz = -d[0] * side; return [P[i][0] + nx * (hw(i) - 0.15 + off), P[i][1] + dy, P[i][2] + nz * (hw(i) - 0.15 + off)]; };
      const RAIL = METAL([0.17, 0.175, 0.18]), RAILD = METAL([0.1, 0.105, 0.11]);
      for (let i = 0; i < n - 1; i++) {
        if (!grow[i] || !grow[i + 1]) continue;
        const d = dir(i), nrm = [d[1] * side, 0, -d[0] * side];
        for (const [off, y0, y1, k] of [[-0.02, 0.62, 0.8, RAIL], [0.02, 0.56, 0.62, RAILD], [-0.02, 0.38, 0.56, RAIL]]) {
          G.quad(railPt(i, off, y0), railPt(i + 1, off, y0), railPt(i + 1, off, y1), railPt(i, off, y1), nrm, k);
          G.quad(railPt(i + 1, off + 0.012, y0), railPt(i, off + 0.012, y0), railPt(i, off + 0.012, y1), railPt(i + 1, off + 0.012, y1), nrm.map((v) => -v), k);
        }
        G.quad(railPt(i, -0.02, 0.8), railPt(i + 1, -0.02, 0.8), railPt(i + 1, -0.008, 0.8), railPt(i, -0.008, 0.8), [0, 1, 0], RAIL);
        if (i % 2 === 0) { const p = railPt(i, 0.09, 0), yaw = Math.atan2(d[0], d[1]); G.box([p[0], P[i][1], p[2]], yaw, 0, 0.36, 0, 0.04, 0.42, 0.07, METAL([0.15, 0.155, 0.16])); }
      }
      for (let i = 0; i < n; i += 13) {     // delineators every ~26 m
        if (grow[i] || mwR || RR.fl[i]) continue;
        const d = dir(i), nx = d[1] * side, nz = -d[0] * side, x = P[i][0] + nx * (hw(i) + 0.35), z = P[i][2] + nz * (hw(i) + 0.35), y = terrainH(x, z), yaw = Math.atan2(d[0], d[1]);
        G.box([x, y, z], yaw, 0, 0.5, 0, 0.06, 0.5, 0.06, C.white); G.box([x, y, z], yaw, 0, 0.85, 0, 0.065, 0.1, 0.065, C.black);
      }
    }
    // This compact four-lane section uses a continuous painted centreline.
    // A physical median would require a separate carriageway transition.
    // bend warnings ahead of the tight hairpins (red-rimmed triangles on a post), both directions
    if (!mwR) for (let i = 20; i < n - 20; i += 4) {
      if (Math.abs(turn(i)) < 0.6 || Math.abs(turn(i - 4)) >= 0.6) continue;
      for (const [j, sgn] of [[i - 30, 1], [i + 30, -1]]) {
        if (j < 0 || j >= n) continue;
        const d = dir(j).map((v) => v * sgn), nx = d[1], nz = -d[0], x = P[j][0] + nx * (hw(j) + 0.6), z = P[j][2] + nz * (hw(j) + 0.6), y = terrainH(x, z), yaw = Math.atan2(d[0], d[1]);
        G.box([x, y, z], yaw, 0, 1.0, 0, 0.04, 1.0, 0.04, C.steel); G.box([x, y, z], yaw, 0, 2.1, -0.05, 0.42, 0.36, 0.02, [0.5, 0.05, 0.03]); G.box([x, y, z], yaw, 0, 2.08, -0.075, 0.32, 0.27, 0.02, C.white);
      }
    }
  }
  // Reject complete fence bays near pavement, including the projecting diagonal rails.
  // A midpoint bounding circle covers every point of a bay; test against road segments,
  // not just fence corners (a paddock can straddle a road with all corners outside it).
  const fenceAudit = { kept: 0, removed: [] };
  const fenceBayClear = (ax, az, bx, bz) => {
    const x = (ax + bx) / 2, z = (az + bz) / 2;
    const radius = Math.hypot(bx - ax, bz - az) * 0.8 + 1.0;
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16), reach = Math.ceil((radius + 16) / 16);
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      for (const q of STRUCT_GRID.get((gx + i) + ',' + (gz + j)) || []) {
        const dx = q[3] - q[0], dz = q[5] - q[2];
        const t = Math.max(0, Math.min(1, ((x - q[0]) * dx + (z - q[2]) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - q[0] - t * dx, z - q[2] - t * dz) < q[6] + radius) {
          fenceAudit.removed.push([x, z]); return false;
        }
      }
    }
    fenceAudit.kept++; return true;
  };
  window.__fenceAudit = fenceAudit;
  // wooden fences (OSM)
  for (const f of PROPS.fences) for (let i = 0; i < f.length - 1; i++) {
    const [ax, az] = f[i], [bx, bz] = f[i + 1], len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(len / 2.5)), yaw = Math.atan2(bx - ax, bz - az);
    for (let k = 0; k < steps; k++) {
      const t0 = k / steps, t1 = (k + 1) / steps, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1, y0 = terrainH(x0, z0), y1 = terrainH(x1, z1);
      if (!fenceBayClear(x0, z0, x1, z1)) continue;
      G.box([x0, y0, z0], yaw, 0, 0.55, 0, 0.06, 0.6, 0.06, C.woodOld);
      for (const hgt of [0.45, 0.95]) G.box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], yaw, 0, hgt, 0, 0.03, 0.05, len / steps / 2, C.woodOld);
    }
  }
  // wayside crosses with their little roof
  for (const [x, z] of PROPS.crosses) { const y = terrainH(x, z), o = [x, y, z], yaw = (x * 0.37) % 6.28; G.box(o, yaw, 0, 1.6, 0, 0.08, 1.6, 0.08, C.wood); G.box(o, yaw, 0, 2.45, 0, 0.7, 0.07, 0.07, C.wood); G.roof(o, yaw + Math.PI / 2, 3.15, 0.5, 1.6, 0.35, 0.15, C.shingle, C.wood); }
  // ski lifts: pylons along the line, two cables, a station box at each end
  for (const L of PROPS.lifts) {
    const pts = L.pts, py = L.pylons.length ? L.pylons : pts.slice(1, -1), heads = [];
    const H = L.kind === 'gondola' || L.kind === 'cable_car' ? 14 : 9;
    for (const [x, z] of py) {
      let best = 0, bd = 1e9; for (let i = 0; i < pts.length - 1; i++) { const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      const a = pts[Math.min(best, pts.length - 2)], b = pts[Math.min(best + 1, pts.length - 1)], yaw = Math.atan2(b[0] - a[0], b[1] - a[1]), y = terrainH(x, z);
      G.box([x, y, z], yaw, 0, H / 2, 0, 0.35, H / 2, 0.35, C.steel); G.box([x, y, z], yaw, 0, H, 0, 2.4, 0.18, 0.25, C.steel); heads.push([x, y + H, z, yaw]);
    }
    for (const e of [pts[0], pts[pts.length - 1]]) { const y = terrainH(e[0], e[1]), b2 = pts[1], yaw = Math.atan2(b2[0] - pts[0][0], b2[1] - pts[0][1]); G.box([e[0], y, e[1]], yaw, 0, 3, 0, 4, 3, 7, C.metal); G.roof([e[0], y, e[1]], yaw, 6, 8, 14, 1.5, 0.5, C.metal, C.metal); heads.unshift; }
    heads.sort((p, q) => Math.hypot(p[0] - pts[0][0], p[2] - pts[0][1]) - Math.hypot(q[0] - pts[0][0], q[2] - pts[0][1]));
    for (let i = 0; i < heads.length - 1; i++) for (const sx of [-2.2, 2.2]) {
      const a = heads[i], b = heads[i + 1], yaw = a[3], ox = Math.cos(yaw) * sx, oz = -Math.sin(yaw) * sx;
      const ax = a[0] + ox, az = a[2] + oz, bx = b[0] + ox, bz = b[2] + oz, len = Math.hypot(bx - ax, bz - az, b[1] - a[1]);
      const o = [(ax + bx) / 2, (a[1] + b[1]) / 2 - 0.3, (az + bz) / 2], cy = Math.atan2(bx - ax, bz - az);
      // a thin box tilted to the slope between the heads
      const m0 = G.count(); G.box(o, cy, 0, 0, 0, 0.03, 0.03, len / 2, C.black); void m0;
    }
  }
  let lifeCount = G_MAIN.count();
  const lifeMesh = (v, name) => { const lm = new BABYLON.Mesh(name, scene); v.applyToMesh(lm); lm.material = propMat; lm.renderingGroupId = 1; lm.isPickable = false; lm.freezeWorldMatrix(); return lm; };
  G_MAIN.vds().forEach((v, i) => lifeMesh(v, 'life' + i));
  for (const [k, g] of scells) { lifeCount += g.count(); g.vds().forEach((v, i) => lifeMesh(v, 'bSS' + k + '_' + i)); }
  const bLod = [];
  for (const [k, c] of bcells) {
    const sm = c.simple.vds().map((v, i) => lifeMesh(v, 'bS' + k + '_' + i)), fm = c.hasFull ? c.full.vds().map((v, i) => lifeMesh(v, 'bF' + k + '_' + i)) : [];
    lifeCount += c.simple.count(); if (fm.length) bLod.push({ cx: c.cx, cz: c.cz, sm, fm, near: null });
  }
  mark('buildings built'); releaseGeometry(); mark('buildings released');      // the buildings' arrays (~230 MB) go before the scatter is built: keeps the loading peak down
  let bT = 0;
  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now(); if (now - bT < 250) return; bT = now;
    const p = scene.activeCamera.position;
    for (const c of bLod) { const near = Math.hypot(c.cx - p.x, c.cz - p.z) < 420; if (near === c.near) continue; c.near = near; c.sm.forEach((m) => m.setEnabled(!near)); c.fm.forEach((m) => m.setEnabled(near)); }
  });
  console.log('life:', PROPS.buildings.length, 'buildings (', nSimple, 'simple),', malgas.length, 'malgas,', lifeCount, 'triangles');
  window.__malgas = malgas;
  // alpha-to-coverage around foliage draws: with MSAA the cut-out edges get 4 coverage levels instead of a hard stair-step
  const withA2C = (m) => { if (Q.msaa < 2 || !engine._gl) return; const gl = engine._gl;
    m.onBeforeDrawObservable.add(() => { gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true, true, true, false); }); m.onAfterRenderObservable.add(() => { gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.colorMask(true, true, true, true); }); };     // coverage only: keep the target's alpha at 1
  // ---------- forest: real canopy heights (DSM - DTM) -> ~185k larch, spruce and stone pine as crossed cards in 256 m cells ----------
  const TREES = await getJSON(MAP + 'trees.json');
  const NO3D = QS.has('notrees3d') || !Q.treeOut, NEAR_TREE_IN = NO3D ? -10 : Q.treeIn, NEAR_TREE_OUT = NO3D ? -5 : Q.treeOut;
  const treeRec = new DataView(await getBin(MAP + 'trees.bin'));
  // sprite atlas painted on a canvas: three columns (spruce, larch, stone pine); larch is painted neutral and tinted by season in the shader
  const treeAtlas = (() => {
    const W = 256, Hh = 512, cv = document.createElement('canvas'); cv.width = W * 6; cv.height = Hh; const c = cv.getContext('2d');
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const blob = (x, y, rx, ry, col, a) => { c.globalAlpha = a; c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.283); c.fill(); };
    // 3 olive: low round silver-green crown on a twisted trunk; 4 cypress: tall dark spindle; 5 orchard tree: round green crown
    for (const [k, crownY, crownR, colf, n] of [[3, 0.55, 0.42, (g) => `rgb(${g * 0.42 | 0},${g * 0.5 | 0},${g * 0.36 | 0})`, 420], [5, 0.55, 0.4, (g) => `rgb(${g * 0.26 | 0},${g * 0.44 | 0},${g * 0.19 | 0})`, 380]]) {
      const x0 = k * W + W / 2; c.globalAlpha = 1; c.fillStyle = '#4a3a2c'; c.beginPath(); c.moveTo(x0 - 10, Hh); c.quadraticCurveTo(x0 + 18, Hh * 0.8, x0 - 4, Hh * crownY); c.lineTo(x0 + 6, Hh * crownY); c.quadraticCurveTo(x0 + 22, Hh * 0.8, x0 + 10, Hh); c.fill();
      for (let j = 0; j < n; j++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()), xx = x0 + Math.cos(a) * r * W * crownR, yy = Hh * (crownY - 0.18) + Math.sin(a) * r * W * crownR * 0.8, g = 120 + rnd() * 100;
        blob(xx, yy, 6 + rnd() * 8, 4 + rnd() * 5, colf(g), 0.85); }
    }
    { const k = 4, x0 = k * W + W / 2;
      // a dense spindle filling the card (crown ~0.16 x height wide), dark but lit green with lighter tufts
      for (let j = 0; j < 1600; j++) { const t = rnd(), y = Hh * (0.98 - 0.95 * t), half = Math.sin(Math.min(1, t * 1.1) * Math.PI) ** 0.7 * W * 0.38 * (t < 0.12 ? 0.6 + t / 0.3 : 1), g = 95 + rnd() * 70;
        blob(x0 + (rnd() * 2 - 1) * half * rnd() ** 0.4, y, 7 + rnd() * 8, 5 + rnd() * 6, `rgb(${g * 0.3 | 0},${g * 0.46 | 0},${g * 0.26 | 0})`, 0.95); } }
    for (let k = 0; k < 3; k++) {
      const x0 = k * W + W / 2;
      c.globalAlpha = 1; c.fillStyle = '#3b2a1e'; c.fillRect(x0 - 4, Hh * 0.35, 8, Hh * 0.65);
      const tiers = k === 2 ? 26 : 34;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers, y = Hh * (0.97 - 0.92 * t);
        let half = k === 0 ? (1 - t) ** 0.95 * W * 0.46 : k === 1 ? (1 - t) ** 0.85 * W * 0.44 : Math.sin(Math.min(1, (1 - t) * 1.25) * 2.2) * W * 0.42;
        if (k === 2 && t < 0.25) half *= 0.6 + t;
        const n = k === 1 ? 18 : 30;
        for (let j = 0; j < n; j++) {
          const side = rnd() < 0.5 ? -1 : 1, r = rnd() ** 0.7, xx = x0 + side * r * half, yy = y + r * (k === 0 ? 14 : 9) + (rnd() - 0.5) * 10;
          const g = k === 0 ? 70 + rnd() * 50 : k === 1 ? 150 + rnd() * 70 : 75 + rnd() * 45;
          const col = k === 0 ? `rgb(${g * 0.32 | 0},${g * 0.55 | 0},${g * 0.36 | 0})` : k === 1 ? `rgb(${g * 0.85 | 0},${g * 0.85 | 0},${g * 0.6 | 0})` : `rgb(${g * 0.35 | 0},${g * 0.56 | 0},${g * 0.3 | 0})`;
          const sz = (k === 1 ? 5 : 7) + rnd() * (k === 1 ? 7 : 9);
          blob(xx, yy, sz * (1.6 - r * 0.4), sz * 0.7, col, k === 1 ? 0.75 : 0.95);
        }
      }
    }
    const t = new BABYLON.DynamicTexture('treeAtlas', cv, scene, true); t.hasAlpha = true; t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE; t.update(false); return t;
  })();
  BABYLON.Effect.ShadersStore.treeVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec2 uv;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);     // compiled without instances: draw nothing
#endif
uniform mat4 viewProjection;
varying vec3 vPos; varying vec2 vUV; varying vec3 vSide; varying float vKind; varying float vRnd;
void main() {
  vec3 base = world3.xyz; float h = world1.y, w = world0.x, kind = world0.w;
  float rnd = hash12(base.xz);
  float a = rnd * 6.283; mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 lp = R * position.xz;
  // gentle wind: tops sway, phase from position
  float sway = sin(atm.w * 1.3 + rnd * 40.0 + base.x * 0.05) * 0.012 * h * position.y * position.y;
  vPos = base + vec3(lp.x * w + sway, position.y * h, lp.y * w + sway * 0.6);
  vUV = vec2((uv.x + kind) / 6.0, uv.y); vSide = normalize(vec3(lp.x, 0.0, lp.y) + 1e-4); vKind = kind; vRnd = rnd;
  gl_Position = viewProjection * vec4(vPos - floatO, 1.0);
}`;
  BABYLON.Effect.ShadersStore.treeFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
const bool A2C = ${Q.msaa > 1};
const float NEAR_TREE_IN = ${NEAR_TREE_IN.toFixed(1)}, NEAR_TREE_OUT = ${NEAR_TREE_OUT.toFixed(1)};
uniform sampler2D atlas;
varying vec3 vPos; varying vec2 vUV; varying vec3 vSide; varying float vKind; varying float vRnd;
void main() {
  vec4 t = texture2D(atlas, vUV);
  // keep thin silhouettes alive in the distance: boost alpha as the mip level rises
  vec2 dx = dFdx(vUV * vec2(1536.0, 512.0)), dy = dFdy(vUV * vec2(1536.0, 512.0));
  float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
  float alpha = t.a * (1.0 + max(lod, 0.0) * 0.35);
  if (alpha < (A2C ? 0.15 : 0.5)) discard;
  float dCam = distance(camPos.xz, vPos.xz);
  if (hash12(gl_FragCoord.xy) > smoothstep(NEAR_TREE_IN, NEAR_TREE_OUT, dCam)) discard;     // 3D trees take over near the camera
  vec3 alb = pow(t.rgb, vec3(2.2));
  if (vKind > 0.5 && vKind < 1.5) {        // larch: green in summer, gold to rust in autumn
    vec3 summer = vec3(0.10, 0.17, 0.05), autumn = mix(vec3(0.55, 0.36, 0.08), vec3(0.45, 0.20, 0.05), vRnd);
    alb = alb * mix(summer, autumn, smoothstep(0.35, 0.9, fogP.w + (vRnd - 0.5) * 0.3)) * 2.2;
  }
  alb *= 0.8 + 0.4 * vRnd;
  vec3 V = normalize(camPos - vPos);
  float u = fract(vUV.x * 3.0) * 2.0 - 1.0;
  vec3 face = normalize(vec3(V.x, 0.0, V.z));
  vec3 N = normalize(vSide * u * 0.9 + face * 0.6 + vec3(0.0, 0.55, 0.0));
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  // crowns are dark inside and towards the base
  float occ = mix(0.35, 1.0, pow(vUV.y > 0.0 ? 1.0 - vUV.y : 0.0, 0.6)) * mix(0.7, 1.0, abs(u));
  float ndl = max(dot(N, sunDir), 0.0) * 0.8 + 0.2 * max(dot(face, sunDir) * -1.0, 0.0);
  // backlit needles glow (strong for larch)
  float back = pow(max(dot(-V, sunDir), 0.0), 6.0) * (vKind > 0.5 && vKind < 1.5 ? 0.9 : 0.3);
  vec3 col = alb * (sunCol * (ndl + back) * sh * occ + ambient(N) * occ * 1.7) / PI;
  col = aerial(col, vPos);
  gl_FragColor = vec4(col, A2C ? clamp((alpha - 0.35) / 0.3, 0.0, 1.0) : 1.0);
}`;
  const treeMat = new BABYLON.ShaderMaterial('treeMat', scene, { vertex: 'tree', fragment: 'tree' }, {
    attributes: ['position', 'uv'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'atlas'],
  });
  treeMat.backFaceCulling = false; treeMat.setTexture('atlas', treeAtlas); bindLevels(treeMat); worldMats.push(treeMat);
  const treeVD = (() => {     // two crossed cards, base at the origin, 1 unit tall, 1 unit half-width
    const pos = [], uv = [], idx = [];
    for (let q = 0; q < 2; q++) {
      const dx = q ? 0 : 1, dz = q ? 1 : 0, o = pos.length / 3;
      pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz); uv.push(0, 1, 1, 1, 1, 0, 0, 0); idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx; return vd;
  })();
  const ASPECT = [0.21, 0.24, 0.3, 0.55, 0.11, 0.5];      // crown half-width / height per kind
  const treeCells = [];
  for (const [cx, cz, first, count] of (QS.has('notrees') ? [] : TREES.cells)) {
    const m = new BABYLON.Mesh('trees_' + cx + '_' + cz, scene); treeVD.applyToMesh(m); m.material = treeMat; m.renderingGroupId = 1; m.isPickable = false;
    const buf = new Float32Array(count * 16); let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = (first + i) * 6, x = treeRec.getInt16(o, true) / (TREES.pos_scale || 4), z = treeRec.getInt16(o + 2, true) / (TREES.pos_scale || 4), h = treeRec.getUint8(o + 4) / 4, k = treeRec.getUint8(o + 5);
      const y = terrainH(x, z) - 0.3, b = i * 16;
      if (Math.abs(terrainH(x + 2, z) - terrainH(x - 2, z)) + Math.abs(terrainH(x, z + 2) - terrainH(x, z - 2)) > 4.0 || Math.abs(terrainH(x + 8, z) - terrainH(x - 8, z)) + Math.abs(terrainH(x, z + 8) - terrainH(x, z - 8)) > 14) { buf[b + 13] = -1e5; continue; }     // no trees on cliff faces
      buf[b] = h * ASPECT[k]; buf[b + 3] = k; buf[b + 5] = h; buf[b + 10] = 1; buf[b + 12] = x; buf[b + 13] = y; buf[b + 14] = z; buf[b + 15] = 1;
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y + h);
    }
    m.thinInstanceSetBuffer('matrix', buf, 16, true);
    m.thinInstanceEnablePicking = false; m.doNotSyncBoundingInfo = true;
    m.setBoundingInfo(new BABYLON.BoundingInfo(new V3(cx - 10, ymin, cz - 10), new V3(cx + TREES.cell + 10, ymax, cz + TREES.cell + 10)));
    m.thinInstanceRefreshBoundingInfo = () => {}; treeCells.push({ m, cx: cx + TREES.cell / 2, cz: cz + TREES.cell / 2 }); withA2C(m);
  }
  // ---------- 3D trees near the camera: tiered skirts of drooping branches (~150 triangles), dithered into the cards ----------
  BABYLON.Effect.ShadersStore.tree3dVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec3 normal; attribute vec4 color;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);     // compiled without instances: draw nothing
#endif
uniform mat4 viewProjection;
varying vec3 vPos; varying vec3 vN; varying vec4 vCol; varying float vKind; varying float vRnd;
void main() {
  vec3 base = world3.xyz; float h = world1.y, w = world0.x, kind = world0.w;
  float rnd = hash12(base.xz), a = rnd * 6.283; mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 lp = R * position.xz; vec2 ln = R * normal.xz;
  float sway = sin(atm.w * 1.3 + rnd * 40.0 + base.x * 0.05) * 0.012 * h * position.y * position.y;
  vPos = base + vec3(lp.x * w * 4.0 + sway, position.y * h, lp.y * w * 4.0 + sway * 0.6);     // unit crown radius 0.25 -> h * aspect
  vN = normalize(vec3(ln.x, normal.y, ln.y)); vCol = color; vKind = kind; vRnd = rnd;
  gl_Position = viewProjection * vec4(vPos - floatO, 1.0);
}`;
  BABYLON.Effect.ShadersStore.tree3dFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
const float NEAR_TREE_IN = ${NEAR_TREE_IN.toFixed(1)}, NEAR_TREE_OUT = ${NEAR_TREE_OUT.toFixed(1)};
varying vec3 vPos; varying vec3 vN; varying vec4 vCol; varying float vKind; varying float vRnd;
void main() {
  float dCam = distance(camPos.xz, vPos.xz);
  if (hash12(gl_FragCoord.xy) < smoothstep(NEAR_TREE_IN, NEAR_TREE_OUT, dCam)) discard;
  // needles: break the skirts into tufts (alpha-like holes) and give them grain
  float n = vnoise(vPos.xz * 7.0 + vPos.y * 5.0) * 0.6 + vnoise(vPos.xy * 13.0) * 0.4;
  if (vCol.a < 0.99 && n < (vKind > 0.5 && vKind < 1.5 ? 0.4 : 0.3)) discard;
  vec3 alb = vKind < 0.5 ? vec3(0.03, 0.055, 0.028) : vKind < 1.5 ? vec3(0.09, 0.15, 0.05) : vKind < 2.5 ? vec3(0.035, 0.06, 0.03) : vKind < 3.5 ? vec3(0.07, 0.085, 0.055) : vKind < 4.5 ? vec3(0.02, 0.04, 0.022) : vec3(0.032, 0.06, 0.026);
  if (vKind > 0.5 && vKind < 1.5) {
    vec3 autumn = mix(vec3(0.5, 0.33, 0.08), vec3(0.42, 0.19, 0.05), vRnd);
    alb = mix(alb, autumn, smoothstep(0.35, 0.9, fogP.w + (vRnd - 0.5) * 0.3));
  }
  if (vCol.a > 0.99) alb = vec3(0.09, 0.065, 0.045);     // trunk
  alb *= (0.65 + 0.7 * n) * (0.85 + 0.3 * vRnd);
  vec3 N = normalize(vN); vec3 V = normalize(camPos - vPos);
  float occ = vCol.r;                                    // baked: inner and lower branches are darker
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  float back = pow(max(dot(-V, sunDir), 0.0), 6.0) * (vKind > 0.5 && vKind < 1.5 ? 0.8 : 0.25);
  vec3 col = alb * (sunCol * (max(dot(N, sunDir), 0.0) * 0.85 + 0.15 + back) * sh * occ + ambient(N) * occ * 1.6) / PI;
  gl_FragColor = vec4(aerial(col, vPos), 1.0);
}`;
  const tree3dMat = new BABYLON.ShaderMaterial('tree3dMat', scene, { vertex: 'tree3d', fragment: 'tree3d' }, {
    attributes: ['position', 'normal', 'color'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT'],
  });
  tree3dMat.backFaceCulling = false; bindLevels(tree3dMat); worldMats.push(tree3dMat);
  const makeTreeVD = (kind) => {      // unit tree: height 1, crown radius ~0.24 at the base (instance scales it)
    let seed = 11 + kind * 97; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pos = [], nrm = [], col = [], idx = [];
    const v = (x, y, z, nx, ny, nz, o, a) => { pos.push(x, y, z); nrm.push(nx, ny, nz); col.push(o, o, o, a); return pos.length / 3 - 1; };
    if (kind === 3 || kind === 5) {
      // broadleaf (and olive): a trunk that ends inside the crown, two limbs, and a rounded crown of overlapping lumpy blobs
      const trunk = (x0, y0, z0, x1, y1, z1, r0, r1) => { for (let k = 0; k < 6; k++) { const a0 = k / 6 * 6.283, a1 = (k + 1) / 6 * 6.283;
        const i0 = v(x0 + Math.cos(a0) * r0, y0, z0 + Math.sin(a0) * r0, Math.cos(a0), 0, Math.sin(a0), 0.5, 1), i1 = v(x0 + Math.cos(a1) * r0, y0, z0 + Math.sin(a1) * r0, Math.cos(a1), 0, Math.sin(a1), 0.5, 1);
        const i2 = v(x1 + Math.cos(a1) * r1, y1, z1 + Math.sin(a1) * r1, Math.cos(a1), 0, Math.sin(a1), 0.6, 1), i3 = v(x1 + Math.cos(a0) * r1, y1, z1 + Math.sin(a0) * r1, Math.cos(a0), 0, Math.sin(a0), 0.6, 1);
        idx.push(i0, i1, i2, i0, i2, i3); } };
      const cy = kind === 3 ? 0.62 : 0.66, cr = kind === 3 ? 0.27 : 0.25;
      trunk(0, 0, 0, 0, cy - 0.05, 0, 0.022, 0.012); trunk(0, cy - 0.12, 0, 0.08, cy + 0.05, 0.03, 0.01, 0.005); trunk(0, cy - 0.1, 0, -0.06, cy + 0.06, -0.05, 0.01, 0.005);
      const blobs = kind === 3 ? 6 : 8;
      for (let b = 0; b < blobs; b++) {
        const a = rnd() * 6.283, rr = b === 0 ? 0 : cr * (0.35 + 0.35 * rnd()), bx = Math.cos(a) * rr, bz = Math.sin(a) * rr, by = cy + (rnd() - 0.4) * cr * 0.7, br = cr * (b === 0 ? 0.75 : 0.45 + 0.25 * rnd());
        const U = 9, Vn = 6, first = pos.length / 3;
        for (let j = 0; j <= Vn; j++) for (let k = 0; k <= U; k++) {
          const th = j / Vn * Math.PI, ph = k / U * 6.283, nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th) * (kind === 3 ? 0.7 : 0.85), nz = Math.sin(th) * Math.sin(ph);
          const lump = 0.82 + 0.36 * rnd(), o = 0.35 + 0.65 * (0.5 + 0.5 * ny) * (0.6 + 0.4 * rr / cr + 0.2);
          v(bx + nx * br * lump, by + ny * br * lump, bz + nz * br * lump, nx, ny, nz, Math.min(1, o), 0.5);
        }
        for (let j = 0; j < Vn; j++) for (let k = 0; k < U; k++) { const i = first + j * (U + 1) + k; idx.push(i, i + U + 1, i + 1, i + 1, i + U + 1, i + U + 2); }
      }
      const vd = new BABYLON.VertexData(); vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.indices = idx; return vd;
    }
    // trunk
    for (let k = 0; k < 6; k++) { const a0 = k / 6 * 6.283, a1 = (k + 1) / 6 * 6.283, r0 = 0.018, r1 = 0.006;
      const i0 = v(Math.cos(a0) * r0, 0, Math.sin(a0) * r0, Math.cos(a0), 0, Math.sin(a0), 0.5, 1), i1 = v(Math.cos(a1) * r0, 0, Math.sin(a1) * r0, Math.cos(a1), 0, Math.sin(a1), 0.5, 1);
      const i2 = v(Math.cos(a1) * r1, 0.95, Math.sin(a1) * r1, Math.cos(a1), 0, Math.sin(a1), 0.6, 1), i3 = v(Math.cos(a0) * r1, 0.95, Math.sin(a0) * r1, Math.cos(a0), 0, Math.sin(a0), 0.6, 1);
      idx.push(i0, i1, i2, i0, i2, i3); }
    const tiers = kind === 1 ? 14 : kind === 2 ? 10 : kind >= 3 && kind !== 4 ? 9 : 17, seg = kind === 1 ? 7 : 9;
    for (let t = 0; t < tiers; t++) {
      const u = t / tiers, y = (kind === 2 ? 0.3 : kind === 3 || kind === 5 ? 0.42 : kind === 4 ? 0.03 : 0.14) + (kind === 2 ? 0.66 : kind === 3 || kind === 5 ? 0.5 : kind === 4 ? 0.95 : 0.82) * u + (rnd() - 0.5) * 0.02;
      let R = kind === 0 ? Math.pow(1 - u, 0.95) * 0.25 : kind === 1 ? Math.pow(1 - u, 0.85) * 0.24 : kind === 4 ? Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.8 * 0.11 : kind >= 3 ? Math.sin(Math.min(1, (1 - u) * 1.05) * 2.9) * 0.27 : Math.sin(Math.min(1, (1 - u) * 1.3) * 2.0) * 0.3;
      R *= 0.85 + rnd() * 0.3;
      const droop = (kind === 1 ? 0.09 : 0.11) * (0.6 + u * 0.4) * (0.7 + 0.6 * rnd()), top = y + 0.02, phase = rnd() * 6.283;
      const c = v(0, top, 0, 0, 1, 0, 0.35 + 0.4 * u, 0.5);
      const ring = [];
      for (let k = 0; k <= seg; k++) { const a = phase + k / seg * 6.283, rr = R * (0.55 + 0.75 * rnd()); ring.push(v(Math.cos(a) * rr, y - droop * (0.5 + 1.0 * rnd()), Math.sin(a) * rr, Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8, 0.55 + 0.45 * u, 0.5)); }
      for (let k = 0; k < seg; k++) idx.push(c, ring[k], ring[k + 1]);
    }
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.indices = idx; return vd;
  };
  const near3d = [0, 1, 2, 3, 4, 5].map((k) => { const m = new BABYLON.Mesh('trees3d_' + k, scene); makeTreeVD(k).applyToMesh(m); m.material = tree3dMat; m.renderingGroupId = 1; m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, false); m.thinInstanceCount = 0; return m; });
  let near3dAt = null;
  const updateNearTrees = (p) => {
    if (QS.has('notrees') || NO3D) return;
    if (near3dAt && Math.hypot(p.x - near3dAt.x, p.z - near3dAt.z) < 15) return;
    near3dAt = p.clone();
    const R = NEAR_TREE_OUT + 10, bufs = [[], [], [], [], [], []];
    for (const [cx, cz, first, count] of TREES.cells) {
      if (p.x < cx - R || p.x > cx + TREES.cell + R || p.z < cz - R || p.z > cz + TREES.cell + R) continue;
      for (let i = 0; i < count; i++) {
        const o = (first + i) * 6, x = treeRec.getInt16(o, true) / (TREES.pos_scale || 4), z = treeRec.getInt16(o + 2, true) / (TREES.pos_scale || 4);
        if ((x - p.x) ** 2 + (z - p.z) ** 2 > R * R) continue;
        const h = treeRec.getUint8(o + 4) / 4, k = treeRec.getUint8(o + 5);
        if (Math.abs(terrainH(x + 2, z) - terrainH(x - 2, z)) + Math.abs(terrainH(x, z + 2) - terrainH(x, z - 2)) > 4.0 || Math.abs(terrainH(x + 8, z) - terrainH(x - 8, z)) + Math.abs(terrainH(x, z + 8) - terrainH(x, z - 8)) > 14) continue;
        bufs[k].push(h * ASPECT[k], 0, 0, k, 0, h, 0, 0, 0, 0, 1, 0, x, terrainH(x, z) - 0.3, z, 1);
      }
    }
    near3d.forEach((m, k) => { const a = new Float32Array(bufs[k].length ? bufs[k] : new Array(16).fill(0)); m.thinInstanceSetBuffer('matrix', a, 16, false); m.thinInstanceCount = bufs[k].length / 16; m.setEnabled(bufs[k].length > 0); });
  };
  scene.onBeforeRenderObservable.add(() => updateNearTrees(scene.activeCamera.position));
  // ---------- boulders: angular limestone blocks at the scree toes and on outcrops (offline placement), drawn within ~500 m ----------
  const ROCKS = await getJSON(MAP + 'rocks.json');
  const rockRec = new DataView(await getBin(MAP + 'rocks.bin'));
  BABYLON.Effect.ShadersStore.boulderVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec3 normal;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);     // compiled without instances: draw nothing
#endif
uniform mat4 viewProjection; varying vec3 vPos; varying vec3 vN; varying float vLocalY;
void main() {
  mat4 W = mat4(world0, world1, world2, world3);
  vec4 w = W * vec4(position, 1.0); vPos = w.xyz; vN = normalize(mat3(W) * normal); vLocalY = position.y;
  gl_Position = viewProjection * vec4(w.xyz - floatO, 1.0);
}`;
  BABYLON.Effect.ShadersStore.boulderFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform highp sampler2DArray texAlb; uniform vec3 rockGain;
varying vec3 vPos; varying vec3 vN; varying float vLocalY;
void main() {
  vec3 N = normalize(vN);
  vec3 bw = pow(abs(N), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  vec3 P = vPos / 3.0;
  vec3 a = pow(texture(texAlb, vec3(P.zy, 0.0)).rgb, vec3(2.2)) * bw.x + pow(texture(texAlb, vec3(P.xz, 0.0)).rgb, vec3(2.2)) * bw.y + pow(texture(texAlb, vec3(P.xy, 0.0)).rgb, vec3(2.2)) * bw.z;
  vec3 alb = a * rockGain * (0.85 + 0.3 * hash12(floor(vPos.xz * 0.2)));
  // lichen and dirt: greener on top, darker where it sits in the grass
  alb = mix(alb, alb * vec3(0.8, 0.9, 0.7), smoothstep(0.3, 0.9, N.y) * 0.4);
  float g = smoothstep(-0.35, 0.2, vLocalY);
  alb *= mix(0.45, 1.0, g);
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  vec3 col = alb * (sunCol * max(dot(N, sunDir), 0.0) * sh + ambient(N) * mix(0.4, 1.0, g) * 1.4) / PI;
  gl_FragColor = vec4(aerial(col, vPos), 1.0);
}`;
  const boulderMat = new BABYLON.ShaderMaterial('boulderMat', scene, { vertex: 'boulder', fragment: 'boulder' }, {
    attributes: ['position', 'normal'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS, 'rockGain'],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'texAlb'],
  });
  bindLevels(boulderMat); worldMats.push(boulderMat); boulderMat.setTexture('texAlb', texArr.alb);
  { const m0 = TEX_INFO.linear_mean_albedo[TEX_INFO.layers[0]]; boulderMat.setVector3('rockGain', new V3(0.27 / m0[0], 0.26 / m0[1], 0.24 / m0[2])); }
  const boulderVDof = (sub) => {      // a faceted block: low icosphere, pushed around by noise, flattened underneath
    const src = BABYLON.MeshBuilder.CreateIcoSphere('b0', { radius: 0.5, subdivisions: sub, flat: true }, scene);
    const p = src.getVerticesData('position'), idx = src.getIndices();
    const key = (x, y, z) => [Math.round(x * 1e4), Math.round(y * 1e4), Math.round(z * 1e4)].join(',');
    const off = new Map();
    for (let i = 0; i < p.length; i += 3) {
      const k = key(p[i], p[i + 1], p[i + 2]);
      if (!off.has(k)) { const h = Math.sin(p[i] * 12.9 + p[i + 1] * 78.2 + p[i + 2] * 37.7) * 43758.5; off.set(k, 0.75 + 0.5 * (h - Math.floor(h))); }
      const f = off.get(k); p[i] *= f; p[i + 2] *= f; p[i + 1] = Math.max(p[i + 1] * f, -0.12) * 0.8;
    }
    const nr = []; BABYLON.VertexData.ComputeNormals(p, idx, nr);
    const vd = new BABYLON.VertexData(); vd.positions = p; vd.indices = Array.from(idx); vd.normals = nr; src.dispose(); return vd;
  };
  // LODs by the distance of the cell centre (256 m cells): 80 triangles near, 20 beyond ~200 m
  const boulderVDs = [boulderVDof(2), boulderVDof(1)], ROCK_LOD = [200];
  const rockCells = [];
  for (const [cx, cz, first, count] of (QS.has('norocks') ? [] : ROCKS.cells)) {
    const lods = boulderVDs.map((vd, l) => { const m = new BABYLON.Mesh('rocks_' + cx + '_' + cz + (l ? '_lod' + l : ''), scene); vd.applyToMesh(m); m.material = boulderMat; m.renderingGroupId = 1; m.isPickable = false; return m; });
    const buf = new Float32Array(count * 16), M = new BABYLON.Matrix(); let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = (first + i) * 6, x = rockRec.getInt16(o, true) / (ROCKS.pos_scale || 4), z = rockRec.getInt16(o + 2, true) / (ROCKS.pos_scale || 4), sz = rockRec.getUint8(o + 4) * ROCKS.size_scale, k = rockRec.getUint8(o + 5);
      const h1 = Math.sin(x * 12.99 + z * 78.23) * 43758.55, r1 = h1 - Math.floor(h1), r2 = (r1 * 7.31) % 1, r3 = (r1 * 13.7) % 1;
      const y = terrainH(x, z) - sz * 0.12;
      BABYLON.Matrix.ComposeToRef(new V3(sz * (0.8 + 0.5 * r2), sz * (0.55 + 0.4 * r3), sz * (0.8 + 0.5 * (1 - r2))),
        BABYLON.Quaternion.RotationYawPitchRoll(r1 * 6.28, (r2 - 0.5) * 0.35, (r3 - 0.5) * 0.35), new V3(x, y, z), M);
      M.copyToArray(buf, i * 16); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y + sz);
    }
    for (const m of lods) { m.thinInstanceSetBuffer('matrix', buf, 16, true); m.doNotSyncBoundingInfo = true;
      m.setBoundingInfo(new BABYLON.BoundingInfo(new V3(cx - 5, ymin, cz - 5), new V3(cx + ROCKS.cell + 5, ymax, cz + ROCKS.cell + 5)));
      m.thinInstanceRefreshBoundingInfo = () => {}; }
    rockCells.push({ lods, cut: ROCK_LOD, cx: cx + ROCKS.cell / 2, cz: cz + ROCKS.cell / 2 });
  }
  // ---------- shrubs: dwarf pine and alpenrose clumps (offline placement), lumpy domes with needle noise, drawn within ~600 m ----------
  const SHRUBS = await getJSON(MAP + 'shrubs.json');
  const shrubRec = new DataView(await getBin(MAP + 'shrubs.bin'));
  BABYLON.Effect.ShadersStore.shrubFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
varying vec3 vPos; varying vec3 vN; varying float vLocalY;
void main() {
  vec3 N = normalize(vN);
  float n = vnoise(vPos.xz * 3.5 + vPos.y * 2.0) * 0.6 + vnoise(vPos.xy * 9.0 + vPos.zy * 7.0) * 0.4;
  if (n < 0.28 && vLocalY > 0.1) discard;                 // ragged silhouette
  float kind = step(0.5, fract(hash12(floor(vPos.xz * 0.5)) * 3.0 + 0.0001));
  vec3 alb = mix(vec3(0.022, 0.04, 0.018), mix(vec3(0.05, 0.045, 0.02), vec3(0.09, 0.04, 0.025), fogP.w), kind * 0.0);
  alb *= 0.6 + 0.8 * n;
  float occ = mix(0.35, 1.0, smoothstep(-0.2, 0.6, vLocalY));
  N = normalize(N + vec3(n - 0.5, 0.0, vnoise(vPos.zx * 4.0) - 0.5) * 0.8);
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  vec3 col = alb * (sunCol * (max(dot(N, sunDir), 0.0) * 0.85 + 0.15) * sh * occ + ambient(N) * occ * 1.6) / PI;
  gl_FragColor = vec4(aerial(col, vPos), 1.0);
}`;
  BABYLON.Effect.ShadersStore.shrubVertexShader = BABYLON.Effect.ShadersStore.boulderVertexShader;
  const shrubMat = new BABYLON.ShaderMaterial('shrubMat', scene, { vertex: 'shrub', fragment: 'shrub' }, {
    attributes: ['position', 'normal'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT'],
  });
  shrubMat.backFaceCulling = false; bindLevels(shrubMat); worldMats.push(shrubMat);
  const shrubVDof = (sub) => {      // a lumpy dome: subdivided sphere, upper half pushed out by noise, base flattened into the ground
    const src = BABYLON.MeshBuilder.CreateIcoSphere('s0', { radius: 0.5, subdivisions: sub }, scene);
    const p = src.getVerticesData('position'), idx = src.getIndices();
    for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1], z = p[i + 2], h = Math.sin(x * 23.1 + y * 41.7 + z * 17.3) * 0.5 + Math.sin(x * 9.3 - z * 13.1) * 0.5;
      const f = 0.82 + 0.25 * h; p[i] = x * f; p[i + 2] = z * f; p[i + 1] = Math.max(y * f, -0.08) * 0.62; }
    const nr = []; BABYLON.VertexData.ComputeNormals(p, idx, nr);
    const vd = new BABYLON.VertexData(); vd.positions = p; vd.indices = Array.from(idx); vd.normals = nr; src.dispose(); return vd;
  };
  // LODs by cell-centre distance: 180 triangles near, 80 beyond ~200 m, 20 beyond ~400 m (2 m clumps are a few pixels there)
  const shrubVDs = [shrubVDof(3), shrubVDof(2), shrubVDof(1)], SHRUB_LOD = [200, 400];
  const shrubCells = [];
  for (const [cx, cz, first, count] of (QS.has('noshrubs') ? [] : SHRUBS.cells)) {
    const lods = shrubVDs.map((vd, l) => { const m = new BABYLON.Mesh('shrubs_' + cx + '_' + cz + (l ? '_lod' + l : ''), scene); vd.applyToMesh(m); m.material = shrubMat; m.renderingGroupId = 1; m.isPickable = false; return m; });
    const buf = new Float32Array(count * 16), M = new BABYLON.Matrix(); let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = (first + i) * 6, x = shrubRec.getInt16(o, true) / (SHRUBS.pos_scale || 4), z = shrubRec.getInt16(o + 2, true) / (SHRUBS.pos_scale || 4), sz = shrubRec.getUint8(o + 4) * SHRUBS.size_scale, k = shrubRec.getUint8(o + 5);
      const h1 = Math.sin(x * 12.99 + z * 78.23) * 43758.55, r1 = h1 - Math.floor(h1), y = terrainH(x, z) - 0.05;
      const hs = sz * (k ? 0.45 : 0.7) * (0.8 + 0.4 * r1);
      BABYLON.Matrix.ComposeToRef(new V3(sz * (1 + 0.6 * r1), hs, sz * (1.6 - 0.6 * r1)), BABYLON.Quaternion.RotationYawPitchRoll(r1 * 6.28, 0, 0), new V3(x, y, z), M);
      M.copyToArray(buf, i * 16); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y + hs);
    }
    for (const m of lods) { m.thinInstanceSetBuffer('matrix', buf, 16, true); m.doNotSyncBoundingInfo = true;
      m.setBoundingInfo(new BABYLON.BoundingInfo(new V3(cx - 5, ymin, cz - 5), new V3(cx + SHRUBS.cell + 5, ymax, cz + SHRUBS.cell + 5)));
      m.thinInstanceRefreshBoundingInfo = () => {}; }
    rockCells.push({ lods, cut: SHRUB_LOD, cx: cx + SHRUBS.cell / 2, cz: cz + SHRUBS.cell / 2, far: true });
  }
  mark('scatter built'); releaseGeometry(); mark('scatter released');      // trees, rocks and shrubs
  let treeT = 0;
  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now(); if (now - treeT < 300) return; treeT = now;
    const p = scene.activeCamera.position, R = { low: 1500, medium: 2200, high: 3000, ultra: 4200 }[tierName] || 2500;
    for (const c of treeCells) { const on = Math.hypot(c.cx - p.x, c.cz - p.z) < R; if (c.m.isEnabled() !== on) c.m.setEnabled(on); }
  });
  let rockT = 0; const NO_VEG_LOD = QS.has('novegLod');      // &novegLod: full detail at every distance (A/B timing)
  scene.onBeforeRenderObservable.add(() => {     // only near cells: further out the outcrop texture carries it
    const now = performance.now(); if (now - rockT < 250) return; rockT = now;
    const p = scene.activeCamera.position;
    for (const c of rockCells) {      // one LOD mesh per cell enabled (-1: none)
      const d = Math.hypot(c.cx - p.x, c.cz - p.z), l = d < Q.rocksR * (c.far ? 1.3 : 1) ? (NO_VEG_LOD ? 0 : c.cut.filter((x) => d >= x).length) : -1;
      c.lods.forEach((m, k) => { if (m.isEnabled() !== (k === l)) m.setEnabled(k === l); });
    }
  });
  // ---------- grass and flowers around the camera: crossed cards on a jittered grid, 16 m tiles cached, shrinking away at the edge ----------
  const imgData = async (p) => { const bmp = await createImageBitmap(await (await fetch(assetUrl(p))).blob(), { colorSpaceConversion: 'none' }); const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); return cx.getImageData(0, 0, bmp.width, bmp.height).data; };
  const [maskPx, canPx] = await Promise.all([imgData(MAP + 'near_m.png'), imgData(MAP + 'near_c.png')]);
  const nearPx = (data, x, z) => { const L = lvl('near'), c = Math.max(0, Math.min(N - 1, Math.floor((x + L.half) / L.res))), r = Math.max(0, Math.min(N - 1, Math.floor((L.half - z) / L.res))); return (r * N + c) * 4; };
  const roadGrid = new Map(); for (const r of ROADS) { r.points.forEach((p, i) => { const ex = roadHalf(r, i) - 3.4; const k = Math.floor(p[0] / 16) + ',' + Math.floor(p[2] / 16); if (!roadGrid.has(k)) roadGrid.set(k, []); roadGrid.get(k).push([p[0], p[2], ex]); }); }
  const roadDist = (x, z) => { let d = 1e9; const gx = Math.floor(x / 16), gz = Math.floor(z / 16); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const l = roadGrid.get((gx + i) + ',' + (gz + j)); if (l) for (const p of l) d = Math.min(d, Math.hypot(p[0] - x, p[1] - z) - p[2]); } return d; };
  const grassAtlas = (() => {
    const S = 256, cv = document.createElement('canvas'); cv.width = S * 3; cv.height = S; const c = cv.getContext('2d');
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 3; k++) {
      const x0 = k * S;
      for (let b = 0; b < (k === 2 ? 70 : 110); b++) {
        const bx = x0 + S * (0.15 + 0.7 * rnd()), h = S * (0.45 + 0.5 * rnd()), lean = (rnd() - 0.5) * S * 0.35, w = 1.5 + rnd() * 2.5;
        const g = 90 + rnd() * 90;
        c.strokeStyle = k === 1 ? `rgb(${g * 1.0 | 0},${g * 0.85 | 0},${g * 0.45 | 0})` : `rgb(${g * 0.55 | 0},${g * 0.85 | 0},${g * 0.35 | 0})`;
        c.lineWidth = w; c.beginPath(); c.moveTo(bx, S); c.quadraticCurveTo(bx + lean * 0.3, S - h * 0.6, bx + lean, S - h); c.stroke();
      }
      if (k === 2) for (let f = 0; f < 26; f++) {
        const fx = x0 + S * (0.15 + 0.7 * rnd()), fy = S * (0.25 + 0.45 * rnd()), col = ['#f4f1e6', '#f1d23a', '#8a6fd1', '#e8e2f0', '#d9443a'][Math.floor(rnd() * 5)];
        c.strokeStyle = 'rgb(70,110,50)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(fx, S); c.lineTo(fx, fy); c.stroke();
        c.fillStyle = col; c.beginPath(); c.arc(fx, fy, 3 + rnd() * 4, 0, 6.283); c.fill();
      }
    }
    const t = new BABYLON.DynamicTexture('grassAtlas', cv, scene, true); t.hasAlpha = true; t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE; t.update(false); return t;
  })();
  const GRASS_R = Math.max(1, Q.grassR);
  BABYLON.Effect.ShadersStore.grassVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec2 uv;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);
#endif
uniform mat4 viewProjection;
varying vec3 vPos; varying vec2 vUV; varying float vRnd; varying float vKind;
void main() {
  vec3 base = world3.xyz; float size = world0.x, kind = world0.y, rnd = world0.z;
  float d = distance(base.xz, camPos.xz);
  float s = size * (1.0 - smoothstep(${(GRASS_R - 12).toFixed(1)}, ${GRASS_R.toFixed(1)}, d));
  float a = rnd * 6.283; mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 lp = R * position.xz * s * 1.6;
  float bend = position.y * position.y * s * 0.25;
  vec2 wind = vec2(sin(atm.w * 1.9 + base.x * 0.21 + base.z * 0.13), cos(atm.w * 1.4 + base.z * 0.17)) * bend;
  vPos = base + vec3(lp.x + wind.x, position.y * s, lp.y + wind.y);
  vUV = vec2((uv.x + kind) / 3.0, uv.y); vRnd = rnd; vKind = kind;
  gl_Position = viewProjection * vec4(vPos - floatO, 1.0);
}`;
  BABYLON.Effect.ShadersStore.grassFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + GL_CAR + `
const bool A2C = ${Q.msaa > 1};
uniform sampler2D atlas;
varying vec3 vPos; varying vec2 vUV; varying float vRnd; varying float vKind;
void main() {
  vec4 t = texture2D(atlas, vUV);
  if (t.a < 0.12) discard;
  vec3 alb = pow(t.rgb, vec3(2.2));
  // tint to the meadow underneath: green to gold with the season
  // same family as the terrain's grass layers: green in hollows, gold where dry, varying over tens of metres, not per clump
  float dry = clamp(fogP.w + (vnoise(vPos.xz * 0.05) - 0.5) * 0.6 + (vnoise(vPos.xz * 0.6) - 0.5) * 0.2, 0.0, 1.0);
  vec3 tgt = mix(vec3(0.075, 0.105, 0.04), vec3(0.165, 0.135, 0.075), smoothstep(0.15, 0.9, dry));
  float lum = dot(alb, vec3(0.3, 0.55, 0.15));
  if (vKind < 1.5) alb = tgt * lum / 0.15 * 1.25;
  float hgt = 1.0 - vUV.y;
  alb *= (0.55 + 0.6 * hgt) * (0.85 + 0.3 * vRnd);
  // towards the edge of the grass ring, fade to the flat colour the terrain shows beyond it, so no line appears
  float edge = smoothstep(${(GRASS_R * 0.45).toFixed(1)}, ${(GRASS_R * 0.9).toFixed(1)}, distance(vPos.xz, camPos.xz));
  if (vKind < 1.5) alb = mix(alb, tgt * 1.05, edge);
  vec3 N = normalize(vec3(0.0, 1.0, 0.0) + normalize(camPos - vPos) * 0.3);
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos)) * carSunShadow(vPos);
  vec3 V = normalize(camPos - vPos);
  float back = pow(max(dot(-V, sunDir), 0.0), 5.0) * 0.6 * hgt;
  vec3 col = alb * (sunCol * (max(dot(N, sunDir), 0.0) * 0.8 + 0.2 + back) * sh + ambient(N) * 1.5 * carAO(vPos)) / PI;
  gl_FragColor = vec4(aerial(col, vPos), A2C ? clamp((t.a - 0.3) / 0.3, 0.0, 1.0) : 1.0);
}`;
  const grassMat = new BABYLON.ShaderMaterial('grassMat', scene, { vertex: 'grass', fragment: 'grass' }, {
    attributes: ['position', 'uv'],
    uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS, 'carShadowM', 'carP', 'carF'],
    samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'atlas', 'carMask'],
  });
  grassMat.backFaceCulling = false; grassMat.setTexture('atlas', grassAtlas); bindLevels(grassMat); bindCar(grassMat); worldMats.push(grassMat);
  // wildflower meadows (ref/val-gardena 26, 29): flower cards in patches tens of metres across on the alpine pastures, sparse elsewhere
  const vn2 = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v; };
  var meadowState = () => 0;      // set by the hay meadows (stage 3): 1 mown, 2 left to flower
  const flowerP = (x, z) => { if (QS.has('nostage1')) return 0.04; const ms = meadowState(x, z); if (ms === 1) return 0.006; if (ms === 2) return 0.3; const alt = terrainH(x, z) * INV_S + Y0 - patchOffsetJS(x, z); if (alt < 1450) return 0.04;
    const n = vn2(x / 22, z / 22) * 0.7 + vn2(x / 6, z / 6) * 0.3; return 0.03 + 0.24 * Math.min(1, Math.max(0, (n - 0.52) / 0.2)); };
  const grassMesh = (() => {
    const pos = [], uv = [], idx = [];
    for (let q = 0; q < 3; q++) { const a = q / 3 * Math.PI, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5, o = pos.length / 3;
      pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz); uv.push(0, 1, 1, 1, 1, 0, 0, 0); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
    const m = new BABYLON.Mesh('grass', scene), vd = new BABYLON.VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx; vd.applyToMesh(m);
    m.material = grassMat; m.renderingGroupId = 1; m.isPickable = false; m.alwaysSelectAsActiveMesh = true;
    m.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, false); m.thinInstanceCount = 0; withA2C(m); return m;
  })();
  const grassTiles = new Map(), GT = 16;
  const grassTile = (tx, tz) => {
    const key = tx + ',' + tz; if (grassTiles.has(key)) return grassTiles.get(key);
    const out = [], sp = 0.42, half = 3.4 + 1.2 + 0.7;
    for (let j = 0; j < GT / sp; j++) for (let i = 0; i < GT / sp; i++) {
      const h1 = Math.sin((tx * 977 + i) * 12.9898 + (tz * 613 + j) * 78.233) * 43758.5453, r = h1 - Math.floor(h1), r2 = (r * 91.7) % 1, r3 = (r * 37.3) % 1;
      const x = tx * GT + (i + r2) * sp, z = tz * GT + (j + r3) * sp;
      const k = nearPx(maskPx, x, z); if (maskPx[k] > 90 || maskPx[k + 1] > 170) continue;          // scree, outcrops
      if (canPx[nearPx(canPx, x, z)] > 12 && r < 0.7) continue;                                    // forest floor: sparse
      const hx = terrainH(x + 1, z) - terrainH(x - 1, z), hz = terrainH(x, z + 1) - terrainH(x, z - 1); if (Math.hypot(hx, hz) / 2 > 0.75) continue;   // steeper than ~37 deg
      if (roadDist(x, z) < half) continue;
      if (inBuilding(x, z)) continue;
      const kind = r < flowerP(x, z) ? 2 : 0;
      out.push((0.2 + 0.2 * r3) * (meadowState(x, z) === 1 ? 0.4 : 1), kind, r, 0, 0, 0, 0, 0, 0, 0, 0, 0, x, terrainH(x, z) - 0.02, z, 1);      // mown: short grass
    }
    const arr = new Float32Array(out); grassTiles.set(key, arr); if (grassTiles.size > 400) grassTiles.delete(grassTiles.keys().next().value); return arr;
  };
  let grassAt = null;
  scene.onBeforeRenderObservable.add(() => {
    if (QS.has('nograss') || !Q.grassR) { grassMesh.setEnabled(false); return; }
    const p = scene.activeCamera.position;
    if (p.y - terrainH(p.x, p.z) > 120) { grassMesh.setEnabled(false); return; }
    if (grassAt && Math.hypot(p.x - grassAt.x, p.z - grassAt.z) < 4 && grassMesh.isEnabled()) return;
    grassAt = p.clone(); grassMesh.setEnabled(true);
    const parts = [], t0x = Math.floor((p.x - GRASS_R) / GT), t1x = Math.floor((p.x + GRASS_R) / GT), t0z = Math.floor((p.z - GRASS_R) / GT), t1z = Math.floor((p.z + GRASS_R) / GT);
    let n = 0;
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) { const a = grassTile(tx, tz); parts.push(a); n += a.length; }
    const buf = new Float32Array(Math.max(16, n)); let o = 0; for (const a of parts) { buf.set(a, o); o += a.length; }
    grassMesh.thinInstanceSetBuffer('matrix', buf, 16, false); grassMesh.thinInstanceCount = n / 16;
  });
  scene.onBeforeRenderObservable.add(() => bindCar(grassMat));
  // ---------- Val Gardena pastures (stage 1; refs in ref/val-gardena): Ladin rail fences along the road and round the barns, herds of
  // cows, Haflinger horses, sheep and donkeys. Geometry in 256 m cells shown within ~450 m; &nostage1 switches it all off (A/B) ----------
  if (!QS.has('nostage1')) {
    const PC = new Map(), PCELL = 256;
    const pg = (x, z) => { const kx = Math.floor(x / PCELL), kz = Math.floor(z / PCELL), k = kx + ',' + kz; if (!PC.has(k)) PC.set(k, { cx: (kx + 0.5) * PCELL, cz: (kz + 0.5) * PCELL, G: Geo() }); return PC.get(k).G; };
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const alt = (x, z) => terrainH(x, z) * INV_S + Y0 - patchOffsetJS(x, z);       // real altitude
    const slope = (x, z) => Math.hypot(terrainH(x + 1, z) - terrainH(x - 1, z), terrainH(x, z + 1) - terrainH(x, z - 1)) / 2;
    const open = (x, z) => { const d = detailAt(x, z); return !!d && d.open && !inBuilding(x, z); };
    // a beam between two points (square section, half size r): rails, necks, tails
    const beam = (G, a, b, r, k) => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dl = Math.hypot(...d) || 1, dn = d.map((v) => v / dl);
      let s = [dn[2], 0, -dn[0]]; let sl = Math.hypot(...s); if (sl < 1e-3) { s = [1, 0, 0]; sl = 1; } s = s.map((v) => v / sl);
      const u = [dn[1] * s[2] - dn[2] * s[1], dn[2] * s[0] - dn[0] * s[2], dn[0] * s[1] - dn[1] * s[0]];
      const P = (p, i, j) => [p[0] + (s[0] * i + u[0] * j) * r, p[1] + (s[1] * i + u[1] * j) * r, p[2] + (s[2] * i + u[2] * j) * r];
      for (const [i0, j0, i1, j1, n] of [[-1, -1, 1, -1, u.map((v) => -v)], [1, -1, 1, 1, s], [1, 1, -1, 1, u], [-1, 1, -1, -1, s.map((v) => -v)]]) G.quad(P(a, i0, j0), P(a, i1, j1), P(b, i1, j1), P(b, i0, j0), n, k);
    };
    // Ladin rail fence (stangenzaun): post pairs every 2.4 m, diagonal split rails leaning along the line, a top rail
    const FENCE = C.woodOld, FENCE_D = C.wood;
    const fenceRun = (pts) => {      // pts: [[x, z], ...] polyline
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.5) continue;
        const n = Math.max(1, Math.round(len / 2.4));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
          if (!fenceBayClear(x0, z0, x1, z1)) continue;
          const y0 = terrainH(x0, z0), y1 = terrainH(x1, z1), G = pg(x0, z0), yaw = Math.atan2(x1 - x0, z1 - z0), nx = Math.cos(yaw) * 0.07, nz = -Math.sin(yaw) * 0.07;
          for (const sd of [1, -1]) beam(G, [x0 + nx * sd, y0 - 0.1, z0 + nz * sd], [x0 + nx * sd, y0 + 1.05, z0 + nz * sd], 0.045, FENCE_D);
          for (let q = 0; q < 4; q++) { const f0 = q / 4, f1 = f0 + 0.55;      // diagonal rails, each from the ground to the next bay's top
            const xa = x0 + (x1 - x0) * f0, za = z0 + (z1 - z0) * f0, ya = y0 + (y1 - y0) * f0 + 0.08, xb = x0 + (x1 - x0) * Math.min(f1, 1.35), zb = z0 + (z1 - z0) * Math.min(f1, 1.35), yb = y0 + (y1 - y0) * Math.min(f1, 1.35) + 0.98;
            beam(G, [xa, ya, za], [xb, yb, zb], 0.03, FENCE); }
          beam(G, [x0, y0 + 1.02, z0], [x1, y1 + 1.02, z1], 0.035, FENCE);
        }
      }
    };
    // the Dolomites part of the route: from the pass to the end of the SS242 (route distances here: ROUTE_S is declared further down)
    const RS = [0]; for (let i = 1; i < ROUTE_PTS.length; i++) RS.push(RS[i - 1] + Math.hypot(ROUTE_PTS[i][0] - ROUTE_PTS[i - 1][0], ROUTE_PTS[i][2] - ROUTE_PTS[i - 1][2]));
    const eD = (() => { const e = RBY.ss242.points[RBY.ss242.points.length - 1]; let bi = 0, bd = Infinity; ROUTE_PTS.forEach((q, i) => { const d = (q[0] - e[0]) ** 2 + (q[2] - e[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; })();
    const dirAt = (i) => { const a = ROUTE_PTS[Math.max(0, i - 3)], b = ROUTE_PTS[Math.min(ROUTE_PTS.length - 1, i + 3)], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[2] - a[2]) / l]; };
    let nFence = 0, fenceM = 0;
    // fences along the road through open pasture: runs of 50-140 m on one side, 9-14 m from the centreline, ending at hairpins
    for (let i = 60; i < eD - 60;) {
      const s0 = RS[i]; let j = i; while (j < eD && RS[j] - s0 < 160) j++;
      if (rnd() < 0.5) {
        const side = rnd() < 0.5 ? 1 : -1, off = 9 + rnd() * 5, runLen = 50 + rnd() * 90;      // beyond the road's cut and fill banks, on the natural ground
        let seg = []; const emit = () => { if (seg.length >= 8) { fenceRun(seg); nFence++; fenceM += seg.length * 2 * SCALE * 2; } seg = []; };
        for (let k = i; k < j && RS[k] - s0 < runLen; k += 2) {
          const d = dirAt(k), d2 = dirAt(Math.min(k + 8, eD)); if (Math.abs(d[0] * d2[1] - d[1] * d2[0]) > 0.5) { emit(); continue; }      // no fence round a hairpin
          const x = ROUTE_PTS[k][0] + d[1] * side * off, z = ROUTE_PTS[k][2] - d[0] * side * off;
          if (!open(x, z) || slope(x, z) > 0.85 || roadDist(x, z) < 7 || alt(x, z) < 1500) { emit(); continue; }      // an obstacle splits the run
          seg.push([x, z]);
        }
        emit();
      }
      i = j;
    }
    // paddock fences round half of the barns and malgas near the road: two or three sides of a rectangle 8-14 m out
    for (const b of PROPS.buildings) {
      if (b.patch !== 'dolomites' || (b.cls !== 'hut' && b.cls !== 'malga') || roadDist(b.c[0], b.c[1]) > 600 || rnd() > 0.5) continue;
      const yaw = Math.PI / 2 - b.ang, gx = Math.max(4, b.wid) / 2 + 8 + rnd() * 6, gz = Math.max(4, b.len) / 2 + 8 + rnd() * 6, c = Math.cos(yaw), s = Math.sin(yaw);
      const W2 = (x, z) => [b.c[0] + x * c + z * s, b.c[1] - x * s + z * c], corners = [W2(-gx, -gz), W2(gx, -gz), W2(gx, gz), W2(-gx, gz)];
      const start = Math.floor(rnd() * 4), sides = 2 + (rnd() < 0.5 ? 1 : 0), pts = [];
      for (let q = 0; q <= sides; q++) pts.push(corners[(start + q) % 4]);
      if (pts.every(([x, z]) => roadDist(x, z) > 3 && slope(x, z) < 0.6)) { fenceRun(pts); nFence++; }
    }
    // herds (refs 25-30): one every few hundred metres on open, gentle pasture 40-350 m off the road
    const HERD = {
      cow: { n: [6, 14], r: 28, gap: 3.2 }, horse: { n: [3, 7], r: 30, gap: 4 }, sheep: { n: [25, 60], r: 15, gap: 1.2 }, donkey: { n: [2, 4], r: 8, gap: 2.4 },
    };
    const COW = { sim: [[0.26, 0.09, 0.03], [0.42, 0.4, 0.36]], swiss: [[0.13, 0.105, 0.08], [0.17, 0.14, 0.11]], grey: [[0.2, 0.19, 0.17], [0.24, 0.23, 0.21]] };
    const animal = (type, x, z, yaw, graze, v) => {
      const G = pg(x, z), g = terrainH(x, z), o = [x, g, z], T = (lx, ly, lz) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), g + ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
      // a rounded body: a wide flat box crossed with a narrow tall one (an octagon-ish section), with tapered ends
      const blob = (oo, cx, cy, cz, hx, hy, hz, k) => { G.box(oo, yaw, cx, cy, cz, hx, hy * 0.72, hz, k); G.box(oo, yaw, cx, cy, cz, hx * 0.72, hy, hz * 0.94, k); G.box(oo, yaw, cx, cy, cz, hx * 0.8, hy * 0.8, hz * 1.06, k); };
      if (type === 'sheep') {
        const wool = [0.26 + v * 0.06, 0.245 + v * 0.05, 0.2 + v * 0.04], dark = [0.05, 0.045, 0.04];      // weathered wool, not paint white
        blob(o, 0, 0.64, 0, 0.27, 0.26, 0.48, wool);
        const hy = graze ? 0.28 : 0.78; beam(G, T(0, 0.75, 0.42), T(0, hy + 0.08, 0.68), 0.09, wool); G.box(T(0, hy, 0.72), yaw, 0, 0, 0, 0.08, 0.1, 0.13, dark);
        for (const [lx, lz] of [[-0.14, 0.32], [0.14, 0.32], [-0.14, -0.32], [0.14, -0.32]]) G.box(o, yaw, lx, 0.2, lz, 0.04, 0.2, 0.04, dark);
        return;
      }
      const horse = type === 'horse', donkey = type === 'donkey';
      const pal = horse ? [[0.3, 0.12, 0.045], [0.55, 0.44, 0.26]] : donkey ? [[0.2, 0.19, 0.18], [0.42, 0.4, 0.37]] : COW[v < 0.5 ? 'sim' : v < 0.8 ? 'swiss' : 'grey'];
      // proportions (m): a cow's barrel is deep, its belly ~0.6 m off the ground on thick legs; a horse stands higher on slender legs
      const body = pal[0], pale = pal[1], sc = donkey ? 0.75 : 1, hb = (horse ? 1.18 : 1.0) * sc, hl = (horse ? 0.9 : 0.95) * sc, hw = (horse ? 0.28 : 0.36) * sc, hy = (horse ? 0.33 : 0.4) * sc;
      blob(o, 0, hb, 0, hw, hy, hl, body);      // barrel
      blob(o, 0, hb + hy * 0.7, -hl * 0.7, hw * 0.85, hy * 0.35, hl * 0.28, body);      // hips
      blob(o, 0, hb + hy * 0.65, hl * 0.62, hw * 0.8, hy * 0.35, hl * 0.25, body);      // shoulders
      if (!horse && !donkey && v < 0.5) G.box(o, yaw, 0, hb - 0.12, 0.1, hw + 0.01, 0.2, hl * 0.6, pale);      // Simmental: white belly patch
      const legC = !horse && !donkey && v < 0.5 ? pale : donkey ? body : horse ? [0.12, 0.05, 0.02] : body, lh = hb - hy * 0.6, lt = (horse ? 0.065 : 0.095) * sc;
      for (const [lx, lz] of [[-hw * 0.6, hl * 0.72], [hw * 0.6, hl * 0.72], [-hw * 0.6, -hl * 0.75], [hw * 0.6, -hl * 0.75]]) { G.box(o, yaw, lx, lh / 2, lz, lt, lh / 2, lt, legC); G.box(o, yaw, lx, lh * 0.82, lz, lt * 1.35, lh * 0.2, lt * 1.6, body); }      // legs, thicker at the top
      const nb = T(0, hb + 0.2 * sc, hl * 0.85), hd = graze ? T(0, 0.25 * sc, hl + (horse ? 1.05 : 0.7) * sc) : T(0, hb + (horse ? 0.75 : 0.35) * sc, hl + (horse ? 0.7 : 0.55) * sc);
      beam(G, nb, hd, (horse ? 0.17 : 0.23) * sc, body);
      const headC = !horse && !donkey && v < 0.5 ? pale : body; blob(hd, 0, 0, graze ? 0.12 * sc : 0.2 * sc, (horse ? 0.13 : 0.16) * sc, (horse ? 0.16 : 0.2) * sc, (horse ? 0.32 : 0.3) * sc, headC);
      if (horse) beam(G, T(0, hb + 0.42, hl * 0.75), [hd[0], hd[1] + 0.22, hd[2]], 0.06, pale);      // blond mane
      if (donkey) for (const sx of [-1, 1]) beam(G, [hd[0], hd[1] + 0.12, hd[2]], T(sx * 0.12, (graze ? 0.62 : hb + 0.85) * sc, hl + 0.5 * sc), 0.035, body);      // long ears
      if (!horse && !donkey) for (const sx of [-1, 1]) beam(G, [hd[0], hd[1] + 0.12, hd[2]], [hd[0] + Math.cos(yaw) * sx * 0.22, hd[1] + 0.2, hd[2] - Math.sin(yaw) * sx * 0.22], 0.025, [0.35, 0.33, 0.28]);      // horns
      beam(G, T(0, hb + 0.25 * sc, -hl), T(0, hb - (horse ? 0.65 : 0.55) * sc, -hl - (horse ? 0.25 : 0.12)), horse ? 0.08 : 0.03, horse ? pale : body);      // tail
      if (!horse && !donkey) G.box(o, yaw, 0, hb - 0.42, -hl * 0.45, 0.14, 0.08, 0.16, [0.42, 0.25, 0.22]);      // udder
    };
    const herds = []; let nAnim = 0;
    for (let i = 40; i < eD; i += 12) {
      for (const side of [1, -1]) {
        if (rnd() > 0.18) continue;
        const d = dirAt(i), dist = 25 + rnd() * rnd() * 300, cx = ROUTE_PTS[i][0] + d[1] * side * dist, cz = ROUTE_PTS[i][2] - d[0] * side * dist;
        if (herds.some((h) => Math.hypot(h.x - cx, h.z - cz) < 260)) continue;
        if (!open(cx, cz) || slope(cx, cz) > 0.36 || roadDist(cx, cz) < 18 || alt(cx, cz) < 1550 || alt(cx, cz) > 2350) continue;
        const u = rnd(), type = u < 0.45 ? 'cow' : u < 0.65 ? 'horse' : u < 0.9 ? 'sheep' : 'donkey', H = HERD[type];
        const n = H.n[0] + Math.floor(rnd() * (H.n[1] - H.n[0] + 1)), placed = [], dir0 = rnd() * 6.28;
        for (let a = 0; a < n * 8 && placed.length < n; a++) {
          const rr = H.r * Math.sqrt(rnd()), th = rnd() * 6.28, x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
          if (placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < H.gap) || !open(x, z) || slope(x, z) > 0.45 || roadDist(x, z) < 8) continue;
          placed.push([x, z]); animal(type, x, z, dir0 + (rnd() - 0.5) * (type === 'sheep' ? 1.2 : 2.6), rnd() < 0.75, rnd()); nAnim++;
        }
        if (placed.length) herds.push({ x: cx, z: cz, type, n: placed.length, s: Math.round(RS[i]) });
      }
    }
    // meshes per cell, switched by distance
    const cells = [];
    for (const c of PC.values()) for (const v of c.G.vds()) { const m = new BABYLON.Mesh('pasture_' + Math.round(c.cx) + '_' + Math.round(c.cz), scene); v.applyToMesh(m); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false; m.freezeWorldMatrix(); cells.push({ m, cx: c.cx, cz: c.cz }); }
    let pT = 0;
    scene.onBeforeRenderObservable.add(() => { const now = performance.now(); if (now - pT < 250) return; pT = now; const p = scene.activeCamera.position;
      for (const c of cells) { const on = Math.hypot(c.cx - p.x, c.cz - p.z) < 450 + PCELL * 0.71; if (c.m.isEnabled() !== on) c.m.setEnabled(on); } });
    window.__pastures = { herds, nAnim, nFence, fenceM: Math.round(fenceM), cells: cells.length, tris: cells.reduce((a, c) => a + c.m.getTotalIndices() / 3, 0) };
    console.log('pastures: ' + JSON.stringify({ herds: herds.length, animals: nAnim, fences: nFence, fenceM: Math.round(fenceM), cells: cells.length }));
  }
  // ---------- streams (stage 2; refs ref/val-gardena 12-16): the OSM streams of Val Gardena, carved as channels by the builder
  // (streams.json: water surface points), drawn as flowing ribbons; stone parapets where a road crosses one. &nostreams: off ----------
  const STREAMS = QS.has('nostreams') ? null : await getJSON(MAP + 'streams.json').catch(() => null);
  if (STREAMS && STREAMS.streams.length) {
    // ripple normals and foam: tileable textures made here (no assets). Ripples: a sum of periodic waves, drawn out across the flow
    // (a stream's standing waves); foam: thresholded turbulence. Both are scrolled along the stream (its uv.y runs with the flow).
    const waterTex = (() => {
      const S = 256, cn = document.createElement('canvas'); cn.width = S; cn.height = S; const cx = cn.getContext('2d'), im = cx.createImageData(S, S);
      let seed = 11; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const W = []; for (let k = 0; k < 14; k++) W.push([1 + Math.floor(r() * 5), Math.floor((r() - 0.5) * 7), r() * 6.283, 0.25 + r() * 0.75]);
      const F = []; for (let k = 0; k < 24; k++) F.push([Math.floor((r() - 0.5) * 9), Math.floor((r() - 0.5) * 14) || 1, r() * 6.283, 0.3 + r() * 0.7]);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S * 6.283, v = y / S * 6.283; let hx = 0, hy = 0, f = 0;
        for (const [a, b, ph, am] of W) { const c = Math.cos(a * u + b * v + ph) * am; hx += c * a; hy += c * b; }
        for (const [a, b, ph, am] of F) f += Math.sin(a * u + b * v + ph + Math.sin(b * u * 0.5 + ph) * 1.7) * am;
        const o = (y * S + x) * 4, l = Math.hypot(hx, hy, 18) || 1;
        im.data[o] = 128 + 127 * hx / l; im.data[o + 1] = 128 + 127 * hy / l; im.data[o + 2] = Math.max(0, Math.min(255, 128 + f * 26)); im.data[o + 3] = 255;
      }
      cx.putImageData(im, 0, 0);
      const tx = new BABYLON.DynamicTexture('waterTex', cn, scene, true); tx.wrapU = tx.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; tx.update(false); return tx;
    })();
    BABYLON.Effect.ShadersStore.streamVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec2 uv; attribute vec2 uv2; attribute vec4 color;
uniform mat4 viewProjection;
varying vec3 vPos; varying vec2 vUV; varying vec2 vFlowW; varying float vFade;
void main() { vPos = position; vUV = uv; vFlowW = uv2; vFade = color.r; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
    BABYLON.Effect.ShadersStore.streamFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform sampler2D waterTex; uniform highp sampler2DArray texAlb; uniform vec3 stoneGain;
// vUV: across (0 to 1) and along (m), vFlowW: slope (drop per metre) and width (m), vFade: 0 where the water ends (culverts)
varying vec3 vPos; varying vec2 vUV; varying vec2 vFlowW; varying float vFade;
void main() {
  float slope = vFlowW.x, w = vFlowW.y, a = abs(vUV.x - 0.5) * 2.0, depthF = 1.0 - a * a;
  float speed = 0.45 + clamp(slope, 0.0, 0.4) * 7.0, tt = atm.w;
  vec2 q = vec2(vUV.x * w, vUV.y);
  vec4 tA = texture2D(waterTex, vec2(q.x / 2.2, (q.y - tt * speed) / 1.4));
  vec4 tB = texture2D(waterTex, vec2(q.x / 1.1 + 0.37, (q.y - tt * speed * 1.4) / 0.75));
  vec4 tC = texture2D(waterTex, mat2(0.8, -0.6, 0.6, 0.8) * vec2(q.x / 1.7, (q.y - tt * speed * 0.8) / 1.9) + 0.61);      // a third layer at an angle: no aligned stripes
  vec2 nn = (tA.rg * 2.0 - 1.0) * 0.45 + (tB.rg * 2.0 - 1.0) * 0.3 + (tC.rg * 2.0 - 1.0) * 0.25;
  float rough = 0.35 + clamp(slope * 4.0, 0.0, 0.9);
  vec3 N = normalize(vec3(nn.x * rough, 1.0, nn.y * rough));
  vec3 V = normalize(camPos - vPos);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = skyL(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  vec3 lit = (sunCol * max(sunDir.y, 0.0) * sh + ambient(vec3(0.0, 1.0, 0.0))) / PI;
  // the water body: clear over pale stones at the edges, glacial green in the deeper middle (refs 12-14)
  vec3 bed = pow(texture(texAlb, vec3(vPos.xz / 2.2 + nn * 0.04, 1.0)).rgb, vec3(2.2)) * stoneGain * 0.7;      // the stones under clear water, wobbling with the ripples
  vec3 deep = vec3(0.022, 0.05, 0.042);
  vec3 body = mix(bed, deep, smoothstep(0.15, 0.95, depthF) * 0.85) * lit;
  // sun glints with normal-variance filtering: where the ripple normals change fast on screen (far, or rough fast water) the
  // highlight widens and dims into a sheen instead of single-pixel sparkles (the 'glitter')
  float rgh = clamp(length(fwidth(nn)) * 5.0 + clamp(slope, 0.0, 0.4) * 1.5, 0.0, 1.0), gp = mix(160.0, 10.0, rgh);
  float glint = pow(max(dot(R, sunDir), 0.0), gp) * (gp / 160.0) * 3.0 * sh;
  // foam: where the stream drops, carried with the current, and a thin line at the banks of the faster stretches
  // foam streaks drawn out along the flow (not specks); the threshold is widened by the pattern's screen-space rate (fwidth),
  // so far foam blurs into soft white instead of sparkling
  float fm = texture2D(waterTex, vec2(q.x / 1.4 + 0.2, (q.y - tt * speed * 1.15) / 6.5)).b * 0.6 + texture2D(waterTex, vec2(q.x / 0.7 + 0.5, (q.y - tt * speed * 1.4) / 3.2)).b * 0.4;
  float dist = distance(vPos, camPos), patchy = smoothstep(0.35, 0.75, texture2D(waterTex, vec2(q.x / 6.0, (q.y - tt * speed * 0.5) / 9.0) + 0.27).b);
  float foamAmt = (clamp((slope - 0.07) * 2.4, 0.0, 0.45) * (0.4 + 0.6 * patchy) + smoothstep(0.8, 1.0, a) * clamp(slope * 2.0, 0.0, 0.2)) * (1.0 - smoothstep(60.0, 220.0, dist));
  float fw = fwidth(fm) * 1.8;
  float foam = smoothstep(1.0 - foamAmt - fw, 1.0 - foamAmt + 0.2 + fw, fm) * step(0.001, foamAmt) * (1.0 - 0.45 * smoothstep(25.0, 120.0, dist));
  vec3 col = body * (1.0 - fres) + sky * fres + sunCol * glint;
  col = mix(col, vec3(0.7, 0.72, 0.7) * lit * 1.2, foam);
  float alpha = (1.0 - smoothstep(0.62, 1.0, a)) * (0.5 + 0.45 * depthF) + fres * 0.3;
  alpha = clamp(max(alpha, foam * (1.0 - smoothstep(0.85, 1.0, a))), 0.0, 1.0) * smoothstep(0.0, 1.0, vFade);
  gl_FragColor = vec4(aerial(col, vPos), alpha);
}`;
    // the bank: a strip draped on the ground under and beside the water, the photo-scanned stones and gravel, dark where wet,
    // fading out into the meadow (the terrain shader stays as it is)
    BABYLON.Effect.ShadersStore.bankVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec4 color;
uniform mat4 viewProjection;
varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying float vFade;
void main() { vPos = position; vN = normal; vUV = uv; vFade = color.r; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
    BABYLON.Effect.ShadersStore.bankFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform highp sampler2DArray texAlb; uniform vec3 stoneGain; uniform vec3 gravelGain;
// vUV.x: 0 at the water's middle, 1 at the outer edge of the strip, vFade: 0 where the stream ends
varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying float vFade;
void main() {
  vec3 N = normalize(vN);
  vec3 stones = pow(texture(texAlb, vec3(vPos.xz / 2.2, 1.0)).rgb, vec3(2.2)), gravel = pow(texture(texAlb, vec3(vPos.xz / 1.6 + 0.3, 4.0)).rgb, vec3(2.2));
  float e = vUV.x;
  vec3 alb = mix(stones * stoneGain, gravel * gravelGain, smoothstep(0.45, 0.85, e) * (0.35 + 0.4 * vnoise(vPos.xz * 0.6)));      // mostly stones, gravel in patches
  alb *= mix(0.42, 1.0, smoothstep(0.32, 0.6, e));      // wet below and just above the waterline
  float sh = (sunShadow(vPos.xz) * cloudShade(vPos));
  vec3 col = alb * (sunCol * max(dot(N, sunDir), 0.0) * sh + ambient(N)) / PI;
  float alpha = (1.0 - smoothstep(0.62, 1.0, e + (vnoise(vPos.xz * 1.3) - 0.5) * 0.25)) * smoothstep(0.0, 1.0, vFade);
  gl_FragColor = vec4(aerial(col, vPos), alpha);
}`;
    window.__srcStream = BABYLON.Effect.ShadersStore.streamFragmentShader;      // for reading compile errors
    const LIT_U = ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS];
    const streamMat = new BABYLON.ShaderMaterial('streamMat', scene, { vertex: 'stream', fragment: 'stream' }, {
      attributes: ['position', 'uv', 'uv2', 'color'], uniforms: [...LIT_U, 'stoneGain'], samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'waterTex', 'texAlb'], needAlphaBlending: true,
    });
    streamMat.backFaceCulling = false; streamMat.disableDepthWrite = true; streamMat.alphaMode = BABYLON.Engine.ALPHA_COMBINE; streamMat.setTexture('waterTex', waterTex); streamMat.setTexture('texAlb', texArr.alb); bindLevels(streamMat); worldMats.push(streamMat);
    const bankMat = new BABYLON.ShaderMaterial('bankMat', scene, { vertex: 'bank', fragment: 'bank' }, {
      attributes: ['position', 'normal', 'uv', 'color'], uniforms: [...LIT_U, 'stoneGain', 'gravelGain'], samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'texAlb'], needAlphaBlending: true,
    });
    bankMat.backFaceCulling = false; bankMat.disableDepthWrite = true; bankMat.alphaMode = BABYLON.Engine.ALPHA_COMBINE; bankMat.zOffset = -2; bankMat.setTexture('texAlb', texArr.alb);
    { const m1 = TEX_INFO.linear_mean_albedo[TEX_INFO.layers[1]], m4 = TEX_INFO.linear_mean_albedo[TEX_INFO.layers[4]]; bankMat.setVector3('stoneGain', new V3(0.17 / m1[0], 0.165 / m1[1], 0.15 / m1[2])); streamMat.setVector3('stoneGain', new V3(0.17 / m1[0], 0.165 / m1[1], 0.15 / m1[2])); bankMat.setVector3('gravelGain', new V3(0.15 / m4[0], 0.14 / m4[1], 0.12 / m4[2])); }
    bindLevels(bankMat); worldMats.push(bankMat);
    const SC = new Map(), SCELL = 256;
    const sbuf = (x, z) => { const kx = Math.floor(x / SCELL), kz = Math.floor(z / SCELL), k = kx + ',' + kz; if (!SC.has(k)) SC.set(k, { cx: (kx + 0.5) * SCELL, cz: (kz + 0.5) * SCELL, pos: [], uv: [], uv2: [], col: [], idx: [], bpos: [], bnrm: [], buv: [], bcol: [], bidx: [], G: Geo() }); return SC.get(k); };
    let nCross = 0, nSkip = 0;
    const BANK = [-1, -0.62, -0.34, 0, 0.34, 0.62, 1];      // across the bank strip, as fractions of its half width
    for (const s of STREAMS.streams) {
      const P = s.points, n = P.length; if (n < 3) continue;
      const hw = s.width / 2 + s.depth * SCALE * 0.55 / 0.7 + 0.1, bw = hw + 2.2;      // water to where the bank meets it; stones 2.2 m beyond
      const nrm = (i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
      const slopeAt = (i) => { const k0 = Math.max(0, i - 4), k1 = Math.min(n - 1, i + 4); return Math.max(0, (P[k0][1] - P[k1][1]) / Math.max(1, Math.hypot(P[k1][0] - P[k0][0], P[k1][2] - P[k0][2]))); };
      const culvert = (i) => roadDist(P[i][0], P[i][2]) < 9;      // under and beside a road the stream runs in a pipe: nothing drawn
      const fade = new Float32Array(n).fill(1e9); { let d = 0; for (let i = 0; i < n; i++) { d = (i === 0 || culvert(i)) ? 0 : d + STREAMS.step; fade[i] = d; }
        d = 0; for (let i = n - 1; i >= 0; i--) { d = (i === n - 1 || culvert(i)) ? 0 : d + STREAMS.step; fade[i] = Math.min(1, Math.min(fade[i], d) / 4); } }
      const pushPair = (c, i, s0) => { const p = P[i], [nx, nz] = nrm(i), sl = slopeAt(i), f = fade[i]; c.pos.push(p[0] + nx * hw, p[1], p[2] + nz * hw, p[0] - nx * hw, p[1], p[2] - nz * hw); c.uv.push(0, s0, 1, s0); c.uv2.push(sl, s.width, sl, s.width); c.col.push(f, 0, 0, 1, f, 0, 0, 1);
        for (const f of BANK) { const x = p[0] + nx * bw * f, z = p[2] + nz * bw * f, y = Math.min(terrainH(x, z), p[1] - 0.02 + Math.abs(f) * 9) + 0.035;
          const gx = terrainH(x + 0.7, z) - terrainH(x - 0.7, z), gz = terrainH(x, z + 0.7) - terrainH(x, z - 0.7), l = Math.hypot(gx, 1.4, gz);
          c.bpos.push(x, y, z); c.bnrm.push(-gx / l, 1.4 / l, -gz / l); c.buv.push(Math.abs(f), s0); c.bcol.push(fade[i], 0, 0, 1); } };
      let along = 0, prev = null, open = false;
      for (let i = 0; i < n - 1; i++) {
        const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
        if (culvert(i) || culvert(i + 1)) { open = false; nSkip++; along += l; continue; }
        const c = sbuf(a[0], a[2]);
        if (prev !== c || !open) { prev = c; open = true; pushPair(c, i, along); }      // a strip starts (or restarts) here
        const o = c.pos.length / 3 - 2, ob = c.bpos.length / 3 - BANK.length;
        pushPair(c, i + 1, along + l);
        c.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        for (let k = 0; k < BANK.length - 1; k++) { const p0 = ob + k, p1 = ob + BANK.length + k; c.bidx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1); }
        along += l;
      }
      // a road over the stream: low stone parapets along both road edges (ref 16), once per crossing
      for (let i = 0, last = -1e9; i < n; i += 3) {
        if (roadDist(P[i][0], P[i][2]) >= 1.0 || i * STREAMS.step - last < 30) continue;
        last = i * STREAMS.step; nCross++;
        let best = null, bd = Infinity; for (const r of ROADS) for (let j = 0; j < r.points.length; j += 2) { const q = r.points[j], d2 = (q[0] - P[i][0]) ** 2 + (q[2] - P[i][2]) ** 2; if (d2 < bd) { bd = d2; best = [r, j]; } }
        const [r, j] = best, q0 = r.points[Math.max(0, j - 2)], q1 = r.points[Math.min(r.points.length - 1, j + 2)], ry = r.points[j], yaw = Math.atan2(q1[0] - q0[0], q1[2] - q0[2]);
        const hwR = (r.width || 7) / 2 + 0.6, len = s.width + 4, G = sbuf(ry[0], ry[2]).G;
        for (const sd of [1, -1]) G.box([ry[0], ry[1], ry[2]], yaw, sd * hwR, 0.35, 0, 0.25, 0.4, len / 2, C.stone);
      }
    }
    const scells = [];
    for (const c of SC.values()) {
      const mk = (name, mat, set) => { const m = new BABYLON.Mesh(name + Math.round(c.cx) + '_' + Math.round(c.cz), scene), vd = new BABYLON.VertexData(); set(vd); vd.applyToMesh(m); m.material = mat; m.isPickable = false; m.freezeWorldMatrix(); return m; };
      if (c.bidx.length) { const m = mk('streamBank_', bankMat, (vd) => { vd.positions = c.bpos; vd.normals = c.bnrm; vd.uvs = c.buv; vd.colors = c.bcol; vd.indices = c.bidx; }); m.renderingGroupId = 1; m.alphaIndex = 1; scells.push({ m, cx: c.cx, cz: c.cz }); }
      if (c.idx.length) { const m = mk('stream_', streamMat, (vd) => { vd.positions = c.pos; vd.indices = c.idx; vd.uvs = c.uv; vd.uvs2 = c.uv2; vd.colors = c.col; }); m.renderingGroupId = 1; m.alphaIndex = 2; scells.push({ m, cx: c.cx, cz: c.cz }); }
      for (const v of c.G.vds()) { const m = new BABYLON.Mesh('streamProp_' + Math.round(c.cx) + '_' + Math.round(c.cz), scene); v.applyToMesh(m); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false; m.freezeWorldMatrix(); scells.push({ m, cx: c.cx, cz: c.cz }); }
    }
    let sT = 0;
    scene.onBeforeRenderObservable.add(() => { const now = performance.now(); if (now - sT < 300) return; sT = now; const p = scene.activeCamera.position;
      for (const c of scells) { const on = Math.hypot(c.cx - p.x, c.cz - p.z) < 1500; if (c.m.isEnabled() !== on) c.m.setEnabled(on); } });
    // spray over the white water (the user's request): droplets thrown up where a stream falls, drawn only within ~60 m of the car.
    // Each droplet is a billboard animated in the vertex shader from its emitter and a seed (launch, arc, fall, fade); the CPU only
    // refreshes the emitter list twice a second. An ordinary ShaderMaterial, so the load-time warm-up builds its pipeline.
    if (!QS.has('nospray')) {
      const EM = [];      // [x, y, z, strength, flow dir x, flow dir z]
      for (const s of STREAMS.streams) { const P = s.points;
        for (let i = 2; i < P.length - 2; i += 2) { const a = P[i - 2], b = P[i + 2], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, sl = (a[1] - b[1]) / l;
          if (sl < 0.12 || s.intermittent || roadDist(P[i][0], P[i][2]) < 13) continue;      // spray only where it really falls, never over a culvert
          EM.push([P[i][0], P[i][1], P[i][2], Math.min(1, (sl - 0.04) * 6) * Math.min(1, s.width / 3), (b[0] - a[0]) / l, (b[2] - a[2]) / l]); } }
      BABYLON.Effect.ShadersStore.sprayVertexShader = GL_COMMON + `
attribute vec3 position;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);
#endif
uniform mat4 viewProjection; uniform vec3 camRight; uniform vec3 camUp;
varying vec2 vUV; varying float vA; varying vec3 vPos;
void main() {
  vec3 e = world0.xyz; float seed = world0.w, str = world1.x, size = world1.y; vec2 fd = world1.zw;
  float life = 0.7 + 0.6 * fract(seed * 7.13), t = fract(atm.w / life + seed), tt = t * life;
  float a = seed * 37.7, sp = 0.6 + 1.4 * fract(seed * 3.31);
  vec3 v = vec3(cos(a) * 0.45 + fd.x * 0.9, 1.6 + 1.8 * fract(seed * 5.77), sin(a) * 0.45 + fd.y * 0.9) * (0.5 + 0.5 * str) * sp;
  vec3 p = e + vec3((fract(seed * 11.3) - 0.5) * 1.2, 0.02, (fract(seed * 13.7) - 0.5) * 1.2) + v * tt + vec3(0.0, -4.9 * tt * tt, 0.0);
  p.y = max(p.y, e.y - 0.05);
  float s = size * (0.7 + 0.8 * t);
  vPos = p + (camRight * position.x + camUp * position.y) * s;
  vUV = position.xy + 0.5; vA = sin(t * 3.14159) * str;
  gl_Position = viewProjection * vec4(vPos - floatO, 1.0);
}`;
      BABYLON.Effect.ShadersStore.sprayFragmentShader = GL_COMMON + `
varying vec2 vUV; varying float vA; varying vec3 vPos;
void main() {
  float r = length(vUV - 0.5) * 2.0, a = (1.0 - smoothstep(0.35, 1.0, r)) * vA * 0.75;
  if (a < 0.02) discard;
  vec3 col = vec3(0.85, 0.88, 0.88) * (sunCol * max(sunDir.y, 0.1) * 0.9 + ambient(vec3(0.0, 1.0, 0.0)) * 1.2) / PI;
  gl_FragColor = vec4(aerial(col, vPos), a);
}`;
      const sprayMat = new BABYLON.ShaderMaterial('sprayMat', scene, { vertex: 'spray', fragment: 'spray' }, {
        attributes: ['position'], uniforms: ['floatO', 'viewProjection', 'camPos', 'camRight', 'camUp', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol'], samplers: ['skyLUT'], needAlphaBlending: true,
      });
      sprayMat.backFaceCulling = false; sprayMat.disableDepthWrite = true; sprayMat.alphaMode = BABYLON.Engine.ALPHA_COMBINE; sprayMat.setTexture('skyLUT', skyLUT); worldMats.push(sprayMat);
      const spray = new BABYLON.Mesh('spray', scene);
      { const vd = new BABYLON.VertexData(); vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]; vd.indices = [0, 1, 2, 0, 2, 3]; vd.applyToMesh(spray); }
      spray.material = sprayMat; spray.renderingGroupId = 1; spray.isPickable = false; spray.alwaysSelectAsActiveMesh = true;
      spray.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, false); spray.thinInstanceCount = 0; spray.setEnabled(false);
      const MAXD = 600, R_ON = 60; let spT = 0;
      scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera, f = cam.getDirection(V3.Forward()), up = cam.getDirection(V3.Up()), rt = cam.getDirection(V3.Right());
        sprayMat.setVector3('camRight', rt); sprayMat.setVector3('camUp', up);
        const now = performance.now(); if (now - spT < 500) return; spT = now;
        let c = cam.position; try { if (car) c = car.getAbsolutePosition(); } catch (err) { /* the car is declared further down: before that, the camera */ }
        const near = [];
        const cp = cam.position; for (const e of EM) { const d = Math.min(Math.hypot(e[0] - c.x, e[2] - c.z), Math.hypot(e[0] - cp.x, e[2] - cp.z)); if (d < R_ON) near.push([d, e]); }      // near the car (or a review camera)
        if (!near.length) { if (spray.isEnabled()) spray.setEnabled(false); return; }
        near.sort((a, b) => a[0] - b[0]);
        const buf = new Float32Array(MAXD * 16); let n = 0;
        for (const [d, e] of near) { const k = Math.round(6 + 14 * e[3]);
          for (let j = 0; j < k && n < MAXD; j++, n++) { const o = n * 16, sd = Math.abs(Math.sin((e[0] * 12.9898 + e[2] * 78.233 + j * 37.719)) * 43758.5453) % 1;
            buf[o] = e[0]; buf[o + 1] = e[1]; buf[o + 2] = e[2]; buf[o + 3] = sd; buf[o + 4] = e[3]; buf[o + 5] = 0.07 + 0.09 * ((sd * 7.7) % 1); buf[o + 6] = e[4]; buf[o + 7] = e[5]; buf[o + 15] = 1; } }
        spray.thinInstanceSetBuffer('matrix', buf.subarray(0, n * 16), 16, false); spray.thinInstanceCount = n; if (!spray.isEnabled()) spray.setEnabled(true);
      });
      window.__spray = { emitters: EM.length };
    }
    // the sound of water (the corridor has no other audio): brown noise through a low band (the rush) and a higher, slowly wobbling
    // band (the babble), louder near bigger and steeper streams; starts on the first key or click (browsers block audio before);
    // &mute: silent
    if (!QS.has('mute')) {
      const SG = new Map();      // 16 m grid of stream points: [x, z, loudness]
      for (const s of STREAMS.streams) for (let i = 0; i < s.points.length; i += 3) { const p = s.points[i], a = s.points[Math.max(0, i - 6)], b = s.points[Math.min(s.points.length - 1, i + 6)];
        const sl = Math.max(0, (a[1] - b[1]) / Math.max(1, Math.hypot(b[0] - a[0], b[2] - a[2]))), k = Math.floor(p[0] / 16) + ',' + Math.floor(p[2] / 16);
        if (!SG.has(k)) SG.set(k, []); SG.get(k).push([p[0], p[2], Math.min(1, 0.25 + s.width / 6 + sl * 2.5) * (s.intermittent ? 0.4 : 1)]); }
      const loud = (x, z) => { let best = 0; const gx = Math.floor(x / 16), gz = Math.floor(z / 16); for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (const [px, pz, L] of (SG.get((gx + i) + ',' + (gz + j)) || [])) {
        const d = Math.hypot(px - x, pz - z); best = Math.max(best, L * Math.max(0, 1 - d / 45) ** 2); } return best; };
      let AC = null, out = null;
      const start = () => {
        if (AC) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
        const n = AC.sampleRate * 4, buf = AC.createBuffer(2, n, AC.sampleRate);
        for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } }
        const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
        const rush = AC.createBiquadFilter(); rush.type = 'bandpass'; rush.frequency.value = 520; rush.Q.value = 0.6;
        const bab = AC.createBiquadFilter(); bab.type = 'bandpass'; bab.frequency.value = 2400; bab.Q.value = 1.4;
        const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.7; lg.gain.value = 900; lfo.connect(lg); lg.connect(bab.frequency); lfo.start();
        const gb = AC.createGain(); gb.gain.value = 0.55;
        out = AC.createGain(); out.gain.value = 0;
        src.connect(rush); rush.connect(out); src.connect(bab); bab.connect(gb); gb.connect(out); out.connect(AC.destination); src.start();
      };
      window.addEventListener('keydown', start, { once: true }); window.addEventListener('pointerdown', start, { once: true });
      let aT = 0;
      scene.onBeforeRenderObservable.add(() => { if (!out) return; const now = performance.now(); if (now - aT < 200) return; aT = now;
        let c = scene.activeCamera.position; try { if (car) c = car.getAbsolutePosition(); } catch (err) { /* the car is declared further down */ }
        out.gain.setTargetAtTime(Math.min(0.9, loud(c.x, c.z)) * 0.6, AC.currentTime, 0.35); });
      window.__streamLoud = loud;
    }
    // streams ordered by how close they come to a road (review shots stream_<n>): [stream, nearest point index]
    STREAMS.near = STREAMS.streams.map((s, k) => { let bi = 0, bd = Infinity; s.points.forEach((p, i) => { const d = roadDist(p[0], p[2]); if (d < bd) { bd = d; bi = i; } }); return [k, bi, bd]; }).sort((a, b) => a[2] - b[2]);
    window.__streams = { streams: STREAMS.streams.length, meshes: scells.length, crossings: nCross, metres: Math.round(STREAMS.streams.reduce((a, s) => a + s.points.length * STREAMS.step, 0)) };
  }
  // ---------- hay meadows and trails (stage 3; refs ref/val-gardena 06, 25, 26): OSM meadows near the drive, about half mown
  // (short, lighter grass in mower stripes along the contours; some with rows of drying hay and Ladin hay stacks or wrapped bales),
  // the rest left to flower; OSM footpaths and farm tracks as worn strips draped on the ground. &nohay: off ----------
  const LAND = QS.has('nohay') ? null : await getJSON(MAP + 'landscape.json').catch(() => null);
  if (LAND) {
    const LU = ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', ...LEVEL_UNIFORMS];
    const hsh = (a) => { const s = Math.sin(a * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };
    const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1] + 1e-9) + a[0]) c = !c; } return c; };
    const edgeD = (P, x, z) => { let d = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[j], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)); d = Math.min(d, Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z)); } return d; };
    const tN = (x, z) => { const gx = terrainH(x + 1, z) - terrainH(x - 1, z), gz = terrainH(x, z + 1) - terrainH(x, z - 1), l = Math.hypot(gx, 2, gz); return [-gx / l, 2 / l, -gz / l]; };
    const LC = new Map(), LCELL = 256;
    const lcell = (x, z) => { const kx = Math.floor(x / LCELL), kz = Math.floor(z / LCELL), k = kx + ',' + kz; if (!LC.has(k)) LC.set(k, { cx: (kx + 0.5) * LCELL, cz: (kz + 0.5) * LCELL, m: { pos: [], nrm: [], uv: [], uv2: [], idx: [] }, t: { pos: [], nrm: [], uv: [], uv2: [], idx: [] }, G: Geo() }); return LC.get(k); };
    // the meadows: a raster of their state (8 m) for the grass, and a draped decal for the mown ones
    const MS = new Map(); meadowState = (x, z) => MS.get(Math.floor(x / 8) + ',' + Math.floor(z / 8)) || 0;
    let nMown = 0, nHay = 0; const mownC = [];
    for (const md of LAND.meadows) {
      const P = md.p, mown = hsh(md.id) < 0.55, x0 = Math.min(...P.map((q) => q[0])), x1 = Math.max(...P.map((q) => q[0])), z0 = Math.min(...P.map((q) => q[1])), z1 = Math.max(...P.map((q) => q[1]));
      for (let x = Math.floor(x0 / 8) * 8 + 4; x < x1; x += 8) for (let z = Math.floor(z0 / 8) * 8 + 4; z < z1; z += 8) if (inPoly(P, x, z)) MS.set(Math.floor(x / 8) + ',' + Math.floor(z / 8), mown ? 1 : 2);
      if (!mown) continue;
      nMown++; mownC.push([(x0 + x1) / 2, (z0 + z1) / 2]);
      // mowing runs along the contours: stripes across the field's mean downhill direction
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, n0 = tN(cx, cz), dl = Math.hypot(n0[0], n0[2]) || 1, ax = -n0[2] / dl, az = n0[0] / dl;
      const rows = hsh(md.id * 3.1) < 0.6, bales = hsh(md.id * 7.7) < 0.35, SP = 5;
      for (let x = Math.floor(x0 / SP) * SP; x < x1; x += SP) for (let z = Math.floor(z0 / SP) * SP; z < z1; z += SP) {
        if (!inPoly(P, x + SP / 2, z + SP / 2) || roadDist(x + SP / 2, z + SP / 2) < 6) continue;
        const c = lcell(x, z).m, o = c.pos.length / 3;
        for (const [qx, qz] of [[x, z], [x + SP, z], [x, z + SP], [x + SP, z + SP]]) { const n = tN(qx, qz); c.pos.push(qx, terrainH(qx, qz) + 0.06, qz); c.nrm.push(...n); c.uv.push(qx * az - qz * ax, Math.min(edgeD(P, qx, qz), 9)); c.uv2.push(hsh(md.id * 1.3), rows ? 1 : 0); }
        c.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
      // hay on the ground: stacks on poles along every other drying row, or a few wrapped bales by the field's edge
      // on every other drying row (the shader's rows sit at u = 6 (k + 0.5 - hash)), a stack every 5 m along it
      const uS = P.map((q) => q[0] * az - q[1] * ax), qS = P.map((q) => q[0] * ax + q[1] * az), hf = hsh(md.id * 1.3);
      if (rows && !bales) for (let k = Math.ceil(Math.min(...uS) / 12); k * 12 < Math.max(...uS); k++) for (let q = Math.min(...qS); q < Math.max(...qS); q += 5) {
        const u = 12 * k + 6 * (0.5 - hf), x = az * u + ax * q, z = -ax * u + az * q; if (!inPoly(P, x, z) || edgeD(P, x, z) < 4 || roadDist(x, z) < 8 || hsh(x * 0.37 + z) < 0.35) continue;
        const G = lcell(x, z).G, y = terrainH(x, z), HAY = [0.2, 0.16, 0.07, LYR(0)], sides = 6;
        G.box([x, y, z], 0, 0, 0.9, 0, 0.03, 0.9, 0.03, C.wood);
        for (let i = 0; i < sides; i++) { const a0 = i / sides * 6.283, a1 = (i + 1) / sides * 6.283, r0 = 0.55, top = [x, y + 1.75, z], b0 = [x + Math.cos(a0) * r0, y + 0.25, z + Math.sin(a0) * r0], b1 = [x + Math.cos(a1) * r0, y + 0.25, z + Math.sin(a1) * r0], am = (a0 + a1) / 2;
          G.quad(b0, b1, top, top, [Math.cos(am) * 0.9, 0.45, Math.sin(am) * 0.9], HAY); }
        nHay++;
      }
      if (bales) for (let i = 0; i < 6; i++) { const t0 = i / 6 * P.length | 0, q = P[t0], x = q[0] + (cx - q[0]) * 0.12, z = q[1] + (cz - q[1]) * 0.12; if (roadDist(x, z) < 8) continue;
        const G = lcell(x, z).G, y = terrainH(x, z), yaw = hsh(i + md.id) * 6.28; G.box([x, y, z], yaw, 0, 0.6, 0, 0.6, 0.6, 0.62, [0.48, 0.48, 0.46, LYR(2)]); G.box([x, y, z], yaw + 0.785, 0, 0.6, 0, 0.6, 0.6, 0.6, [0.48, 0.48, 0.46, LYR(2)]); nHay++; }
    }
    // trails: worn dirt and gravel, ragged edges; farm tracks as two wheel ruts with grass between
    let nTrail = 0;
    for (const tr of LAND.paths) {
      const P = tr.p, n = P.length, track = tr.k === 'track', hw = tr.w / 2 + 0.25;
      const pts = []; for (let i = 0; i < n - 1; i++) { const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(l / 2)); for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); } pts.push(P[n - 1]);
      let along = 0, open = false, prev = null;
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / dl, nz = (b[0] - a[0]) / dl;
        if (i) along += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
        if (roadDist(x, z) < 6 || inBuilding(x, z)) { open = false; continue; }
        const c = lcell(x, z), T = c.t;
        if (prev !== c || !open) { prev = c; open = true; T.last = -1; }
        const o = T.pos.length / 3;
        for (const f of [-1, 0, 1]) { const px = x + nx * hw * f, pz = z + nz * hw * f; T.pos.push(px, terrainH(px, pz) + 0.05, pz); T.nrm.push(...tN(px, pz)); T.uv.push(f, along); T.uv2.push(track ? 1 : 0, tr.w); }
        if (T.last >= 0) T.idx.push(T.last, T.last + 1, o, T.last + 1, o + 1, o, T.last + 1, T.last + 2, o + 1, T.last + 2, o + 2, o + 1);
        T.last = o; nTrail++;
      }
    }
    BABYLON.Effect.ShadersStore.dragVertexShader = GL_COMMON + `
attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec2 uv2;
uniform mat4 viewProjection;
varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying vec2 vU2;
void main() { vPos = position; vN = normal; vUV = uv; vU2 = uv2; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
    BABYLON.Effect.ShadersStore.mownFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform highp sampler2DArray texAlb; uniform vec3 grassGain;
// vUV: across-the-slope coordinate (m) and distance to the field's edge (m), vU2: field hash and drying rows (1)
varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying vec2 vU2;
void main() {
  vec3 N = normalize(vN);
  vec3 g = pow(texture(texAlb, vec3(vPos.xz / 1.4, 2.0)).rgb, vec3(2.2)) * grassGain;
  float s = vUV.x / 3.2, pass = smoothstep(0.4, 0.6, abs(fract(s) - 0.5) * 2.0);      // mower passes: alternating tones
  vec3 alb = g * vec3(1.25, 1.18, 0.78) * mix(0.9, 1.08, pass) * (0.92 + 0.16 * vU2.x);
  float row = (1.0 - smoothstep(0.05, 0.16, abs(fract(vUV.x / 6.0 + vU2.x) - 0.5))) * vU2.y * (0.75 + 0.25 * vnoise(vPos.xz * 0.8));
  alb = mix(alb, vec3(0.2, 0.16, 0.075) * (0.85 + 0.3 * vnoise(vPos.xz * 2.0)), row);      // drying hay in rows
  float sh = sunShadow(vPos.xz) * cloudShade(vPos);
  vec3 col = alb * (sunCol * max(dot(N, sunDir), 0.0) * sh + ambient(N)) / PI;
  float alpha = smoothstep(0.5, 3.5, vUV.y + (vnoise(vPos.xz * 0.5) - 0.5) * 2.0) * 0.92;
  gl_FragColor = vec4(aerial(col, vPos), alpha);
}`;
    BABYLON.Effect.ShadersStore.trailFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform highp sampler2DArray texAlb; uniform vec3 dirtGain; uniform vec3 gravelGain;
// vUV: across (-1 to 1) and along (m), vU2: track (1, two wheel ruts) and width (m)
varying vec3 vPos; varying vec3 vN; varying vec2 vUV; varying vec2 vU2;
void main() {
  vec3 N = normalize(vN);
  float a = abs(vUV.x), wob = (vnoise(vec2(vUV.y * 0.7, vUV.x * 2.0 + 3.0)) - 0.5) * 0.35;
  float path = 1.0 - smoothstep(0.55, 0.95, a + wob);
  float ruts = 1.0 - smoothstep(0.12, 0.3, abs(a - 0.55 + wob * 0.4));
  float m = mix(path, ruts, vU2.x);
  vec3 dirt = pow(texture(texAlb, vec3(vPos.xz / 1.3, 3.0)).rgb, vec3(2.2)) * dirtGain, grav = pow(texture(texAlb, vec3(vPos.xz / 0.9 + 0.4, 4.0)).rgb, vec3(2.2)) * gravelGain;
  vec3 alb = mix(dirt, grav, smoothstep(0.4, 0.7, vnoise(vPos.xz * 0.4)) * 0.7);
  float sh = sunShadow(vPos.xz) * cloudShade(vPos);
  vec3 col = alb * (sunCol * max(dot(N, sunDir), 0.0) * sh + ambient(N)) / PI;
  gl_FragColor = vec4(aerial(col, vPos), m * 0.9 * (1.0 - smoothstep(900.0, 1400.0, distance(vPos, camPos))));
}`;
    const mk = (name, frag, extra) => { const m = new BABYLON.ShaderMaterial(name, scene, { vertex: 'drag', fragment: frag }, { attributes: ['position', 'normal', 'uv', 'uv2'], uniforms: [...LU, ...extra], samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'texAlb'], needAlphaBlending: true });
      m.backFaceCulling = false; m.disableDepthWrite = true; m.alphaMode = BABYLON.Engine.ALPHA_COMBINE; m.zOffset = -2; m.setTexture('texAlb', texArr.alb); bindLevels(m); worldMats.push(m); return m; };
    const mownMat = mk('mownMat', 'mown', ['grassGain']), trailMat = mk('trailMat', 'trail', ['dirtGain', 'gravelGain']);
    { const mean = (i) => TEX_INFO.linear_mean_albedo[TEX_INFO.layers[i]], g = mean(2), d = mean(3), v = mean(4);
      mownMat.setVector3('grassGain', new V3(0.09 / g[0], 0.11 / g[1], 0.05 / g[2])); trailMat.setVector3('dirtGain', new V3(0.2 / d[0], 0.17 / d[1], 0.13 / d[2])); trailMat.setVector3('gravelGain', new V3(0.24 / v[0], 0.23 / v[1], 0.21 / v[2])); }
    const lcells = [];
    for (const c of LC.values()) {
      for (const [b, mat, nm] of [[c.m, mownMat, 'mown_'], [c.t, trailMat, 'trail_']]) if (b.idx.length) { const m = new BABYLON.Mesh(nm + Math.round(c.cx) + '_' + Math.round(c.cz), scene), vd = new BABYLON.VertexData();
        vd.positions = b.pos; vd.normals = b.nrm; vd.uvs = b.uv; vd.uvs2 = b.uv2; vd.indices = b.idx; vd.applyToMesh(m); m.material = mat; m.renderingGroupId = 1; m.alphaIndex = 0; m.isPickable = false; m.freezeWorldMatrix(); lcells.push({ m, cx: c.cx, cz: c.cz, r: nm === 'trail_' ? 1400 : 1100 }); }
      for (const v of c.G.vds()) { const m = new BABYLON.Mesh('hay_' + Math.round(c.cx) + '_' + Math.round(c.cz), scene); v.applyToMesh(m); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false; m.freezeWorldMatrix(); lcells.push({ m, cx: c.cx, cz: c.cz, r: 600 }); }
    }
    let lT = 0;
    scene.onBeforeRenderObservable.add(() => { const now = performance.now(); if (now - lT < 300) return; lT = now; const p = scene.activeCamera.position;
      for (const c of lcells) { const on = Math.hypot(c.cx - p.x, c.cz - p.z) < c.r; if (c.m.isEnabled() !== on) c.m.setEnabled(on); } });
    window.__land = { mownC, meadows: LAND.meadows.length, mown: nMown, hay: nHay, trails: LAND.paths.length, trailPts: nTrail, meshes: lcells.length };
  }
  // ---------- Lake Garda: a water surface over the lake mask (shoreline = where the terrain rises above it), and a few sails ----------
  if (WATER) {
    const mask = await imgBytes(MAP + WATER.mask), res = WATER.res, half = N * res / 2, c0 = WATER.center, S2 = 2;     // 32 m cells
    const pos = [], idx = [], wy = WATER.y;
    // the lake's extent from its mask: the shore band in the terrain shader only applies there (other patches can lie lower
    // than the water's world height, and must not get a beach or count as lake)
    { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let r = 0; r < N; r += 2) for (let c = 0; c < N; c += 2) if (mask[(r * N + c) * 4] > 127) { const x = c0[0] - half + c * res, z = c0[1] + half - r * res; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      LAKE_BOX = [x0 - 250, z0 - 250, x1 + 250, z1 + 250]; terrainMat.setVector4('lakeBox', new BABYLON.Vector4(...LAKE_BOX)); }
    lakeMaskAt = (x, z) => { const c = Math.round((x - (c0[0] - half)) / res), r = Math.round(((c0[1] + half) - z) / res);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const cc = c + a, rr = r + b; if (cc >= 0 && rr >= 0 && cc < N && rr < N && mask[(rr * N + cc) * 4] > 127) return true; } return false; };
    const at = (c, r) => { let v = 0; for (let a = -1; a <= S2; a++) for (let b = -1; b <= S2; b++) { const cc = c + a, rr = r + b; if (cc >= 0 && rr >= 0 && cc < N && rr < N && mask[(rr * N + cc) * 4] > 127) v = 1; } return v; };
    for (let r = 0; r < N; r += S2) for (let c = 0; c < N; c += S2) {
      if (!at(c, r)) continue;
      const x0 = c0[0] - half + c * res, z0 = c0[1] + half - r * res, w = S2 * res, o = pos.length / 3;
      pos.push(x0, wy, z0, x0 + w, wy, z0, x0 + w, wy, z0 - w, x0, wy, z0 - w); idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
    BABYLON.Effect.ShadersStore.waterVertexShader = `precision highp float; uniform vec3 floatO; attribute vec3 position; uniform mat4 viewProjection; varying vec3 vPos;
void main() { vPos = position; gl_Position = viewProjection * vec4(position - floatO, 1.0); }`;
    BABYLON.Effect.ShadersStore.waterFragmentShader = GL_COMMON + GL_LEVELS + GL_SHADOWED + `
uniform float waterY; uniform highp sampler2DArray nArr;
varying vec3 vPos;
const int REFL_STEPS = ${QS.has('norefl') ? 0 : ({ low: 0, medium: 10, high: 14, ultra: 20 })[tierName] ?? 10};
uniform float reflOn;
// wind waves: a spectrum of 10 short waves (9 m down to 0.5 m) around the wind direction, each at its deep-water speed
// (omega = sqrt(g k)) and faded out with distance before it can alias; their strength follows drifting wind patches, so rough
// dark water alternates with glassy stretches that mirror the mountains (Garda's Ora and Peler). Height derivatives only.
float windPatch(vec2 p, float t) {
  return smoothstep(0.32, 0.72, vnoise(p * 0.0035 + vec2(t * 0.004, t * 0.0015)) * 0.7 + vnoise(p * 0.013 - vec2(t * 0.012, -t * 0.006)) * 0.3);
}
vec2 waveGrad(vec2 p, float t, float dist, float wind) {
  vec2 g = vec2(0.0);
  float amp = mix(0.3, 1.25, wind);
  for (int i = 0; i < 10; i++) {
    float fi = float(i), lam = 9.0 * pow(0.72, fi), k = 6.2832 / lam;
    float ang = 0.55 + (fract(sin(fi * 12.9898) * 43758.5453) - 0.5) * 1.7;
    vec2 d = vec2(cos(ang), sin(ang));
    float fade = 1.0 - smoothstep(lam * 18.0, lam * 70.0, dist);
    float ph = dot(d, p) * k - t * sqrt(9.81 * k) + fi * 1.7;
    // Integrate away waves smaller than a pixel, including at grazing viewing angles.
    float pixelFade = 1.0 - smoothstep(0.7, 2.8, fwidth(ph));
    g += d * (0.045 * amp * fade * pixelFade * cos(ph));
  }
  // irregular ripples on top (breaks the regularity of the sum up close)
  vec2 q = p * 1.9 + vec2(t * 0.6, t * 0.25); float e = 0.2, h0 = vnoise(q);
  g += vec2(vnoise(q + vec2(e, 0.0)) - h0, vnoise(q + vec2(0.0, e)) - h0) / e * 0.05 * amp * (1.0 - smoothstep(30.0, 120.0, dist));
  return g;
}
// the mountains in the water: march the reflected ray over the terrain heights; returns the shaded hit (alpha = hit)
vec4 reflectTerrain(vec3 o, vec3 R) {
  if (reflOn < 0.5) return vec4(0.0);
  float s = 30.0, prevD = 0.0, prevS = 0.0;
  float hit = 0.0, hitS = 30.0, coverage = 0.0;
  // Uniform, bounded march. Carry the first crossing instead of shading in a divergent
  // branch; feather the silhouette by its projected footprint, not a binary hit/miss.
  for (int i = 0; i < REFL_STEPS; i++) {
    vec3 p = o + R * s; int li = lvW(MID_I, p.xz) >= 1.0 ? MID_I : FAR_I;
    float d = p.y - hFetchL(li, p.xz);
    float feather = max(3.0, fwidth(d) * 1.5 + s * 0.003);
    float sampleCoverage = 1.0 - smoothstep(-feather, feather, d);
    float take = (1.0 - hit) * step(d, feather);
    float sh = mix(s, prevS + (s - prevS) * clamp(prevD / max(prevD - d, 1e-3), 0.0, 1.0), step(d, 0.0));
    hitS = mix(hitS, sh, take);
    coverage = max(coverage, sampleCoverage);
    hit = max(hit, step(d, feather));
    prevD = d; prevS = s; s *= pow(280.0, 1.0 / max(1.0, float(REFL_STEPS - 1)));
  }
  vec3 h = o + R * hitS;
  int li = lvW(MID_I, h.xz) >= 1.0 ? MID_I : FAR_I;
  vec2 q = textureLod(nArr, vec3(lvUV(li, h.xz), float(li)), 0.0).rg * 2.0 - 1.0;
  vec3 Nn = normalize(vec3(q.x, sqrt(max(0.02, 1.0 - dot(q, q))), q.y));
  float rock = 1.0 - smoothstep(0.45, 0.62, Nn.y), alt = h.y - waterY;
  vec3 alb = mix(vec3(0.032, 0.041, 0.035), vec3(0.095, 0.10, 0.098), rock);
  alb = mix(alb, vec3(0.6, 0.62, 0.66), smoothstep(1700.0, 2000.0, alt) * smoothstep(0.5, 0.8, Nn.y));
  vec3 c = aerial(alb * (ambient(Nn) / PI * 1.3 + sunCol * max(dot(Nn, sunDir), 0.0) * 0.35 / PI), h);
  c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), 0.28);
  return vec4(c, coverage * 0.86);

}
void main() {
  vec2 xz = vPos.xz; float t = atm.w;
  float dist = distance(vPos, camPos);
  float wind = windPatch(xz, t);
  vec2 g = waveGrad(xz, t, dist, wind);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(camPos - vPos), R = reflect(-V, N);
  R.y = max(R.y, 0.004);
  float f = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 refl = skyL(normalize(R)) * 0.72;
  vec3 Rs = reflect(-V, normalize(mix(N, vec3(0.0, 1.0, 0.0), mix(0.96, 0.86, wind)))); Rs.y = max(Rs.y, 0.004);      // the mountains are reflected by a calmer surface than the glints, sharpest in the glassy patches
  vec4 mt = reflectTerrain(vec3(vPos.x, waterY + 0.1, vPos.z), normalize(Rs));
  refl = mix(refl, mt.rgb, mt.a);
  float depth = vPos.y - heightAt(xz);
  vec3 deep = vec3(0.006, 0.032, 0.045), shallow = vec3(0.05, 0.11, 0.095);
  vec3 body = mix(shallow, deep, smoothstep(0.3, 9.0, depth)) * (ambient(vec3(0.0, 1.0, 0.0)) / PI * 0.9 + sunCol * max(sunDir.y, 0.0) * 0.15 / PI);
  // light through the wave faces turned towards the viewer: Garda's blue-green, strongest in the rough patches
  body += vec3(0.0, 0.035, 0.04) * max(dot(normalize(g + 1e-5), -normalize(V.xz + 1e-5)), 0.0) * length(g) * 3.0 * (ambient(vec3(0.0, 1.0, 0.0)) / PI + sunCol / PI * 0.3);
  float sh = sunShadow(xz) * cloudShade(vPos);
  float sunDot = max(dot(R, sunDir), 0.0);
  float glintPower = 1.0 / (1.0 / 350.0 + fwidth(sunDot) * 2.0);
  float glint = pow(sunDot, glintPower) * (glintPower / 350.0) * 8.0 + pow(sunDot, 45.0) * 0.35;
  vec3 col = body * (1.0 - f) + refl * f + sunCol * glint * sh * 0.25 * (1.0 - mt.a);
  // the shore: clear water over the pebbles, a lapping line of foam that comes and goes
  float lap = 0.5 + 0.5 * sin(t * 1.3 + dot(xz, vec2(0.21, 0.17)) + vnoise(xz * 0.2) * 6.0);
  float foam = (1.0 - smoothstep(0.0, 0.12 + 0.25 * lap, depth)) * smoothstep(0.35, 0.7, vnoise(xz * 1.7 + t * 0.3));
  col = mix(col, vec3(0.7, 0.72, 0.72) * (ambient(vec3(0.0, 1.0, 0.0)) / PI + sunCol * max(sunDir.y, 0.0) / PI * sh), foam * 0.7);
  float a = smoothstep(0.0, 0.35, depth);      // fades over the beach so the waterline is soft
  gl_FragColor = vec4(aerial(col, vPos), a);
}`;
    const waterMat = new BABYLON.ShaderMaterial('waterMat', scene, { vertex: 'water', fragment: 'water' }, {
      attributes: ['position'], uniforms: ['floatO', 'viewProjection', 'camPos', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol', 'waterY', 'reflOn', ...LEVEL_UNIFORMS],
      samplers: [...LEVEL_SAMPLERS, 'skyLUT', 'nArr'], needAlphaBlending: true,
    });
    bindLevels(waterMat); worldMats.push(waterMat); waterMat.setFloat('waterY', WATER.y); waterMat.setFloat('reflOn', 1); waterMat.setTexture('nArr', nArr); SAFE.water = waterMat;
    const water = new BABYLON.Mesh('lake', scene); const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.applyToMesh(water);
    water.material = waterMat; water.renderingGroupId = 1; water.isPickable = false; water.freezeWorldMatrix();
    // boats: a few detailed ones close to the Torbole and Riva shores (yachts with sails, motorboats), bobbing on the swell
    {
      const BG = Geo(), HULL = [0.62, 0.62, 0.6, L(2)], DECK = [0.32, 0.22, 0.13, L(1)], SAIL = [0.7, 0.69, 0.66, L(2)], NAVY = [0.04, 0.07, 0.13, L(2)], RED = [0.35, 0.05, 0.04, L(2)];
      const Q2 = (a, b, c, d, n, k) => { BG.quad(a, b, c, d, n, k); BG.quad(d, c, b, a, n.map((v) => -v), k); };     // both faces (winding-proof)
      const hull = (o, yaw, len, beam, fb, kTop, kBot) => {      // pointed bow (+z), flat transom (-z); fb = freeboard
        const P = (x, y, z) => [o[0] + x * Math.cos(yaw) + z * Math.sin(yaw), o[1] + y, o[2] - x * Math.sin(yaw) + z * Math.cos(yaw)];
        const nrm = (x, y, z) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
        const hl = len / 2, b = beam / 2, mid = hl * 0.25;
        for (const sd of [-1, 1]) {
          Q2(P(sd * b, fb, mid), P(sd * b, fb, -hl), P(sd * b * 0.92, -0.35, -hl), P(sd * b * 0.92, -0.35, mid), nrm(sd, 0, 0), kTop);
          Q2(P(0, fb + 0.15, hl), P(sd * b, fb, mid), P(sd * b * 0.92, -0.35, mid), P(0, -0.3, hl * 0.92), nrm(sd * 0.8, 0, 0.6), kTop);
          Q2(P(sd * b * 0.935, 0.02, mid), P(sd * b * 0.935, 0.02, -hl), P(sd * b * 0.945, 0.14, -hl), P(sd * b * 0.945, 0.14, mid), nrm(sd, 0, 0), kBot);       // boot stripe
        }
        Q2(P(-b, fb, -hl), P(b, fb, -hl), P(b * 0.92, -0.35, -hl), P(-b * 0.92, -0.35, -hl), nrm(0, 0, -1), kTop);     // transom
        Q2(P(-b, fb, -hl), P(-b, fb, mid), P(b, fb, mid), P(b, fb, -hl), [0, 1, 0], DECK);                             // deck
        Q2(P(-b, fb, mid), P(0, fb + 0.15, hl), P(0, fb + 0.15, hl), P(b, fb, mid), [0, 1, 0], DECK);
        return P;
      };
      const yacht = (o, yaw, len) => {
        const P = hull(o, yaw, len, len * 0.32, 0.75, HULL, NAVY);
        BG.box(o, yaw, 0, 1.05, -len * 0.08, len * 0.11, 0.3, len * 0.16, HULL);                     // coachroof
        const mh = len * 1.35, mz = len * 0.1;
        BG.box(o, yaw, 0, 0.75 + mh / 2, mz, 0.06, mh / 2, 0.06, [0.5, 0.5, 0.5, L(5)]);             // mast
        const heel = 0.18, side = Math.sign(Math.sin(yaw * 3.1)) || 1;
        const sp = (x, y, z) => P(x + side * heel * (y - 0.75), y, z);
        Q2(sp(0, 1.4, mz - 0.1), sp(0, 1.4, mz - len * 0.42), sp(0, 1.45, mz - len * 0.42), sp(0, 0.75 + mh * 0.96, mz - 0.1), [Math.cos(yaw) * side, 0, -Math.sin(yaw) * side], SAIL);        // mainsail
        Q2(sp(0, 1.4, mz + 0.15), sp(0, 0.75 + mh * 0.8, mz + 0.1), sp(0, 0.75 + mh * 0.8, mz + 0.1), sp(0, 0.9, len * 0.5), [Math.cos(yaw) * side, 0, -Math.sin(yaw) * side], SAIL);           // jib
      };
      const motorboat = (o, yaw, len, k) => {
        hull(o, yaw, len, len * 0.36, 0.6, k, RED);
        BG.box(o, yaw, 0, 0.95, -len * 0.05, len * 0.15, 0.32, len * 0.12, [0.06, 0.08, 0.09, L(5)]);     // windscreen and console
        BG.box(o, yaw, 0, 0.8, -len * 0.3, len * 0.15, 0.15, len * 0.1, DECK);                            // seats
      };
      // water spots 60-300 m off the two towns, spread so they do not overlap
      const spots = []; let sd2 = 4242; const rn = () => { sd2 = (sd2 * 16807) % 2147483647; return sd2 / 2147483647; };
      for (const [tw, n] of [[L0.torbole, 4], [L0.riva, 5]]) {
        if (!tw) continue;
        for (let k = 0, got = 0; k < 600 && got < n; k++) {
          const a = rn() * 6.283, r = 120 + rn() * 900, x = tw[0] + Math.cos(a) * r, z = tw[tw.length - 1] + Math.sin(a) * r;
          if (!inLakeBox(x, z) || terrainH(x, z) > wy - 4) continue;
          let near = false; for (const q of spots) if (Math.hypot(q[0] - x, q[2] - z) < 70) near = true;
          let shore = Infinity; for (let b = 0; b < 12; b++) { const aa = b * 0.5236; for (let d = 20; d <= 320; d += 30) if (terrainH(x + Math.cos(aa) * d, z + Math.sin(aa) * d) > wy) { shore = Math.min(shore, d); break; } }
          if (near || shore > 320 || shore < 40) continue;
          spots.push([x, wy, z]); got++;
        }
      }
      spots.forEach((p, i) => { const yaw = rn() * 6.283; if (i % 3 === 2) motorboat(p, yaw, 6 + rn() * 3, i % 2 ? HULL : [0.5, 0.48, 0.42, L(2)]); else yacht(p, yaw, 8 + rn() * 4); });
      const boatMeshes = BG.vds().map((v, i) => { const m = new BABYLON.Mesh('boats' + i, scene); v.applyToMesh(m); m.material = propMat; m.renderingGroupId = 1; m.isPickable = false; return m; });
      scene.onBeforeRenderObservable.add(() => { const t = (performance.now() - t0) / 1000; for (const m of boatMeshes) m.position.y = Math.sin(t * 1.1) * 0.06; });
      console.log('boats', spots.length);
    }
    // sails off Torbole and Riva: white triangles, drifting slowly
    const tb = L0.torbole || [0, 0], sp = [], si = []; let seed = 77; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 400 && sp.length < 70 * 9; k++) {
      const x = tb[0] + (rnd() - 0.65) * 4500, z = tb[tb.length - 1] + (rnd() - 0.8) * 4500;
      if (!inLakeBox(x, z) || terrainH(x, z) > wy - 3) continue;
      const a = rnd() * 6.28, hgt = 5 + rnd() * 3, base = 2.5 + rnd(), o = sp.length / 3, cx = Math.cos(a), sx = Math.sin(a);
      sp.push(x - cx * base, wy + 0.8, z - sx * base, x + cx * base * 0.2, wy + 0.8, z + sx * base * 0.2, x, wy + 0.8 + hgt, z);     // sail
      si.push(o, o + 1, o + 2);
      const o2 = sp.length / 3; sp.push(x - cx * 2.6, wy + 0.05, z - sx * 2.6, x + cx * 2.6, wy + 0.05, z + sx * 2.6, x, wy + 0.7, z); si.push(o2, o2 + 1, o2 + 2);     // hull
    }
    if (sp.length) {
      const sm = new BABYLON.Mesh('sails', scene), svd = new BABYLON.VertexData(); svd.positions = sp; svd.indices = si;
      const cl = []; for (let v = 0; v < sp.length / 3; v++) cl.push(0.62, 0.61, 0.58, 2.5 / 8); svd.colors = cl;
      const nr = []; BABYLON.VertexData.ComputeNormals(sp, si, nr); svd.normals = nr; svd.applyToMesh(sm);
      sm.material = propMat; sm.renderingGroupId = 1; sm.isPickable = false;
      scene.onBeforeRenderObservable.add(() => { const t = (performance.now() - t0) / 1000; sm.position.x = Math.sin(t * 0.02) * 40; sm.position.z = Math.cos(t * 0.017) * 30; });
    }
  }

  // ---------- sky dome: LUT + sun disc + a cloud layer ----------
  BABYLON.Effect.ShadersStore.dskyVertexShader = `precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
void main(){ vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
  BABYLON.Effect.ShadersStore.dskyFragmentShader = GL_COMMON + `
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyL(vec3(d.x, max(d.y, 0.0), d.z));
  float mu = dot(d, sunDir);
  // sun disc with limb darkening
  float sd = smoothstep(0.999986, 0.999991, mu);
  c += sunCol * sd * 400.0 * (1.0 - smoothstep(0.5, 0.85, fogP.z));     // hidden behind a full overcast
  // the cumulus layer at 3500 m (cloudField, world-anchored: it stays over the mountains and matches the shadows on them)
  {
    float dy = max(d.y, 0.02), tt = max(CLOUD_Y - camPos.y, 50.0) / dy;
    vec2 xz = camPos.xz + d.xz * tt;
    float den = cloudField(xz), core = cloudField(xz + sunDir.xz * ${(160 * SCALE).toFixed(1)});      // density towards the sun: the sunlit rim is thin
    vec3 lit = sunCol * (0.18 + 0.55 * (1.0 - core) + 0.6 * pow(max(mu, 0.0), 8.0)) * (1.0 - fogP.z * 0.6) + ambYp / PI * (0.75 - 0.3 * core);
    float fade = smoothstep(0.0, 0.1, d.y) * (1.0 - smoothstep(14000.0, 45000.0, tt * INV_S));      // thins out towards the horizon
    c = mix(c, lit, den * fade * 0.92);
  }
  // below the horizon (only visible past the edge of the data): blend into hazy ground
  gl_FragColor = vec4(c, 1.0);
}`;
  const skyMat = new BABYLON.ShaderMaterial('dskyMat', scene, { vertex: 'dsky', fragment: 'dsky' }, {
    attributes: ['position'], uniforms: ['worldViewProjection', 'camPos', 'sunDir', 'sunCol', 'ambYp', 'atm', 'fogP', 'fogCol', 'ambXp', 'ambXn', 'ambYn', 'ambZp', 'ambZn'], samplers: ['skyLUT'],
  });
  skyMat.backFaceCulling = false; skyMat.disableDepthWrite = true; skyMat.setTexture('skyLUT', skyLUT);
  const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 1000, segments: 24, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  sky.material = skyMat; sky.infiniteDistance = true; sky.isPickable = false; sky.renderingGroupId = 0;
  grid.renderingGroupId = 1;
  scene.setRenderingAutoClearDepthStencil(1, false);
  worldMats.push(skyMat);

  // ---------- cumulus towers over the summits (the summer afternoon of the references): clusters of lit billboard puffs, flat
  // based, cauliflower tops, a silver lining against the sun; drifting with the cloud layer, their shadows in cloudShade ----------
  const CLOUD_T = new Array(40).fill(0);
  if (!QS.has('noclouds')) {
    // anchors: the highest ground 6-14 km out from the middle of the Dolomites stretch, in 12 directions (there the towers stand 5-10
    // degrees above the skyline, as in the photos; over the summits right by the pass they would be above the driver's view)
    const mid = ROUTE_PTS[Math.round(ROUTE_PTS.length * 0.25)], anchors = [];
    for (let k = 0; k < 12; k++) {
      const ang = k / 12 * 6.283 + 0.3; let best = null;
      for (let r = 6000; r <= 14000; r += 1000) for (const da of [-0.12, 0, 0.12]) {
        const x = mid[0] + Math.cos(ang + da) * r * SCALE, z = mid[2] + Math.sin(ang + da) * r * SCALE, h = terrainH(x, z) * INV_S + Y0;
        if (!best || h > best[1]) best = [x, h, z]; }
      anchors.push(best);
    }
    let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const puffs = [];      // [x, y, z, radius, light 0..1 (from its place in the whole cloud), seed, base y, unused]
    anchors.forEach((a, ti) => {
      if (ti >= 10) return;
      const W = (1400 + rnd() * 1400) * SCALE, H = (1200 + rnd() * 1600) * SCALE, base = (Math.max(a[1] + 300, 3200 + rnd() * 400) - Y0) * SCALE;
      const cx = a[0], cz = a[2], sun = LIGHT.sunDir;
      for (let k = 0; k < 64; k++) {
        // a dome: wide at the base, narrowing to cauliflower turrets; puffs fill it, more of them towards the core
        const hy = Math.pow(rnd(), 0.8), wide = W * 0.5 * (1 - hy * 0.55), ang = rnd() * 6.283, rr = wide * Math.sqrt(rnd());
        const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr * 0.85, y = base + hy * H, rad = W * (0.12 + rnd() * 0.08) * (1 - hy * 0.35);
        // light from the puff's place in the cloud: the side facing the sun is bright, the far side and the base are grey
        const ox = (x - cx) / (W * 0.5), oy = (y - base) / H - 0.35, oz = (z - cz) / (W * 0.5), ol = Math.hypot(ox, oy, oz) || 1;
        const facing = (ox * sun[0] + oy * sun[1] + oz * sun[2]) / ol, light = Math.min(1, Math.max(0.12, 0.55 + 0.45 * facing) * (0.55 + 0.45 * Math.min(1, hy * 2.2)));
        puffs.push([x, y, z, rad, light, rnd(), base, hy]);
      }
      CLOUD_T[ti * 4] = cx; CLOUD_T[ti * 4 + 1] = cz; CLOUD_T[ti * 4 + 2] = W * 0.5; CLOUD_T[ti * 4 + 3] = 0.85;
    });
    const T0 = CLOUD_T.slice();
    BABYLON.Effect.ShadersStore.cumulusVertexShader = GL_COMMON + `
attribute vec3 position;
#ifdef INSTANCES
attribute vec4 world0; attribute vec4 world1; attribute vec4 world2; attribute vec4 world3;
#else
const vec4 world0 = vec4(0.0), world1 = vec4(0.0), world2 = vec4(0.0), world3 = vec4(0.0, -1e5, 0.0, 1.0);
#endif
uniform mat4 viewProjection; uniform vec3 camRight; uniform vec3 camUp; uniform vec2 drift;
varying vec3 vPos; varying vec2 vUV; varying vec3 vC; varying vec4 vInfo;
void main() {
  vec3 c = world0.xyz + vec3(drift.x, 0.0, drift.y); float r = world0.w;
  vPos = c + (camRight * position.x + camUp * position.y) * r * 2.0;
  vUV = position.xy * 2.0; vC = c; vInfo = world1;
  gl_Position = viewProjection * vec4(vPos - floatO, 1.0);
}`;
    BABYLON.Effect.ShadersStore.cumulusFragmentShader = GL_COMMON + `
uniform vec3 camRight; uniform vec3 camUp;
// vInfo: light from the puff's place in the cloud, seed, cloud base (game y), height in the tower (0 base, 1 top)
varying vec3 vPos; varying vec2 vUV; varying vec3 vC; varying vec4 vInfo;
void main() {
  float r2 = dot(vUV, vUV), sd = vInfo.y * 31.7;
  float n = vnoise(vUV * 3.2 + sd) * 0.5 + vnoise(vUV * 8.5 + sd * 1.7) * 0.3 + vnoise(vUV * 19.0 + sd * 2.3) * 0.2;      // cauliflower rims
  float rr = r2 + (n - 0.45) * 0.6;
  float baseLine = vInfo.z + (n - 0.45) * 60.0;      // a flat base, ragged rather than ruled
  float alpha = (1.0 - smoothstep(mix(0.45, 0.72, vInfo.w), 1.0, rr)) * smoothstep(baseLine - 25.0, baseLine + 70.0, vPos.y) * 0.85;      // crisp cauliflower tops, softer base
  if (alpha < 0.01) discard;
  vec3 toCam = normalize(camPos - vC);
  float nz = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  vec3 N = normalize(camRight * vUV.x + camUp * vUV.y + toCam * nz);
  // light: the puff's place in the whole cloud (vInfo.x: sunlit side bright, far side and base grey), with a little of its own relief
  float relief = 0.8 + 0.2 * dot(N, sunDir), base = smoothstep(vInfo.z - 20.0, vInfo.z + 260.0, vPos.y);      // grey towards the base
  float silver = pow(max(dot(-toCam, sunDir), 0.0), 6.0) * pow(1.0 - nz, 2.0) * 1.6;
  // brilliant only where the sun strikes; the shaded side takes a little blue sky light, the flat base is darker still
  vec3 col = vec3(0.78) * (sunCol * pow(vInfo.x, 1.4) * relief * (0.35 + 0.65 * base) + ambYp * (0.22 + 0.18 * N.y) * (0.6 + 0.4 * base)) / PI + sunCol * silver / PI;
  gl_FragColor = vec4(aerial(col, vPos), alpha);
}`;
    const cuMat = new BABYLON.ShaderMaterial('cumulusMat', scene, { vertex: 'cumulus', fragment: 'cumulus' }, {
      attributes: ['position'], uniforms: ['floatO', 'viewProjection', 'camPos', 'camRight', 'camUp', 'drift', 'sunDir', 'sunCol', 'ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn', 'atm', 'fogP', 'fogCol'], samplers: ['skyLUT'], needAlphaBlending: true,
    });
    cuMat.backFaceCulling = false; cuMat.disableDepthWrite = true; cuMat.alphaMode = BABYLON.Engine.ALPHA_COMBINE; cuMat.setTexture('skyLUT', skyLUT); worldMats.push(cuMat);
    const cu = new BABYLON.Mesh('cumulus', scene);
    { const vd = new BABYLON.VertexData(); vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]; vd.indices = [0, 1, 2, 0, 2, 3]; vd.applyToMesh(cu); }
    cu.material = cuMat; cu.renderingGroupId = 1; cu.isPickable = false; cu.alwaysSelectAsActiveMesh = true;
    const buf = new Float32Array(puffs.length * 16), order = puffs.map((_, i) => i);
    const fill = () => { const c = scene.activeCamera.position; order.sort((i, j) => Math.hypot(puffs[j][0] - c.x, puffs[j][2] - c.z) - Math.hypot(puffs[i][0] - c.x, puffs[i][2] - c.z));      // far first
      order.forEach((k, n) => { const p = puffs[k], o = n * 16; buf[o] = p[0]; buf[o + 1] = p[1]; buf[o + 2] = p[2]; buf[o + 3] = p[3]; buf[o + 4] = p[4]; buf[o + 5] = p[5]; buf[o + 6] = p[6]; buf[o + 7] = p[7]; buf[o + 15] = 1; });
      cu.thinInstanceSetBuffer('matrix', buf, 16, false); };
    fill();
    let cuN = 0;
    scene.onBeforeRenderObservable.add(() => {
      const cam = scene.activeCamera, t = QS.has('shot') ? 0 : (performance.now() - t0) / 1000, dx = t * 2.4, dz = t * 0.9;      // the cloud layer's wind
      cuMat.setVector3('camRight', cam.getDirection(V3.Right())); cuMat.setVector3('camUp', cam.getDirection(V3.Up())); cuMat.setVector2('drift', new BABYLON.Vector2(dx, dz));
      for (let i = 0; i < 10; i++) { CLOUD_T[i * 4] = T0[i * 4] + dx; CLOUD_T[i * 4 + 1] = T0[i * 4 + 1] + dz; CLOUD_T[i * 4 + 3] = P.cloud > 0.6 ? 0 : T0[i * 4 + 3]; }
      if (cu.isEnabled() !== (P.cloud <= 0.6)) cu.setEnabled(P.cloud <= 0.6);      // overcast: the towers are in the grey
      if (++cuN % 20 === 0) fill();
    });
    window.__cumulus = { towers: anchors.length, puffs: puffs.length };
  }
  // ---------- Babylon lights for the PBR objects (car): driven by the same sun and sky ----------
  const sunLight = new BABYLON.DirectionalLight('sun', new V3(0, -1, 0), scene);
  const hemi = new BABYLON.HemisphericLight('skyLight', new V3(0, 1, 0), scene);

  // ---------- camera ----------
  const camera = new BABYLON.UniversalCamera('cam', new V3(0, 300, 0), scene);
  camera.minZ = 0.3; camera.maxZ = 90000; camera.fov = 0.9;
  camera.speed = 4; camera.angularSensibility = 1500; camera.inertia = 0.6;
  camera.keysUp = [87, 38]; camera.keysDown = [83, 40]; camera.keysLeft = [65, 37]; camera.keysRight = [68, 39];
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;

  // ---------- post: HDR pipeline with bloom, ACES, LUT, vignette ----------
  const pipe = new BABYLON.DefaultRenderingPipeline('post', true, scene, [camera]);
  pipe.samples = Q.msaa; pipe.fxaaEnabled = Q.msaa < 2;
  pipe.bloomEnabled = true; pipe.bloomThreshold = 1.1; pipe.bloomKernel = 64; pipe.bloomScale = 0.5;
  pipe.fxaaEnabled = false;
  const ip = pipe.imageProcessing;
  pipe.imageProcessingEnabled = true;
  ip.toneMappingEnabled = true; ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.vignetteEnabled = true; ip.vignetteColor = new BABYLON.Color4(0.02, 0.01, 0.0, 0); ip.vignetteBlendMode = BABYLON.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  ip.colorCurvesEnabled = true; ip.colorCurves = new BABYLON.ColorCurves();
  // one look-up table: warm highlights, cool lifted shadows, gentle S-curve (assets/maps/dolomites/grade.3dl)
  const lut = new BABYLON.ColorGradingTexture(assetUrl(MAP + 'grade.3dl'), scene);
  ip.colorGradingEnabled = true; ip.colorGradingTexture = lut;

  // ---------- per-frame uniforms ----------
  const t0 = performance.now();
  const applyLook = () => {
    ip.exposure = P.exposure; ip.contrast = P.contrast; ip.colorCurves.globalSaturation = (P.saturation - 1) * 100;
    lut.level = P.lut; ip.vignetteWeight = P.vignette; pipe.bloomWeight = P.bloom;
    const s = LIGHT.sunDir; sunLight.direction = new V3(-s[0], -s[1], -s[2]);
    const sc = LIGHT.sun, mx = Math.max(sc[0], sc[1], sc[2], 1e-4);
    sunLight.diffuse = new C3(sc[0] / mx, sc[1] / mx, sc[2] / mx); sunLight.intensity = mx / Math.PI * (typeof carShade === 'number' ? carShade : 1);
    const a = LIGHT.amb[2], am = Math.max(a[0], a[1], a[2], 1e-4);
    hemi.diffuse = new C3(a[0] / am, a[1] / am, a[2] / am); hemi.intensity = am / Math.PI;
    const g = LIGHT.amb[3]; hemi.groundColor = new C3(g[0] / am, g[1] / am, g[2] / am);
  };
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    updateTerrain(cam);
    if (shadowDirty) refreshShadows();
    shadowStep();
    const s = LIGHT.sunDir, A = LIGHT.amb, t = (performance.now() - t0) / 1000;
    const atm = new BABYLON.Vector4(ATM.bM0 * P.haze, Y0, P.fog, QS.has('shot') ? 0 : t), fogP = new BABYLON.Vector4(P.fogBase, P.fogFalloff, P.cloud, P.season);
    terrainMat.setFloat('nPortal', SAFE.on ? 0 : nearPortals(cam.position.x, cam.position.z)); terrainMat.setArray4('portalSeg', portalArr);
    for (const m of worldMats) {
      m.setVector3('camPos', cam.position); m.setVector3('floatO', scene.floatingOriginOffset); m.setVector3('sunDir', new V3(s[0], s[1], s[2])); m.setVector3('sunCol', new V3(...LIGHT.sun));
      ['ambXp', 'ambXn', 'ambYp', 'ambYn', 'ambZp', 'ambZn'].forEach((n, i) => m.setVector3(n, new V3(...A[i]).scale(m === skyMat ? 1 : P.fill)));
      m.setVector4('atm', atm); m.setVector4('fogP', fogP); m.setVector3('fogCol', new V3(...P.fogCol)); m.setArray4('cloudT', CLOUD_T);
    }
  });

  // ---------- shots: fixed cameras matched to the reference photos ----------
  const WS = (p) => p.map((v) => (v == null ? v : v * SCALE));      // a fixed shot position given in unscaled world metres
  const SHOTS = {
    // from the slope below Sas Ciampac / Cir trail, looking down at the pass with the Cir spires behind (ref: I07 996 Grödnerjoch, Tschierspitzen)
    pass_overlook: { pos: WS([700, null, -150]), h: 40, look: WS([600, 250, 1300]), fov: 70 },
    // west ramp hairpins from Dantercepies side, looking down the valley to Selva (ref: Passo Gardena - Dolomites, Italy 2025)
    hairpins: { pos: WS([200, null, 1300]), h: 40, look: WS([180, 30, 300]), fov: 62 },
    // chase cam behind the car on the last straight before the pass (ref: I07 968 Grödnerjoch, Passhöhe)
    chase: { road: 0.683, back: 7.5, up: 2.0, fov: 62 },
    // chapel San Mauriz with the Cir walls behind (ref: Cappella di San Maurizio01)
    chapel: { pos: [L0.chapel_san_mauriz[0] - 22, null, L0.chapel_san_mauriz[2] - 34], h: 1.7, look: [L0.chapel_san_mauriz[0] + 14, L0.chapel_san_mauriz[1] + 9, L0.chapel_san_mauriz[2] + 40], fov: 64 },
    // from above the east ramp out over Colfosco to the Alta Badia (ref: Südtirol Grödner Joch 38)
    valley: { pos: WS([1050, null, 750]), h: 30, look: WS([3600, -380, 1300]), fov: 60 },
    // west ramp looking east into the low sun over the pass (ref: Sunrise near Passo Gardena1)
    low_sun: { pos: WS([700, null, 600]), h: 4, lookSun: true, fov: 70 },
    // the Dolomites -> Garda drive (positions along the route in metres; the camera rides behind the car, looking at a landmark or ahead)
    fence_crossing: { routeM: 1980, back: 12, up: 5, fov: 64 },
    departure: { routeM: 12, back: 9, up: 3.0, fov: 64 },
    // Early-route pasture review: raised chase views every kilometre from the eastern road endpoint
    pasture_1: { routeM: 1000, back: 14, up: 6, fov: 66 }, pasture_2: { routeM: 2000, back: 14, up: 6, fov: 66 }, pasture_3: { routeM: 3000, back: 14, up: 6, fov: 66 },
    pasture_4: { routeM: 4000, back: 14, up: 6, fov: 66 }, pasture_5: { routeM: 5000, back: 14, up: 6, fov: 66 },
    valley_opening: { routeKm: 'link_valgardena_a22', at: 0.55, back: 10, up: 3.5, fov: 66 },
    motorway_castle: { nearLm: 'castel_firmiano', lookAt: 'castel_firmiano', ahead: -40, back: 18, up: 30.0, fov: 50 },
    a22_entry_seam: { routeKm: 'link_valgardena_a22', at: 0.998, back: 12, up: 3.5, fov: 66 },
    a22_exit_seam: { routeKm: 'a22', at: 0.998, back: 16, up: 3.5, fov: 66 },
    a22_entry_divider: { routeKm: 'a22', at: 0.055, back: 14, up: 9, fov: 66 },
    a22_exit_divider: { routeKm: 'a22', at: 0.94, back: 14, up: 9, fov: 66 },
    a22_entry_merge: { routeKm: 'a22', at: 0.025, back: 12, up: 4, fov: 66 },
    a22_exit_merge: { routeKm: 'a22', at: 0.975, back: 12, up: 4, fov: 66 },
    a22_start: { routeKm: 'a22', at: 0.12, back: 9, up: 2.6, fov: 66 },
    first_tunnel: { routeKm: 'link_a22_nago', at: 0.14, back: 9, up: 2.6, fov: 66 },
    link_viaduct_end: { routeKm: 'link_a22_nago', at: 0.83, back: 9, up: 2.6, fov: 66 },
    link_tunnel_exit: { routeKm: 'link_a22_nago', at: 0.76, back: 9, up: 2.6, fov: 66 },
    nago_tunnel_approach: { routeKm: 'ss240', at: 0.012, back: 9, up: 2.6, fov: 66 },
    nago_reveal: { reveal: true, ahead: 20, back: 25, up: 22.0, lookMix: 1.0, fov: 70 },
    shore_arrival: { shoreNear: 'torbole', fov: 72 },
    riva: { shoreNear: 'riva', fov: 72 },
    // standing at the waterline of the town, looking out across the lake (refs: Riva del Garda05, Torbole 100919 - Spiaggia 04)
    garda_shore_drive: { pos: WS([-6695, 0, -1553]), h: 3.2, look: [-4800 * SCALE, WATER.y + 15, -2800 * SCALE], fov: 66 },
    riva_houses: { pos: WS([-6413, 0, -1180]), h: 3, look: WS([-6430, 8, -1149]), lookGround: true, fov: 66 },
    riva_waterfront: { waterEdge: 'riva', eye: 2.2, turn: -0.35, fov: 66 },
    torbole_beach: { waterEdge: 'torbole', eye: 1.7, turn: 0.95, out: 18, fov: 66 },
  };
  const ROUTE_S = (() => { const s = [0]; for (let i = 1; i < ROUTE_PTS.length; i++) s.push(s[i - 1] + Math.hypot(ROUTE_PTS[i][0] - ROUTE_PTS[i - 1][0], ROUTE_PTS[i][2] - ROUTE_PTS[i - 1][2])); return s; })();
  function routeIndexOfRoad0(id, f) { const r = RBY[id], p = r.points[Math.round(f * (r.points.length - 1))]; let bi = 0, bd = Infinity; ROUTE_PTS.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; }
  const routeIndexAtM = (m) => { let i = 0; while (i < ROUTE_S.length - 2 && ROUTE_S[i] < m) i++; return i; };
  // line of sight over the terrain (heights sampled every ~1/80 of the way)
  const sightClear = (a, b) => { for (let k = 1; k < 80; k++) { const t = k / 80, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t; if (terrainH(x, z) > y + 0.5) return false; } return true; };
  // the lake reveal: the first point of the descent to Garda from which open water near Torbole is in sight
  const revealIndex = (() => {
    if (!WATER || !L0.torbole) return 0;
    const tb = L0.torbole, wpt = [tb[0] - 600, WATER.y + 1, tb[tb.length - 1] - 900];     // open water south-west of Torbole
    const i0 = routeIndexOfRoad0('link_a22_nago', 0);
    for (let i = i0; i < ROUTE_PTS.length; i += 4) { const p = ROUTE_PTS[i]; if (sightClear([p[0], p[1] + 1.4, p[2]], wpt)) return i; }
    return i0;
  })();
  const routeIndexOfRoad = (id, f) => { const r = RBY[id], p = r.points[Math.round(f * (r.points.length - 1))]; let bi = 0, bd = Infinity; ROUTE_PTS.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  let car = null; var ROUTE_LANE = null;
  const roadAt = (f) => { const pts = ROAD.points, i = Math.max(1, Math.min(pts.length - 2, Math.round(f * (pts.length - 1)))); const p = pts[i], q = pts[i + 1]; return { p, dir: [q[0] - p[0], q[2] - p[2]] }; };
  const setShot = (name) => {
    let S = SHOTS[name];
    const hm = /^herd_(\d+)$/.exec(name);      // herd_<n>: from the road beside pasture herd n, looking at it (stage 1 review)
    if (!S && hm && window.__pastures && window.__pastures.herds[+hm[1]]) {
      const h = window.__pastures.herds[+hm[1]]; let bi = 0, bd = Infinity; ROUTE_PTS.forEach((q, i) => { const d = (q[0] - h.x) ** 2 + (q[2] - h.z) ** 2; if (d < bd) { bd = d; bi = i; } });
      const q = ROUTE_PTS[bi], dx = h.x - q[0], dz = h.z - q[2], l = Math.hypot(dx, dz) || 1, k = Math.max(0, l - 35) / l;
      S = { pos: [q[0] + dx * k, null, q[2] + dz * k], h: 5, look: [h.x, terrainH(h.x, h.z) + 0.6, h.z], fov: 55 };
    }
    const sm = /^stream_(\d+)$/.exec(name);      // stream_<n>: on the road where the n-th nearest stream comes closest, looking down its channel
    if (!S && sm && typeof STREAMS !== 'undefined' && STREAMS && STREAMS.near && STREAMS.near[+sm[1]]) {
      const [k, i0] = STREAMS.near[+sm[1]], P = STREAMS.streams[k].points;
      let j = i0; for (let i = 0; i < P.length; i++) { const d = roadDist(P[i][0], P[i][2]); if (d > 30 && d < 120) { j = i; if (Math.abs(i - i0) > 10) break; } }
      const q = P[j], a = P[Math.max(0, j - 3)], b = P[Math.min(P.length - 1, j + 3)], l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, nx = -(b[2] - a[2]) / l, nz = (b[0] - a[0]) / l;
      S = { pos: [q[0] + nx * 20 - (b[0] - a[0]) / l * 8, null, q[2] + nz * 20 - (b[2] - a[2]) / l * 8], h: 3, look: [q[0], q[1], q[2]], fov: 60 };
    }
    const sa = /^streamAt_(\d+)_(\d+)$/.exec(name);      // streamAt_<stream>_<point>: from the nearest road point at driving height, looking downstream
    if (!S && sa && typeof STREAMS !== 'undefined' && STREAMS && STREAMS.streams[+sa[1]]) {
      const P = STREAMS.streams[+sa[1]].points, p = P[Math.min(P.length - 1, +sa[2])], q = P[Math.min(P.length - 1, +sa[2] + 10)];
      let bi = 0, bd = Infinity; ROUTE_PTS.forEach((r, i) => { const d = (r[0] - p[0]) ** 2 + (r[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      const r = ROUTE_PTS[bi], dx = r[0] - p[0], dz = r[2] - p[2], l = Math.hypot(dx, dz) || 1;      // 12 m from the stream, on the road's side
      S = { pos: [p[0] + dx / l * 12, null, p[2] + dz / l * 12], h: 4.5, look: [q[0], q[1] + 0.2, q[2]], fov: 55 };
    }
    const wm = /^wall_(\d+)$/.exec(name);      // wall_<n>: from the road, the n-th nearest big rock wall 120-400 m away (rock LOD review)
    if (!S && wm && RG) {
      if (!RG.walls) {
        const cand = [], DP = ROADS.filter((r) => r.id === 'ss243_existing' || r.id === 'ss242').flatMap((r) => r.points);      // Dolomites roads only (patches overlap)
        for (let j = 0; j < RG.N; j++) for (let i = 0; i < RG.N; i++) if (RG.out[j * RG.N + i] > 235) {
          const x = RG.x0 + (i + 0.5) * RG.C, z = RG.z0 + (j + 0.5) * RG.C; let bi = 0, bd = Infinity;
          for (let k = 0; k < DP.length; k += 2) { const d = (DP[k][0] - x) ** 2 + (DP[k][2] - z) ** 2; if (d < bd) { bd = d; bi = k; } }
          bd = Math.sqrt(bd); if (bd > 120 && bd < 400) cand.push([bd, x, z, bi]);
        }
        cand.sort((a, b) => a[0] - b[0]); RG.walls = [];
        for (const c of cand) if (RG.walls.every((w) => Math.hypot(w[1] - c[1], w[2] - c[2]) > 700)) RG.walls.push(c);
      }
      const w = RG.walls[+wm[1]];
      if (w) { const r = ROADS.filter((q) => q.id === 'ss243_existing' || q.id === 'ss242').flatMap((q) => q.points)[w[3]]; S = { pos: [r[0], null, r[2]], h: 2.5, look: [w[1], terrainH(w[1], w[2]) + 10, w[2]], fov: 55 }; }
    }
    const hm2 = /^hayfield_(\d+)$/.exec(name);      // hayfield_<n>: mown field n from the nearest road point, raised a little
    if (!S && hm2 && window.__land && window.__land.mownC[+hm2[1]]) {
      const [fx, fz] = window.__land.mownC[+hm2[1]]; let bi = 0, bd = Infinity; ROUTE_PTS.forEach((r, i) => { const d = (r[0] - fx) ** 2 + (r[2] - fz) ** 2; if (d < bd) { bd = d; bi = i; } });
      const r = ROUTE_PTS[bi], dx = fx - r[0], dz = fz - r[2], l = Math.hypot(dx, dz) || 1, kk = Math.max(0, l - 70) / l;
      S = { pos: [r[0] + dx * kk, null, r[2] + dz * kk], h: 7, look: [fx, terrainH(fx, fz) + 1, fz], fov: 60 };
    }
    if (!S) return false;
    camera.fov = S.fov * Math.PI / 180 * (canvas.height / canvas.width) * 1.5;   // fov values are horizontal at 3:2
    camera.fov = 2 * Math.atan(Math.tan(S.fov * Math.PI / 360) * canvas.height / canvas.width);
    if (!S.lmView && (S.routeM !== undefined || S.routeKm !== undefined || S.nearLm || S.reveal || S.shore)) {
      let i = S.routeM !== undefined ? routeIndexAtM(S.routeM) : S.routeKm ? routeIndexOfRoad(S.routeKm, S.at) : S.reveal ? revealIndex : 0;
      if (S.nearLm) { const lm = L0[S.nearLm]; let bd = Infinity; ROUTE_PTS.forEach((q, k) => { const d = (q[0] - lm[0]) ** 2 + (q[2] - lm[lm.length - 1]) ** 2; if (d < bd) { bd = d; i = k; } }); }
      if (S.shore && WATER) { for (let k = revealIndex; k < ROUTE_PTS.length; k++) if (ROUTE_PTS[k][1] < WATER.y + 8) { i = k; break; } }
      if (S.ahead) i = Math.max(0, Math.min(ROUTE_PTS.length - 5, i + Math.round(S.ahead / 2)));
      const p = ROUTE_PTS[i], q = ROUTE_PTS[Math.min(ROUTE_PTS.length - 1, i + 4)], l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1, dx = (q[0] - p[0]) / l, dz = (q[2] - p[2]) / l, lo = ROUTE_LANE ? ROUTE_LANE[i] : 1.6;
      const px = p[0] + dz * lo, pz = p[2] - dx * lo;
      if (car) { car.position.set(px, collisionH(px, pz) + 0.04, pz); car.rotationQuaternion = null; car.rotation.set(0, Math.atan2(dx, dz), 0); }
      let cx = px - dx * S.back, cz = pz - dz * S.back;
      if (S.nearLm) {      // frame the car on one side and the landmark on the other
        const lmA = L0[S.nearLm], ex = lmA[0] - px, ez = lmA[lmA.length - 1] - pz, el = Math.hypot(ex, ez) || 1;
        cx -= ex / el * 7; cz -= ez / el * 7;
      }
      camera.position.set(cx, Math.max(terrainH(cx, cz), p[1]) + S.up, cz);
      const lakeC = WATER && L0.torbole ? [L0.torbole[0] - 600, WATER.y, L0.torbole[L0.torbole.length - 1] - 900] : null;
      const lake = WATER && L0.torbole ? [L0.torbole[0] - 600, WATER.y, L0.torbole[L0.torbole.length - 1] - 900] : null;
      const lm = S.lookAt && L0[S.lookAt], lm2 = S.lookLakeLm ? lakeC : S.nearLm ? L0[S.nearLm] : (S.reveal || S.shore || S.lookLake) ? lake : null;
      if (lm2 && S.lookMix) { const ly = lm2.length === 3 ? lm2[1] + 5 : terrainH(lm2[0], lm2[1]) + 15, lz = lm2[lm2.length - 1]; const ax = px + dx * 40, az = pz + dz * 40;
        const ex = lm2[0] - px, ez = lz - pz, el = Math.hypot(ex, ez) || 1, k2 = S.lookMix; const cy = camera.position.y; camera.setTarget(new V3(px + dx * 12 * (1 - k2 * 0.5) + ex / el * 22 * k2, cy - 2.5 + (ly - cy) / el * 22 * k2 * 0.5, pz + dz * 12 * (1 - k2 * 0.5) + ez / el * 22 * k2)); }     // pitch from the camera's own height (raised cameras looked straight down)
      else if (lm) { const ly = lm.length === 3 ? lm[1] : terrainH(lm[0], lm[1]) + 20, lz = lm.length === 3 ? lm[2] : lm[1]; camera.setTarget(new V3(lm[0], ly, lz)); }
      else camera.setTarget(new V3(px + dx * 30, p[1] + 1.0, pz + dz * 30));
    } else if (S.shoreNear) {      // on the lakefront road nearest a landmark, looking out over the lake (south, between Riva and Torbole)
      const lm = L0[S.shoreNear], rv = L0.riva, tb = L0.torbole; let i = 0, bd = Infinity;
      ROUTE_PTS.forEach((q, k) => { const d = Math.hypot(q[0] - lm[0], q[2] - lm[lm.length - 1]) + Math.max(0, q[1] - WATER.y) * 20; if (d < bd) { bd = d; i = k; } });
      const p = ROUTE_PTS[i], q = ROUTE_PTS[Math.min(ROUTE_PTS.length - 1, i + 4)], l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1, dx = (q[0] - p[0]) / l, dz = (q[2] - p[2]) / l;
      const lo = 1.6, px = p[0] + dz * lo, pz = p[2] - dx * lo;
      // the open water: the direction in which the lake bed starts soonest and stays under water longest
      let best = null; for (let a = 0; a < 72; a++) { const ux = Math.sin(a / 72 * 6.283), uz = Math.cos(a / 72 * 6.283); let first = -1, wet = 0;
        for (let r = 20; r < 3000; r += 20) { if (terrainH(px + ux * r, pz + uz * r) < WATER.y - 0.5) { if (first < 0) first = r; wet++; } }
        const score = wet * 20 - (first < 0 ? 1e9 : first); if (!best || score > best[0]) best = [score, ux, uz]; }
      const lakeX = px + best[1] * 2000, lakeZ = pz + best[2] * 2000;
      if (car) { car.position.set(px, collisionH(px, pz) + 0.04, pz); car.rotationQuaternion = null; car.rotation.set(0, Math.atan2(dx, dz), 0); }
      const ex = lakeX - px, ez = lakeZ - pz, el = Math.hypot(ex, ez) || 1;
      camera.position.set(px - ex / el * 9 - dx * 3, p[1] + 3.2, pz - ez / el * 9 - dz * 3);
      camera.setTarget(new V3(px + ex / el * 40, p[1] + 1.0, pz + ez / el * 40));
    } else if (S.waterEdge && WATER) {      // on the shore of a town: the nearest water from the landmark, camera a few metres inland
      const lm = L0[S.waterEdge], lx = lm[0], lz = lm[lm.length - 1], wet = (x, z) => terrainH(x, z) < WATER.y - 0.3;
      let best = null;
      for (let a = 0; a < 72; a++) { const ux = Math.sin(a / 72 * 6.283), uz = Math.cos(a / 72 * 6.283);
        for (let r = 0; r < 2500; r += 10) if (wet(lx + ux * r, lz + uz * r)) {
          // open water, not an inlet: the water must be wide across this direction too
          let deep = 0, wide = 0; for (let q = 0; q < 1500; q += 50) if (wet(lx + ux * (r + q), lz + uz * (r + q))) deep++;
          for (let q = -300; q <= 300; q += 50) if (wet(lx + ux * (r + 200) - uz * q, lz + uz * (r + 200) + ux * q)) wide++;
          const score = deep + wide * 2 - r / 40; if (deep > 20 && wide > 9 && (!best || score > best[3])) best = [r, ux, uz, score]; break; } }
      if (best) {
        const [r, ux, uz] = best, sx = lx + ux * r, sz = lz + uz * r, t = S.turn || 0, vx = ux * Math.cos(t) - uz * Math.sin(t), vz = ux * Math.sin(t) + uz * Math.cos(t);
        const cx = sx + ux * (S.out || 4), cz = sz + uz * (S.out || 4);      // just off the shore, as from a jetty: clear of the shore trees (and huts)
        camera.position.set(cx, Math.max(terrainH(cx, cz), WATER.y) + S.eye, cz);
        camera.setTarget(new V3(cx + vx * 600, WATER.y + S.eye + 25, cz + vz * 600));
      }
    } else if (S.lmView) {      // a fixed viewpoint at a landmark, looking over the lake
      const lm = L0[S.lmView], x = lm[0], z = lm[lm.length - 1], tb = L0.torbole;
      camera.position.set(x, Math.max(terrainH(x, z), WATER ? WATER.y : -1e9) + S.h, z);
      camera.setTarget(new V3(tb[0] - 400, WATER ? WATER.y + 60 : 0, tb[tb.length - 1] - 1500));
    } else if (S.road !== undefined) {
      const { p, dir } = roadAt(S.road), l = Math.hypot(dir[0], dir[1]); const dx = dir[0] / l, dz = dir[1] / l;
      if (car) { car.position.set(p[0] + dz * 1.0, p[1] + 0.04, p[2] - dx * 1.0); car.rotation.y = Math.atan2(dx, dz); }
      const cx = p[0] - dx * S.back + dz * 1.0, cz = p[2] - dz * S.back - dx * 1.0;
      camera.position.set(cx, Math.max(terrainH(cx, cz), p[1]) + S.up, cz);
      camera.setTarget(new V3(p[0] + dx * 12 + dz, p[1] + 1.3, p[2] + dz * 12 - dx));
    } else {
      const y = terrainH(S.pos[0], S.pos[2]) + S.h;
      camera.position.set(S.pos[0], y, S.pos[2]);
      if (S.lookSun) { const s = LIGHT.sunDir; camera.setTarget(camera.position.add(new V3(s[0], s[1] + 0.03, s[2]))); }
      else camera.setTarget(new V3(S.look[0], S.look[1] + (S.lookGround ? terrainH(S.look[0], S.look[2]) : 0), S.look[2]));
    }
    lastSel = null; return true;
  };

  // ---------- the car, parked on the road for the chase shot ----------
  if (!QS.has('nocar')) {
    try {
      // the chase cameras never come closer than a few metres: the light model (tools/build_car_lod.sh, ~1/4 of the triangles);
      // &fullcar loads the showroom model for comparison
      let res = QS.has('fullcar') ? null : await fetch(assetUrl('cars/alfa33_lod.glb'));
      if (!res || !res.ok) res = await fetch(assetUrl('cars/alfa33.glb'));
      const bytes = new Uint8Array(await res.arrayBuffer());
      mark('car import start'); const r = await BABYLON.ImportMeshAsync(bytes, scene, { pluginExtension: '.glb' }); mark('car imported');
      car = new BABYLON.TransformNode('carRig', scene); r.meshes[0].parent = car;
      // the hood stays shut here: nothing under it can be seen
      const bay = scene.getTransformNodeByName('EngineBay') || scene.getMeshByName('EngineBay');
      if (bay) { for (const m of bay.getChildMeshes(false)) m.dispose(); r.meshes.splice(0, r.meshes.length, ...r.meshes.filter((m) => !m.isDisposed())); }
      r.meshes.forEach((m) => { m.renderingGroupId = 1; m.isPickable = false; });
      // reflections: a cube that follows the car and sees the sky plus a coarse stand-in of the terrain (~23k triangles,
      // vertex-coloured, same sun, peak shadows and haze); 128 px faces, refreshed every other frame
      mark('proxy terrain start'); const proxyMeshes = [];
      {
        const mk = (name, ext, n, drop, c0 = [0, 0]) => {
          const pos = [], col = [], idx = [], step = ext / n;
          const H = (x, z) => terrainH(x, z);
          for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            const x = c0[0] - ext / 2 + i * step, z = c0[1] - ext / 2 + j * step, y = H(x, z) - drop;
            const sx = (H(x + step, z) - H(x - step, z)) / (2 * step), sz = (H(x, z + step) - H(x, z - step)) / (2 * step), slope = Math.hypot(sx, sz), alt = y * INV_S + Y0;
            let c = [0.13, 0.12, 0.06];                                                     // meadow, late season
            if (alt < 2050 && slope < 0.9) c = [0.04, 0.055, 0.03];                         // forest belt
            if (slope > 0.75 || alt > 2700) c = [0.30, 0.29, 0.27];                         // rock
            pos.push(x, y, z); col.push(c[0], c[1], c[2], 1);
          }
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
          const m = new BABYLON.Mesh(name, scene), vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = idx; vd.colors = col;
          const nr = []; BABYLON.VertexData.ComputeNormals(pos, idx, nr); vd.normals = nr; vd.applyToMesh(m);
          m.material = proxyMat; m.isPickable = false; m.setEnabled(false); m.renderingGroupId = 1; proxyMeshes.push(m); return m;
        };
        mk('reflTerrainMid', 22000, 150, 0, [LVL[MID_I].cx, LVL[MID_I].cz]);
        mk('reflTerrainFar', LVL[FAR_I].extent / 2, 48, 25, [LVL[FAR_I].cx, LVL[FAR_I].cz]);
      }
      if (!QS.has('noprobe')) {
      const probe = new BABYLON.ReflectionProbe('carProbe', Q.probe, scene, true, true);
      probe.renderList.push(sky, ...proxyMeshes); probe.refreshRate = Q.probeRate;
      probe.cubeTexture.onBeforeRenderObservable.add(() => proxyMeshes.forEach((m) => m.setEnabled(true)));
      probe.cubeTexture.onAfterRenderObservable.add(() => proxyMeshes.forEach((m) => m.setEnabled(false)));
      scene.onBeforeRenderObservable.add(() => { if (car) probe.position.copyFrom(car.getAbsolutePosition().add(new V3(0, 1.0, 0))); });
      scene.environmentTexture = probe.cubeTexture; scene.environmentIntensity = 0.55;
      for (const mt of scene.materials) if (mt.getClassName && mt.getClassName() === 'PBRMaterial') { mt.realTimeFiltering = true; mt.realTimeFilteringQuality = BABYLON.Constants.TEXTURE_FILTERING_QUALITY_LOW; }
      }
      // the parked car is scenery here: no refraction pass (it re-renders the whole terrain) and merged parts (~900 draws -> a few dozen)
      // glass keeps real refraction, but what it refracts is cheap: the car itself, the road, the sky and the coarse terrain stand-in
      // (the full terrain in that pass cost ~14 ms); 512 px, every frame
      {
        const th = scene._transmissionHelper;
        if (th && th._opaqueRenderTarget && !QS.has('noglass') && Q.glass) {
          if (th.setOptions) th.setOptions({ renderSize: Q.glass, samples: 1 }); else if (th._options && th._setupRenderTargets) { th._options.renderSize = Q.glass; th._options.samples = 1; th._setupRenderTargets(); }
          const rt = th._opaqueRenderTarget;
          const isGlass = (m) => m.material && m.material.subSurface && m.material.subSurface.isRefractionEnabled;
          // only the far stand-in (sunk 25 m): the 145 m mid grid can pass above the road right at the car and fill the windows
          const glassList = () => [sky, road, proxyMeshes[1], ...scene.meshes.filter((m) => car && m.isDescendantOf(car) && m.getTotalVertices() > 0 && !isGlass(m) && m.layerMask !== 0x20000000)];
          let cached = null;
          const apply = () => { if (!cached) cached = glassList(); rt.renderList = cached; };
          scene.onBeforeRenderObservable.add(apply);
          rt.onBeforeRenderObservable.add(() => { apply(); proxyMeshes.forEach((m) => m.setEnabled(true)); });
          rt.onAfterRenderObservable.add(() => proxyMeshes.forEach((m) => m.setEnabled(false)));
          setTimeout(() => { cached = null; }, 3000);      // after the merge
        } else if (th) { for (const mt of scene.materials) if (mt.subSurface && mt.subSurface.isRefractionEnabled) { mt.subSurface.isRefractionEnabled = false; mt.alpha = 0.5; mt.albedoColor = new C3(0.02, 0.025, 0.03); } th.dispose(); scene._transmissionHelper = null; }
      }
      // merge by material, but keep each wheel separate so it can spin and steer
      mark('merge start'); const groups = new Map();
      for (const m of r.meshes) { if (!m.material || !m.getVerticesDataKinds || !m.getTotalVertices || m.getTotalVertices() === 0 || (m.instances && m.instances.length)) continue;      // instances (shared meshes) stay as they are
        let owner = null; for (let n = m.parent; n; n = n.parent) if (/^Wheel_(FL|FR|RL|RR)$/.test(n.name)) { owner = n; break; }
        const key = (owner ? owner.name : 'body') + '|' + m.material.uniqueId + '|' + m.getVerticesDataKinds().sort().join(','); if (!groups.has(key)) groups.set(key, { owner, list: [] }); groups.get(key).list.push(m); }
      for (const { owner, list } of groups.values()) if (list.length > 1) { try { list.forEach((m) => m.computeWorldMatrix(true)); const mm = BABYLON.Mesh.MergeMeshes(list, true, true); if (mm) { mm.setParent(owner || car); mm.renderingGroupId = 1; mm.isPickable = false; } } catch (e) { console.warn('merge skipped', e); } }
      // stand-in that only the sun mask sees: body box, cabin, four wheels (~200 triangles)
      car.computeWorldMatrix(true);
      const wq = {}; for (const k of ['FL', 'FR', 'RL', 'RR']) { const n = scene.getTransformNodeByName('Wheel_' + k); if (n) { n.computeWorldMatrix(true); wq[k] = V3.TransformCoordinates(n.getAbsolutePosition(), car.getWorldMatrix().clone().invert()); } }
      const bb = car.getHierarchyBoundingVectors(true), inv = car.getWorldMatrix().clone().invert();
      const bmin = V3.TransformCoordinates(bb.min, inv), bmax = V3.TransformCoordinates(bb.max, inv);
      const lo = V3.Minimize(bmin, bmax), hi = V3.Maximize(bmin, bmax), len = hi.z - lo.z, mid = (hi.z + lo.z) / 2, halfW = Math.max(0.7, (hi.x - lo.x) / 2);
      carState.halfW = halfW * 0.95; carState.halfL = len / 2 * 0.95;
      const parts = [BABYLON.MeshBuilder.CreateBox('sp_body', { width: 2 * halfW - 0.05, height: 0.6, depth: len - 0.05 }, scene)];
      parts[0].position.set(0, 0.62, mid);
      const cab = BABYLON.MeshBuilder.CreateCylinder('sp_cab', { height: Math.max(0.3, hi.y - 0.9), diameterTop: 1.5, diameterBottom: 2.2, tessellation: 4 }, scene);
      cab.rotation.y = Math.PI / 4; cab.scaling.set(0.65, 1, 1.1); cab.position.set(0, 0.9 + Math.max(0.3, hi.y - 0.9) / 2, mid - 0.25); parts.push(cab);
      for (const k in wq) { const w = BABYLON.MeshBuilder.CreateCylinder('sp_w', { height: 0.2, diameter: 2 * Math.max(0.25, wq[k].y), tessellation: 10 }, scene); w.rotation.z = Math.PI / 2; w.position.copyFrom(wq[k]); parts.push(w); }
      const proxy = BABYLON.Mesh.MergeMeshes(parts, true, true); proxy.name = 'carShadowProxy';
      const pm = new BABYLON.StandardMaterial('maskWhite', scene); pm.disableLighting = true; pm.emissiveColor = new C3(1, 1, 1); pm.backFaceCulling = false;
      proxy.material = pm; proxy.parent = car; proxy.layerMask = 0x20000000; proxy.isPickable = false;
      carMaskRT.renderList = [proxy]; carState.on = 1; mark('car ready');
    } catch (e) { console.warn('car not loaded', e); }
  }
  // the sun mask camera follows the car; the uniforms go to the terrain and road
  scene.onBeforeRenderObservable.add(() => {
    if (!car || !carState.on) return;
    car.computeWorldMatrix(true);
    const s = LIGHT.sunDir, cp = car.getAbsolutePosition(), sv = new V3(s[0], Math.max(0.08, s[1]), s[2]).normalize();
    const shift = new V3(-sv.x, 0, -sv.z).scale(2.5);
    shadowCam.position = cp.add(shift).add(sv.scale(60)); shadowCam.setTarget(cp.add(shift));
    carState.M = shadowCam.getViewMatrix().multiply(shadowCam.getProjectionMatrix());
    carState.pos = cp; carState.fwd = car.getDirection(V3.Forward());
    bindCar(terrainMat); bindCar(roadMat);
  });

  // ---------- driving: cannon RaycastVehicle (same tuning as the Po map) on a heightfield window that follows the car ----------
  const DRIVE = !QS.has('shot') && car && typeof CANNON !== 'undefined';
  const keys = {}, touchKeys = {}, touchAxis = { steer: 0, pedal: 0 };      // touch sticks: steer -1..1 (right +), pedal -1..1 (gas +)
  const touchDriving = isTouch || navigator.maxTouchPoints > 0 || QS.has('touch');
  let driving = false, chassis = null, vehicle = null, steer = 0, camMode = 0, physWorld = null;
  const wheels = []; let C0Y = 0.6;
  const fwdV = new CANNON.Vec3();
  const HF_N = 160, HF_TS = 2, hf = { body: null, cx: 1e9, cz: 1e9 };
  const HF_LIFT = 3000;     // cannon's heightfield misbehaves when heights cross zero: keep the data positive and shift the body down
  const placeHeightfield = (x, z) => prof('heightfield', () => placeHeightfield0(x, z));
  const placeHeightfield0 = (x, z) => {
    const x0 = Math.round(x / HF_TS) * HF_TS - HF_N * HF_TS / 2, z1 = Math.round(z / HF_TS) * HF_TS + HF_N * HF_TS / 2, data = [];
    for (let i = 0; i <= HF_N; i++) { const col = []; for (let j = 0; j <= HF_N; j++) col.push(collisionH(x0 + i * HF_TS, z1 - j * HF_TS) + HF_LIFT); data.push(col); }
    if (hf.body) physWorld.removeBody(hf.body);
    const b = new CANNON.Body({ mass: 0 }); b.addShape(new CANNON.Heightfield(data, { elementSize: HF_TS }));
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); b.position.set(x0, -HF_LIFT, z1); physWorld.addBody(b);
    hf.body = b; hf.cx = x; hf.cz = z;
    // buildings near the car as static boxes (14 m tall, from below their lowest corner): the car stops at walls
    for (const bb of hf.bld || []) physWorld.removeBody(bb);
    hf.bld = [];
    for (const c of BCOLL) {
      if (Math.abs(c.x - x) > 130 || Math.abs(c.z - z) > 130) continue;
      const bd = new CANNON.Body({ mass: 0 }); bd.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, 7, c.hz)));
      bd.position.set(c.x, c.y + 7, c.z); bd.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), c.yaw); physWorld.addBody(bd); hf.bld.push(bd);
    }
  };
  ROUTE_LANE = (() => { const tree = []; for (const r of ROADS) if (r.class === 'motorway') r.points.forEach((p, i) => tree.push({ p, lane: r.cross[i].lane })); return ROUTE_PTS.map(p => { const q = tree.find(q => Math.abs(q.p[0] - p[0]) < 1.5 && Math.abs(q.p[2] - p[2]) < 1.5); return q ? q.lane : 1.6; }); })();
  const roadIndexNear = (x, z) => { let bi = 0, bd = Infinity; const P = ROUTE_PTS; for (let i = 0; i < P.length; i += 2) { const d = (P[i][0] - x) ** 2 + (P[i][2] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const spawnAt = (i) => {
    const P = ROUTE_PTS; i = Math.max(0, Math.min(P.length - 4, i)); const p = P[i], q = P[Math.min(P.length - 1, i + 3)], dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz) || 1;
    const lo = ROUTE_LANE[i], x = p[0] + dz / l * lo, z = p[2] - dx / l * lo;       // right-hand lane
    placeHeightfield(x, z);
    chassis.position.set(x, collisionH(x, z) + C0Y + 0.1, z);
    chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.atan2(dx, dz));
    chassis.velocity.set(0, 0, 0); chassis.angularVelocity.set(0, 0, 0);
  };
  if (DRIVE) {
    physWorld = new CANNON.World(); physWorld.gravity.set(0, -9.81, 0); physWorld.broadphase = new CANNON.SAPBroadphase(physWorld); physWorld.solver.iterations = 10;
    physWorld.defaultContactMaterial.friction = 0.3;
    car.rotationQuaternion = BABYLON.Quaternion.Identity(); car.position.set(0, 0, 0); car.computeWorldMatrix(true);
    const wpos = {}; for (const k of ['FL', 'FR', 'RL', 'RR']) { const n = scene.getTransformNodeByName('Wheel_' + k); n.computeWorldMatrix(true); wpos[k] = n.getAbsolutePosition().clone(); }
    const K = 40, WR = Math.max(0.2, wpos.FL.y); C0Y = WR + (0.30 - 9.81 / (4 * K)) + 0.06;
    const bb = car.getHierarchyBoundingVectors(true), bodyLen = bb.max.z - bb.min.z, bodyMid = (bb.max.z + bb.min.z) / 2;
    const halfTrack = Math.max(...Object.values(wpos).map((p) => Math.abs(p.x)));
    chassis = new CANNON.Body({ mass: 1000 }); chassis.addShape(new CANNON.Box(new CANNON.Vec3(halfTrack + 0.05, 0.3, bodyLen / 2 - 0.06)), new CANNON.Vec3(0, 0.1, bodyMid));
    chassis.angularDamping = 0.4; physWorld.addBody(chassis);
    vehicle = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const n = scene.getTransformNodeByName('Wheel_' + k); if (!n.rotationQuaternion) n.rotationQuaternion = BABYLON.Quaternion.Identity();
      const wp = wpos[k], r = Math.max(0.2, wp.y); wheels.push({ node: n, front: k[0] === 'F', r, spin: 0 });
      vehicle.addWheel({ radius: r, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: K, suspensionRestLength: 0.30, frictionSlip: 3.2,
        dampingRelaxation: 2.3, dampingCompression: 4.4, maxSuspensionForce: 200000, rollInfluence: 0.05, axleLocal: new CANNON.Vec3(1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(wp.x, -0.06 + (r - WR), wp.z), maxSuspensionTravel: 0.2, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true });
    }
    vehicle.addToWorld(physWorld);
    // Start at the eastern end of the existing SS243, facing toward the pass and Lake Garda.
    let startI = QS.has('road') ? +QS.get('road') : ROUTE_S.findIndex(s => s >= 12);
    if (QS.get('at')) {      // &at=<road id>:<metres along it> (test shots in tunnels, on viaducts)
      const [rid, m] = QS.get('at').split(':'), rp = RBY[rid] && RBY[rid].points[Math.round((+m || 0) / RD.step)];
      if (rp) { let bd = Infinity; ROUTE_PTS.forEach((p, i) => { const d = (p[0] - rp[0]) ** 2 + (p[2] - rp[2]) ** 2; if (d < bd) { bd = d; startI = i; } }); }
    }
    mark('spawn'); spawnAt(startI); mark('spawned');
    driving = true;
    const resetCar = () => spawnAt(roadIndexNear(chassis.position.x, chassis.position.z));
    const cycleCamera = () => { camMode = (camMode + 1) % 3; if (camMode === 2) camera.attachControl(canvas, true); else camera.detachControl(); };
    if (touchDriving) {
      document.body.classList.add('corridor-touch');
      const pad = document.createElement('div'); pad.id = 'driveTouch';
      // two floating sticks (2026-10-19, the user's choice): the left half steers (sideways), the right half is gas (up) and
      // brake / reverse (down). Each stick appears under the thumb; values are analog. Handbrake, camera and reset stay buttons.
      pad.innerHTML = '<div class="touch-actions"><button type="button" data-action="camera" aria-label="Change camera">Camera</button><button type="button" data-action="reset" aria-label="Reset car on road">Reset</button></div>' +
        '<div class="stick-zone" data-stick="steer" aria-label="Steering stick: drag left or right"><div class="stick"><div class="knob"></div></div><span class="stick-label">STEER</span></div>' +
        '<div class="stick-zone" data-stick="pedal" aria-label="Pedal stick: drag up for gas, down to brake and reverse"><div class="stick"><div class="knob"></div></div><span class="stick-label">GAS / BRAKE</span></div>' +
        '<button type="button" class="touch-hand" data-key="Space" aria-label="Handbrake">HANDBRAKE</button>';
      document.body.appendChild(pad);
      const R = 58, DEAD = 0.08;
      const sticks = {};
      for (const zone of pad.querySelectorAll('.stick-zone')) {
        const kind = zone.dataset.stick, base = zone.querySelector('.stick'), knob = zone.querySelector('.knob');
        const S = sticks[kind] = { id: null, x0: 0, y0: 0, zone, base, knob };
        const rest = () => { const r = zone.getBoundingClientRect(); base.style.left = (kind === 'steer' ? r.width * 0.42 : r.width * 0.58) + 'px'; base.style.top = r.height * 0.62 + 'px'; };
        S.reset = () => { S.id = null; touchAxis[kind] = 0; knob.style.transform = 'translate(-50%, -50%)'; zone.classList.remove('active'); rest(); };
        const move = (e) => {
          let dx = (e.clientX - S.x0) / R, dy = (S.y0 - e.clientY) / R;
          if (kind === 'steer') dy = 0; else dx = 0;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          knob.style.transform = `translate(calc(-50% + ${dx * R}px), calc(-50% + ${-dy * R}px))`;
          const v = kind === 'steer' ? dx : dy, a = Math.max(0, (Math.abs(v) - DEAD) / (1 - DEAD));
          touchAxis[kind] = Math.sign(v) * (kind === 'steer' ? Math.pow(a, 1.6) : a);      // finer steering near the centre
        };
        zone.addEventListener('pointerdown', (e) => {
          if (S.id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
          e.preventDefault(); S.id = e.pointerId; const r = zone.getBoundingClientRect();
          S.x0 = e.clientX; S.y0 = e.clientY; base.style.left = (e.clientX - r.left) + 'px'; base.style.top = (e.clientY - r.top) + 'px';
          zone.classList.add('active'); move(e);
          try { zone.setPointerCapture(e.pointerId); } catch (_) { /* synthetic test events have no active pointer */ }
        });
        zone.addEventListener('pointermove', (e) => { if (e.pointerId === S.id) move(e); });
        const end = (e) => { if (e.pointerId === S.id) S.reset(); };
        zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end); zone.addEventListener('lostpointercapture', end);
        zone.addEventListener('contextmenu', (e) => e.preventDefault());
        S.reset();
      }
      const held = new Map();
      const sync = () => {
        for (const button of pad.querySelectorAll('[data-key]')) {
          const on = Array.from(held.values()).includes(button);
          touchKeys[button.dataset.key] = on;
          button.classList.toggle('pressed', on); button.setAttribute('aria-pressed', String(on));
        }
      };
      const release = e => { held.delete(e.pointerId); sync(); };
      for (const button of pad.querySelectorAll('[data-key]')) {
        button.addEventListener('pointerdown', e => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault(); e.stopPropagation(); held.set(e.pointerId, button); sync();
          try { button.setPointerCapture(e.pointerId); } catch (_) { /* synthetic test events have no active pointer */ }
        });
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('contextmenu', e => e.preventDefault());
      }
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      const clear = () => { held.clear(); sync(); for (const S of Object.values(sticks)) S.reset(); };
      window.addEventListener('blur', clear);
      window.addEventListener('pagehide', clear);
      window.addEventListener('resize', clear);
      document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
      pad.querySelector('[data-action="camera"]').addEventListener('click', cycleCamera);
      pad.querySelector('[data-action="reset"]').addEventListener('click', () => { clear(); resetCar(); });
      sync();
    }
    mark('controls ready');
    window.addEventListener('blur', () => { for (const key of Object.keys(keys)) keys[key] = false; });
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (e.code === 'KeyR' && !e.repeat) resetCar();
      if (e.code === 'KeyC' && !e.repeat) cycleCamera();
      if (e.code === 'Enter') driving = !driving;
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    camera.detachControl();
  }
  // sun on the car: the same terrain shadow, marched on the CPU for one point
  let carShade = 1, shadeT = 0;
  const shadeAt = (x, y, z) => {
    const s = LIGHT.sunDir, l = Math.hypot(s[0], s[2]) || 1e-4, tanE = s[1] / l; let t = 3, occ = -1e9;
    for (let i = 0; i < 60 && t < 20000; i++) { const qx = x + s[0] / l * t, qz = z + s[2] / l * t; occ = Math.max(occ, (terrainH(qx, qz) - y) / t); t *= 1.14; }
    return Math.min(1, Math.max(0, (tanE - occ) / 0.024 + 0.5));
  };
  // ---------- test autopilot: pure pursuit on the route, speed from curvature ahead and the road class limit ----------
  const autopilot = (() => {
    if (!QS.has('autodrive')) return null;
    const P = ROUTE_PTS, Sx = [0]; for (let i = 1; i < P.length; i++) Sx.push(Sx[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]));
    const clsAt = (() => { const arr = new Array(P.length).fill('pass'); let k = 0;

      for (let i = 0; i < P.length; i++) { const p = P[i]; let best = 'pass', bd = 9; for (const r of ROADS) { const pts = r.points, step = Math.max(1, Math.floor(pts.length / 400)); for (let j = 0; j < pts.length; j += step) { const d = Math.abs(pts[j][0] - p[0]) + Math.abs(pts[j][2] - p[2]); if (d < bd) { bd = d; best = r.class; } } } arr[i] = best; }
      return arr; })();
    let idx = 0; const st = { on: true, log: [], t: 0, done: false, idx: 0 };
    st.step = (ch, fwd, kmh) => {
      const x = ch.position.x, z = ch.position.z;
      if (st.t++ === 0) { let bd = Infinity; P.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[2] - z) ** 2; if (d < bd) { bd = d; idx = i; } }); }
      for (let k = 0; k < 60 && idx < P.length - 1; k++) { const a = (P[idx][0] - x) ** 2 + (P[idx][2] - z) ** 2, b = (P[idx + 1][0] - x) ** 2 + (P[idx + 1][2] - z) ** 2; if (b <= a) idx++; else break; }
      st.idx = idx;
      const v = kmh / 3.6, look = 7 + v * 0.55; let j = idx; while (j < P.length - 1 && Sx[j] - Sx[idx] < look) j++;
      const lo = ROUTE_LANE ? ROUTE_LANE[j] : 1.6, tq = P[Math.min(P.length - 1, j + 2)], tdx = tq[0] - P[j][0], tdz = tq[2] - P[j][2], tl = Math.hypot(tdx, tdz) || 1;
      const tx = P[j][0] + tdz / tl * lo, tz = P[j][2] - tdx / tl * lo;
      const fx = fwd.x, fz = fwd.z, fl = Math.hypot(fx, fz) || 1, dx = tx - x, dz = tz - z;
      const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);      // >0: target to the left
      // speed: minimum over the next ~120 m of sqrt(a_lat * R), capped by class
      let vt = { motorway: 110, main: 75, pass: 55, track: 30 }[clsAt[idx]] / 3.6;
      for (let k = idx + 6; k < P.length - 6 && Sx[k] - Sx[idx] < 25 + v * v / 5; k += 3) {
        const a = P[k - 6], b = P[k], c = P[k + 6], A_ = Math.hypot(b[0] - c[0], b[2] - c[2]), B_ = Math.hypot(a[0] - c[0], a[2] - c[2]), C_ = Math.hypot(a[0] - b[0], a[2] - b[2]);
        const ar = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2, R = ar > 1e-6 ? A_ * B_ * C_ / (4 * ar) : 1e9;
        const vk = Math.sqrt(3.2 * R), dist = Sx[k] - Sx[idx]; vt = Math.min(vt, Math.sqrt(vk * vk + 2 * 3.0 * dist));
      }
      st.vt = vt;
      const err = vt - v;
      return { steer: -ang * 2.2, thr: err > 0 ? Math.min(1, err * 0.6) : 0, brk: err < -1 ? Math.min(1, -err * 0.25) : 0 };
    };
    return st;
  })();
  const driveStep = (dt) => {
    chassis.quaternion.vmult(new CANNON.Vec3(0, 0, 1), fwdV);
    const vF = chassis.velocity.dot(fwdV), kmh = Math.abs(vF) * 3.6, on = driving;
    const kUp = on && (keys.ArrowUp || keys.KeyW || touchKeys.KeyW), kDown = on && (keys.ArrowDown || keys.KeyS || touchKeys.KeyS), kL = on && (keys.ArrowLeft || keys.KeyA || touchKeys.KeyA), kR = on && (keys.ArrowRight || keys.KeyD || touchKeys.KeyD), hand = !on || keys.Space || touchKeys.Space;
    const AP = autopilot && autopilot.on ? autopilot.step(chassis, fwdV, kmh) : null;     // test hook: follows the route, ?autodrive
    const keySteer = (kR ? 1 : 0) - (kL ? 1 : 0), stickSteer = on ? touchAxis.steer : 0;
    const maxSteer = 0.42 + (0.09 - 0.42) * Math.min(1, kmh / 130), target = AP ? Math.max(-1, Math.min(1, AP.steer)) * maxSteer : (keySteer || stickSteer) * maxSteer;
    steer += (target - steer) * Math.min(1, dt * (target === 0 ? 4.0 : 2.4));
    let eng = 0, brake = 0;
    const pedal = on ? touchAxis.pedal : 0;      // touch pedal stick: up gas, down brake then reverse (analog)
    const thr = AP ? AP.thr : kUp && !kDown ? 1 : Math.max(0, pedal), brk = AP ? AP.brk : kDown ? 1 : Math.max(0, -pedal);
    if (thr > 0) eng = -2500 * thr * Math.max(0, 1 - Math.pow(kmh / 205, 1.6)) * (vF < -0.5 ? 1.4 : 1);
    if (brk > 0) { if (vF > 0.8) brake = 60 * brk; else eng = 1100 * brk * Math.max(0, 1 - kmh / 35); }
    if (!thr && !brk) brake = on ? 4 : 0;
    if (!on) { eng = 0; brake = 100; }
    for (let w = 0; w < 4; w++) { vehicle.applyEngineForce(w < 2 ? eng : 0, w); vehicle.setBrake(hand && w >= 2 ? (on ? 120 : 100) : brake, w); }
    vehicle.setSteeringValue(steer, 0); vehicle.setSteeringValue(steer, 1);
    const sp = chassis.velocity.norm(); chassis.applyForce(chassis.velocity.scale(-0.45 * sp), chassis.position);
    if (Math.hypot(chassis.position.x - hf.cx, chassis.position.z - hf.cz) > HF_N * HF_TS * 0.25) placeHeightfield(chassis.position.x, chassis.position.z);
    prof('physics', () => physWorld.step(1 / 60, dt, 3));
    // fell off the world, or into the lake (only over the lake's mask and near its height: the Adige valley lies far below the water's world height)
    if (chassis.position.y < collisionH(chassis.position.x, chassis.position.z) - 5 || (WATER && chassis.position.y < WATER.y + 0.3 && chassis.position.y > WATER.y - 40 && inLakeBox(chassis.position.x, chassis.position.z) && lakeMaskAt(chassis.position.x, chassis.position.z) && terrainH(chassis.position.x, chassis.position.z) < WATER.y - 0.5)) spawnAt(roadIndexNear(chassis.position.x, chassis.position.z));
    const q = new BABYLON.Quaternion(chassis.quaternion.x, chassis.quaternion.y, chassis.quaternion.z, chassis.quaternion.w);
    car.rotationQuaternion.copyFrom(q);
    car.position.copyFrom(new V3(chassis.position.x, chassis.position.y, chassis.position.z).subtract(new V3(0, C0Y, 0).applyRotationQuaternion(q)));
    car.computeWorldMatrix(true);
    wheels.forEach((w, i) => {
      w.spin += vF * dt / w.r; vehicle.updateWheelTransform(i);
      const wp = vehicle.wheelInfos[i].worldTransform.position, par = w.node.parent; par.computeWorldMatrix(true);
      w.node.position.y = V3.TransformCoordinates(new V3(wp.x, wp.y, wp.z), par.getWorldMatrix().clone().invert()).y;
      BABYLON.Quaternion.RotationYawPitchRollToRef(w.front ? -steer : 0, w.spin, 0, w.node.rotationQuaternion);
    });
    const cp = new V3(chassis.position.x, chassis.position.y, chassis.position.z), fw = new V3(fwdV.x, 0, fwdV.z).normalize();
    if (camMode < 2) {
      const dist = camMode === 0 ? 6.4 : 12, hgt = camMode === 0 ? 2.1 : 3.8;
      const want = cp.add(fw.scale(-dist)).add(new V3(0, hgt, 0)); want.y = Math.max(want.y, collisionH(want.x, want.z) + 0.8); { const st = structAt(cp.x, cp.z); if (st && st[4] === 1) want.y = Math.min(want.y, st[1] + 4.6); }     // inside a tunnel the camera stays under the vault
      const k = V3.Distance(camera.position, want) > 25 ? 1 : 1 - Math.exp(-dt * 6); camera.position = V3.Lerp(camera.position, want, k);
      camera.setTarget(cp.add(fw.scale(3)).add(new V3(0, 0.6, 0))); camera.fov = 0.9 + Math.min(0.2, kmh / 650);
    }
    shadeT += dt; if (shadeT > 0.15) { shadeT = 0; const st = structAt(cp.x, cp.z); carShade = st && st[4] === 1 ? 0.04 : shadeAt(cp.x, cp.y + 0.8, cp.z); }     // under a tunnel vault: no sun on the car
    if (modeChip) modeChip.textContent = Math.round(kmh) + (touchDriving ? ' km/h' : ' km/h · WASD drive · Space handbrake · C camera · R reset · G look panel');
  };
  // ---------- debug panel: sun, fog, exposure, saturation, LUT; G toggles ----------
  const panel = document.createElement('div');
  panel.id = 'lookPanel';
  panel.style.cssText = 'position:fixed;right:16px;top:64px;z-index:20;background:rgba(18,20,24,.82);color:#eee;font:12px/1.3 system-ui,sans-serif;padding:10px 12px;border-radius:8px;width:250px;max-height:calc(100vh - 80px);overflow:auto';
  const SL = [['sunAz', 'Sun azimuth', 0, 360, 1], ['sunEl', 'Sun elevation', -4, 60, 0.1], ['fill', 'Shadow fill (sky + bounce)', 0.5, 3, 0.05], ['penumbra', 'Shadow softness', 0.005, 0.1, 0.001], ['haze', 'Haze', 0, 6, 0.05], ['fog', 'Low cloud density', 0, 20, 0.1], ['fogBase', 'Low cloud base (m)', 1200, 2600, 10], ['fogFalloff', 'Low cloud depth (m)', 40, 800, 5], ['cloud', 'Cloud cover', 0, 1, 0.01], ['season', 'Meadow: green → gold', 0, 1, 0.01], ['exposure', 'Exposure', 0.2, 3, 0.01], ['contrast', 'Contrast', 0.6, 1.6, 0.01], ['saturation', 'Saturation', 0, 2, 0.01], ['lut', 'LUT strength', 0, 1, 0.01], ['vignette', 'Vignette', 0, 5, 0.05], ['bloom', 'Bloom', 0, 1, 0.01]];
  const build = () => {
    panel.innerHTML = `<div style="opacity:.75;margin-bottom:4px">Quality: <b>${tierName}</b> (benchmark ${benchMs.toFixed(1)} ms) · <a style="color:#9cf" href="?spawn=dolomites&quality=low">low</a> <a style="color:#9cf" href="?spawn=dolomites&quality=medium">medium</a> <a style="color:#9cf" href="?spawn=dolomites&quality=high">high</a> <a style="color:#9cf" href="?spawn=dolomites&quality=ultra">ultra</a></div>` + '<div id="fpsLine" style="margin:2px 0 8px;font-variant-numeric:tabular-nums">– fps</div>' + '<b>Look</b> <span style="opacity:.6">(G or the Look button hides)</span><div style="margin:6px 0"><button data-p="summer">Summer afternoon</button> <button data-p="golden">Golden hour</button> <button data-p="overcast">Overcast</button></div>' +
      SL.map(([k, l, a, b, st]) => `<label style="display:block;margin:5px 0">${l} <span id="v_${k}" style="float:right">${P[k]}</span><input type="range" min="${a}" max="${b}" step="${st}" value="${P[k]}" data-k="${k}" style="width:100%"></label>`).join('') +
      `<label style="display:block;margin:5px 0">Low cloud colour <input type="color" id="fogColor" value="#${P.fogCol.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('')}"></label>` +
      '<div style="margin-top:6px">Shots: ' + Object.keys(SHOTS).map((s) => `<button data-s="${s}" style="margin:2px">${s}</button>`).join('') + '</div>' +
      '<button id="copyLook" style="margin-top:6px">Copy settings</button>';
  };
  build(); document.body.appendChild(panel);
  if (QS.has('shot') || QS.has('nopanel') || touchDriving) panel.style.display = 'none';
  let atmT = 0;
  const atmosphereSoon = () => { clearTimeout(atmT); atmT = setTimeout(() => { updateAtmosphere(); applyLook(); }, 60); };
  panel.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k) { P[k] = parseFloat(e.target.value); $('v_' + k).textContent = P[k]; if (/sun|haze|cloud|penumbra/.test(k)) atmosphereSoon(); else applyLook(); }
    if (e.target.id === 'fogColor') { const h = e.target.value; P.fogCol = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); }
  });
  panel.addEventListener('click', (e) => {
    const p = e.target.dataset.p, s = e.target.dataset.s;
    if (p) { Object.assign(P, PRESETS[p]); build(); updateAtmosphere(); applyLook(); }
    if (s) setShot(s);
    if (e.target.id === 'copyLook') navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(P));
  });
  // the panel opens right under the toolbar, toggled by its own Look button (and by G), so it never covers the buttons
  const tools = document.querySelector('.tools');
  const lookBtn = document.createElement('button'); lookBtn.type = 'button'; lookBtn.id = 'lookBtn'; lookBtn.textContent = 'Look';
  if (tools) tools.appendChild(lookBtn);
  const placePanel = () => { if (tools) { const r = tools.getBoundingClientRect(); panel.style.top = Math.round(r.bottom + 8) + 'px'; panel.style.right = Math.max(16, Math.round(innerWidth - r.right)) + 'px'; } };
  const setPanel = (on) => { panel.style.display = on ? '' : 'none'; lookBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) placePanel(); };
  setPanel(panel.style.display !== 'none');
  lookBtn.addEventListener('click', () => setPanel(panel.style.display === 'none'));
  window.addEventListener('resize', placePanel);
  window.addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') setPanel(panel.style.display === 'none'); });
  // frame rate line: fps and frame time over the last half second
  { let n = 0, t0 = performance.now(); scene.onAfterRenderObservable.add(() => { n++; const t = performance.now(); if (t - t0 < 500) return;
      const el = document.getElementById('fpsLine'); if (el) { const fps = n * 1000 / (t - t0); el.innerHTML = `<b>${fps.toFixed(0)} fps</b> · ${(1000 / fps).toFixed(1)} ms/frame · render scale ${(1 / engine.getHardwareScalingLevel()).toFixed(2)}`; }
      n = 0; t0 = t; }); }

  updateAtmosphere(); applyLook();
  if (!DRIVE && !setShot(QS.get('shot') || 'pass_overlook')) setShot('pass_overlook');
  const modeChip = $('modeChip');
  if (DRIVE) scene.onBeforeRenderObservable.add(() => { if (window.__pauseDrive) return; driveStep(Math.min(0.05, engine.getDeltaTime() / 1000)); sunLight.intensity = Math.max(...LIGHT.sun) / Math.PI * carShade; });
  // ---------- ?canary: shader safety test. Never renders a frame to the screen. ----------
  // 1) compiles every material on its own (shader compiler only, nothing queued on the GPU), timing each;
  // 2) draws each material alone into tiny offscreen targets (8, 32, 128 px), timed with gl.finish(), stepping up only
  //    while under budget, and extrapolates to the full window; 3) the same for one tile of the terrain shadow pass.
  // Results: a table on the page and window.__canary.
  if (QS.has('canary')) { await runCanary(); return; }
  async function runCanary() {
    const gl = engine._gl, out = window.__canary = { renderer: engine.getGlInfo().renderer, compile: [], draw: [], done: false };
    const W = engine.getRenderWidth() * engine.getRenderHeight(), SIZES = [8, 32, 128, 256], STEP_BUDGET = +(QS.get('canarybudget') || 40), FULL_BUDGET = 150;     // raise the budget only on software rendering, for comparisons
    const box = document.createElement('pre'); box.style.cssText = 'position:fixed;inset:12px;overflow:auto;background:#111;color:#ddd;font:12px/1.4 monospace;padding:12px;z-index:99;margin:0;user-select:text;-webkit-user-select:text;pointer-events:auto';
    const copyBtn = document.createElement('button'); copyBtn.textContent = 'Copy results'; copyBtn.style.cssText = 'position:fixed;top:20px;right:24px;z-index:100;font:13px sans-serif;padding:6px 12px';
    copyBtn.onclick = () => { const t = box.textContent + '\n' + JSON.stringify(out); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { copyBtn.textContent = 'Copied'; }, () => { copyBtn.textContent = 'Copy failed: use Cmd+A in the box'; }); };
    document.body.appendChild(box); document.body.appendChild(copyBtn); statusEl.hidden = true;
    const show = (t) => { box.textContent += t + '\n'; };
    show('canary: renderer ' + out.renderer + '\nwindow ' + engine.getRenderWidth() + 'x' + engine.getRenderHeight() + '\n');
    scene.onBeforeRenderObservable.notifyObservers(scene);      // per-frame setup on the CPU only (terrain nodes, cells, uniforms); no draw
    const cam = scene.activeCamera;
    const mats = scene.materials.filter((m) => scene.meshes.some((x) => x.material === m && x.getTotalVertices() > 0));
    const meshesOf = (m) => scene.meshes.filter((x) => x.material === m && x.getTotalVertices() > 0 && x.isEnabled());
    show('1) compile, one material at a time');
    for (const m of mats) {
      const mesh = scene.meshes.find((x) => x.material === m && x.getTotalVertices() > 0), t0 = performance.now(); let ok = true, err = '';
      try { await m.forceCompilationAsync(mesh); } catch (e) { ok = false; err = String(e).slice(0, 120); }
      const ms = Math.round(performance.now() - t0); out.compile.push({ m: m.name, ms, ok, err }); show(`   ${m.name.padEnd(22)} ${String(ms).padStart(6)} ms ${ok ? 'ok' : 'FAILED ' + err}`);
    }
    show('\n2) draw each material alone, offscreen; ms with gl.finish, extrapolated to the full window');
    // count real GL draw calls, so a test that silently draws nothing (material not ready for the target) is visible
    let draws = 0;
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const o = gl[f].bind(gl); gl[f] = (...a) => { draws++; return o(...a); }; }
    window.__canaryDraws = () => draws;
    // GPU completion time with a fence (gl.finish() in Chrome returns before the GPU is done); polls without blocking the page
    const timeGPU = async (fn) => {
      const f0 = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      while (gl.getSyncParameter(f0, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise((r) => setTimeout(r, 0));
      gl.deleteSync(f0);
      const d0 = draws, t0 = performance.now(); fn();
      const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      while (gl.getSyncParameter(f, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise((r) => setTimeout(r, 0));
      gl.deleteSync(f); return { ms: performance.now() - t0, nd: draws - d0 };
    };
    const drawOnce = async (meshes, n) => {
      const rt = new BABYLON.RenderTargetTexture('canary', n, scene, false); rt.activeCamera = cam; rt.renderList = meshes; rt.renderParticles = false; rt.renderSprites = false;
      // make the target ready first (any shader variant it needs is compiled here, not timed as a draw)
      for (let k = 0; k < 100 && !rt.isReadyForRendering(); k++) await new Promise((r) => setTimeout(r, 20));
      for (let k = 0; k < 100 && !meshes.every((x) => !x.material || x.material.isReady(x, x.hasThinInstances)); k++) await new Promise((r) => setTimeout(r, 20));
      const r = await timeGPU(() => rt.render()); rt.dispose(); return r;
    };
    for (const m of mats) {
      const ms_ = meshesOf(m); if (!ms_.length) continue;
      let line = `   ${m.name.padEnd(22)} ${String(ms_.length).padStart(5)} meshes`, flag = '';
      for (const n of SIZES) {
        const { ms, nd } = await drawOnce(ms_, n), full = ms * W / (n * n);
        out.draw.push({ m: m.name, n, ms: +ms.toFixed(2), draws: nd, fullEst: Math.round(full) }); line += `  ${n}px ${ms.toFixed(1)} ms/${nd}d`;
        if (!nd) { flag = '  NO DRAWS (not tested)'; break; }
        if (ms > STEP_BUDGET) { flag = '  STOPPED: over the step budget'; break; }
        if (n === SIZES[SIZES.length - 1] && full > FULL_BUDGET) flag = `  FLAG: ~${Math.round(full)} ms at full window`;
        await new Promise((r) => setTimeout(r, 30));
      }
      show(line + flag);
    }
    show('\n3) terrain shadow pass: one tile per level');
    for (const k of LV) {
      const pt = shadowTex[k]; let line = `   shadow ${k.padEnd(15)}`;
      for (const n of SIZES) {
        pt.setFloat('cheap', 0); pt.tile_ = [0, 0, n, n]; pt.isEnabled = true;
        for (let q = 0; q < 50 && !pt.isReady(); q++) await new Promise((r) => setTimeout(r, 20));
        const { ms, nd } = await timeGPU(() => pt.render());
        out.draw.push({ m: 'shadow_' + k, n, ms: +ms.toFixed(2), draws: nd }); line += `  ${n}px ${ms.toFixed(1)} ms/${nd}d`;
        if (!nd) { line += '  NO DRAWS (not tested)'; break; }
        if (ms > STEP_BUDGET) { line += '  STOPPED'; break; }
        await new Promise((r) => setTimeout(r, 30));
      }
      show(line);
    }
    show('\n4) other offscreen passes of the first frames (at their real size)');
    for (const rt of scene.customRenderTargets.concat(scene.reflectionProbes ? scene.reflectionProbes.map((p) => p.cubeTexture) : [])) {
      if (!rt || !rt.render) continue;
      for (let q = 0; q < 50 && rt.isReady && !rt.isReady(); q++) await new Promise((r) => setTimeout(r, 20));
      const { ms, nd } = await timeGPU(() => rt.render());
      out.draw.push({ m: 'rt_' + rt.name, n: rt.getSize ? rt.getSize().width : 0, ms: +ms.toFixed(2), draws: nd });
      show(`   ${('rt ' + rt.name).padEnd(22)} ${(rt.getSize ? rt.getSize().width : '?') + 'px'} ${ms.toFixed(1)} ms/${nd}d`);
      await new Promise((r) => setTimeout(r, 30));
    }
    show('\n5) the complete frame (post-processing, SSAO, every pass) on a tiny canvas, stepping up only while under budget');
    out.frame = [];
    const canvas = engine.getRenderingCanvas(), css = [canvas.style.width, canvas.style.height];
    for (const [w, h] of [[64, 40], [160, 100], [320, 200]]) {
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; engine.setSize(w, h);
      for (let q = 0; q < 200 && !scene.isReady(); q++) await new Promise((r) => setTimeout(r, 20));
      let worst = 0, nd = 0;
      for (let k = 0; k < 3; k++) { const r = await timeGPU(() => scene.render()); worst = Math.max(worst, r.ms); nd = r.nd; await new Promise((res) => setTimeout(res, 30)); }
      out.frame.push({ w, h, worstMs: +worst.toFixed(1), draws: nd }); show(`   ${w}x${h}  worst of 3 frames ${worst.toFixed(1)} ms, ${nd} draws`);
      if (worst > STEP_BUDGET * 2) { show('   STOPPED: over budget'); break; }
    }
    canvas.style.width = css[0]; canvas.style.height = css[1];
    out.done = true; show('\ndone. Only tiny frames were drawn (step 5).');
    window.__watchdog = 'stopped';      // ends the test runner's wait (it waits for frames, an error, or a stopped render loop)
  }
  const ready = () => scene.isReady() && lut.isReady();
  mark('waiting for ready');
  await new Promise((res) => { const chk = () => (ready() ? res() : setTimeout(chk, 100)); chk(); });
  mark('ready');
  // ---------- shader warm-up ----------
  for (const m of scene.materials) if (m.getClassName && m.getClassName() === 'ShaderMaterial' && m.options.uniforms.includes('fogP') && !m.options.uniforms.includes('cloudT')) m.options.uniforms.push('cloudT');
  // a material whose shader fails to compile ends the load at once with window.__err (else the warm-up and the test runner waited
  // out their time limits on a material that never becomes ready)
  // Babylon rewrites varying and attribute lines statement by statement, splitting at ';' even inside a trailing // comment: the rest
  // of the comment became code (2026-10-17). Such a line stops the load here with a clear error.
  for (const [k, src] of Object.entries(BABYLON.Effect.ShadersStore)) if (typeof src === 'string' && /(Vertex|Fragment)Shader$/.test(k) && !/^(default|pbr|standard)/.test(k)) {
    const bad = src.split('\n').find((l) => /\b(varying|attribute|uniform)\b/.test(l) && /\/\/.*;/.test(l));
    if (bad) { window.__err = (window.__err ? window.__err + ' | ' : '') + 'semicolon in a GLSL comment on a varying/attribute line: ' + k; console.error('GLSL comment with ;', k, bad); } }
  for (const m of scene.materials) if (m.getClassName && m.getClassName() === 'ShaderMaterial') { const prev = m.onError; m.onError = (eff, errs) => { window.__err = (window.__err ? window.__err + ' | ' : '') + m.name + ': ' + String(errs).slice(0, 300); console.error('shader error', m.name, errs); if (prev) prev(eff, errs); }; }
  // Chrome's Metal backend builds each shader's GPU pipeline lazily, on its first draw into each kind of target (70-500 ms
  // per material on the 5500M). A first frame that pays all of them at once ran ~15 s, past Chrome's GPU watchdog, which
  // kills the GPU process (screen glitch; after a few, WebGL is disabled). So the pipelines are built here, one small piece
  // per step, each waited on with a fence: every material once into a tiny target, then the complete frame on a tiny canvas.
  // release CPU copies of static geometry (task A, 2026-10-19): Babylon keeps every vertex, index and thin-instance array after
  // upload (~400 MB here). Nothing reads them back except picking (pickable meshes keep theirs), updatable buffers and the
  // per-mesh GPU diagnostic (done by now). Meshes built later (grass tiles, spray) are untouched. &keepgeo: keep everything. It runs before the shader warm-up
  // (which only draws): kept until after it, these copies made the loading peak (1.27 GB) that crashed phone tabs.
  function releaseGeometry() {      // a hoisted declaration: also called while the scene is built (after buildings, after scatter)
    if (QS.has('keepgeo')) return;
    let freed = window.__geoFreedMB ? window.__geoFreedMB * 1e6 : 0;
    for (const g of scene.geometries) {
      if (!g.meshes.length || g.meshes.some((m) => m.isPickable)) continue;
      // sub-mesh bounding boxes are filled only by refreshBoundingInfo (the transparent sort reads them): fill them while the
      // positions still exist. Indices are kept (47 MB): with them gone Babylon rebuilds sub-meshes and loses their boxes
      for (const m of g.meshes) { m.getBoundingInfo(); if (m.subMeshes) for (const sm of m.subMeshes) sm.refreshBoundingInfo(); }
      for (const k in g._vertexBuffers) { const b = g._vertexBuffers[k]._buffer; if (b && !b.isUpdatable() && b._data) { freed += b._data.byteLength || b._data.length * 4; b._data = null; } }
    }
    for (const m of scene.meshes) {
      const s = m._thinInstanceDataStorage;
      if (s && s.matrixData && !m.isPickable && s.matrixBuffer && !s.matrixBuffer.isUpdatable()) { freed += s.matrixData.byteLength; s.matrixData = null; s.matrixBuffer._data = null; }
    }
    window.__geoFreedMB = Math.round(freed / 1e6);
  }
  mark('before release'); releaseGeometry(); mark('released');
  if (!QS.has('nowarmup')) {
    const gl = engine._gl, t0w = performance.now();
    const fenceWait = async () => { const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      while (gl.getSyncParameter(f, gl.SYNC_STATUS) !== gl.SIGNALED) await new Promise((r) => setTimeout(r, 4)); gl.deleteSync(f); };
    const step = (t) => { statusEl.hidden = false; statusEl.textContent = 'Preparing shaders… ' + t; };
    mark('per-frame setup'); scene.onBeforeRenderObservable.notifyObservers(scene); mark('per-frame setup done');      // CPU-side per-frame setup, so the warm-up draws what the first frame will
    const cam = scene.activeCamera;
    const mats = scene.materials.filter((m) => scene.meshes.some((x) => x.material === m && x.getTotalVertices() > 0));
    for (let i = 0; i < mats.length; i++) {
      // disabled meshes too (tunnels switch on near their portals): their first draw mid-drive cost 142 ms
      const m = mats[i], meshes = scene.meshes.filter((x) => x.material === m && x.getTotalVertices() > 0);
      if (!meshes.length) continue;
      const off = meshes.filter((x) => !x.isEnabled()); off.forEach((x) => x.setEnabled(true));
      step(`${i + 1}/${mats.length}`);
      const rt = new BABYLON.RenderTargetTexture('warmup', 8, scene, false); rt.activeCamera = cam; rt.renderList = meshes; rt.renderParticles = false; rt.renderSprites = false;
      for (let k = 0; k < 200 && !rt.isReadyForRendering(); k++) await new Promise((r) => setTimeout(r, 10));
      rt.render(); await fenceWait(); rt.dispose(); off.forEach((x) => x.setEnabled(false));
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    // the complete frame (post-processing, SSAO, probes, every pass) on a tiny canvas. Materials whose meshes are all out of view
    // (tunnels) would build their main-pass pipeline mid-drive (152 ms): the smallest mesh of each is drawn regardless of the frustum
    const forced = [];
    for (const m of mats) { const ms = scene.meshes.filter((x) => x.material === m && x.getTotalVertices() > 0 && x.isEnabled()).sort((a, b) => a.getTotalVertices() - b.getTotalVertices()); if (ms.length && !ms[0].alwaysSelectAsActiveMesh) { ms[0].alwaysSelectAsActiveMesh = true; forced.push(ms[0]); } }
    const canvas = engine.getRenderingCanvas(), css = [canvas.style.width, canvas.style.height];
    for (const [w, h, label] of [[64, 40, 'frame 1/3'], [64, 40, 'frame 2/3'], [160, 100, 'frame 3/3']]) {
      step(label); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; engine.setSize(w, h);
      for (let q = 0; q < 300 && !scene.isReady(); q++) await new Promise((r) => setTimeout(r, 10));
      scene.render(); await fenceWait();
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    canvas.style.width = css[0]; canvas.style.height = css[1]; engine.resize();
    for (const x of forced) x.alwaysSelectAsActiveMesh = false;
    console.log('shader warm-up', Math.round(performance.now() - t0w), 'ms');
    window.__warmupMs = Math.round(performance.now() - t0w);
  }
  if (QS.has('diag')) { window.__diagHook = { scene, engine, setShot, SHOTS, tier: tierName, readyMs: Math.round(performance.now()) }; await runDiag(); return; }      // the hook lets tools/perf_bench.js time views after the diag
  // ---------- ?diag: one-shot GPU hang diagnosis ----------
  // Every frame is split into small GPU jobs: a barrier (a 1 px clear + readback on a private framebuffer, which waits for all
  // earlier GPU work) at every render-target / procedural-texture / post-process boundary and at every material change in the
  // main pass. Before each job, a line naming it is sent synchronously to the local server (tools/serve.py /diag-log), which
  // fsyncs it to diag/<session>.jsonl: if the GPU hangs, the last line on disk names the job. The canvas grows from 320x200 to
  // the full window, 3 frames per size; before each step up, every job's cost is extrapolated by pixel count and the ramp stops
  // if any would exceed a safe budget. If the full window passes, 60 frames run without the inner barriers (as in normal play).
  // any exception ends the diag at once with an 'error' line and window.__err, so the runner stops instead of idling to its
  // time limit (2026-10-15: InstancedMesh has no onBeforeDrawObservable; the diag threw after 'env' and the page sat idle)
  // (no outer let here: runDiag is called above its own position in this function, before such a line would have run)
  async function runDiag() {
    const H = { post: null };
    try { await runDiagBody(H); } catch (e) {
      const msg = String((e && e.stack) || e).slice(0, 800);
      try { if (H.post) H.post({ ev: 'error', msg }); } catch (_) { /* the log is best effort; the flags below must still be set */ }
      console.error('diag error: ' + msg);
      window.__err = 'diag: ' + msg.split('\n')[0]; window.__diagDone = true; window.__watchdog = 'stopped';
    }
  }
  async function runDiagBody(H) {
    const gl = engine._gl, S = 'diag-' + new Date().toISOString().replace(/[:.]/g, '-'), url = '/diag-log?s=' + S;
    const box = document.createElement('pre'); box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;max-height:45%;overflow:auto;background:rgba(10,10,10,.92);color:#ddd;font:12px/1.35 monospace;padding:10px;z-index:99;margin:0;user-select:text;-webkit-user-select:text';
    document.body.appendChild(box); statusEl.hidden = true;
    const show = (t) => { box.textContent += t + '\n'; box.scrollTop = box.scrollHeight; };
    const SOFTR = /swiftshader/i.test((engine.getGlInfo && engine.getGlInfo().renderer) || '');
    const MEM = window.__diagLog = [];
    let post = (o) => { try { const x = new XMLHttpRequest(); x.open('POST', url, false); x.send(JSON.stringify(o)); return x.status; } catch (e) { return 0; } };
    if (post({ t: 0, ev: 'hello' }) !== 204) {
      if (!SOFTR) { show('DIAG: the log endpoint is missing. Restart tools/serve.py (it was updated), then reload. Nothing was rendered.'); return; }
      post = (o) => { MEM.push(o); return 204; };      // software-rendering tests only: log to memory
    }
    H.post = (o) => post({ t: Math.round(performance.now()), ...o });
    show('DIAG session ' + S + '  (log file: po-garda-drive/diag/' + S + '.jsonl)');
    const T0 = performance.now(), now = () => +(performance.now() - T0).toFixed(1);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    post({ t: now(), ev: 'env', renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), tier: tierName, Q, dpr: devicePixelRatio,
      window: [innerWidth, innerHeight], hwScale: engine.getHardwareScalingLevel(), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), meshes: scene.meshes.length, materials: scene.materials.length,
      textures: scene.textures.length, postProcesses: (scene.postProcesses || []).length, ua: navigator.userAgent, url: location.search, warmupMs: window.__warmupMs });
    // the barrier: clear a private 1x1 target and read it back; Chrome executes everything queued before it first
    const fbo = gl.createFramebuffer(), tex = gl.createTexture(), px = new Uint8Array(4);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    engine.resetTextureCache && engine.resetTextureCache();
    const barrier = () => {
      const dr = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), rd = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), sc = gl.isEnabled(gl.SCISSOR_TEST), cm = gl.getParameter(gl.COLOR_WRITEMASK), cc = gl.getParameter(gl.COLOR_CLEAR_VALUE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); if (sc) gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.clearColor(cc[0], cc[1], cc[2], cc[3]); gl.colorMask(cm[0], cm[1], cm[2], cm[3]); if (sc) gl.enable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dr); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rd);
    };
    // segment bookkeeping: the GPU time of the job that just ended is measured at the barrier that ends it
    const D = { on: false, split: true, frame: 0, cur: 'cpu', t0: 0, acc: {}, cpu: {}, stack: [], inB: false };
    const cut = (label) => {
      if (!D.on || D.inB || label === D.cur) return;
      D.inB = true;
      const tc = performance.now();
      if (D.split) barrier();
      const t = performance.now(); D.acc[D.cur] = (D.acc[D.cur] || 0) + (t - D.t0);
      D.cpu[D.cur] = (D.cpu[D.cur] || 0) + (tc - D.t0);      // CPU part of the job (the rest is waiting on the GPU at the barrier)
      D.cur = label; post({ t: now(), f: D.frame, begin: label }); D.t0 = performance.now(); D.inB = false;
    };
    const top = () => D.stack.length ? D.stack[D.stack.length - 1] : 'main';
    const enter = (p) => { D.stack.push(p); cut(p); }, leave = () => { D.stack.pop(); cut(top()); };
    for (const t of scene.textures) {
      if (t.onBeforeGenerationObservable && t.onGeneratedObservable) { t.onBeforeGenerationObservable.add(() => enter('pt:' + t.name)); t.onGeneratedObservable.add(leave); }
      else if (t.onBeforeRenderObservable && t.onAfterRenderObservable && t.renderList !== undefined) { t.onBeforeRenderObservable.add(() => enter('rtt:' + t.name)); t.onAfterRenderObservable.add(leave); }
    }
    // post-processes (bloom, tone mapping, grading...): every one starts with activate(), whichever list it lives in
    { const act = BABYLON.PostProcess.prototype.activate;
      BABYLON.PostProcess.prototype.activate = function (...a) { if (D.on) { D.stack = []; cut('pp:' + this.name); } return act.apply(this, a); }; }
    const PER_MESH = (QS.get('diagmesh') || 'propMat').split(',');
    const meshFacts = [];
    for (const m of scene.meshes) {
      const mat = m.material ? m.material.name : 'nomat', per = PER_MESH.includes(mat);
      const label = per ? mat + '#' + m.uniqueId + ':' + m.name : mat;
      if (per) {
        const idx = m.getIndices(), col = m.getVerticesData('color');
        let aMax = 0, aMin = 9; if (col) for (let i = 3; i < col.length; i += 4) { if (col[i] > aMax) aMax = col[i]; if (col[i] < aMin) aMin = col[i]; }
        const bb = m.getBoundingInfo().boundingBox;
        meshFacts.push({ id: m.uniqueId, name: m.name, verts: m.getTotalVertices(), indices: idx ? idx.length : 0, idx32: !!(idx && (idx instanceof Uint32Array || m.getTotalVertices() > 65535)),
          alpha: col ? [+aMin.toFixed(3), +aMax.toFixed(3)] : null, enabled: m.isEnabled(), frozen: m.isWorldMatrixFrozen, parent: m.parent ? m.parent.name : null,
          size: [Math.round(bb.extendSizeWorld.x * 2), Math.round(bb.extendSizeWorld.y * 2), Math.round(bb.extendSizeWorld.z * 2)], center: [Math.round(bb.centerWorld.x), Math.round(bb.centerWorld.y), Math.round(bb.centerWorld.z)] });
      }
      if (m.onBeforeDrawObservable) m.onBeforeDrawObservable.add(() => { if (D.on) cut(top() + '|' + label); });      // instances draw with their source mesh
    }
    post({ t: now(), ev: 'meshes', material: PER_MESH, count: meshFacts.length, totalVerts: meshFacts.reduce((a, x) => a + x.verts, 0), meshes: meshFacts });
    const JOB_LIMIT = 1500, JOB_PREDICT = 3000, FRAME_PREDICT = 6000;
    let stopped = null, last = null;
    // one frame, measured; the same stop limits apply during the ramp and every review shot.
    const frame = () => {
      D.frame++; D.acc = {}; D.cpu = {}; D.stack = []; D.on = true; const wall0 = Date.now(); D.cur = 'frame-start'; post({ t: now(), f: D.frame, ev: 'frame', size: [engine.getRenderWidth(), engine.getRenderHeight()], split: D.split });
      D.t0 = performance.now(); const tf = performance.now();
      scene.render();
      const tc = performance.now();
      D.inB = true; barrier(); D.inB = false; D.acc[D.cur] = (D.acc[D.cur] || 0) + (performance.now() - D.t0); D.on = false;
      D.cpu[D.cur] = (D.cpu[D.cur] || 0) + (tc - D.t0);
      const total = performance.now() - tf, acc = Object.fromEntries(Object.entries(D.acc).map(([k, v]) => [k, +v.toFixed(1)]));
      // slow jobs: how much was CPU; and the wall clock, which keeps running while the Mac sleeps (performance.now() does not:
      // a lid-close sleep showed up as one 6.8 s 'grass' job)
      const cpuSlow = Object.fromEntries(Object.entries(D.cpu).filter(([k]) => acc[k] > 50).map(([k, v]) => [k, +v.toFixed(1)]));
      const wallMs = Date.now() - wall0, slept = wallMs - total > 1000;
      post({ t: now(), f: D.frame, ev: 'frame-done', totalMs: +total.toFixed(1), wallMs, ...(slept ? { slept: true } : {}), cpuSlow, jobs: acc, active: scene.getActiveMeshes().length, draws: engine._drawCalls ? engine._drawCalls.current : null });
      if (D.split) {
        const over = Object.entries(acc).filter(([, v]) => v > JOB_LIMIT);
        if (over.length) stopped = 'job over ' + JOB_LIMIT + ' ms: ' + over.map(([j, v]) => j + ' ' + v.toFixed(0)).join(', ');
        if (slept) stopped = 'Mac slept during frame ' + D.frame + '; timings need review';
      }
      return { total, acc };
    };
    const canvas = engine.getRenderingCanvas(), css = [canvas.style.width, canvas.style.height];
    const fullW = Math.round(canvas.clientWidth || innerWidth), fullH = Math.round(canvas.clientHeight || innerHeight);
    const sizes = [[320, 200], [480, 300], [640, 400], [800, 500], [960, 600], [fullW, fullH]].filter((s, i, a) => i === a.length - 1 || s[0] < fullW);
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const finishStopped = () => {
      if (!stopped) return false;
      post({ t: now(), ev: 'stopped', why: stopped, last });
      show('STOPPED (safe): ' + stopped + '\nNothing further was rendered. Send me the log file.');
      canvas.style.width = css[0]; canvas.style.height = css[1];
      window.__diagDone = true; window.__watchdog = 'stopped'; return true;
    };
    for (let si = 0; si < sizes.length && !stopped; si++) {
      const [w, h] = sizes[si];
      if (si === sizes.length - 1) { canvas.style.width = css[0]; canvas.style.height = css[1]; engine.resize(); } else { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; engine.setSize(w, h); }
      for (let q = 0; q < 300 && !scene.isReady(); q++) await new Promise((r) => setTimeout(r, 10));
      post({ t: now(), ev: 'size', css: [w, h], render: [engine.getRenderWidth(), engine.getRenderHeight()] });
      let worstJobs = {}, worstTotal = 0;
      for (let k = 0; k < 3 && !stopped; k++) {
        const r = frame(); worstTotal = Math.max(worstTotal, r.total);
        for (const [j, v] of Object.entries(r.acc)) worstJobs[j] = Math.max(worstJobs[j] || 0, v);
        if (Object.values(r.acc).some((v) => v > JOB_LIMIT)) break;      // no more frames once a job is over the limit
        await nextFrame();
      }
      const topJobs = Object.entries(worstJobs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([j, v]) => j + ' ' + v.toFixed(0)).join(', ');
      show(`${engine.getRenderWidth()}x${engine.getRenderHeight()}: frame ${worstTotal.toFixed(0)} ms (split) | slowest: ${topJobs}`);
      last = { size: [engine.getRenderWidth(), engine.getRenderHeight()], worstTotal, worstJobs };
      const over = Object.entries(worstJobs).filter(([, v]) => v > JOB_LIMIT);
      if (over.length) { stopped = 'job over ' + JOB_LIMIT + ' ms: ' + over.map(([j, v]) => j + ' ' + v.toFixed(0)).join(', '); break; }
      if (si + 1 < sizes.length) {
        const nx = sizes[si + 1], ratio = (nx[0] * nx[1]) / (w * h);
        const pred = Object.entries(worstJobs).map(([j, v]) => [j, v * ratio]).filter(([, v]) => v > JOB_PREDICT);
        if (pred.length || worstTotal * ratio > FRAME_PREDICT) stopped = `next size ${nx[0]}x${nx[1]} predicted too slow: ` + (pred.map(([j, v]) => j + ' ~' + v.toFixed(0)).join(', ') || 'frame ~' + (worstTotal * ratio).toFixed(0));
      }
    }
    if (finishStopped()) return;
    post({ t: now(), ev: 'ramp-complete', last });
    // review screenshots on the real GPU, still as split frames: &diagshots=riva,shore_arrival,...  (each sent as a JPEG log line)
    if (QS.get('diagshots')) {
      window.__pauseDrive = true;
      show('screenshots: finishing the terrain shadows...');
      for (let k = 0; k < 240 && !stopped && window.__shadowJobs && window.__shadowJobs() > 0; k++) { frame(); await nextFrame(); }
      if (finishStopped()) return;
      for (const name of QS.get('diagshots').split(',')) {
        if (!setShot(name)) { post({ t: now(), ev: 'shot-missing', name }); show('no shot named ' + name); continue; }
        for (let k = 0; k < 5 && !stopped; k++) { frame(); await nextFrame(); }       // streaming, LOD and building cells settle
        if (finishStopped()) return;
        const r = frame();
        if (finishStopped()) return;
        const jpeg = canvas.toDataURL('image/jpeg', 0.88);
        post({ t: now(), ev: 'shot', name, size: [canvas.width, canvas.height], frameMs: +r.total.toFixed(1), jpeg });
        show(`shot ${name}: ${canvas.width}x${canvas.height}, split frame ${r.total.toFixed(0)} ms`);
        await nextFrame();
      }
    }
    if (!QS.has('diagunsplit')) { post({ t: now(), ev: 'diag-complete', unsplit: 'skipped' }); show('DIAG COMPLETE (split frames up to the full window). Send me the log file.'); window.__diagDone = true; window.__watchdog = 'stopped'; return; }
    show('ramp complete at the full window. Now 60 frames as in normal play (no inner barriers, one per frame)...');
    D.split = false;
    let worst = 0;
    for (let k = 0; k < 60; k++) { const r = frame(); worst = Math.max(worst, r.total); if (r.total > JOB_LIMIT * 2) { post({ t: now(), ev: 'stopped', why: 'unsplit frame ' + r.total.toFixed(0) + ' ms' }); show('STOPPED: an unsplit frame took ' + r.total.toFixed(0) + ' ms'); return; } await nextFrame(); }
    post({ t: now(), ev: 'diag-complete', worstUnsplitMs: +worst.toFixed(1) });
    show(`DIAG COMPLETE. Worst normal frame ${worst.toFixed(0)} ms. Send me the log file.`); window.__diagDone = true; window.__watchdog = 'stopped';
  }
  statusEl.hidden = true;
  releaseGeometry();      // again, for anything built during the warm-up (cheap: released buffers are skipped)
  if (modeChip && !DRIVE) modeChip.textContent = 'Dolomites look-dev · G: look panel · WASD + mouse: fly';
  // frame watchdog: a frame over 250 ms (twice) drops the expensive passes; over 2 s the loop stops rather than keep a hung GPU busy
  let wdLast = performance.now(), wdSlow = 0, wdFrames = 0, wdHung = 0;
  const SOFT = /swiftshader/i.test((engine.getGlInfo && engine.getGlInfo().renderer) || '');     // software rendering (tests): slow frames are normal, nothing to protect
  window.__worstFrame = 0;
  engine.runRenderLoop(() => {
    const now = performance.now(), dt = now - wdLast; wdLast = now;
    if (++wdFrames > 3 && !document.hidden) {     // armed after the first frames (shader compilation)
      window.__worstFrame = Math.max(window.__worstFrame, Math.round(dt));
      if (!SOFT && dt > 2000 && ++wdHung >= 2) { engine.stopRenderLoop(); console.error('watchdog: frame took', Math.round(dt), 'ms - rendering stopped'); window.__watchdog = 'stopped'; statusEl.hidden = false; statusEl.textContent = 'Rendering stopped: a frame took ' + Math.round(dt) + ' ms. Reload with ?quality=low.'; return; }
      if (!SOFT && dt > 250 && ++wdSlow >= 2 && !SAFE.on) { SAFE.on = true; if (SAFE.water) SAFE.water.setFloat('reflOn', 0); console.warn('watchdog: slow frames, water reflections and tunnel portals off'); window.__watchdog = 'safe'; }
      window.__slowFrames = (window.__slowFrames || []); if (dt > 250 && window.__slowFrames.length < 20) window.__slowFrames.push(Math.round(dt));
    }
    // frame log for the first 40 frames: [gap since the last frame, time inside scene.render, of which per-frame callbacks] in ms
    const cb0 = Object.entries(PROF).reduce((a, [k, v]) => (k.startsWith('cb') ? a + v : a), 0), r0 = performance.now();
    // errors inside Babylon reach window.onerror as a bare "Script error." (the CDN script is cross-origin): catch them here,
    // show the message and where it came from, and stop rather than repeat it every frame
    { const nf0 = (window.__frameLog || []).length + 1; if (nf0 <= 5) CRUMB.set('frame ' + nf0 + ' starting'); }
    try { scene.render(); } catch (e) {
      engine.stopRenderLoop(); const at = String((e && e.stack) || '').split('\n').slice(0, 4).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' | ');
      fail('Something went wrong while rendering: ' + ((e && e.message) || e) + ' [' + at + ']'); console.error(e); return; }
    const r1 = performance.now(), cb1 = Object.entries(PROF).reduce((a, [k, v]) => (k.startsWith('cb') ? a + v : a), 0);
    const FL = window.__frameLog = window.__frameLog || [];
    const nf = FL.length + 1; if (nf <= 5 || nf === 10 || nf === 30 || nf === 100) CRUMB.set('frame ' + nf + ' drawn', { scale: renderScale, canvas: engine.getRenderWidth() + 'x' + engine.getRenderHeight() }); else if (nf === 300) CRUMB.set('ok'); if (FL.length < 400) FL.push([Math.round(dt), Math.round(r1 - r0), Math.round(cb1 - cb0)]);
  });
  window.addEventListener('resize', () => engine.resize());
  let frames = 0; scene.onAfterRenderObservable.add(() => frames++);
  // dynamic resolution: hold ~35 fps (GPU time when the browser reports it, frame time otherwise) between the tier's limits
  const TARGET_MS = +(QS.get('targetms') || 28);
  let dynT = performance.now(), dynFrames = 0, dynHold = 0;
  scene.onAfterRenderObservable.add(() => {
    dynFrames++;
    const now = performance.now(); if (now - dynT < 1500 || QS.has('shot') || QS.has('scale')) return;
    const gpu = inst.gpuFrameTimeCounter.lastSecAverage / 1e6, frameMs = (now - dynT) / dynFrames; dynT = now; dynFrames = 0;
    const ms = gpu > 0.1 ? gpu : frameMs;
    let next = renderScale;
    if (ms > TARGET_MS * 1.08) next = Math.max(Q.scale[0], renderScale * Math.sqrt(TARGET_MS / ms));
    else if (ms < TARGET_MS * 0.7 && ++dynHold > 1) { next = Math.min(Q.scale[1], renderScale + 0.1); dynHold = 0; }
    if (Math.abs(next - renderScale) > 0.04) { renderScale = Math.round(next * 20) / 20; engine.setHardwareScalingLevel(1 / renderScale); }
  });
  const inst = new BABYLON.EngineInstrumentation(engine); inst.captureGPUFrameTime = true;
  const sinst = new BABYLON.SceneInstrumentation(scene); sinst.captureFrameTime = true;
  window.__dolo = { get revealIndex() { return revealIndex; }, spawnAt: (i) => spawnAt && spawnAt(i), sightClear, scene, engine, P, PRESETS, SHOTS, setShot, terrainH, collisionH, structAt, get hf() { return hf; }, ROAD, ROADS, buildings: PROPS.buildings, ROUTE_PTS, ROUTE_S, get ROUTE_LANE() { return ROUTE_LANE; }, WORLD, L0, keys, touchKeys, touchAxis, detailAt, LVL, get chassis() { return chassis; }, get autopilot() { return autopilot; }, physStep: (n) => { for (let i = 0; i < n; i++) driveStep(1 / 60); },
    setPreset: (p) => { Object.assign(P, PRESETS[p]); updateAtmosphere(); applyLook(); },
    set: (o) => { Object.assign(P, o); updateAtmosphere(); applyLook(); },
    get frames() { return frames; }, get nodes() { return nodeCount; },
    stats: () => { let tex = 0; for (const t of scene.textures) { const it = t.getInternalTexture && t.getInternalTexture(); if (it) tex += it.width * it.height * (it.type === 1 ? 16 : 4) * (it.is3D ? it.depth : 1) * (it.isCube ? 6 : 1); }
      return { tier: tierName, bench: +benchMs.toFixed(2), scale: renderScale, gpuMs: +(inst.gpuFrameTimeCounter.lastSecAverage / 1e6).toFixed(2), cpuMs: +sinst.frameTimeCounter.lastSecAverage.toFixed(2), draws: sinst.drawCallsCounter.current, terrainKTris: Math.round(nodeCount * GRID * GRID * 2 / 1000), activeKTris: Math.round(scene.getActiveIndices() / 3 / 1000), nodes: nodeCount, gpuMB: Math.round(tex / 1048576) }; } };
})();
