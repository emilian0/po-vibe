// Po valley drive: world generation, car, physics, controls, audio, post-processing and the perf dashboard.
(async () => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const fail = (t) => { statusEl.hidden = false; statusEl.textContent = t; };
  const say = (t) => { $('announce').textContent = t; };
  window.addEventListener('error', (e) => fail('Something went wrong: ' + (e.message || 'unknown error')));
  window.addEventListener('unhandledrejection', (e) => fail('Something went wrong while loading: ' + ((e.reason && e.reason.message) || e.reason || 'unknown error')));
  if (typeof BABYLON === 'undefined' || typeof CANNON === 'undefined') { fail('The 3D engine did not load. Check your connection and reload.'); return; }
  if (!BABYLON.Engine.isSupported()) { fail('This game needs WebGL. Try a recent Chrome, Safari or Firefox.'); return; }
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const isMobile = isTouch || Math.min(screen.width, screen.height) < 700;
  if (isTouch) document.body.classList.add('touchmode');
  const NOCAR = new URLSearchParams(location.search).has('nocar');
  // ?spawn=dolomites: the Passo Gardena look-dev world lives in its own script
  if (new URLSearchParams(location.search).get('spawn') === 'dolomites') { const s = document.createElement('script'); s.src = 'src/dolomites.js?v=' + Date.now(); document.body.appendChild(s); return; }
  const QS = new URLSearchParams(location.search), NO_SSAO = QS.has('nossao'), NO_RAYS = QS.has('norays'), NO_CSM = QS.has('nocsm'), NO_MIRROR = QS.has('nomirror'), NO_POST = QS.has('nopost');

  // ---------- small utilities ----------
  const b64ToBytes = (s) => { const bin = atob(s.trim()); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
  const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const blobImagesWork = () => new Promise((res) => {
    try {
      const url = URL.createObjectURL(new Blob([b64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')], { type: 'image/png' }));
      const img = new Image(); img.onload = () => res(true); img.onerror = () => res(false); img.src = url; setTimeout(() => res(false), 1500);
    } catch (e) { res(false); }
  });
  const useDataUrlsForBlobs = () => {
    const NB = window.Blob;
    function TB(parts, opts) { const b = new NB(parts, opts); try { Object.defineProperty(b, '__p', { value: parts }); Object.defineProperty(b, '__t', { value: (opts && opts.type) || '' }); } catch (e) {} return b; }
    TB.prototype = NB.prototype; window.Blob = TB;
    const nc = URL.createObjectURL.bind(URL), nr = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => { const p = o && o.__p; if (p && p.length === 1) { const x = p[0]; const u8 = x instanceof ArrayBuffer ? new Uint8Array(x) : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : null; if (u8) return 'data:' + (o.__t || 'application/octet-stream') + ';base64,' + bytesToB64(u8); } return nc(o); };
    URL.revokeObjectURL = (u) => { if (typeof u === 'string' && u.startsWith('data:')) return; nr(u); };
  };
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const V3 = BABYLON.Vector3, C3 = BABYLON.Color3;

  // ---------- engine, scene, sky ----------
  const ASSETS = new URL('../assets/', location.href);                    // game/ and assets/ are siblings, locally and on Pages
  const assetUrl = (p) => new URL(p, ASSETS).href;
  // drivable cars; choose with ?car=<id> or the Car button. Sizes in metres, game frame (+z forward, origin at the wheelbase centre on the ground).
  const CARS = {
    alfa33:   { file: 'cars/alfa33.glb',   name: 'Alfa 33',   desc: 'a red Alfa Romeo 33', vmax: 205, eye: [-0.37, 1.12, -0.25], lamp: [0.52, 0.60, 1.95], ev: false },
    fiat500e: { file: 'cars/fiat500e.glb', name: 'Fiat 500e', desc: 'a pale blue Fiat 500e', vmax: 150, eye: [-0.37, 1.20, -0.42], lamp: [0.47, 0.72, 1.80], ev: true },
    ferrari296: { file: 'cars/ferrari296.glb', name: 'Ferrari 296', desc: 'a red Ferrari 296 GTB', vmax: 330, power: 1.25, eye: [-0.36, 0.98, -0.05], lamp: [0.655, 0.555, 2.22], ev: false, mid: true, redline: 8500, cyl: 6 },
    ferrari12c: { file: 'cars/ferrari12c.glb', name: 'Ferrari 12Cilindri', desc: 'a yellow Ferrari 12Cilindri', vmax: 340, power: 1.25, eye: [-0.37, 1.02, -0.37], lamp: [0.64, 0.58, 2.21], ev: false, redline: 9500, cyl: 12 },
    purosangue: { file: 'cars/purosangue.glb', name: 'Ferrari Purosangue', desc: 'a dark blue Ferrari Purosangue', vmax: 310, power: 1.2, eye: [-0.38, 1.32, -0.28], lamp: [0.66, 0.83, 2.33], ev: false, redline: 8250, cyl: 12, rearDoorsBackHinged: true },
    giulia: { file: 'cars/giulia.glb', name: 'Alfa Giulia QV', desc: 'a green Alfa Romeo Giulia Quadrifoglio', vmax: 307, power: 1.2, eye: [-0.38, 1.17, -0.36], lamp: [0.62, 0.68, 2.12], ev: false, redline: 7000, cyl: 6 },
    stradale33: { file: 'cars/stradale33.glb', name: 'Alfa 33 Stradale', desc: 'a red Alfa Romeo 33 Stradale', vmax: 333, power: 1.25, eye: [-0.36, 1.01, -0.11], lamp: [0.6, 0.58, 2.3], ev: false, mid: true, redline: 7500, cyl: 6, doors: 'scissor' },
    junior: { file: 'cars/junior.glb', name: 'Alfa Junior', desc: 'a red Alfa Romeo Junior', vmax: 200, power: 1.0, eye: [-0.37, 1.28, -0.15], lamp: [0.58, 0.82, 1.99], ev: true },
    temerario: { file: 'cars/temerario.glb', name: 'Lamborghini Temerario', desc: 'a green Lamborghini Temerario', vmax: 343, power: 1.3, eye: [-0.36, 1.0, -0.08], lamp: [0.66, 0.57, 2.38], ev: false, mid: true, redline: 10000, cyl: 8 },
    revuelto: { file: 'cars/revuelto.glb', name: 'Lamborghini Revuelto', desc: 'an orange Lamborghini Revuelto', vmax: 350, power: 1.3, eye: [-0.36, 0.99, -0.11], lamp: [0.66, 0.54, 2.37], ev: false, mid: true, redline: 9500, cyl: 12, doors: 'scissor' },
    urus: { file: 'cars/urus.glb', name: 'Lamborghini Urus', desc: 'a grey Lamborghini Urus', vmax: 312, power: 1.2, eye: [-0.38, 1.38, -0.18], lamp: [0.66, 0.88, 2.38], ev: false, redline: 6800, cyl: 8 },
    ypsilon: { file: 'cars/ypsilon.glb', name: 'Lancia Ypsilon', desc: 'a blue Lancia Ypsilon', vmax: 150, power: 0.9, eye: [-0.37, 1.22, -0.13], lamp: [0.58, 0.74, 1.93], ev: true },
    delta: { file: 'cars/delta.glb', name: 'Lancia Delta Integrale', desc: 'a white Lancia Delta HF Integrale', vmax: 220, power: 1.0, eye: [-0.37, 1.16, -0.26], lamp: [0.48, 0.69, 1.85], ev: false, redline: 6500, cyl: 4 },
    mc20: { file: 'cars/mc20.glb', name: 'Maserati MC20', desc: 'a blue Maserati MC20', vmax: 325, power: 1.25, eye: [-0.36, 1.01, -0.12], lamp: [0.63, 0.58, 2.26], ev: false, mid: true, redline: 8000, cyl: 6, doors: 'scissor' },
    granturismo: { file: 'cars/granturismo.glb', name: 'Maserati GranTurismo', desc: 'a red Maserati GranTurismo', vmax: 320, power: 1.2, eye: [-0.37, 1.1, -0.32], lamp: [0.66, 0.66, 2.29], ev: false, redline: 7500, cyl: 6 },
    grandepanda: { file: 'cars/grandepanda.glb', name: 'Fiat Grande Panda', desc: 'a white Fiat Grande Panda', vmax: 132, power: 0.8, eye: [-0.37, 1.3, -0.2], lamp: [0.56, 0.86, 1.91], ev: true },
    utopia: { file: 'cars/utopia.glb', name: 'Pagani Utopia', desc: 'a silver Pagani Utopia', vmax: 350, power: 1.3, eye: [-0.36, 1.02, 0.04], lamp: [0.6, 0.58, 2.25], ev: false, mid: true, redline: 7000, cyl: 12, doors: 'gullwing' },
  };
  const CAR_IDS = Object.keys(CARS), CAR_ID = CARS[new URLSearchParams(location.search).get('car')] ? new URLSearchParams(location.search).get('car') : 'alfa33', CAR = CARS[CAR_ID];
  if (location.protocol === 'file:') { fail('This game has to be served over HTTP. In the repo folder run: python3 -m http.server 8000, then open http://localhost:8000'); return; }
  let TRACK;
  try { const r = await fetch(assetUrl('maps/po-valley/track.json')); if (!r.ok) throw new Error(r.status); TRACK = await r.json(); }
  catch (e) { fail('Could not load the map data (assets/maps/po-valley/track.json): ' + e.message); return; }
  const canvas = $('c');
  // renderer: WebGPU when available (lower CPU cost per draw call), WebGL otherwise; ?webgl forces WebGL
  const forceWebGL = new URLSearchParams(location.search).has('webgl') || sessionStorage.getItem('poForceWebGL') === '1';
  let engine = null, usingWebGPU = false;
  if (!forceWebGL && navigator.gpu && BABYLON.WebGPUEngine) {
    try {
      if (await BABYLON.WebGPUEngine.IsSupportedAsync) {
        engine = new BABYLON.WebGPUEngine(canvas, { antialias: true, powerPreference: 'high-performance', adaptToDeviceRatio: true, stencil: false });
        await engine.initAsync();
        usingWebGPU = true;
        // every shader we use ships in WGSL; if Babylon ever needs its GLSL converter (downloaded from a CDN this page cannot reach), fall back to WebGL
        engine.prepareGlslangAndTintAsync = () => { console.warn('WebGPU: a shader needs GLSL conversion, switching to WebGL'); sessionStorage.setItem('poForceWebGL', '1'); location.reload(); return new Promise(() => {}); };
      }
    } catch (e) { console.warn('WebGPU unavailable, using WebGL', e); engine = null; usingWebGPU = false; }
  }
  if (!engine) engine = new BABYLON.Engine(canvas, true, { stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' }, true);
  if (usingWebGPU) {
    // safety net: any engine error or a lost GPU device in the first 20 s switches this session to WebGL and reloads once
    const t0 = performance.now(), prevLog = BABYLON.Logger.OnNewCacheEntry;
    const bail = (why) => { if (sessionStorage.getItem('poForceWebGL')) return; console.warn('WebGPU problem, switching to WebGL:', why); sessionStorage.setItem('poForceWebGL', '1'); location.reload(); };
    BABYLON.Logger.OnNewCacheEntry = (entry) => { if (prevLog) prevLog(entry); if (performance.now() - t0 < 20000 && /error|context lost|device lost/i.test(entry)) bail(entry); };
    engine.onContextLostObservable.add(() => bail('device lost'));
  }
  // phones/tablets: up to 2x for sharpness; desktop: 1x (one rendered pixel per CSS pixel), much faster on Retina/4K screens
  engine.setHardwareScalingLevel(isMobile ? 1 / Math.min(window.devicePixelRatio || 1, 2) : 1);
  engine.onContextLostObservable.add(() => fail('The graphics memory ran out on this device. Close other apps and reload.'));
  const scene = new BABYLON.Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.clearColor = new BABYLON.Color4(0.70, 0.79, 0.88, 1);
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true; ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES; ip.exposure = 1.0; ip.contrast = 1.08;
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2; scene.fogDensity = 0.0011; scene.fogColor = new C3(0.74, 0.80, 0.86);
  const env = BABYLON.CubeTexture.CreateFromPrefilteredData(assetUrl('sky/sky.env'), scene, '.env');
  scene.environmentTexture = env; scene.environmentIntensity = 0.75;
  const SUN = new V3(-0.42, -0.62, -0.66).normalize();
  const sun = new BABYLON.DirectionalLight('sun', SUN, scene); sun.intensity = 3.0; sun.diffuse = new C3(1, 0.96, 0.88);
  const hemi = new BABYLON.HemisphericLight('sky', new V3(0, 1, 0), scene); hemi.intensity = 0.25; hemi.groundColor = new C3(0.3, 0.32, 0.22);

  // sky dome with a soft sun, drawn without fog
  BABYLON.Effect.ShadersStore.skyVertexShader = `precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
    void main(){ vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`;
  BABYLON.Effect.ShadersStore.skyFragmentShader = `precision highp float; varying vec3 vDir; uniform vec3 sunDir; uniform vec3 zenCol; uniform vec3 horCol; uniform vec3 sunCol;
    void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -0.2, 1.0);
      vec3 zen = zenCol, hor = horCol;
      vec3 c = mix(hor, zen, pow(max(h, 0.0), 0.5));
      float s = max(dot(d, -sunDir), 0.0); c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
      if (h < 0.0) c = mix(hor, vec3(0.55, 0.6, 0.55), clamp(-h * 6.0, 0.0, 1.0));
      gl_FragColor = vec4(pow(c, vec3(1.0)), 1.0); }`;
  BABYLON.ShaderStore.ShadersStoreWGSL.skyVertexShader = `
attribute position : vec3<f32>;
uniform worldViewProjection : mat4x4<f32>;
varying vDir : vec3<f32>;
@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  var p = uniforms.worldViewProjection * vec4<f32>(vertexInputs.position, 1.0);
  p.z = p.w * 0.99999;
  vertexOutputs.position = p;
}`;
  BABYLON.ShaderStore.ShadersStoreWGSL.skyFragmentShader = `
varying vDir : vec3<f32>;
uniform sunDir : vec3<f32>;
uniform zenCol : vec3<f32>;
uniform horCol : vec3<f32>;
uniform sunCol : vec3<f32>;
@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let d = normalize(fragmentInputs.vDir);
  let h = clamp(d.y, -0.2, 1.0);
  var c = mix(uniforms.horCol, uniforms.zenCol, pow(max(h, 0.0), 0.5));
  let s = max(dot(d, -uniforms.sunDir), 0.0);
  c = c + uniforms.sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
  if (h < 0.0) { c = mix(uniforms.horCol, vec3<f32>(0.55, 0.6, 0.55), clamp(-h * 6.0, 0.0, 1.0)); }
  fragmentOutputs.color = vec4<f32>(c, 1.0);
}`;
  const skyMat = new BABYLON.ShaderMaterial('skyMat', scene, { vertex: 'sky', fragment: 'sky' }, { attributes: ['position'], uniforms: ['worldViewProjection', 'sunDir', 'zenCol', 'horCol', 'sunCol'],
    shaderLanguage: usingWebGPU ? BABYLON.ShaderLanguage.WGSL : BABYLON.ShaderLanguage.GLSL });
  skyMat.setVector3('sunDir', SUN); skyMat.setVector3('zenCol', new V3(0.20, 0.40, 0.78)); skyMat.setVector3('horCol', new V3(0.78, 0.84, 0.90)); skyMat.setVector3('sunCol', new V3(1, 0.9, 0.7)); skyMat.backFaceCulling = false; skyMat.disableDepthWrite = true;
  const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 2000, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  sky.material = skyMat; sky.infiniteDistance = true; sky.isPickable = false; sky.applyFog = false;

  // ---------- textures painted on canvases (no downloads needed) ----------
  const canvasTex = (name, size, paint, opts = {}) => {
    const t = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, true);
    paint(t.getContext(), size); t.update(); t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8; if (opts.linear) t.gammaSpace = false; return t;
  };
  const noiseFill = (ctx, n, base, amp, scale = 8) => {
    const id = ctx.getImageData(0, 0, n, n), d = id.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = (fbm(x / n * scale, y / n * scale, 3) - 0.5) * 2 * amp + (hash(x, y) - 0.5) * amp * 0.6, i = (y * n + x) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] * (1 + v))); d[i + 1] = Math.max(0, Math.min(255, base[1] * (1 + v))); d[i + 2] = Math.max(0, Math.min(255, base[2] * (1 + v))); d[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
  };
  const normalFromHeight = (name, n, hf, strength) => {
    const t = new BABYLON.DynamicTexture(name, { width: n, height: n }, scene, true), ctx = t.getContext();
    const id = ctx.createImageData(n, n), d = id.data, H = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) H[y * n + x] = hf(x, y);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (H[y * n + (x + 1) % n] - H[y * n + (x - 1 + n) % n]) * strength, dy = (H[((y + 1) % n) * n + x] - H[((y - 1 + n) % n) * n + x]) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0); t.update(); t.wrapU = t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; return t;
  };
  const pbr = (name, color, rough, extra = {}) => {
    const m = new BABYLON.PBRMaterial(name, scene); m.albedoColor = color; m.metallic = extra.metal || 0; m.roughness = rough;
    if (extra.tex) m.albedoTexture = extra.tex; if (extra.bump) { m.bumpTexture = extra.bump; m.bumpTexture.level = extra.bumpLevel || 1; }
    return m;
  };
  const tex = {
    asphalt: canvasTex('asphalt', 512, (c, n) => {
      noiseFill(c, n, [92, 92, 94], 0.22, 24);
      for (let k = 0; k < 9; k++) { c.fillStyle = `rgba(${hash(k, 1) < 0.5 ? '40,40,42' : '120,118,112'},0.35)`; c.fillRect(n * (0.08 + hash(k, 2) * 0.7), hash(k, 3) * n, n * (0.08 + hash(k, 4) * 0.2), n * (0.05 + hash(k, 5) * 0.15)); }
      c.strokeStyle = 'rgba(25,25,25,0.55)'; c.lineWidth = 1.5;
      for (let k = 0; k < 14; k++) { let x = hash(k, 6) * n, y = hash(k, 7) * n; c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 6; j++) { x += (hash(k, j + 8) - 0.5) * 40; y += hash(k, j + 20) * 30; c.lineTo(x, y); } c.stroke(); }
      c.fillStyle = 'rgba(30,30,32,0.25)'; c.fillRect(n * 0.22, 0, n * 0.1, n); c.fillRect(n * 0.68, 0, n * 0.1, n);     // darker wheel tracks
      c.fillStyle = 'rgba(235,235,225,0.92)';
      c.fillRect(n * 0.035, 0, n * 0.03, n); c.fillRect(n * 0.935, 0, n * 0.03, n);
      c.fillRect(n * 0.49, 0, n * 0.02, n * 0.45);
    }),
    cobble: canvasTex('cobble', 512, (c, n) => {
      c.fillStyle = '#4d4642'; c.fillRect(0, 0, n, n);
      const s = n / 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const h = hash(x, y), off = (y % 2) * s * 0.5;
        const r = 120 + h * 50, g = 98 + h * 30, b = 88 + h * 22;
        c.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        c.beginPath(); c.roundRect((x * s + off) % n + 2, y * s + 2, s - 4, s - 4, 6); c.fill();
      }
    }),
    brick: canvasTex('brick', 512, (c, n) => {
      c.fillStyle = '#b9a58d'; c.fillRect(0, 0, n, n);
      const rows = 32, bw = n / 8;
      for (let y = 0; y < rows; y++) for (let x = -1; x < 9; x++) {
        const h = hash(x, y), off = (y % 2) * bw * 0.5, hh = n / rows;
        c.fillStyle = `rgb(${(150 + h * 45) | 0},${(70 + h * 25) | 0},${(48 + h * 18) | 0})`;
        c.fillRect(x * bw + off + 1.5, y * hh + 1.5, bw - 3, hh - 3);
      }
    }),
    plaster: canvasTex('plaster', 256, (c, n) => noiseFill(c, n, [242, 228, 204], 0.07, 6)),
    roof: canvasTex('roof', 512, (c, n) => {
      const rows = 16, cols = 12;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const h = hash(x, y * 3), w = n / cols, hh = n / rows;
        const g = c.createLinearGradient(x * w, 0, x * w + w, 0);
        const r0 = 150 + h * 40;
        g.addColorStop(0, `rgb(${r0 * 0.55 | 0},${r0 * 0.27 | 0},${r0 * 0.18 | 0})`); g.addColorStop(0.5, `rgb(${r0 | 0},${r0 * 0.5 | 0},${r0 * 0.33 | 0})`); g.addColorStop(1, `rgb(${r0 * 0.6 | 0},${r0 * 0.3 | 0},${r0 * 0.2 | 0})`);
        c.fillStyle = g; c.fillRect(x * w, y * hh, w, hh - 2);
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x * w, y * hh + hh - 3, w, 3);
      }
    }),
    bark: canvasTex('bark', 256, (c, n) => {
      noiseFill(c, n, [168, 170, 160], 0.12, 5);
      for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(40,40,35,${0.25 + hash(i, 3) * 0.4})`; c.fillRect(hash(i, 1) * n, hash(i, 2) * n, 10 + hash(i, 4) * 26, 2 + hash(i, 5) * 4); }
    }),
    leaves: canvasTex('leaves', 256, (c, n) => {
      noiseFill(c, n, [92, 132, 58], 0.32, 10);
      for (let i = 0; i < 900; i++) { const h = hash(i, 9); c.fillStyle = `rgba(${(140 + h * 60) | 0},${(170 + h * 50) | 0},${(70 + h * 30) | 0},0.35)`; c.beginPath(); c.arc(hash(i, 1) * n, hash(i, 2) * n, 1.5 + h * 3, 0, 6.3); c.fill(); }
    }),
    concrete: canvasTex('concrete', 256, (c, n) => noiseFill(c, n, [170, 168, 160], 0.12, 7)),
  };
  const grainN = normalFromHeight('grainN', 256, (x, y) => fbm(x / 16, y / 16, 3), 2.5);
  const waterN = normalFromHeight('waterN', 256, (x, y) => fbm(x / 32, y / 22, 4) + 0.3 * Math.sin((x + y) / 7), 3.0);

  const M = {
    asphalt: pbr('asphalt', new C3(1, 1, 1), 0.82, { tex: tex.asphalt, bump: grainN, bumpLevel: 0.6 }),
    cobble: pbr('cobble', new C3(1, 1, 1), 0.7, { tex: tex.cobble, bump: grainN, bumpLevel: 0.9 }),
    brick: pbr('brick', new C3(1, 1, 1), 0.85, { tex: tex.brick, bump: grainN, bumpLevel: 0.5 }),
    plaster: pbr('plaster', new C3(1, 1, 1), 0.9, { tex: tex.plaster }),
    roof: pbr('roof', new C3(1, 1, 1), 0.75, { tex: tex.roof }),
    trim: pbr('trim', new C3(0.88, 0.82, 0.70), 0.8),
    glassDark: pbr('glassDark', new C3(0.05, 0.06, 0.07), 0.15),
    shutter: pbr('shutter', new C3(0.18, 0.28, 0.18), 0.6),
    wood: pbr('wood', new C3(0.30, 0.18, 0.10), 0.7),
    bark: pbr('bark', new C3(1, 1, 1), 0.9, { tex: tex.bark }),
    leaf: pbr('leaf', new C3(1, 1, 1), 0.85, { tex: tex.leaves, bump: grainN, bumpLevel: 0.6 }),
    leafDark: pbr('leafDark', new C3(0.62, 0.70, 0.55), 0.85, { tex: tex.leaves, bump: grainN, bumpLevel: 0.6 }),
    leafLight: pbr('leafLight', new C3(1.12, 1.08, 0.82), 0.85, { tex: tex.leaves, bump: grainN, bumpLevel: 0.6 }),
    concrete: pbr('concrete', new C3(1, 1, 1), 0.85, { tex: tex.concrete }),
    steel: pbr('steel', new C3(0.62, 0.66, 0.66), 0.45, { metal: 0.6 }),
    rail: pbr('rail', new C3(0.75, 0.76, 0.76), 0.35, { metal: 0.9 }),
    lamp: pbr('lamp', new C3(0.12, 0.12, 0.12), 0.5),
    stripe: pbr('stripe', new C3(1, 1, 1), 0.8),
  };
  M.stripe.albedoTexture = canvasTex('checker', 128, (c, n) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#eee'; c.fillRect(x * n / 16, y * n / 4, n / 16, n / 4); } });

  // ---------- track: an oval crossing the Po twice ----------
  const RAD = 120, HALF = 200, DECK = 7.0, BR = 110, RAMP_END = 182;
  const riverX = (z) => 14 * Math.sin(z / 170) + 5 * Math.sin(z / 53);
  const stepLen = 2;
  // ---------- the circuit: ~2.5 km, crossing the Po on two straight bridges, a village loop to the west, a winding run through the poplars to the east ----------
  // circuit control points live in the map data (assets/maps/po-valley/track.json)
  const CTRL = TRACK.controlPoints;
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const dense = [];
  for (let i = 0; i < CTRL.length; i++) {
    const p0 = CTRL[(i - 1 + CTRL.length) % CTRL.length], p1 = CTRL[i], p2 = CTRL[(i + 1) % CTRL.length], p3 = CTRL[(i + 2) % CTRL.length];
    for (let k = 0; k < 60; k++) { const t = k / 60; dense.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]); }
  }
  const rawPts = [];
  { let acc = 0; rawPts.push([dense[0][0], dense[0][1]]);
    for (let i = 1; i <= dense.length; i++) { const p = [dense[(i - 1) % dense.length][0], dense[(i - 1) % dense.length][1]], q = dense[i % dense.length]; let seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      while (acc + seg >= stepLen) { const t = (stepLen - acc) / seg; const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t; rawPts.push([x, z]); seg -= stepLen - acc; p[0] = x; p[1] = z; acc = 0; }
      acc += seg; }
    const l = rawPts[rawPts.length - 1]; if (Math.hypot(l[0] - rawPts[0][0], l[1] - rawPts[0][1]) < stepLen * 0.6) rawPts.pop(); }
  rawPts.forEach((p) => { p.push(p[0] < -330 && p[1] > -120 && p[1] < 168 ? 2 : p[0] > 300 ? 1 : 0); });
  let startIdx = 0, bestD = 1e9;
  rawPts.forEach((p, i) => { const d = Math.hypot(p[0] - TRACK.start[0], p[1] - TRACK.start[1]); if (d < bestD) { bestD = d; startIdx = i; } });
  const pts = rawPts.slice(startIdx).concat(rawPts.slice(0, startIdx));
  const N = pts.length;
  const roadY = (x, z) => {
    const onStraight = Math.abs(Math.abs(z) - RAD) < 1 && Math.abs(x) <= HALF + 0.1;
    const base = 0.18;
    if (!onStraight) return base;
    const ax = Math.abs(x);
    if (ax <= BR) return DECK;
    if (ax >= RAMP_END) return base;
    const t = (ax - BR) / (RAMP_END - BR); return base + (DECK - base) * (1 - t * t * (3 - 2 * t));
  };
  const T = [];             // per-sample frame
  let cum = 0;
  for (let i = 0; i < N; i++) {
    const p = pts[i], q = pts[(i + 1) % N], o = pts[(i - 1 + N) % N];
    const tx = q[0] - o[0], tz = q[1] - o[1], l = Math.hypot(tx, tz);
    const y = roadY(p[0], p[1]);
    T.push({ x: p[0], z: p[1], y, tx: tx / l, tz: tz / l, nx: -tz / l, nz: tx / l, s: cum,
             village: p[2] === 2, grove: p[2] === 1, bridge: Math.abs(Math.abs(p[1]) - RAD) < 1 && Math.abs(p[0]) <= BR });
    cum += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  const TRACK_LEN = cum;
  const halfW = (t) => (t.village ? 3.4 : 3.9);

  // spatial index of the centreline for nearest-sample queries
  const GRID = 24, buckets = new Map();
  T.forEach((t, i) => { const k = Math.floor(t.x / GRID) + ',' + Math.floor(t.z / GRID); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); });
  const nearestSample = (x, z, maxR = 2) => {
    const gx = Math.floor(x / GRID), gz = Math.floor(z / GRID); let best = -1, bd = 1e18;
    for (let r = 0; r <= maxR && best < 0 ? true : r <= maxR; r++) {
      for (let a = gx - r; a <= gx + r; a++) for (let b = gz - r; b <= gz + r; b++) {
        if (Math.max(Math.abs(a - gx), Math.abs(b - gz)) !== r) continue;
        const L = buckets.get(a + ',' + b); if (!L) continue;
        for (const i of L) { const d = (T[i].x - x) ** 2 + (T[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  };

  // ---------- zones ----------
  const ZC = 10, ZX0 = -600, ZZ0 = -460, ZNX = 120, ZNZ = 92, vMask = new Uint8Array(ZNX * ZNZ);
  T.forEach((t) => { if (!t.village) return; for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) { const x = t.x + a * ZC, z = t.z + b * ZC; if (Math.hypot(a, b) * ZC > 72) continue;
    const i = Math.floor((x - ZX0) / ZC), j = Math.floor((z - ZZ0) / ZC); if (i >= 0 && j >= 0 && i < ZNX && j < ZNZ) vMask[j * ZNX + i] = 1; } });
  const inVillage = (x, z) => { const i = Math.floor((x - ZX0) / ZC), j = Math.floor((z - ZZ0) / ZC); return i >= 0 && j >= 0 && i < ZNX && j < ZNZ && vMask[j * ZNX + i] === 1; };
  const inGrove = (x, z) => x > 250 && x < 545 && z > -300 && z < 260;

  // ---------- terrain ----------
  const TX0 = -560, TX1 = 560, TZ0 = -420, TZ1 = 420, TS = 4;
  const NX = Math.round((TX1 - TX0) / TS) + 1, NZ = Math.round((TZ1 - TZ0) / TS) + 1;
  const baseHeight = (x, z) => {
    const plain = (fbm(x / 160 + 3.1, z / 160 + 7.3, 3) - 0.5) * 0.7;
    const d = Math.abs(x - riverX(z));
    let h = lerp(-6.0, plain, smooth(56, 104, d));
    const bar = Math.max(0, Math.sin(z / 95 + 1.3)) * smooth(40, 64, d) * (1 - smooth(70, 82, d)) * Math.sign(Math.sin(z / 300)) ;
    if (bar > 0 && x - riverX(z) > 0) h = Math.max(h, -3.6 + 1.2 * bar);   // sand bars on the inside of the bend
    return h;
  };
  const H = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = TX0 + i * TS, z = TZ0 + j * TS;
    let h = baseHeight(x, z);
    const ns = nearestSample(x, z, 2);
    if (ns && !T[ns.i].bridge) {
      const t = T[ns.i], top = t.y - 0.12, hw = halfW(t) + 2.5;
      const reach = hw + Math.max(3, (top - h) * 2.2);
      if (ns.d < reach) { const w = 1 - smooth(hw, reach, ns.d); h = lerp(h, top, w); if (ns.d < hw) h = top; }
    } else if (ns && T[ns.i].bridge && ns.d < 9) h = Math.min(h, -1.5 - 0 * ns.d);
    H[j * NX + i] = h;
  }
  const terrainH = (x, z) => {
    const fx = (x - TX0) / TS, fz = (z - TZ0) / TS, i = Math.max(0, Math.min(NX - 2, Math.floor(fx))), j = Math.max(0, Math.min(NZ - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const a = H[j * NX + i], b = H[j * NX + i + 1], c = H[(j + 1) * NX + i], d = H[(j + 1) * NX + i + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  {
    const pos = [], uv = [], ind = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { pos.push(TX0 + i * TS, H[j * NX + i], TZ0 + j * TS); uv.push(i / (NX - 1), j / (NZ - 1)); }
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; ind.push(a, b, c, b, d, c); }
    var terrain = new BABYLON.Mesh('terrain', scene);
    const vd = new BABYLON.VertexData(); vd.positions = pos; vd.indices = ind; vd.uvs = uv;
    const nor = []; BABYLON.VertexData.ComputeNormals(pos, ind, nor);
    if (nor[1] < 0) for (let k = 0; k < nor.length; k++) nor[k] = -nor[k];      // normals must face up
    vd.normals = nor; vd.applyToMesh(terrain);
  }

  // ---------- vegetation layout (needed by the ground map for painted shade) ----------
  const groveTrees = [], riverTrees = [], hedgeTrees = [], orchard = [];
  for (let x = 250; x < 545; x += 6.5) for (let z = -296; z < 256; z += 6) {
    if (!inGrove(x, z)) continue;
    const ns = nearestSample(x, z, 1); if (ns && ns.d < 9.5) continue;
    if (Math.abs(x - riverX(z)) < 120) continue;
    groveTrees.push([x + (hash(x, z) - 0.5) * 0.6, z + (hash(z, x) - 0.5) * 0.6, 0.85 + hash(x * 2, z) * 0.3]);
  }
  for (let k = 0; k < 2600; k++) {
    const z = TZ0 + hash(k, 1) * (TZ1 - TZ0), side = hash(k, 2) < 0.5 ? -1 : 1, d = 84 + Math.pow(hash(k, 3), 1.6) * 75;
    const x = riverX(z) + side * d; if (inGrove(x, z) || inVillage(x, z)) continue;
    if (Math.hypot(x - (riverX(-238) + 116), z + 238) < 48) continue;      // keep the waterfall bluff clear
    const ns = nearestSample(x, z, 1); if (ns && ns.d < 10) continue;
    if (hash(Math.floor(z / 40), side) < 0.25 && d > 110) continue;
    riverTrees.push([x, z, 0.7 + hash(k, 4) * 0.6]);
  }
  // fields: rotated grid of plots
  const FA = 0.14, FCA = Math.cos(FA), FSA = Math.sin(FA);
  const fieldOf = (x, z) => { const xr = x * FCA + z * FSA, zr = -x * FSA + z * FCA; const cx = Math.floor(xr / 95), cz = Math.floor(zr / 70);
    return { cx, cz, kind: Math.floor(hash(cx + 17, cz - 5) * 6), u: xr - cx * 95, v: zr - cz * 70 }; };
  const isFarm = (x, z) => !inGrove(x, z) && !inVillage(x, z) && Math.abs(x - riverX(z)) > 140;
  for (let x = TX0; x < TX1; x += 4.5) for (let z = TZ0; z < TZ1; z += 3.8) {
    if (!isFarm(x, z)) continue; const f = fieldOf(x, z); if (f.kind !== 5) continue;
    if (f.u < 4 || f.v < 4 || f.u > 91 || f.v > 66) continue;
    const ns = nearestSample(x, z, 1); if (ns && ns.d < 9) continue;
    if (orchard.length < (isMobile ? 1800 : 3200)) orchard.push([x, z, 0.8 + hash(x, z) * 0.3]);
  }
  // poplar lines along some plot edges
  for (let x = TX0; x < TX1; x += 7) for (let z = TZ0; z < TZ1; z += 7) {
    if (!isFarm(x, z)) continue; const f = fieldOf(x, z);
    if ((f.u < 3.5 || f.u > 91.5) && hash(f.cx, f.cz + 99) < 0.35) {
      const ns = nearestSample(x, z, 1); if (ns && ns.d < 10) continue;
      hedgeTrees.push([x, z, 0.9 + hash(x, z) * 0.25]);
    }
  }

  // ground colour map: fields, river banks, village and grove floors, painted tree shade
  const MAPN = isMobile ? 1024 : 2048;
  const groundMap = new BABYLON.DynamicTexture('groundMap', { width: MAPN, height: MAPN }, scene, true);
  {
    const ctx = groundMap.getContext(), id = ctx.createImageData(MAPN, MAPN), d = id.data;
    const FIELD = [[118, 140, 62], [196, 170, 88], [132, 104, 74], [96, 128, 70], [150, 160, 82], [104, 132, 64]];
    for (let py = 0; py < MAPN; py++) for (let px = 0; px < MAPN; px++) {
      const x = TX0 + (px + 0.5) / MAPN * (TX1 - TX0), z = TZ0 + (py + 0.5) / MAPN * (TZ1 - TZ0);
      const h = terrainH(x, z), n = fbm(x / 9, z / 9, 3), nn = fbm(x / 60, z / 60, 2);
      let c;
      if (h < -2.2) { const wet = smooth(-3.4, -2.4, h); c = [lerp(110, 196, wet), lerp(104, 182, wet), lerp(84, 150, wet)]; }
      else if (inGrove(x, z)) { c = [98 + n * 40, 112 + n * 34, 60 + n * 18]; if (((x - HALF + 40) % 6.5 + 6.5) % 6.5 < 1.2) c = [c[0] * 0.92, c[1] * 0.9, c[2] * 0.85]; }
      else if (inVillage(x, z)) c = [104 + n * 40, 118 + n * 30, 70 + n * 20];
      else if (Math.abs(x - riverX(z)) < 140) c = [86 + n * 40 + nn * 20, 116 + n * 30, 58 + n * 16];
      else {
        const f = fieldOf(x, z), base = FIELD[f.kind], rows = f.kind === 2 ? 0.88 + 0.12 * Math.sin(f.v * 1.6) : f.kind === 1 ? 0.94 + 0.06 * Math.sin(f.u * 2.2) : 1;
        const tint = 0.9 + 0.2 * hash(f.cx, f.cz), edge = (f.u < 1.6 || f.v < 1.6) ? 0.7 : 1;
        c = [base[0] * tint * rows * edge * (0.9 + n * 0.2), base[1] * tint * rows * edge * (0.9 + n * 0.2), base[2] * tint * rows * edge * (0.9 + n * 0.2)];
      }
      const i = ((MAPN - 1 - py) * MAPN + px) * 4;      // canvas y grows downward; v grows with z
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    // soft shade under trees, offset away from the sun
    const sx = SUN.x / -SUN.y, sz = SUN.z / -SUN.y;
    const toPx = (x, z) => [((x - TX0) / (TX1 - TX0)) * MAPN, MAPN - ((z - TZ0) / (TZ1 - TZ0)) * MAPN];
    const shade = (list, hgt, r, a) => { for (const [x, z, s] of list) { const [px, py] = toPx(x + sx * hgt * s, z + sz * hgt * s); const rr = r * s / (TX1 - TX0) * MAPN;
      const g = ctx.createRadialGradient(px, py, 0, px, py, rr); g.addColorStop(0, `rgba(10,20,5,${a})`); g.addColorStop(1, 'rgba(10,20,5,0)'); ctx.fillStyle = g; ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2); } };
    shade(groveTrees, 14, 4.2, 0.45); shade(riverTrees, 5, 5.5, 0.4); shade(hedgeTrees, 14, 3.5, 0.35); shade(orchard, 1.6, 2.4, 0.35);
    groundMap.update();
  }
  const groundMat = new BABYLON.PBRMaterial('ground', scene);
  groundMat.albedoTexture = groundMap; groundMat.metallic = 0; groundMat.roughness = 0.95;
  groundMat.bumpTexture = normalFromHeight('groundN', 256, (x, y) => fbm(x / 12, y / 12, 3), 2.0); groundMat.bumpTexture.uScale = 280; groundMat.bumpTexture.vScale = 210; groundMat.bumpTexture.level = 0.7;
  groundMat.specularIntensity = 0.3;
  groundMat.backFaceCulling = false; M.asphalt.backFaceCulling = false; M.cobble.backFaceCulling = false;
  {
    const gd = new BABYLON.DynamicTexture('groundDetail', { width: 512, height: 512 }, scene, true), c = gd.getContext(), id = c.createImageData(512, 512), d = id.data;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const blades = Math.abs(Math.sin(x * 0.9 + Math.sin(y * 0.11) * 3)) * 0.35 + fbm(x / 6, y / 30, 3) * 0.5 + hash(x, y) * 0.15, dirt = fbm(x / 40 + 9, y / 40, 3);
      const v = 0.5 + (blades - 0.5) * 0.55 - Math.max(0, dirt - 0.62) * 0.8, k = (y * 512 + x) * 4;
      d[k] = Math.max(0, Math.min(255, v * 255)); d[k + 1] = 128; d[k + 2] = 128; d[k + 3] = 255;
    }
    c.putImageData(id, 0, 0); gd.update(); gd.wrapU = gd.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE; gd.uScale = 2200; gd.vScale = 1650;
    groundMat.detailMap.texture = gd; groundMat.detailMap.isEnabled = true; groundMat.detailMap.diffuseBlendLevel = 0.55; groundMat.detailMap.bumpLevel = 0; groundMat.detailMap.roughnessBlendLevel = 0;
  }
  terrain.material = groundMat; terrain.receiveShadows = true;

  // water
  const water = BABYLON.MeshBuilder.CreateGround('water', { width: 300, height: TZ1 - TZ0 + 200 }, scene);
  water.position.y = -3.0;
  const wm = new BABYLON.PBRMaterial('waterMat', scene);
  wm.albedoColor = new C3(0.06, 0.11, 0.09); wm.metallic = 0; wm.roughness = 0.12; wm.bumpTexture = waterN; waterN.uScale = 18; waterN.vScale = 50; waterN.level = 0.35;
  wm.environmentIntensity = 0.55;
  water.material = wm; water.receiveShadows = true;
  scene.onBeforeRenderObservable.add(() => { const t = performance.now() / 1000; waterN.vOffset = t * 0.012; waterN.uOffset = Math.sin(t * 0.1) * 0.01; });

  // ---------- road ----------
  const roadMesh = (name, from, to, mat, vScale) => {
    const pos = [], nor = [], uv = [], ind = []; let k = 0;
    for (let ii = from; ii <= to; ii++) {
      const t = T[ii % N], hw = halfW(t), sh = hw + 0.9;
      const pL = [t.x + t.nx * hw, t.y, t.z + t.nz * hw], pR = [t.x - t.nx * hw, t.y, t.z - t.nz * hw];
      const sL = [t.x + t.nx * sh, t.y - (t.bridge ? 0 : 0.18), t.z + t.nz * sh], sR = [t.x - t.nx * sh, t.y - (t.bridge ? 0 : 0.18), t.z - t.nz * sh];
      const v = (ii >= N ? TRACK_LEN : t.s) / vScale;
      pos.push(...sL, ...pL, ...pR, ...sR); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); uv.push(-0.12, v, 0, v, 1, v, 1.12, v);
      if (ii > from) { for (let c = 0; c < 3; c++) { const a = (k - 1) * 4 + c, b = k * 4 + c; ind.push(a, a + 1, b, a + 1, b + 1, b); } }
      k++;
    }
    const m = new BABYLON.Mesh(name, scene), vd = new BABYLON.VertexData();
    vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = ind; vd.applyToMesh(m);      // roads are near-flat: straight-up normals
    m.material = mat; m.receiveShadows = true; return m;
  };
  // split the loop into village (cobbles) and the rest (asphalt)
  const roads = [];
  {
    let segStart = 0;
    for (let i = 1; i <= N; i++) {
      const a = T[(i - 1) % N].village, b = T[i % N].village;
      if (i === N || a !== b) { roads.push(roadMesh('road' + roads.length, segStart, i, a ? M.cobble : M.asphalt, a ? TRACK_LEN / Math.round(TRACK_LEN / 3) : TRACK_LEN / Math.round(TRACK_LEN / 12))); segStart = i; }
    }
  }
  const startLine = BABYLON.MeshBuilder.CreateGround('startLine', { width: 6.8, height: 1.2 }, scene);
  startLine.material = M.stripe; startLine.position.set(T[0].x, T[0].y + 0.02, T[0].z); startLine.rotation.y = Math.atan2(T[0].tx, T[0].tz) + Math.PI / 2;

  // ---------- instancing helper ----------
  const tmpM = new BABYLON.Matrix();
  const thin = (mesh, mats) => { const buf = new Float32Array(mats.length * 16); mats.forEach((m, i) => m.copyToArray(buf, i * 16)); mesh.thinInstanceSetBuffer('matrix', buf, 16, true); mesh.isPickable = false; return mesh; };
  // ---------- spatial chunks: instanced geometry split into 64 m tiles; the GPU only draws tiles in view, and trees switch detail by distance ----------
  const CH = 96, chunks = [];
  const thinChunked = (proto, mats, kind) => {
    const groups = new Map();
    for (const m of mats) { const k = Math.floor(m.m[12] / CH) + ',' + Math.floor(m.m[14] / CH); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    const keys = [...groups.keys()]; if (!keys.length) { proto.dispose(); return []; }
    // each tile needs its own geometry object: thin-instance buffers live on the geometry, so shared geometry would make tiles overwrite each other
    const meshes = keys.map((k, idx) => { if (!idx) return proto; const c = proto.clone(proto.name + '@' + k); c.makeGeometryUnique(); return c; });
    const ext = proto.getBoundingInfo().boundingBox;                                    // per-instance extent of the source mesh
    const r = Math.max(Math.abs(ext.minimum.x), Math.abs(ext.maximum.x), Math.abs(ext.minimum.z), Math.abs(ext.maximum.z)) * 1.4 + 1;
    keys.forEach((k, idx) => { const mesh = meshes[idx], list = groups.get(k); thin(mesh, list);
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (const m of list) { const x = m.m[12], y = m.m[13], z = m.m[14]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      mesh.setBoundingInfo(new BABYLON.BoundingInfo(new V3(x0 - r, y0 + ext.minimum.y * 1.4 - 1, z0 - r), new V3(x1 + r, y1 + ext.maximum.y * 1.4 + 1, z1 + r)));
      mesh.doNotSyncBoundingInfo = true;
      const [a, b] = k.split(',').map(Number); chunks.push({ mesh, cx: (a + 0.5) * CH, cz: (b + 0.5) * CH, kind }); });
    meshes[0].name = proto.name + '@' + keys[0];
    return meshes;
  };
  const boxMat = (sx, sy, sz, x, y, z, ry = 0, rx = 0, rz = 0) => BABYLON.Matrix.Compose(new V3(sx, sy, sz), BABYLON.Quaternion.FromEulerAngles(rx, ry, rz), new V3(x, y, z));
  const unitBox = (name, mat) => { const b = BABYLON.MeshBuilder.CreateBox(name, { size: 1 }, scene); b.material = mat; return b; };

  // ---------- bridges over the Po ----------
  const staticBoxes = [];   // physics colliders: [cx, cy, cz, hx, hy, hz, ry]
  {
    const slabs = [], piers = [], caps = [], chords = [], diags = [], verts = [];
    for (const zc of [-RAD, RAD]) {
      slabs.push(boxMat(2 * BR + 6, 1.1, 10.4, 0, DECK - 0.62, zc));
      for (let x = -BR; x <= BR + 0.1; x += 44) {
        for (const dz of [-3.2, 3.2]) piers.push(BABYLON.Matrix.Compose(new V3(2.6, (DECK - 1.2 + 8) / 2, 2.6), BABYLON.Quaternion.Identity(), new V3(x, (DECK - 1.2 - 8) / 2, zc + dz)));
        caps.push(boxMat(3.2, 1.0, 10.6, x, DECK - 1.6, zc));
      }
      for (const side of [-1, 1]) {
        const zs = zc + side * 5.0;
        chords.push(boxMat(2 * BR, 0.35, 0.35, 0, DECK + 0.25, zs), boxMat(2 * BR, 0.35, 0.35, 0, DECK + 3.6, zs));
        const panel = 5.5;
        for (let x = -BR; x < BR - 0.1; x += panel) {
          const up = Math.round((x + BR) / panel) % 2 === 0, len = Math.hypot(panel, 3.35), ang = Math.atan2(3.35, panel) * (up ? 1 : -1);
          diags.push(boxMat(len, 0.22, 0.22, x + panel / 2, DECK + 0.25 + 3.35 / 2, zs, 0, 0, ang));
          verts.push(boxMat(0.18, 3.35, 0.18, x, DECK + 1.92, zs));
        }
        staticBoxes.push([0, DECK + 0.8, zs, BR, 0.9, 0.25, 0]);
      }
    }
    thin(unitBox('deck', M.concrete), slabs); thin(BABYLON.MeshBuilder.CreateCylinder('pier', { height: 2, diameter: 1, tessellation: 16 }, scene), piers).material = M.concrete;
    thin(unitBox('pierCap', M.concrete), caps); thin(unitBox('chord', M.steel), chords); thin(unitBox('diag', M.steel), diags); thin(unitBox('vert', M.steel), verts);
    // guard rails on the ramps
    const posts = [], beams = [];
    for (const zc of [-RAD, RAD]) for (const sx of [-1, 1]) for (const side of [-1, 1]) {
      const zs = zc + side * 4.6;
      for (let ax = BR; ax <= RAMP_END; ax += 2.5) { const x = sx * ax; posts.push(boxMat(0.12, 0.9, 0.12, x, roadY(x, zc) + 0.25, zs)); }
      for (let ax = BR; ax < RAMP_END; ax += 4) {
        const x0 = sx * ax, x1 = sx * Math.min(RAMP_END, ax + 4), y0 = roadY(x0, zc), y1 = roadY(x1, zc);
        beams.push(boxMat(Math.hypot(x1 - x0, y1 - y0) + 0.05, 0.32, 0.06, (x0 + x1) / 2, (y0 + y1) / 2 + 0.6, zs + side * 0.06, 0, 0, Math.atan2(y1 - y0, x1 - x0)));
        staticBoxes.push([(x0 + x1) / 2, (y0 + y1) / 2 + 0.6, zs, 2.05, 0.7, 0.15, 0]);
      }
    }
    thin(unitBox('railPost', M.rail), posts); thin(unitBox('railBeam', M.rail), beams);
  }

  // ---------- trees ----------
  const crownMesh = (name, sub, mat, sx, sy, sz, lump) => {
    const m = BABYLON.MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: sub, flat: false }, scene);
    const p = m.getVerticesData('position');
    for (let i = 0; i < p.length; i += 3) { const k = 1 + lump * (fbm(p[i] * 2.1 + 5, p[i + 1] * 2.1 + p[i + 2] * 1.7, 3) - 0.5); p[i] *= sx * k; p[i + 1] *= sy * k; p[i + 2] *= sz * k; }
    m.setVerticesData('position', p); const n = []; BABYLON.VertexData.ComputeNormals(p, m.getIndices(), n); m.setVerticesData('normal', n);
    m.material = mat; return m;
  };
  const trunkMesh = (name, h, r0, r1) => { const m = BABYLON.MeshBuilder.CreateCylinder(name, { height: h, diameterTop: r1 * 2, diameterBottom: r0 * 2, tessellation: 7 }, scene); m.material = M.bark; return m; };
  const placeTrees = (list, parts, kind = 'far') => {
    for (const [mesh, yOff, scaleXZ] of parts) {
      const mats = list.map(([x, z, s], i) => BABYLON.Matrix.Compose(new V3(s * scaleXZ, s, s * scaleXZ), BABYLON.Quaternion.FromEulerAngles(0, hash(x, z) * 6.28, 0), new V3(x, terrainH(x, z) + yOff * s, z)));
      thinChunked(mesh, mats, kind);
    }
  };
  // ---------- trees: real branch geometry + alpha-tested leaf clusters near the road, simple crowns far away ----------
  const leafTex = (() => {
    const t = new BABYLON.DynamicTexture('leafCards', { width: 512, height: 512 }, scene, true), c = t.getContext();
    c.clearRect(0, 0, 512, 512);
    for (let k = 0; k < 170; k++) {
      const x = 40 + hash(k, 1) * 432, y = 40 + hash(k, 2) * 432, a = hash(k, 3) * 6.28, s = 13 + hash(k, 4) * 11, g = hash(k, 5);
      c.save(); c.translate(x, y); c.rotate(a);
      c.fillStyle = `rgb(${(58 + g * 60) | 0},${(98 + g * 70) | 0},${(32 + g * 30) | 0})`;
      c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(s * 0.75, -s * 0.1, 0, s * 0.95); c.quadraticCurveTo(-s * 0.75, -s * 0.1, 0, -s); c.fill();
      c.strokeStyle = 'rgba(40,60,20,0.6)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -s * 0.9); c.lineTo(0, s * 1.25); c.stroke();
      c.restore();
    }
    t.update(); t.hasAlpha = true; return t;
  })();
  const leafMat = (name, tint) => {
    const m = new BABYLON.PBRMaterial(name, scene); m.albedoTexture = leafTex; m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = 0.45; m.backFaceCulling = false; m.twoSidedLighting = true;
    m.albedoColor = tint; m.metallic = 0; m.roughness = 0.75; return m;
  };
  const LM = { poplar: leafMat('leafPoplar', new C3(1.05, 1.08, 0.85)), broad: leafMat('leafBroad', new C3(0.82, 0.92, 0.72)), orchard: leafMat('leafOrchard', new C3(0.9, 1.0, 0.75)) };
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const treeVariant = (kind, seed) => {
    const rnd = mulberry(seed), W = { p: [], n: [], u: [], i: [] }, Lf = { p: [], n: [], u: [], i: [] };
    const limb = (a, b, r0, r1) => {
      const d = b.subtract(a), len = d.length(), dir = d.scale(1 / len);
      const side = Math.abs(dir.y) < 0.95 ? V3.Cross(dir, V3.Up()).normalize() : new V3(1, 0, 0), up2 = V3.Cross(side, dir).normalize();
      const base = W.p.length / 3, seg = 6;
      for (let e = 0; e < 2; e++) for (let k = 0; k <= seg; k++) {
        const ang = k / seg * Math.PI * 2, r = e ? r1 : r0, o = side.scale(Math.cos(ang)).add(up2.scale(Math.sin(ang)));
        const p = (e ? b : a).add(o.scale(r)); W.p.push(p.x, p.y, p.z); W.n.push(o.x, o.y, o.z); W.u.push(k / seg, e * len / 2);
      }
      for (let k = 0; k < seg; k++) { const a0 = base + k, b0 = base + seg + 1 + k; W.i.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
    };
    let crownC = new V3(0, 0, 0);
    const cluster = (c, s) => {
      for (let q = 0; q < 3; q++) {
        const yaw = rnd() * Math.PI, tilt = (rnd() - 0.5) * 1.2;
        const ax = new V3(Math.cos(yaw), 0, Math.sin(yaw)), ay = new V3(-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt));
        const nrm = c.subtract(crownC).add(new V3(0, 1.2, 0)).normalize();      // volumetric shading: normals point out of the crown
        const base = Lf.p.length / 3;
        for (const [sx, sy, uu, vv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
          const p = c.add(ax.scale(sx * s)).add(ay.scale(sy * s)); Lf.p.push(p.x, p.y, p.z); Lf.n.push(nrm.x, nrm.y, nrm.z); Lf.u.push(uu, vv);
        }
        Lf.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    if (kind === 'poplar') {
      const H = 17 + rnd() * 3; crownC = new V3(0, H * 0.68, 0);
      limb(new V3(0, 0, 0), new V3(0, H * 0.55, 0), 0.24, 0.15); limb(new V3(0, H * 0.55, 0), new V3(0, H, 0), 0.15, 0.04);
      for (let h = H * 0.36; h < H * 0.97; h += 0.75) for (let b = 0; b < 2; b++) {
        const az = rnd() * 6.28, f = (h - H * 0.36) / (H * 0.62), len = 0.9 + 2.3 * Math.sin(Math.PI * Math.min(1, f * 1.05)), el = 0.95 + rnd() * 0.25;
        const a = new V3(0, h, 0), e = a.add(new V3(Math.cos(az) * Math.sin(el), Math.cos(el), Math.sin(az) * Math.sin(el)).scale(len));
        limb(a, e, 0.05, 0.015);
        cluster(e, 1.15 + rnd() * 0.45); if (len > 1.4) cluster(V3.Lerp(a, e, 0.55), 0.95);
      }
      cluster(new V3(0, H + 0.4, 0), 0.9);
    } else if (kind === 'broad') {
      const T0 = 2.4 + rnd() * 1.2; crownC = new V3(0, T0 + 3.5, 0);
      limb(new V3(0, 0, 0), new V3(0, T0, 0), 0.34, 0.26);
      const nL = 4 + Math.floor(rnd() * 2);
      for (let l = 0; l < nL; l++) {
        const az = l / nL * 6.28 + rnd() * 0.6, el = 0.45 + rnd() * 0.45, len = 3 + rnd() * 1.5;
        const a = new V3(0, T0, 0), e = a.add(new V3(Math.cos(az) * Math.sin(el), Math.cos(el), Math.sin(az) * Math.sin(el)).scale(len));
        limb(a, e, 0.2, 0.09);
        for (let s = 0; s < 3; s++) {
          const az2 = az + (rnd() - 0.5) * 1.6, el2 = 0.3 + rnd() * 0.8, l2 = 1.6 + rnd() * 1.6, a2 = V3.Lerp(a, e, 0.55 + s * 0.2);
          const e2 = a2.add(new V3(Math.cos(az2) * Math.sin(el2), Math.cos(el2), Math.sin(az2) * Math.sin(el2)).scale(l2));
          limb(a2, e2, 0.08, 0.025);
          cluster(e2, 1.0 + rnd() * 0.4); cluster(V3.Lerp(a2, e2, 0.5), 0.85);
        }
        cluster(e, 1.1);
      }
    } else {
      crownC = new V3(0, 1.9, 0); limb(new V3(0, 0, 0), new V3(0, 1.1, 0), 0.09, 0.07);
      for (let l = 0; l < 4; l++) { const az = l * 1.57 + rnd() * 0.5, e = new V3(Math.cos(az) * 0.9, 2.0 + rnd() * 0.4, Math.sin(az) * 0.9); limb(new V3(0, 1.1, 0), e, 0.06, 0.02); cluster(e, 0.6); cluster(V3.Lerp(new V3(0, 1.1, 0), e, 0.6), 0.5); }
    }
    const mk = (name, g, mat) => { const m = new BABYLON.Mesh(name, scene), vd = new BABYLON.VertexData(); vd.positions = g.p; vd.normals = g.n; vd.uvs = g.u; vd.indices = g.i; vd.applyToMesh(m); m.material = mat; return m; };
    return [mk(kind + 'Wood' + seed, W, M.bark), mk(kind + 'Leaves' + seed, Lf, LM[kind])];
  };
  const instanceTrees = (list, kind, variants) => {
    const vs = []; for (let v = 0; v < variants; v++) vs.push({ meshes: treeVariant(kind, 11 + v * 7 + kind.length), mats: [] });
    list.forEach(([x, z, s], i) => vs[i % variants].mats.push(BABYLON.Matrix.Compose(new V3(s, s, s), BABYLON.Quaternion.FromEulerAngles(0, hash(x, z) * 6.28, 0), new V3(x, terrainH(x, z) - 0.05, z))));
    const out = [];
    vs.forEach((v) => v.meshes.forEach((m) => { if (v.mats.length) out.push(...thinChunked(m, v.mats, 'near')); else m.dispose(); }));
    return out;
  };
  const nearRoad = (x, z, r) => { const ns = nearestSample(x, z, Math.ceil(r / GRID) + 1); return ns && ns.d < r; };
  const split = (list, r) => { const near = [], far = []; for (const t of list) (nearRoad(t[0], t[1], r) ? near : far).push(t); return [near, far]; };
  const [groveNear, groveFar] = split(groveTrees, 70), [rivNear, rivFar] = split(riverTrees, 80), [hedgeNear, hedgeFar] = split(hedgeTrees, 70), [orchNear, orchFar] = split(orchard, 60);
  // every tree exists twice: full branches and leaves (drawn near the camera) and a light crown (drawn beyond ~115 m)
  const detailed = [...instanceTrees(groveTrees, 'poplar', 3), ...instanceTrees(hedgeTrees, 'poplar', 2), ...instanceTrees(riverTrees, 'broad', 3), ...instanceTrees(orchard, 'orchard', 2)];
  // distant trees keep light-weight crowns
  placeTrees(groveTrees, [[trunkMesh('poplarTrunk', 16, 0.19, 0.09), 8, 1], [crownMesh('poplarCrown', 1, M.leafLight, 2.6, 6.5, 2.6, 0.35), 16, 1]]);
  placeTrees(hedgeTrees, [[trunkMesh('hedgeTrunk', 12, 0.18, 0.08), 6, 1], [crownMesh('hedgeCrown', 1, M.leaf, 2.1, 7.5, 2.1, 0.3), 13, 1]]);
  placeTrees(riverTrees, [[trunkMesh('rivTrunkA', 4, 0.28, 0.18), 2, 1], [crownMesh('rivCrownA', 2, M.leafDark, 4.2, 3.6, 4.2, 0.55), 6.2, 1]]);
  placeTrees(orchard, [[trunkMesh('orchTrunk', 1.2, 0.09, 0.07), 0.6, 1], [crownMesh('orchCrown', 1, M.leafDark, 1.5, 1.3, 1.5, 0.45), 1.9, 1]]);
  for (const [x, z] of groveTrees) { const ns = nearestSample(x, z, 1); if (ns && ns.d < 16) staticBoxes.push([x, terrainH(x, z) + 1.5, z, 0.25, 1.5, 0.25, 0]); }
  for (const [x, z] of riverTrees) { const ns = nearestSample(x, z, 1); if (ns && ns.d < 16) staticBoxes.push([x, terrainH(x, z) + 1.5, z, 0.35, 1.5, 0.35, 0]); }

  const piazzaTrees = [], detailedVillage = [];
  // ---------- village: modelled buildings (openings with reveals, sills, cornices, real roofs, arcades, balconies, tower) ----------
  {
    const BUF = {};
    let vChunk = '0,0';                                              // geometry is bucketed per 64 m tile so off-screen houses are culled
    const BUFL = {}; let useLod = false;                             // BUFL: low-detail stand-ins for distant views
    const buf = (mat) => { const B = useLod ? BUFL : BUF, k = mat + '|' + vChunk; return B[k] || (B[k] = { p: [], n: [], u: [], c: [], i: [] }); };
    const UP = new V3(0, 1, 0);
    // planar polygon (3 or 4 points, any winding); normal forced toward `out`; UVs world-scaled on the polygon plane
    const poly = (mat, pts, out, col = [1, 1, 1], uvS = 2) => {
      const g = buf(mat); let n = V3.Cross(pts[1].subtract(pts[0]), pts[2].subtract(pts[0])).normalize();
      if (V3.Dot(n, out) < 0) { pts = pts.slice().reverse(); n = n.scale(-1); }
      const tu = Math.abs(n.y) > 0.9 ? new V3(1, 0, 0) : V3.Cross(UP, n).normalize(), tv = V3.Cross(n, tu);
      const base = g.p.length / 3;
      for (const p of pts) { g.p.push(p.x, p.y, p.z); g.n.push(n.x, n.y, n.z); g.u.push(V3.Dot(p, tu) / uvS, V3.Dot(p, tv) / uvS); g.c.push(col[0], col[1], col[2], 1); }
      for (let k = 1; k < pts.length - 1; k++) g.i.push(base, base + k + 1, base + k);
    };
    // oriented box: centre c, half sizes along frame axes ax (along wall), ay (up), az (out)
    const obox = (mat, c, ax, ay, az, hx, hy, hz, col) => {
      const P = (sx, sy, sz) => c.add(ax.scale(sx * hx)).add(ay.scale(sy * hy)).add(az.scale(sz * hz));
      const F = [[az, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [az.scale(-1), [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]]],
                 [ax, [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]]], [ax.scale(-1), [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
                 [ay, [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]], [ay.scale(-1), [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]];
      for (const [o, q] of F) poly(mat, q.map(([a, b, d]) => P(a, b, d)), o, col, 1);
    };
    const arcPts = (cx, y0, r, n = 10) => { const a = []; for (let k = 0; k <= n; k++) { const t = Math.PI * (1 - k / n); a.push([cx + Math.cos(t) * r, y0 + Math.sin(t) * r]); } return a; };
    // a wall plane with rectangular openings (optionally arched) cut through it, with reveals and recessed glass/doors
    const wall = (mat, col, o, ax, outN, w, h, holes) => {
      const at = (x, y, d = 0) => o.add(ax.scale(x)).add(UP.scale(y)).add(outN.scale(-d));
      const xs = [0, w], ys = [0, h];
      holes.forEach((hl) => { xs.push(hl.x0, hl.x1); ys.push(hl.y0, hl.top); });
      const X = [...new Set(xs.map((v) => +v.toFixed(4)))].sort((a, b) => a - b), Y = [...new Set(ys.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
      for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < Y.length - 1; j++) {
        const mx = (X[i] + X[i + 1]) / 2, my = (Y[j] + Y[j + 1]) / 2;
        if (holes.some((hl) => mx > hl.x0 && mx < hl.x1 && my > hl.y0 && my < hl.top)) continue;
        poly(mat, [at(X[i], Y[j]), at(X[i + 1], Y[j]), at(X[i + 1], Y[j + 1]), at(X[i], Y[j + 1])], outN, col);
      }
      for (const hl of holes) {
        const d = hl.depth || 0.24, y1 = hl.arch ? hl.top - (hl.x1 - hl.x0) / 2 : hl.top;
        poly(mat, [at(hl.x0, hl.y0), at(hl.x0, hl.y0, d), at(hl.x0, y1, d), at(hl.x0, y1)], ax, col);
        poly(mat, [at(hl.x1, hl.y0), at(hl.x1, hl.y0, d), at(hl.x1, y1, d), at(hl.x1, y1)], ax.scale(-1), col);
        poly(mat, [at(hl.x0, hl.y0), at(hl.x1, hl.y0), at(hl.x1, hl.y0, d), at(hl.x0, hl.y0, d)], UP, col);
        if (hl.arch) {
          const r = (hl.x1 - hl.x0) / 2, a = arcPts(hl.x0 + r, y1, r);
          for (let k = 0; k < a.length - 1; k++) {           // spandrel up to the opening's rectangle top, and the arch soffit
            poly(mat, [at(a[k][0], a[k][1]), at(a[k + 1][0], a[k + 1][1]), at(a[k + 1][0], hl.top), at(a[k][0], hl.top)], outN, col);
            const mid = (a[k][0] + a[k + 1][0]) / 2 - (hl.x0 + r), dn = ax.scale(-mid).add(UP.scale(-((a[k][1] + a[k + 1][1]) / 2 - y1))).normalize();
            poly(mat, [at(a[k][0], a[k][1]), at(a[k + 1][0], a[k + 1][1]), at(a[k + 1][0], a[k + 1][1], d), at(a[k][0], a[k][1], d)], dn, col);
          }
          const back = [at(hl.x0, hl.y0, d), at(hl.x1, hl.y0, d)]; a.slice().reverse().forEach(([x, y]) => back.push(at(x, y, d)));
          const fc = hl.fill === 'wood' ? [0.34, 0.21, 0.12] : [1, 1, 1];
          for (let k = 1; k < back.length - 1; k++) poly(hl.fill, [back[0], back[k], back[k + 1]], outN, fc, 1);
          // brick arch ring
          for (let k = 0; k < a.length - 1; k++) {
            const p0 = a[k], p1 = a[k + 1], cxr = hl.x0 + r, e0 = [cxr + (p0[0] - cxr) * 1.16, y1 + (p0[1] - y1) * 1.16], e1 = [cxr + (p1[0] - cxr) * 1.16, y1 + (p1[1] - y1) * 1.16];
            poly('trim', [at(p0[0], p0[1], -0.03), at(p1[0], p1[1], -0.03), at(e1[0], e1[1], -0.03), at(e0[0], e0[1], -0.03)], outN, [0.95, 0.9, 0.82]);
          }
        } else {
          poly(mat, [at(hl.x0, hl.top), at(hl.x1, hl.top), at(hl.x1, hl.top, d), at(hl.x0, hl.top, d)], UP.scale(-1), col);
          poly(hl.fill, [at(hl.x0, hl.y0, d), at(hl.x1, hl.y0, d), at(hl.x1, hl.top, d), at(hl.x0, hl.top, d)], outN, hl.fill === 'wood' ? [0.34, 0.21, 0.12] : [1, 1, 1], 1);
          if (hl.fill === 'glassDark') {   // glazing bars
            obox('wood', at((hl.x0 + hl.x1) / 2, (hl.y0 + hl.top) / 2, d - 0.02), ax, UP, outN, 0.025, (hl.top - hl.y0) / 2, 0.02, [0.92, 0.9, 0.85]);
            obox('wood', at((hl.x0 + hl.x1) / 2, hl.y0 + (hl.top - hl.y0) * 0.62, d - 0.02), ax, UP, outN, (hl.x1 - hl.x0) / 2, 0.025, 0.02, [0.92, 0.9, 0.85]);
          }
        }
        if (hl.sill) obox('trim', at((hl.x0 + hl.x1) / 2, hl.y0 - 0.05, -0.05), ax, UP, outN, (hl.x1 - hl.x0) / 2 + 0.1, 0.05, 0.08, [0.93, 0.9, 0.84]);
        if (hl.shutters) for (const s of [-1, 1]) {
          const cxw = s < 0 ? hl.x0 - 0.3 : hl.x1 + 0.3;
          obox('wood', at(cxw, (hl.y0 + hl.top) / 2, -0.04), ax, UP, outN, 0.28, (hl.top - hl.y0) / 2 + 0.03, 0.03, hl.shutterCol);
          for (let k = 1; k < 7; k++) obox('wood', at(cxw, hl.y0 + (hl.top - hl.y0) * k / 7, -0.075), ax, UP, outN, 0.26, 0.012, 0.01, hl.shutterCol.map((v) => v * 0.7));
        }
      }
    };
    const SHUTTERS = [[0.20, 0.33, 0.20], [0.42, 0.24, 0.14], [0.55, 0.52, 0.42]];
    const PLASTER = [[1.0, 0.86, 0.62], [1.0, 0.93, 0.80], [0.98, 0.76, 0.62], [0.95, 0.88, 0.70]];
    const house = (cx, cz, ry, w, d, floors, kind, front, opts = {}) => {
      vChunk = Math.floor(cx / CH) + ',' + Math.floor(cz / CH);
      const ax = new V3(Math.cos(ry), 0, -Math.sin(ry)), az = new V3(Math.sin(ry), 0, Math.cos(ry));   // along street, depth
      const gy = terrainH(cx, cz) - 0.3, fh = 3.25, H = floors * fh + 0.5, c0 = new V3(cx, gy, cz);
      const mat = kind, col = kind === 'brick' ? [1, 1, 1] : PLASTER[Math.floor(hash(cx, cz) * PLASTER.length)];
      const shutterCol = SHUTTERS[Math.floor(hash(cz, cx) * SHUTTERS.length)], arcade = !!opts.arcade;
      const faces = [[az, ax, w, d], [az.scale(-1), ax.scale(-1), w, d], [ax, az.scale(-1), d, w], [ax.scale(-1), az, d, w]];
      faces.forEach(([outN, along, fw, fd], fi) => {
        const o = c0.add(outN.scale(fd / 2)).subtract(along.scale(fw / 2));
        const holes = [], isFront = fi === (front > 0 ? 0 : 1), isLong = fi < 2;
        const nWin = isLong ? Math.max(1, Math.floor(fw / 2.7)) : (fw > 9 ? 2 : 1);
        for (let f = 0; f < floors; f++) for (let k = 0; k < nWin; k++) {
          const xc = (k + 0.5) / nWin * fw, y0 = f * fh + (f === 0 ? 0.0 : 0.95) + 0.3;
          if (f === 0 && isFront) {
            if (arcade) holes.push({ x0: xc - 1.05, x1: xc + 1.05, y0: 0.3, top: 3.1, arch: true, fill: 'glassDark', depth: 0.6 });
            else if (k === Math.floor(nWin / 2)) holes.push({ x0: xc - 0.65, x1: xc + 0.65, y0: 0.3, top: 2.75, arch: hash(cx, k) < 0.5, fill: 'wood', depth: 0.3 });
            else holes.push({ x0: xc - 0.5, x1: xc + 0.5, y0: 1.1, top: 2.5, fill: 'glassDark', sill: true, shutters: true, shutterCol });
          } else if (f === 0 && !isLong) continue;
          else holes.push({ x0: xc - 0.52, x1: xc + 0.52, y0, top: y0 + 1.6, fill: 'glassDark', sill: true, shutters: kind !== 'brick' || hash(k, cx) < 0.5, shutterCol, arch: kind === 'brick' && hash(cz, f) < 0.3 });
        }
        wall(mat, col, o, along, outN, fw, H, holes);
        // details: flower boxes, shop awnings, door lanterns, gutters and downpipes
        for (const hl of holes) {
          const cxh = (hl.x0 + hl.x1) / 2, at2 = (x, y, dd) => o.add(along.scale(x)).add(UP.scale(y)).add(outN.scale(dd));
          if (hl.sill && hl.y0 > 2 && hash(cxh + cx, hl.y0 + cz) < 0.38) {
            obox('wood', at2(cxh, hl.y0 + 0.02, 0.17), along, UP, outN, (hl.x1 - hl.x0) / 2 + 0.05, 0.1, 0.1, [0.42, 0.26, 0.15]);
            for (let k = 0; k < 7; k++) { const fx = hl.x0 + (k + 0.5) / 7 * (hl.x1 - hl.x0), hc = hash(k + cxh, cz + hl.y0);
              obox('flowers', at2(fx, hl.y0 + 0.17 + hc * 0.06, 0.17 + (hc - 0.5) * 0.08), along, UP, outN, 0.075, 0.07, 0.075, hc < 0.5 ? [0.85, 0.08, 0.12] : hc < 0.8 ? [0.95, 0.45, 0.65] : [0.95, 0.95, 0.9]);
              obox('flowers', at2(fx + 0.05, hl.y0 + 0.12, 0.2), along, UP, outN, 0.07, 0.05, 0.07, [0.25, 0.45, 0.15]); }
          }
          if (isFront && hl.y0 > 0.9 && hl.y0 < 1.5 && kind === 'plaster' && hash(cxh, cx) < 0.6) {      // striped awning over a ground-floor window
            const y0a = hl.top + 0.35, ww = (hl.x1 - hl.x0) / 2 + 0.25;
            poly('awning', [at2(cxh - ww, y0a, 0), at2(cxh + ww, y0a, 0), at2(cxh + ww, y0a - 0.45, 0.95), at2(cxh - ww, y0a - 0.45, 0.95)], UP.add(outN).normalize(), [1, 1, 1], 0.5);
            poly('awning', [at2(cxh - ww, y0a - 0.45, 0.95), at2(cxh + ww, y0a - 0.45, 0.95), at2(cxh + ww, y0a - 0.68, 0.95), at2(cxh - ww, y0a - 0.68, 0.95)], outN, [1, 1, 1], 0.5);
          }
          if (hl.fill === 'wood') {                                                                      // lantern beside the door
            obox('metal', at2(hl.x1 + 0.35, hl.top - 0.1, 0.12), along, UP, outN, 0.1, 0.16, 0.1, [0.15, 0.15, 0.15]);
            obox('lampGlass', at2(hl.x1 + 0.35, hl.top - 0.1, 0.12), along, UP, outN, 0.075, 0.12, 0.075, [1, 1, 1]);
          }
        }
        if (isLong && !opts.flat) {
          obox('copper', c0.add(outN.scale(fd / 2)).add(UP.scale(H - 0.2)).add(outN.scale(0.62)), along, UP, outN, fw / 2 + 0.3, 0.06, 0.06, [0.75, 0.48, 0.32]);
          for (const sx of [-1, 1]) obox('copper', c0.add(outN.scale(fd / 2)).add(along.scale(sx * (fw / 2 - 0.25))).add(UP.scale(H / 2)).add(outN.scale(0.1)), along, UP, outN, 0.045, H / 2, 0.045, [0.75, 0.48, 0.32]);
        }
        // plinth, string courses, eaves cornice
        const mid = c0.add(outN.scale(fd / 2));
        obox('trim', mid.add(UP.scale(0.32)), along, UP, outN, fw / 2 + 0.04, 0.32, 0.04, [0.8, 0.78, 0.72]);
        for (let f = 1; f < floors; f++) obox('trim', mid.add(UP.scale(f * fh + 0.3)), along, UP, outN, fw / 2, 0.07, 0.05, [0.93, 0.9, 0.84]);
        obox('trim', mid.add(UP.scale(H - 0.15)), along, UP, outN, fw / 2 + 0.06, 0.15, 0.08, [0.93, 0.9, 0.84]);
        obox('trim', mid.add(UP.scale(H - 0.02)), along, UP, outN, fw / 2 + 0.14, 0.06, 0.16, [0.93, 0.9, 0.84]);
        if (isFront && !arcade && floors > 1 && hash(cx, cz * 3) < 0.4) {          // balcony on the first floor
          const xb = fw / 2;
          obox('trim', o.add(along.scale(xb)).add(UP.scale(fh + 1.12)).add(outN.scale(0.45)), along, UP, outN, 1.0, 0.07, 0.45, [0.9, 0.88, 0.82]);
          for (let b = -9; b <= 9; b++) obox('metal', o.add(along.scale(xb + b * 0.1)).add(UP.scale(fh + 1.62)).add(outN.scale(0.86)), along, UP, outN, 0.012, 0.45, 0.012, [0.2, 0.2, 0.2]);
          obox('metal', o.add(along.scale(xb)).add(UP.scale(fh + 2.1)).add(outN.scale(0.86)), along, UP, outN, 1.0, 0.025, 0.025, [0.2, 0.2, 0.2]);
        }
      });
      // roof
      const top = c0.add(UP.scale(H)), ov = 0.55, oe = 0.32, pitch = 0.40, rise = Math.tan(pitch) * (d / 2 + ov);
      const ridgeY = H + rise, hip = !!opts.hip, ridgeHalf = hip ? Math.max(0.6, w / 2 - d / 2) : w / 2 + oe;
      const R = (sx, sz, y) => c0.add(ax.scale(sx)).add(az.scale(sz)).add(UP.scale(y));
      const eaveY = H - 0.05;
      if (opts.flat) {
        poly('trim', [R(-w / 2, -d / 2, H + 0.05), R(w / 2, -d / 2, H + 0.05), R(w / 2, d / 2, H + 0.05), R(-w / 2, d / 2, H + 0.05)], UP, [0.7, 0.66, 0.6]);
        for (let s = -1; s <= 1; s += 2) for (let x = -w / 2 + 0.4; x < w / 2; x += 1.1) obox(mat, R(x, s * (d / 2 - 0.2), H + 0.45), ax, UP, az, 0.3, 0.45, 0.2, col);
        for (let s = -1; s <= 1; s += 2) for (let z = -d / 2 + 0.4; z < d / 2; z += 1.1) obox(mat, R(s * (w / 2 - 0.2), z, H + 0.45), ax, UP, az, 0.2, 0.45, 0.3, col);
      } else {
        for (const s of [-1, 1]) {
          const out = az.scale(s).add(UP.scale(1.6)).normalize();
          poly('roof', [R(-w / 2 - oe, s * (d / 2 + ov), eaveY), R(w / 2 + oe, s * (d / 2 + ov), eaveY), R(ridgeHalf, 0, eaveY + rise), R(-ridgeHalf, 0, eaveY + rise)], out, [1, 1, 1], 1.2);
          poly('trim', [R(-w / 2 - oe, s * (d / 2 + ov), eaveY - 0.14), R(w / 2 + oe, s * (d / 2 + ov), eaveY - 0.14), R(w / 2 + oe, s * (d / 2 + ov), eaveY), R(-w / 2 - oe, s * (d / 2 + ov), eaveY)], az.scale(s), [0.55, 0.36, 0.25]);
          poly('trim', [R(-w / 2 - oe, s * (d / 2 + ov), eaveY - 0.14), R(w / 2 + oe, s * (d / 2 + ov), eaveY - 0.14), R(w / 2, s * d / 2, eaveY - 0.14), R(-w / 2, s * d / 2, eaveY - 0.14)], UP.scale(-1), [0.85, 0.82, 0.76]);
        }
        for (const s of [-1, 1]) {
          if (hip) poly('roof', [R(s * (w / 2 + oe), -(d / 2 + ov), eaveY), R(s * (w / 2 + oe), d / 2 + ov, eaveY), R(s * ridgeHalf, 0, eaveY + rise)], ax.scale(s).add(UP.scale(1.6)).normalize(), [1, 1, 1], 1.2);
          else {
            const yw = eaveY + Math.tan(pitch) * ov;      // roof underside height at the wall plane
            poly(mat, [R(s * w / 2, -d / 2, H), R(s * w / 2, d / 2, H), R(s * w / 2, d / 2, yw), R(s * w / 2, 0, yw + Math.tan(pitch) * d / 2), R(s * w / 2, -d / 2, yw)], ax.scale(s), col);
            poly('roof', [R(s * (w / 2 + oe), -(d / 2 + ov), eaveY), R(s * (w / 2 + oe), 0, eaveY + rise), R(s * (w / 2 + oe), 0, eaveY + rise - 0.14), R(s * (w / 2 + oe), -(d / 2 + ov), eaveY - 0.14)], ax.scale(s), [0.8, 0.6, 0.5], 1);
            poly('roof', [R(s * (w / 2 + oe), d / 2 + ov, eaveY), R(s * (w / 2 + oe), 0, eaveY + rise), R(s * (w / 2 + oe), 0, eaveY + rise - 0.14), R(s * (w / 2 + oe), d / 2 + ov, eaveY - 0.14)], ax.scale(s), [0.8, 0.6, 0.5], 1);
          }
        }
        obox('roof', R(0, 0, eaveY + rise + 0.05), ax, UP, az, ridgeHalf + (hip ? 0 : 0.02), 0.09, 0.14, [0.85, 0.62, 0.5]);
        // chimney
        const chx = (hash(cx, 9) - 0.5) * w * 0.6, chz = (hash(cz, 9) - 0.5) * d * 0.4, chB = eaveY + rise * (1 - Math.abs(chz) / (d / 2 + ov));
        obox('brick', R(chx, chz, chB + 0.6), ax, UP, az, 0.32, 0.9, 0.32, [1, 1, 1]);
        obox('trim', R(chx, chz, chB + 1.55), ax, UP, az, 0.45, 0.06, 0.45, [0.9, 0.88, 0.82]);
        obox('roof', R(chx, chz, chB + 1.75), ax, UP, az, 0.38, 0.05, 0.38, [0.9, 0.7, 0.6]);
      }
      staticBoxes.push([cx, gy + H / 2, cz, w / 2, H / 2, d / 2, ry]);
      useLod = true;
      obox(mat, c0.add(UP.scale(H / 2)), ax, UP, az, w / 2, H / 2, d / 2, col);
      if (opts.flat) obox(mat, c0.add(UP.scale(H + 0.45)), ax, UP, az, w / 2, 0.45, d / 2, col);
      else {
        const rr = Math.tan(pitch) * (d / 2 + ov), L = (sx, sz, y) => c0.add(ax.scale(sx)).add(az.scale(sz)).add(UP.scale(y));
        for (const sd of [-1, 1]) {
          poly('roof', [L(-w / 2 - oe, sd * (d / 2 + ov), H - 0.05), L(w / 2 + oe, sd * (d / 2 + ov), H - 0.05), L(w / 2 + oe, 0, H - 0.05 + rr), L(-w / 2 - oe, 0, H - 0.05 + rr)], az.scale(sd).add(UP.scale(1.6)).normalize(), [1, 1, 1], 1.2);
          poly(mat, [L(sd * w / 2, -d / 2, H), L(sd * w / 2, d / 2, H), L(sd * w / 2, 0, H - 0.05 + rr)], ax.scale(sd), col);
        }
      }
      useLod = false;
    };
    // line both sides of the village road
    const vIdx = T.map((t, i) => i).filter((i) => T[i].village);
    for (const side of [-1, 1]) {
      let i = 0;
      while (i < vIdx.length) {
        const t = T[vIdx[i]];
        const w = 7 + hash(i, side) * 6, d = 8.5 + hash(side, i) * 2.5, floors = 2 + (hash(i * 3, side) < 0.45 ? 1 : 0);
        const atStart = t.s < 34 || TRACK_LEN - t.s < 34;
        if (side === -1 && atStart) { i += 3; continue; }       // piazza on the inside of the bend
        const off = halfW(t) + 2.8 + d / 2, cx = t.x + t.nx * side * off, cz = t.z + t.nz * side * off;
        const ry = Math.atan2(t.tx, t.tz) + Math.PI / 2;
        const kind = hash(i, side * 7) < 0.55 ? 'brick' : 'plaster';
        house(cx, cz, ry, w, d, floors, kind, side, { arcade: kind === 'brick' && hash(i, 31) < 0.3, hip: hash(i, 41) < 0.3 });
        i += Math.max(1, Math.round((w + 0.3 + (hash(i, 5) < 0.15 ? 5 : 0)) / stepLen));
      }
    }
    // piazza: paving, crenellated hall and bell tower (after the castle-like buildings in the photos)
    const t0 = T[0], back = -(halfW(t0) + 24), px = t0.x + t0.nx * back, pz = t0.z + t0.nz * back, pg = terrainH(px, pz) + 0.21;
    const along = new V3(t0.tx, 0, t0.tz), outward = new V3(-t0.nx, 0, -t0.nz);
    {
      const q = (a, b) => px + along.x * a + outward.x * b, r = (a, b) => pz + along.z * a + outward.z * b;
      const g = buf('cobblePlaza'), base = 0;
      for (const [a, b] of [[-26, -21], [26, -21], [26, 4], [-26, 4]]) { g.p.push(q(a, b), pg - 0.02, r(a, b)); g.n.push(0, 1, 0); g.u.push(a / 3, b / 3); g.c.push(1, 1, 1, 1); }
      g.i.push(0, 2, 1, 0, 3, 2);
    }
    const ryH = Math.atan2(t0.tx, t0.tz) + Math.PI / 2;
    {
      const tx = px + outward.x * 6 + along.x * 10, tz = pz + outward.z * 6 + along.z * 10, ty = terrainH(tx, tz) - 0.3, s = 2.4, Ht = 22;
      const ax = new V3(1, 0, 0), az = new V3(0, 0, 1);
      for (const [outN, al] of [[az, ax], [az.scale(-1), ax.scale(-1)], [ax, az.scale(-1)], [ax.scale(-1), az]]) {
        const o = new V3(tx, ty, tz).add(outN.scale(s)).subtract(al.scale(s));
        wall('brick', [1, 1, 1], o, al, outN, 2 * s, Ht, [{ x0: s - 0.18, x1: s + 0.18, y0: 7, top: 8.4, fill: 'glassDark', depth: 0.4 },
          { x0: s - 0.18, x1: s + 0.18, y0: 12, top: 13.4, fill: 'glassDark', depth: 0.4 }, { x0: s - 0.7, x1: s + 0.7, y0: 16.6, top: 19.4, arch: true, fill: 'glassDark', depth: 0.9 }]);
        const mid = new V3(tx, ty, tz).add(outN.scale(s));
        obox('trim', mid.add(UP.scale(16.2)), al, UP, outN, s + 0.05, 0.12, 0.08, [0.93, 0.9, 0.84]);
        obox('brick', mid.add(UP.scale(Ht + 0.15)), al, UP, outN, s + 0.25, 0.25, 0.25, [1, 1, 1]);
        for (let k = -2; k <= 2; k++) obox('brick', mid.add(al.scale(k * 0.95)).add(UP.scale(Ht + 0.85)).add(outN.scale(0.1)), al, UP, outN, 0.28, 0.45, 0.18, [1, 1, 1]);
      }
      poly('trim', [new V3(tx - s, ty + Ht + 0.4, tz - s), new V3(tx + s, ty + Ht + 0.4, tz - s), new V3(tx + s, ty + Ht + 0.4, tz + s), new V3(tx - s, ty + Ht + 0.4, tz + s)], UP, [0.6, 0.55, 0.5]);
      const hb = 1.6; obox('brick', new V3(tx, ty + Ht + 1.6, tz), ax, UP, az, hb, 1.2, hb, [1, 1, 1]);
      for (const [a, b, c, d] of [[[-hb, -hb], [hb, -hb], [0, 0], az.scale(-1)], [[hb, -hb], [hb, hb], [0, 0], ax], [[hb, hb], [-hb, hb], [0, 0], az], [[-hb, hb], [-hb, -hb], [0, 0], ax.scale(-1)]])
        poly('roof', [new V3(tx + a[0], ty + Ht + 2.8, tz + a[1]), new V3(tx + b[0], ty + Ht + 2.8, tz + b[1]), new V3(tx, ty + Ht + 5.2, tz)], d.add(UP).normalize(), [1, 1, 1], 1.2);
      staticBoxes.push([tx, ty + Ht / 2, tz, s, Ht / 2, s, 0]);
      const bell = BABYLON.MeshBuilder.CreateCylinder('churchBell', { height: 1.0, diameterTop: 0.45, diameterBottom: 1.15, tessellation: 20 }, scene);
      bell.material = pbr('bronze', new C3(0.62, 0.42, 0.22), 0.35, { metal: 1 }); bell.position.set(tx, ty + 17.4, tz);
      const yoke = BABYLON.MeshBuilder.CreateBox('bellYoke', { width: 1.6, height: 0.16, depth: 0.16 }, scene); yoke.material = M.wood; yoke.position.set(tx, ty + 18.0, tz);
    }
    const hayMat = pbr('hay', new C3(0.86, 0.72, 0.42), 0.95, { tex: tex.plaster, bump: grainN, bumpLevel: 1.5 });
    vChunk = 'landmark';
    // ---------- church on the piazza: brick facade with pediment, arched portal, rose window, pilasters, nave windows, apse ----------
    {
      const az = outward, ax = new V3(az.z, 0, -az.x);                 // az: nave axis (away from the road), ax: across
      const cc = new V3(px + az.x * 18 - along.x * 9, 0, pz + az.z * 18 - along.z * 9), gy = terrainH(cc.x, cc.z) - 0.3, c0 = new V3(cc.x, gy, cc.z);
      const Wn = 12, Ln = 22, Hn = 11.5, col = [1, 1, 1];
      const at = (x, y, z) => c0.add(ax.scale(x)).add(UP.scale(y)).add(az.scale(z));
      // facade (faces the piazza, i.e. -az)
      wall('brick', col, at(Wn / 2, 0, -Ln / 2), ax.scale(-1), az.scale(-1), Wn, Hn, [
        { x0: Wn / 2 - 1.6, x1: Wn / 2 + 1.6, y0: 0.4, top: 5.6, arch: true, fill: 'wood', depth: 0.7 },
        { x0: 1.4, x1: 2.6, y0: 3.2, top: 6.4, arch: true, fill: 'glassDark', depth: 0.4 }, { x0: Wn - 2.6, x1: Wn - 1.4, y0: 3.2, top: 6.4, arch: true, fill: 'glassDark', depth: 0.4 }]);
      for (const sd of [-1, 1]) {
        wall('brick', col, at(sd * Wn / 2, 0, sd > 0 ? -Ln / 2 : Ln / 2), az.scale(sd), ax.scale(sd), Ln, Hn,
          [0, 1, 2, 3].map((k) => ({ x0: 3 + k * 5, x1: 4.4 + k * 5, y0: 4.2, top: 9.2, arch: true, fill: 'glassDark', depth: 0.5, sill: true })));
        for (let k = 0; k <= 4; k++) obox('trim', at(sd * (Wn / 2 + 0.12), Hn / 2, -Ln / 2 + 0.5 + k * 5.25), az, UP, ax.scale(sd), 0.28, Hn / 2, 0.12, [0.92, 0.88, 0.8]);
      }
      wall('brick', col, at(-Wn / 2, 0, Ln / 2), ax, az, Wn, Hn, []);
      // pediment, pilasters, cornices, steps
      const ped = Math.tan(0.5) * (Wn / 2 + 0.6);
      poly('brick', [at(-Wn / 2, Hn, -Ln / 2), at(Wn / 2, Hn, -Ln / 2), at(0, Hn + ped - 0.4, -Ln / 2)], az.scale(-1), col);
      for (const x of [-Wn / 2 + 0.3, -1.9, 1.9, Wn / 2 - 0.3]) obox('trim', at(x, Hn / 2, -Ln / 2 - 0.15), ax, UP, az.scale(-1), 0.3, Hn / 2, 0.15, [0.95, 0.92, 0.85]);
      obox('trim', at(0, Hn + 0.12, -Ln / 2 - 0.2), ax, UP, az.scale(-1), Wn / 2 + 0.4, 0.15, 0.25, [0.95, 0.92, 0.85]);
      for (const sd of [-1, 1]) {
        const a = at(sd * (Wn / 2 + 0.6), Hn + 0.2, -Ln / 2 - 0.2), b = at(0, Hn + ped, -Ln / 2 - 0.2), dir = b.subtract(a), len = dir.length(), dn = dir.scale(1 / len);
        obox('trim', a.add(b).scale(0.5), dn, V3.Cross(az.scale(-1), dn).scale(-1).normalize(), az.scale(-1), len / 2, 0.14, 0.22, [0.95, 0.92, 0.85]);
      }
      for (let k = 0; k < 3; k++) obox('trim', at(0, 0.1 + k * 0.18, -Ln / 2 - 1.5 + k * 0.35), ax, UP, az, 3.2 - k * 0.3, 0.09 + k * 0.0, 0.9 - k * 0.35 + 0.35, [0.8, 0.78, 0.74]);
      // rose window
      const rw = BABYLON.MeshBuilder.CreateDisc('roseGlass', { radius: 1.25, tessellation: 32 }, scene), rr = BABYLON.MeshBuilder.CreateTorus('roseRing', { diameter: 2.7, thickness: 0.28, tessellation: 40 }, scene);
      rw.material = M.glassDark; rr.material = M.trim; const rp = at(0, 8.4, -Ln / 2 - 0.05);
      rw.position = rp.add(az.scale(0.04)); rr.position = rp; rw.lookAt(rp.add(az)); rr.lookAt(rp.add(az.scale(-1))); rr.rotate(BABYLON.Axis.X, Math.PI / 2, BABYLON.Space.LOCAL);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI; obox('trim', rp.add(az.scale(-0.02)), ax.scale(Math.cos(a)).add(UP.scale(Math.sin(a))), V3.Cross(az, ax.scale(Math.cos(a)).add(UP.scale(Math.sin(a)))).normalize(), az.scale(-1), 1.25, 0.04, 0.03, [0.95, 0.92, 0.85]); }
      // nave roof
      const ov = 0.5, rise = Math.tan(0.5) * (Wn / 2 + ov);
      for (const sd of [-1, 1]) poly('roof', [at(sd * (Wn / 2 + ov), Hn - 0.05, -Ln / 2 - 0.3), at(sd * (Wn / 2 + ov), Hn - 0.05, Ln / 2 + 0.3), at(0, Hn - 0.05 + rise, Ln / 2 + 0.3), at(0, Hn - 0.05 + rise, -Ln / 2 - 0.3)], ax.scale(sd).add(UP.scale(1.5)).normalize(), [1, 1, 1], 1.2);
      poly('brick', [at(-Wn / 2, Hn, Ln / 2), at(Wn / 2, Hn, Ln / 2), at(0, Hn - 0.05 + rise - Math.tan(0.5) * ov, Ln / 2)], az, col);
      // apse: half-cylinder with a half-cone roof
      const ar = Wn / 2 - 1, n = 12, ah = Hn - 3;
      for (let k = 0; k < n; k++) {
        const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n, p0 = (a) => at(Math.cos(a) * ar, 0, Ln / 2 + Math.sin(a) * ar), mida = (a0 + a1) / 2, o = ax.scale(Math.cos(mida)).add(az.scale(Math.sin(mida)));
        poly('brick', [p0(a0), p0(a1), p0(a1).add(UP.scale(ah)), p0(a0).add(UP.scale(ah))], o, col);
        poly('roof', [p0(a0).add(UP.scale(ah)).add(o.scale(0.4)), p0(a1).add(UP.scale(ah)).add(o.scale(0.4)), at(0, ah + 2.4, Ln / 2)], o.add(UP).normalize(), [1, 1, 1], 1.2);
        if (k % 4 === 2) obox('glassDark', p0(mida).add(UP.scale(ah * 0.6)).add(o.scale(0.02)), ax.scale(-Math.sin(mida)).add(az.scale(Math.cos(mida))), UP, o, 0.45, 1.4, 0.03, [1, 1, 1]);
      }
      staticBoxes.push([cc.x, gy + Hn / 2, cc.z, Wn / 2, Hn / 2, Ln / 2, Math.atan2(az.x, az.z)]);
    }
    // ---------- farmsteads (cascine) out in the fields, with hay bales ----------
    for (const [fx, fz, fr] of [[-450, 250, 0.3], [-440, -300, -0.2], [-200, 345, 1.4], [500, -360, 0.9], [-470, 30, 1.6], [-300, -392, 0.2], [180, 380, 1.0], [520, 380, 2.1], [-525, -385, 0.7]]) {
      if (nearestSample(fx, fz, 3) && nearestSample(fx, fz, 3).d < 40) continue;
      const ca = Math.cos(fr), sa = Math.sin(fr), loc = (a, b) => [fx + ca * a + sa * b, fz - sa * a + ca * b];
      house(...loc(0, 0), fr, 14, 10, 2, 'plaster', 1, { hip: true });
      house(...loc(18, 4), fr, 20, 11, 2, 'brick', 1, { arcade: true });
      house(...loc(-4, 14), fr + Math.PI / 2, 9, 7, 1, 'brick', -1, {});
      for (let k = 0; k < 7; k++) {
        const [bx, bz] = loc(30 + (k % 4) * 3.4, -12 - Math.floor(k / 4) * 3.4), bale = BABYLON.MeshBuilder.CreateCylinder('bale' + fx + k, { height: 1.2, diameter: 1.5, tessellation: 18 }, scene);
        bale.material = hayMat; bale.rotation.z = Math.PI / 2; bale.rotation.y = fr + hash(k, fx); bale.position.set(bx, terrainH(bx, bz) + 0.75, bz);
      }
    }
    // ---------- village name signs at both ends ----------
    {
      const vi = T.map((t, i) => i).filter((i) => T[i].village), ends = [vi.find((i) => !T[(i - 1 + N) % N].village), vi.find((i) => !T[(i + 1) % N].village)];
      const signTex = new BABYLON.DynamicTexture('signTex', { width: 512, height: 192 }, scene, true), sc = signTex.getContext();
      sc.fillStyle = '#f4f2ea'; sc.fillRect(0, 0, 512, 192); sc.strokeStyle = '#1a1a1a'; sc.lineWidth = 12; sc.strokeRect(10, 10, 492, 172);
      sc.fillStyle = '#1a1a1a'; sc.font = 'bold 72px Arial, sans-serif'; sc.textAlign = 'center'; sc.fillText('BORGO PO', 256, 120); signTex.update();
      const sm = pbr('signMat', new C3(1, 1, 1), 0.6, { tex: signTex });
      ends.forEach((i, e) => {
        if (i === undefined) return;
        const t = T[(i + (e ? 6 : -6) + N) % N], side = e ? 1 : -1, o = halfW(t) + 1.6;
        const x = t.x + t.nx * side * o, z = t.z + t.nz * side * o, y = terrainH(x, z);
        obox('metal', new V3(x, y + 1.2, z), new V3(t.tx, 0, t.tz), UP, new V3(t.nx, 0, t.nz), 0.04, 1.2, 0.04, [0.6, 0.6, 0.6]);
        const pl = BABYLON.MeshBuilder.CreatePlane('villageSign' + e, { width: 1.6, height: 0.6, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        pl.material = sm; pl.position.set(x, y + 2.1, z); pl.lookAt(new V3(x - t.tx * (e ? -1 : 1), y + 2.1, z - t.tz * (e ? -1 : 1)));
      });
    }
    // raised pavements with kerbs along the village street
    {
      const g = buf('pavement'), vi = T.map((t, i) => i).filter((i) => T[i].village);
      for (const side of [-1, 1]) {
        let prev = null;
        for (const i of vi.concat(vi.length ? [vi[0]] : [])) {
          const t = T[i], hw = halfW(t), y = t.y + 0.13;
          const kerb = new V3(t.x + t.nx * side * hw, t.y, t.z + t.nz * side * hw), kerbTop = kerb.add(UP.scale(0.13));
          const outer = new V3(t.x + t.nx * side * (hw + 2.7), y, t.z + t.nz * side * (hw + 2.7));
          if (prev && V3.Distance(prev.kerb, kerb) < 6) {
            poly('pavement', [prev.kerbTop, kerbTop, outer, prev.outer], UP, [1, 1, 1], 1.2);
            poly('kerb', [prev.kerb, kerb, kerbTop, prev.kerbTop], new V3(-t.nx * side, 0, -t.nz * side), [1, 1, 1], 1);
          }
          prev = { kerb, kerbTop, outer };
        }
      }
    }
    // piazza: fountain, benches, bollards, shade trees
    {
      const fc = new V3(px - outward.x * 8 + along.x * -4, pg, pz - outward.z * 8 + along.z * -4);
      const basin = BABYLON.MeshBuilder.CreateCylinder('fountainBasin', { height: 0.6, diameter: 6.4, tessellation: 40 }, scene); basin.material = M.concrete; basin.position = fc.add(UP.scale(0.3));
      const inner = BABYLON.MeshBuilder.CreateCylinder('fountainWater', { height: 0.05, diameter: 5.8, tessellation: 40 }, scene); inner.material = wm; inner.position = fc.add(UP.scale(0.5));
      const col1 = BABYLON.MeshBuilder.CreateCylinder('fountainColumn', { height: 1.8, diameterTop: 0.35, diameterBottom: 0.6, tessellation: 16 }, scene); col1.material = M.concrete; col1.position = fc.add(UP.scale(1.2));
      const bowl = BABYLON.MeshBuilder.CreateCylinder('fountainBowl', { height: 0.35, diameterTop: 1.8, diameterBottom: 0.5, tessellation: 24 }, scene); bowl.material = M.concrete; bowl.position = fc.add(UP.scale(2.2));
      staticBoxes.push([fc.x, pg + 0.5, fc.z, 3.0, 0.5, 3.0, 0]);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.4, bc = fc.add(new V3(Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2)), ax2 = new V3(-Math.sin(a), 0, Math.cos(a)), az2 = new V3(Math.cos(a), 0, Math.sin(a));
        for (let sl = 0; sl < 3; sl++) obox('wood', bc.add(UP.scale(0.45)).add(az2.scale(-0.15 + sl * 0.15)), ax2, UP, az2, 0.9, 0.025, 0.06, [0.5, 0.33, 0.2]);
        for (let sl = 0; sl < 2; sl++) obox('wood', bc.add(UP.scale(0.7 + sl * 0.14)).add(az2.scale(0.28)), ax2, UP, az2, 0.9, 0.05, 0.02, [0.5, 0.33, 0.2]);
        for (const e of [-0.8, 0.8]) obox('metal', bc.add(ax2.scale(e)).add(UP.scale(0.38)), ax2, UP, az2, 0.03, 0.38, 0.25, [0.12, 0.12, 0.12]);
      }
      for (let b = -24; b <= 24; b += 3) { const bp = new V3(px + along.x * b - outward.x * 2.2, pg, pz + along.z * b - outward.z * 2.2);
        obox('metal', bp.add(UP.scale(0.45)), along, UP, outward, 0.08, 0.45, 0.08, [0.18, 0.18, 0.18]); }
      piazzaTrees.push(...[[-20, -16], [20, -16], [-20, 2], [20, 2]].map(([a, b]) => [px + along.x * a - outward.x * b, pz + along.z * a - outward.z * b, 0.9]));
    }
    const awningTex = canvasTex('awning', 256, (c, n) => { for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#f1ebdc' : '#2f6b4a'; c.fillRect(k * n / 8, 0, n / 8, n); } });
    const MATS = { brick: M.brick, plaster: M.plaster, trim: M.trim, roof: M.roof, glassDark: M.glassDark, wood: M.wood, metal: M.lamp, cobblePlaza: M.cobble,
      flowers: pbr('flowers', new C3(1, 1, 1), 0.8), awning: pbr('awningMat', new C3(1, 1, 1), 0.85, { tex: awningTex }), copper: pbr('copper', new C3(1, 1, 1), 0.4, { metal: 0.7 }),
      lampGlass: (() => { const m = pbr('lampGlass', new C3(1, 0.9, 0.7), 0.2); m.emissiveColor = new C3(1, 0.75, 0.4); m.emissiveIntensity = 0.4; return m; })(),
      pavement: pbr('pavement', new C3(0.95, 0.93, 0.9), 0.85, { tex: tex.concrete, bump: grainN, bumpLevel: 0.5 }), kerb: pbr('kerb', new C3(0.8, 0.8, 0.78), 0.8, { tex: tex.concrete }) };
    M.trim.albedoColor = new C3(1, 1, 1); M.wood.albedoColor = new C3(1, 1, 1);
    const tileCentre = (tile) => { const [a, b] = tile.split(',').map(Number); return [(a + 0.5) * CH, (b + 0.5) * CH]; };
    for (const [key, g] of Object.entries(BUFL)) {
      const [k, tile] = key.split('|'), m = new BABYLON.Mesh('villageLod_' + k + '@' + tile, scene), vd = new BABYLON.VertexData();
      vd.positions = g.p; vd.normals = g.n; vd.uvs = g.u; vd.colors = g.c; vd.indices = g.i; vd.applyToMesh(m);
      m.material = MATS[k]; m.useVertexColors = true; m.isPickable = false; m.setEnabled(false);
      const [cx, cz] = tileCentre(tile); chunks.push({ mesh: m, cx, cz, kind: 'vfar' });
    }
    for (const [key, g] of Object.entries(BUF)) {
      const [k, tile] = key.split('|');
      const m = new BABYLON.Mesh('village_' + k + '@' + tile, scene), vd = new BABYLON.VertexData();
      if (tile !== 'landmark' && !['pavement', 'kerb', 'cobblePlaza'].includes(k)) { const [cx, cz] = tileCentre(tile); chunks.push({ mesh: m, cx, cz, kind: 'vnear' }); }
      vd.positions = g.p; vd.normals = g.n; vd.uvs = g.u; vd.colors = g.c; vd.indices = g.i; vd.applyToMesh(m);
      m.material = MATS[k]; m.useVertexColors = true; m.receiveShadows = true; m.isPickable = false;
      if (k !== 'cobblePlaza') m.material.backFaceCulling = false;
      if (k === 'pavement' || k === 'kerb') roads.push(m);          // the car can mount the kerb
      if (!['pavement', 'kerb', 'cobblePlaza', 'flowers'].includes(k)) m.checkCollisions = true;   // the parked-view camera cannot pass through buildings
    }
    if (piazzaTrees.length) detailedVillage.push(...instanceTrees(piazzaTrees, 'broad', 2));
    // street lamps
    const poles = [], heads = [];
    T.forEach((t, i) => { if (!t.village || i % 14) return; const o = halfW(t) + 1.2, x = t.x + t.nx * o, z = t.z + t.nz * o;
      poles.push(boxMat(0.12, 4.2, 0.12, x, t.y + 2.1, z)); heads.push(boxMat(0.45, 0.5, 0.45, x, t.y + 4.3, z)); });
    thin(unitBox('lampPoles', M.lamp), poles); thin(unitBox('lampHeads', M.lamp), heads);
  }

  // ---------- the Alps on the northern horizon ----------
  {
    const pos = [], col = [], ind = []; const R0 = 7000, n = 220;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * 0.18 + (k / n) * Math.PI * 0.64;
      const ridge = 120 + 260 * Math.pow(fbm(k / 18, 3.3, 5), 1.4) + 180 * Math.pow(Math.max(0, Math.sin(k / n * Math.PI)), 2);
      const x = Math.cos(a) * R0, z = Math.sin(a) * R0;
      pos.push(x, -50, z, x, ridge, z);
      const snow = ridge > 300 ? 1 : 0;
      col.push(0.70, 0.76, 0.84, 1, snow ? 0.90 : 0.66, snow ? 0.92 : 0.72, snow ? 0.96 : 0.80, 1);
      if (k) { const b = (k - 1) * 2; ind.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const alps = new BABYLON.Mesh('alps', scene), vd = new BABYLON.VertexData(); vd.positions = pos; vd.colors = col; vd.indices = ind; vd.applyToMesh(alps);
    const am = new BABYLON.StandardMaterial('alpsMat', scene); am.disableLighting = true; am.emissiveColor = new C3(1, 1, 1); am.backFaceCulling = false; am.fogEnabled = false;
    alps.material = am; alps.useVertexColors = true; alps.applyFog = false; alps.isPickable = false;
  }

  // ---------- roadside grass, wildflowers and reeds (alpha-tested cards) ----------
  const cardTex = (name, paint) => { const t = new BABYLON.DynamicTexture(name, { width: 256, height: 256 }, scene, true), c = t.getContext(); c.clearRect(0, 0, 256, 256); paint(c); t.update(); t.hasAlpha = true; return t; };
  const grassTex = cardTex('grassCard', (c) => {
    for (let k = 0; k < 110; k++) { const x = 8 + hash(k, 1) * 240, h = 90 + hash(k, 2) * 160, lean = (hash(k, 3) - 0.5) * 60, g = hash(k, 4);
      c.strokeStyle = `rgb(${(70 + g * 70) | 0},${(110 + g * 70) | 0},${(40 + g * 30) | 0})`; c.lineWidth = 2 + hash(k, 5) * 3;
      c.beginPath(); c.moveTo(x, 256); c.quadraticCurveTo(x + lean * 0.3, 256 - h * 0.6, x + lean, 256 - h); c.stroke(); }
  });
  const flowerTex = cardTex('flowerCard', (c) => {
    for (let k = 0; k < 70; k++) { const x = 8 + hash(k, 7) * 240, h = 70 + hash(k, 8) * 120; c.strokeStyle = 'rgb(80,125,50)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 256); c.lineTo(x + (hash(k, 9) - 0.5) * 20, 256 - h); c.stroke(); }
    for (let k = 0; k < 40; k++) { const x = 10 + hash(k, 11) * 236, y = 256 - 70 - hash(k, 12) * 120, f = hash(k, 13);
      c.fillStyle = f < 0.4 ? '#d8261e' : f < 0.7 ? '#f3e7a0' : f < 0.85 ? '#6f6fd8' : '#f7f7f2'; c.beginPath(); c.arc(x, y, 5 + hash(k, 14) * 5, 0, 6.3); c.fill(); }
  });
  const reedTex = cardTex('reedCard', (c) => {
    for (let k = 0; k < 60; k++) { const x = 6 + hash(k, 21) * 244, h = 170 + hash(k, 22) * 86, g = hash(k, 23);
      c.strokeStyle = `rgb(${(100 + g * 60) | 0},${(120 + g * 50) | 0},${(60 + g * 30) | 0})`; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x, 256); c.lineTo(x + (hash(k, 24) - 0.5) * 30, 256 - h); c.stroke();
      if (hash(k, 25) < 0.35) { c.fillStyle = '#6b4a2c'; c.fillRect(x + (hash(k, 24) - 0.5) * 30 * 0.85 - 3, 256 - h * 0.92, 6, 22); } }
  });
  const cardMat = (name, t, tint) => { const m = new BABYLON.PBRMaterial(name, scene); m.albedoTexture = t; m.useAlphaFromAlbedoTexture = true; m.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST;
    m.alphaCutOff = 0.4; m.backFaceCulling = false; m.twoSidedLighting = true; m.metallic = 0; m.roughness = 0.9; m.albedoColor = tint; return m; };
  const cardMesh = (name, w, h, mat) => {
    const p = [], nn = [], u = [], i = [];
    for (let q = 0; q < 2; q++) { const a = q * Math.PI / 2, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, b = p.length / 3;
      p.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz); nn.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); u.push(0, 0, 1, 0, 1, 1, 0, 1); i.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const m = new BABYLON.Mesh(name, scene), vd = new BABYLON.VertexData(); vd.positions = p; vd.normals = nn; vd.uvs = u; vd.indices = i; vd.applyToMesh(m); m.material = mat; return m;
  };
  {
    const grass = [], flowers = [], reeds = [], lim = isMobile ? 0.5 : 1;
    T.forEach((t, i) => {
      if (t.village || t.bridge || Math.abs(t.y - 0.18) > 0.5) return;
      for (let k = 0; k < 4 * lim; k++) {
        const side = hash(i, k) < 0.5 ? -1 : 1, off = halfW(t) + 1.0 + Math.pow(hash(k, i), 1.5) * 8, along = (hash(i + 3, k) - 0.5) * 2;
        const x = t.x + t.nx * side * off + t.tx * along, z = t.z + t.nz * side * off + t.tz * along;
        const mtx = BABYLON.Matrix.Compose(new V3(1, 0.7 + hash(x, z) * 0.6, 1), BABYLON.Quaternion.FromEulerAngles(0, hash(z, x) * 6.28, 0), new V3(x, terrainH(x, z) - 0.02, z));
        (hash(x * 3, z) < 0.22 ? flowers : grass).push(mtx);
      }
    });
    for (let z = TZ0 + 4; z < TZ1 - 4; z += 2.2 / lim) for (const side of [-1, 1]) {
      for (let d = 60; d < 92; d += 1.6) { const x = riverX(z) + side * d, h = terrainH(x, z); if (h > -3.1 && h < -1.6 && hash(x, z) < 0.55) { reeds.push(BABYLON.Matrix.Compose(new V3(1, 0.8 + hash(z, x) * 0.5, 1), BABYLON.Quaternion.FromEulerAngles(0, hash(x, z * 2) * 6.28, 0), new V3(x, h - 0.1, z))); break; } }
    }
    thinChunked(cardMesh('grassCards', 1.1, 0.55, cardMat('grassMat', grassTex, new C3(0.95, 1, 0.85))), grass, 'grass');
    thinChunked(cardMesh('flowerCards', 1.0, 0.5, cardMat('flowerMat', flowerTex, new C3(1, 1, 1))), flowers, 'grass');
    thinChunked(cardMesh('reedCards', 1.2, 1.9, cardMat('reedMat', reedTex, new C3(1.35, 1.35, 1.15))), reeds, 'grass');
  }

  // ---------- roadside furniture: post-and-rail fences, telegraph poles with wires, km stones, bend warning signs ----------
  {
    const posts = [], rails = [], poles = [], arms = [], wires = [], stones = [], tops = [];
    const at = (t, side, off) => [t.x + t.nx * side * off, t.z + t.nz * side * off];
    const seg = (list, x1, y1, z1, x2, y2, z2, w, h) => { const len = Math.hypot(x2 - x1, y2 - y1, z2 - z1); list.push(BABYLON.Matrix.Compose(new V3(w, h, len),
      BABYLON.Quaternion.FromEulerAngles(-Math.atan2(y2 - y1, Math.hypot(x2 - x1, z2 - z1)), Math.atan2(x2 - x1, z2 - z1), 0), new V3((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2))); };
    T.forEach((t, i) => {
      const open = !t.village && !t.bridge && Math.abs(t.y - 0.18) < 0.4;
      if (open && !t.grove && i % 2 === 0) for (const side of [-1, 1]) {
        if (hash(Math.floor(i / 40), side * 3) > 0.45) continue;
        const t2 = T[(i + 2) % N], o = halfW(t) + 6.5, [x1, z1] = at(t, side, o), [x2, z2] = at(t2, side, halfW(t2) + 6.5), y1 = terrainH(x1, z1), y2 = terrainH(x2, z2);
        posts.push(boxMat(0.12, 1.15, 0.12, x1, y1 + 0.55, z1));
        for (const h of [0.45, 0.88]) seg(rails, x1, y1 + h, z1, x2, y2 + h, z2, 0.05, 0.09);
      }
      if (open && i % 20 === 0) {
        const t2 = T[(i + 20) % N], ok2 = !t2.village && !t2.bridge && Math.abs(t2.y - 0.18) < 0.4;
        const [x, z] = at(t, 1, halfW(t) + 9.5), y = terrainH(x, z);
        poles.push(boxMat(0.24, 7.6, 0.24, x, y + 3.8, z)); arms.push(boxMat(1.7, 0.12, 0.12, x, y + 7.2, z, Math.atan2(t.nx, t.nz)));
        if (ok2) { const [xb, zb] = at(t2, 1, halfW(t2) + 9.5), yb = terrainH(xb, zb);
          for (const k of [-0.7, 0, 0.7]) seg(wires, x + t.nx * k, y + 7.3, z + t.nz * k, xb + t2.nx * k, yb + 7.3, zb + t2.nz * k, 0.025, 0.025); }
      }
      if (open && i % 50 === 0) { const [x, z] = at(t, -1, halfW(t) + 1.7), y = terrainH(x, z), ry = Math.atan2(t.tx, t.tz);
        stones.push(boxMat(0.36, 0.62, 0.18, x, y + 0.31, z, ry)); tops.push(boxMat(0.37, 0.15, 0.19, x, y + 0.66, z, ry)); }
    });
    const wood = pbr('fenceWood', new C3(0.42, 0.33, 0.24), 0.9, { tex: tex.bark }), white = pbr('kmStone', new C3(0.92, 0.92, 0.9), 0.7), red = pbr('kmTop', new C3(0.75, 0.08, 0.06), 0.6), wire = pbr('wire', new C3(0.1, 0.1, 0.1), 0.4, { metal: 0.6 });
    thinChunked(unitBox('fencePosts', wood), posts, 'detail'); thinChunked(unitBox('fenceRails', wood), rails, 'detail');
    thinChunked(unitBox('telePoles', wood), poles, 'detail'); thinChunked(unitBox('teleArms', wood), arms, 'detail'); thinChunked(unitBox('teleWires', wire), wires, 'detail');
    thinChunked(unitBox('kmStones', white), stones, 'detail'); thinChunked(unitBox('kmTops', red), tops, 'detail');
    // warning signs ahead of the tighter bends (radius under ~60 m), on the driver's right
    const signTex = (dir) => { const t = new BABYLON.DynamicTexture('bendSign' + dir, { width: 256, height: 256 }, scene, true), c = t.getContext();
      c.clearRect(0, 0, 256, 256); c.fillStyle = '#c8161d'; c.beginPath(); c.moveTo(128, 14); c.lineTo(244, 228); c.lineTo(12, 228); c.closePath(); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(128, 52); c.lineTo(212, 206); c.lineTo(44, 206); c.closePath(); c.fill();
      c.strokeStyle = '#111'; c.lineWidth = 14; c.lineCap = 'round'; c.beginPath(); c.moveTo(128, 196); c.lineTo(128, 150); c.quadraticCurveTo(128, 110, 128 + dir * 40, 104); c.stroke();
      c.fillStyle = '#111'; c.beginPath(); c.moveTo(128 + dir * 58, 104); c.lineTo(128 + dir * 30, 84); c.lineTo(128 + dir * 30, 124); c.closePath(); c.fill(); t.update(); t.hasAlpha = true; return t; };
    const signMats = {}; for (const d of [-1, 1]) { const m = pbr('bendSignMat' + d, new C3(1, 1, 1), 0.5, { tex: signTex(d) }); m.useAlphaFromAlbedoTexture = true; m.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHATEST; m.backFaceCulling = false; signMats[d] = m; }
    let last = -999;
    for (let i = 0; i < N; i++) {
      const a = T[i], b = T[(i + 10) % N], turn = a.tx * b.tz - a.tz * b.tx, ang = Math.acos(Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz)));
      if (ang < 20 / 60 || i - last < 60 || a.village) continue;            // ~20 m of travel turning by > 19 degrees
      last = i;
      const s = T[(i - 28 + N) % N]; if (s.bridge || s.village) continue;
      const [x, z] = [s.x - s.nx * (halfW(s) + 1.4), s.z - s.nz * (halfW(s) + 1.4)], y = terrainH(x, z);
      const post = BABYLON.MeshBuilder.CreateCylinder('bendSignPost' + i, { height: 2.4, diameter: 0.08, tessellation: 8 }, scene); post.material = M.rail; post.position.set(x, y + 1.2, z);
      const pl = BABYLON.MeshBuilder.CreatePlane('bendSign' + i, { size: 0.9 }, scene); pl.material = signMats[turn > 0 ? 1 : -1];
      pl.position.set(x, y + 2.3, z); pl.lookAt(new V3(x + s.tx, y + 2.3, z + s.tz));
    }
  }
  // ---------- waterfall: a rocky bluff on the east bank, a falling sheet of water, a pool, spray particles ----------
  const fallPos = (() => { const z = -238, x = riverX(z) + 116; return new V3(x, terrainH(x, z), z); })();
  {
    const rockTex = canvasTex('rockTex', 256, (c, n) => noiseFill(c, n, [128, 122, 112], 0.25, 9));
    const rockMat = pbr('rock', new C3(1, 1, 1), 0.9, { tex: rockTex, bump: grainN, bumpLevel: 1.2 });
    const rocks = [];
    for (let k = 0; k < 16; k++) {
      const r = BABYLON.MeshBuilder.CreateIcoSphere('rock' + k, { radius: 1, subdivisions: 3 }, scene), p = r.getVerticesData('position');
      for (let i = 0; i < p.length; i += 3) { const f = 1 + 0.35 * (fbm(p[i] * 1.7 + k, p[i + 1] * 1.7 + p[i + 2] * 1.3, 4) - 0.5); p[i] *= f; p[i + 1] *= f; p[i + 2] *= f; }
      r.setVerticesData('position', p); const nn = []; BABYLON.VertexData.ComputeNormals(p, r.getIndices(), nn); r.setVerticesData('normal', nn);
      const along = (k / 15 - 0.5) * 48, hh = 13 * Math.exp(-Math.pow(along / 20, 2)) + 3, gap = Math.abs(along) < 3.5;
      r.scaling.set(7 + hash(k, 1) * 4, gap ? hh * 0.86 : hh, 6 + hash(k, 2) * 4); r.position.set(fallPos.x + 7 + hash(k, 3) * 3, fallPos.y - 1, fallPos.z + along);
      r.rotation.y = hash(k, 4) * 6; r.material = rockMat; rocks.push(r);
      staticBoxes.push([r.position.x, r.position.y + hh / 2, r.position.z, 5, hh / 2, 3, 0]);
    }
    const top = fallPos.y + 12.6;
    // stream on top, the falling sheet, the pool and the run-off to the Po
    const streamTex = canvasTex('fallTex', 256, (c, n) => { c.fillStyle = 'rgba(200,220,225,0.55)'; c.fillRect(0, 0, n, n);
      for (let k = 0; k < 260; k++) { c.fillStyle = `rgba(255,255,255,${0.25 + hash(k, 1) * 0.6})`; c.fillRect(hash(k, 2) * n, hash(k, 3) * n, 1.5 + hash(k, 4) * 3, 10 + hash(k, 5) * 60); } });
    streamTex.hasAlpha = true;
    const fallMat = new BABYLON.PBRMaterial('fallMat', scene); fallMat.albedoTexture = streamTex; fallMat.useAlphaFromAlbedoTexture = true; fallMat.alpha = 0.92;
    fallMat.metallic = 0; fallMat.roughness = 0.15; fallMat.emissiveColor = new C3(0.25, 0.28, 0.3); fallMat.backFaceCulling = false;
    const sheet = BABYLON.MeshBuilder.CreateGround('fallSheet', { width: 6.5, height: 13.4, subdivisions: 12, updatable: true }, scene);
    { const p = sheet.getVerticesData('position'); for (let i = 0; i < p.length; i += 3) { const v = (p[i + 2] + 6.7) / 13.4; p[i + 1] = -Math.pow(1 - v, 2) * 1.6; } sheet.setVerticesData('position', p); }
    sheet.rotation.set(-Math.PI / 2, Math.PI / 2, 0); sheet.position.set(fallPos.x - 2.6, fallPos.y + 6.3, fallPos.z);
    sheet.material = fallMat;
    const pool = BABYLON.MeshBuilder.CreateDisc('fallPool', { radius: 7.5, tessellation: 40 }, scene); pool.rotation.x = Math.PI / 2; pool.position.set(fallPos.x - 7, fallPos.y + 0.12, fallPos.z); pool.material = wm;
    const run = BABYLON.MeshBuilder.CreateGround('runoff', { width: fallPos.x - 3 - (riverX(fallPos.z) + 70), height: 4.5 }, scene);
    run.position.set((fallPos.x - 3 + riverX(fallPos.z) + 70) / 2, fallPos.y + 0.1, fallPos.z); run.material = wm;
    const streamTop = BABYLON.MeshBuilder.CreateGround('streamTop', { width: 18, height: 4.2 }, scene); streamTop.position.set(fallPos.x + 7, top + 0.1, fallPos.z); streamTop.material = wm;
    scene.onBeforeRenderObservable.add(() => { streamTex.vOffset = (performance.now() / 1000 * 1.6) % 1; });
    // particles: mist at the foot, droplets off the lip
    const soft = new BABYLON.DynamicTexture('softDot', { width: 64, height: 64 }, scene, false);
    { const c = soft.getContext(), g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); soft.update(); soft.hasAlpha = true; }
    const mist = new BABYLON.ParticleSystem('mist', isMobile ? 260 : 700, scene); mist.particleTexture = soft;
    mist.emitter = new V3(fallPos.x - 5.0, fallPos.y + 0.6, fallPos.z); mist.minEmitBox = new V3(-1, 0, -2.4); mist.maxEmitBox = new V3(1, 0.4, 2.4);
    mist.color1 = new BABYLON.Color4(1, 1, 1, 0.42); mist.color2 = new BABYLON.Color4(0.85, 0.92, 1, 0.3); mist.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    mist.minSize = 1.2; mist.maxSize = 3.4; mist.minLifeTime = 1.2; mist.maxLifeTime = 2.6; mist.emitRate = isMobile ? 110 : 280;
    mist.direction1 = new V3(-2.5, 2.2, -1.2); mist.direction2 = new V3(-0.5, 4.2, 1.2); mist.gravity = new V3(0, -0.6, 0); mist.minEmitPower = 0.6; mist.maxEmitPower = 1.4;
    mist.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD; mist.start();
    const drops = new BABYLON.ParticleSystem('drops', isMobile ? 300 : 900, scene); drops.particleTexture = soft;
    drops.emitter = new V3(fallPos.x - 2.2, top, fallPos.z); drops.minEmitBox = new V3(0, 0, -2.5); drops.maxEmitBox = new V3(0.3, 0, 2.5);
    drops.color1 = new BABYLON.Color4(1, 1, 1, 0.7); drops.color2 = new BABYLON.Color4(0.8, 0.9, 1, 0.5); drops.colorDead = new BABYLON.Color4(1, 1, 1, 0);
    drops.minSize = 0.15; drops.maxSize = 0.45; drops.minLifeTime = 1.2; drops.maxLifeTime = 1.6; drops.emitRate = isMobile ? 160 : 450;
    drops.direction1 = new V3(-1.2, 0, -0.3); drops.direction2 = new V3(-0.4, 0.2, 0.3); drops.gravity = new V3(0, -9.8, 0); drops.minEmitPower = 0.8; drops.maxEmitPower = 1.5; drops.start();
  }

  // ---------- river reflections (desktop) ----------
  let mirror = null;
  if (!isMobile && !NO_MIRROR) {
    mirror = new BABYLON.MirrorTexture('riverMirror', 512, scene, true);         // blurred by the ripples anyway, so half resolution is enough
    mirror.mirrorPlane = new BABYLON.Plane(0, -1, 0, -3.0); mirror.level = 0.55; mirror.adaptiveBlurKernel = 8;
    mirror.refreshRate = 3;                                                            // re-render every 3rd frame
    wm.reflectionTexture = mirror;
  }
  // freeze everything static
  scene.meshes.forEach((m) => { if (m.name !== 'sky') m.freezeWorldMatrix(); m.isPickable = false; });

  // ---------- physics world ----------
  const world = new CANNON.World(); world.gravity.set(0, -9.81, 0); world.broadphase = new CANNON.SAPBroadphase(world); world.solver.iterations = 10;
  world.defaultContactMaterial.friction = 0.3;
  const wallMat = new CANNON.Material('wall'), bodyMat = new CANNON.Material('carBody');
  world.addContactMaterial(new CANNON.ContactMaterial(wallMat, bodyMat, { friction: 0.0, restitution: 0.15, contactEquationStiffness: 1e7, contactEquationRelaxation: 4 }));
  {
    const data = []; for (let i = 0; i < NX; i++) { const col = []; for (let jj = 0; jj < NZ; jj++) col.push(H[(NZ - 1 - jj) * NX + i]); data.push(col); }
    const hf = new CANNON.Heightfield(data, { elementSize: TS }); const b = new CANNON.Body({ mass: 0 }); b.addShape(hf);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); b.position.set(TX0, 0, TZ1); world.addBody(b);
    for (const r of roads) {
      const p = r.getVerticesData('position'), ix = Array.from(r.getIndices());
      // cannon's ray tests only see triangles whose (right-handed) normal faces the ray: make every road triangle face up
      for (let k = 0; k < ix.length; k += 3) {
        const a = ix[k] * 3, b = ix[k + 1] * 3, c = ix[k + 2] * 3;
        const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
        if (uz * vx - ux * vz < 0) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      }
      const tm = new CANNON.Trimesh(Array.from(p), ix); const rb = new CANNON.Body({ mass: 0 }); rb.addShape(tm); world.addBody(rb);
    }
    for (const [x, y, z, hx, hy, hz, ry] of staticBoxes) {
      const b2 = new CANNON.Body({ mass: 0, material: wallMat }); b2.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b2.position.set(x, y, z);
      b2.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), ry); world.addBody(b2);
    }
  }

  // ---------- camera ----------
  const camera = new BABYLON.FreeCamera('cam', new V3(T[0].x - 12, 6, T[0].z), scene);
  camera.minZ = 0.25; camera.maxZ = 12000; camera.fov = 0.9; camera.inputs.clear();
  let camMode = 0; const CAMS = ['Chase camera', 'Far chase camera', 'Driver view', 'Orbit camera'];
  const orbit = new BABYLON.ArcRotateCamera('orbit', -1.2, 1.15, 10, V3.Zero(), scene); orbit.lowerRadiusLimit = 3.5; orbit.upperRadiusLimit = 40; orbit.upperBetaLimit = 1.5; orbit.minZ = 0.25; orbit.maxZ = 12000;
  scene.activeCamera = camera;

  // ---------- shadows (car and village), following the car ----------
  let visT = 0;
  const NEAR_R = isMobile ? 60 : 80, VILLAGE_R = isMobile ? 130 : 170;
  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now(); if (now - visT < 200) return; visT = now;
    const p = scene.activeCamera.position;
    for (const c of chunks) {
      const d = Math.hypot(c.cx - p.x, c.cz - p.z);
      const on = !c.mesh._perfOff && (c.kind === 'near' ? d < NEAR_R : c.kind === 'far' ? d >= NEAR_R : c.kind === 'grass' ? d < 150 :
        c.kind === 'vnear' ? d < VILLAGE_R : c.kind === 'vfar' ? d >= VILLAGE_R : d < 280);
      if (c.mesh.isEnabled() !== on) c.mesh.setEnabled(on);
    }
  });
  let sg;
  if (!isMobile && !NO_CSM && BABYLON.CascadedShadowGenerator) {
    // sharp near the car, still present 250 m away
    sg = new BABYLON.CascadedShadowGenerator(2048, sun); sg.numCascades = 3; sg.lambda = 0.88; sg.shadowMaxZ = 260; sg.stabilizeCascades = true;
    sg.cascadeBlendPercentage = 0.08; sg.autoCalcDepthBounds = false;
  } else sg = new BABYLON.ShadowGenerator(isMobile ? 1024 : 2048, sun);
  sg.usePercentageCloserFiltering = true; sg.filteringQuality = isMobile ? BABYLON.ShadowGenerator.QUALITY_LOW : BABYLON.ShadowGenerator.QUALITY_MEDIUM;
  sg.bias = 0.0015; sg.normalBias = 0.02; sg.darkness = 0.25;
  if (!(sg instanceof BABYLON.CascadedShadowGenerator)) { sun.autoUpdateExtends = false; sun.autoCalcShadowZBounds = false; } sun.shadowMinZ = 1; sun.shadowMaxZ = 260;
  sun.orthoLeft = -30; sun.orthoRight = 30; sun.orthoTop = 30; sun.orthoBottom = -30;
  scene.meshes.filter((m) => /^village_|^villageLod_|^chord|^diag|^vert/.test(m.name)).forEach((m) => sg.addShadowCaster(m, false));
  // trees are not real-time shadow casters: with 3 cascades that meant drawing every leaf card 3 more times; their shade is painted into the ground map
  roads.forEach((r) => (r.receiveShadows = true)); scene.getMeshByName('deck').receiveShadows = true;

  // ---------- the car ----------
  let rig = null, chassis = null, vehicle = null, wheels = [], steerWheel = null, steerWheelRest = null, spin = 0;
  const K = 40; let WR = 0.288, C0Y = WR + (0.30 - 9.81 / (4 * K)) + 0.06;      // WR (wheel radius) is read from the model on load
  const MOVERS = /^(Door_(FL|FR|RL|RR)(_Glass)?|Hood|Tailgate|Wheel_(FL|FR|RL|RR)|Strut_(FL|FR|RL|RR)|Arm_(FL|FR|RL|RR)|SteeringWheel|EngineBay|Luggage)$/;   // groups kept separate so they can move or be hidden
  const LAMPNODE = /^(Headlight_|Taillight_|Indicator_)/;
  const mergeForSpeed = (root) => {
    const groups = new Map();
    for (const m of scene.meshes.slice()) {
      if (!m.isDescendantOf(root) || !m.material || m.getTotalVertices() === 0) continue;
      if (!m.getVerticesDataKinds || (m.instances && m.instances.length)) continue;     // instanced meshes (shared by gltfpack) stay as they are
      let owner = 'static', skip = false;
      for (let n = m.parent; n; n = n.parent) { if (LAMPNODE.test(n.name)) { skip = true; break; } if (MOVERS.test(n.name)) { owner = n.name; break; } }
      if (skip) continue;
      const key = owner + '|' + m.material.uniqueId + '|' + m.getVerticesDataKinds().sort().join(',');
      if (!groups.has(key)) groups.set(key, { owner, list: [] }); groups.get(key).list.push(m);
    }
    for (const { owner, list } of groups.values()) {
      if (list.length < 2) continue;
      try { list.forEach((m) => m.computeWorldMatrix(true)); const mm = BABYLON.Mesh.MergeMeshes(list, true, true); if (!mm) continue;
        mm.name = owner + '_merged'; mm.setParent(owner === 'static' ? root : (scene.getTransformNodeByName(owner) || root)); } catch (e) { console.warn('merge skipped', e); }
    }
  };
  const spawnAt = (idx) => {
    const t = T[idx];
    chassis.position.set(t.x, t.y + C0Y + 0.05, t.z);
    chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.atan2(t.tx, t.tz));
    chassis.velocity.set(0, 0, 0); chassis.angularVelocity.set(0, 0, 0);
    lapStart = performance.now(); lastIdx = idx; lapArmed = false;
  };
  const setupCar = async () => {
    if (!(await blobImagesWork())) useDataUrlsForBlobs();
    statusEl.textContent = 'Loading the car…';
    const res = await fetch(assetUrl(CAR.file)); if (!res.ok) throw new Error('could not load assets/' + CAR.file + ' (' + res.status + ')');
    const bytes = new Uint8Array(await res.arrayBuffer());
    await BABYLON.ImportMeshAsync(bytes, scene, { pluginExtension: '.glb' });
    const root = scene.getMeshByName('__root__') || scene.getTransformNodeByName('__root__');
    // drop the showroom-only floor bits if present and keep the car itself
    mergeForSpeed(root);
    rig = new BABYLON.TransformNode('rig', scene); rig.rotationQuaternion = BABYLON.Quaternion.Identity(); root.parent = rig;
    scene.meshes.forEach((m) => { if (m.isDescendantOf(rig)) { sg.addShadowCaster(m, false); m.isPickable = true; } });
    initParts();
    // glass keeps true refraction (it reads much better than plain transparency); its background render runs at reduced resolution
    { const th = scene._transmissionHelper; if (th && th.setOptions) th.setOptions({ renderSize: isMobile ? 256 : 512, samples: 1 }); }
    // 2) hidden parts are not drawn: engine bay while the hood is shut, luggage area while the tailgate is shut, suspension while driving
    hideable.engine = scene.getTransformNodeByName('EngineBay'); hideable.luggage = scene.getTransformNodeByName('Luggage');
    hideable.susp = scene.transformNodes.filter((n) => /^(Strut|Arm)_(FL|FR|RL|RR)$/.test(n.name));
    // wheel radius, track, wheelbase and body length come from the model, so any car with the node-name API drives
    const wpos = {}; for (const k of ['FL', 'FR', 'RL', 'RR']) { const n = scene.getTransformNodeByName('Wheel_' + k); n.computeWorldMatrix(true); wpos[k] = n.getAbsolutePosition().clone(); }
    WR = Math.max(0.2, wpos.FL.y); C0Y = WR + (0.30 - 9.81 / (4 * K)) + 0.06;
    const bb = root.getHierarchyBoundingVectors(true), bodyLen = bb.max.z - bb.min.z, bodyMid = (bb.max.z + bb.min.z) / 2, roofY = bb.max.y;
    const halfTrack = Math.max(...Object.values(wpos).map((p) => Math.abs(p.x)));
    // low-poly stand-in that only the shadow map sees: body, glasshouse and wheels (~200 triangles instead of ~500k)
    {
      const parts = [BABYLON.MeshBuilder.CreateBox('sp_body', { width: 2 * halfTrack + 0.16, height: 0.62, depth: bodyLen - 0.02 }, scene),
                     BABYLON.MeshBuilder.CreateCylinder('sp_cabin', { height: roofY - 0.88, diameterTop: 1.6, diameterBottom: 2.3, tessellation: 4 }, scene)];
      parts[0].position.set(0, 0.6, bodyMid);
      parts[1].rotation.y = Math.PI / 4; parts[1].scaling.set(0.62, 1, 1.15); parts[1].position.set(0, 0.88 + (roofY - 0.88) / 2, -0.25);
      for (const k in wpos) {
        const w = BABYLON.MeshBuilder.CreateCylinder('sp_wheel', { height: 0.18, diameter: 2 * wpos[k].y, tessellation: 10 }, scene); w.rotation.z = Math.PI / 2; w.position.set(wpos[k].x, wpos[k].y, wpos[k].z); parts.push(w);
      }
      carShadowProxy = BABYLON.Mesh.MergeMeshes(parts, true, true); carShadowProxy.name = 'carShadowProxy';
      const im = new BABYLON.StandardMaterial('shadowOnly', scene); im.disableColorWrite = true; im.disableDepthWrite = true; im.backFaceCulling = false;
      carShadowProxy.material = im; carShadowProxy.isPickable = false; carShadowProxy.parent = rig; carShadowProxy.setEnabled(false);
    }
    steerWheel = scene.getTransformNodeByName('SteeringWheel');
    if (steerWheel) { if (!steerWheel.rotationQuaternion) steerWheel.rotationQuaternion = BABYLON.Quaternion.Identity(); steerWheelRest = steerWheel.rotationQuaternion.clone(); }
    chassis = new CANNON.Body({ mass: 1000, material: bodyMat }); chassis.addShape(new CANNON.Box(new CANNON.Vec3(halfTrack + 0.05, 0.3, bodyLen / 2 - 0.06)), new CANNON.Vec3(0, 0.1, bodyMid));
    chassis.angularDamping = 0.4; world.addBody(chassis);
    vehicle = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const n = scene.getTransformNodeByName('Wheel_' + k); if (!n.rotationQuaternion) n.rotationQuaternion = BABYLON.Quaternion.Identity();
      n.computeWorldMatrix(true); const wp = n.getAbsolutePosition(), r = Math.max(0.2, wp.y);     // staggered tyres: each wheel keeps its own radius
      wheels.push({ key: k, node: n, front: k[0] === 'F', r, spin: 0 });
      vehicle.addWheel({ radius: r, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: K, suspensionRestLength: 0.30, frictionSlip: 3.2,
        dampingRelaxation: 2.3, dampingCompression: 4.4, maxSuspensionForce: 200000, rollInfluence: 0.05, axleLocal: new CANNON.Vec3(1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(wp.x, -0.06 + (r - WR), wp.z), maxSuspensionTravel: 0.2, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true });
    }
    vehicle.addToWorld(world);
    // headlight beams
    for (const s of [-1, 1]) {
      const sp = new BABYLON.SpotLight('beam' + s, V3.Zero(), new V3(0, -0.12, 1), 0.85, 2, scene); sp.intensity = 0; sp.range = 60; sp.diffuse = new C3(1, 0.94, 0.82);
      beams.push({ light: sp, side: s });
    }
    spawnAt(0);
  };
  const beams = [];

  // ---------- input: keyboard, and twin virtual sticks on touch (right = drive, left = look around) ----------
  const keys = {};
  const joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };          // right thumb: x steer, y throttle(-)/brake(+)
  const look = { yaw: 0, pitch: 0, id: null, lx: 0, ly: 0, idleT: 0 };
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyR') resetCar(); if (e.code === 'KeyC') cycleCam(); if (e.code === 'KeyL') toggleLights();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  const joyEl = $('joy'), knobEl = $('knob'), JR = 62;
  const showJoy = (on, x, y) => { joyEl.style.display = on ? 'block' : 'none'; if (on) { joyEl.style.left = x + 'px'; joyEl.style.top = y + 'px'; } };
  canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
  canvas.addEventListener('pointerdown', (e) => {
    if (!driving || camMode === 3) return;                    // parked / orbit: the orbit camera handles input
    const right = e.clientX > window.innerWidth / 2;
    if (e.pointerType !== 'mouse' && right && joy.id === null) {
      joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0; showJoy(true, e.clientX, e.clientY); knobEl.style.transform = 'translate(-50%, -50%)';
      document.body.classList.add('used-drive');
    } else if (look.id === null && (e.pointerType === 'mouse' ? e.button === 0 : !right)) {
      look.id = e.pointerId; look.lx = e.clientX; look.ly = e.clientY; document.body.classList.add('used-look');
    } else return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === joy.id) {
      let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const l = Math.hypot(dx, dy); if (l > JR) { dx *= JR / l; dy *= JR / l; }
      joy.x = dx / JR; joy.y = dy / JR; knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === look.id) {
      look.yaw -= (e.clientX - look.lx) * 0.0075; look.pitch = Math.max(-0.35, Math.min(0.9, look.pitch + (e.clientY - look.ly) * 0.005));
      look.lx = e.clientX; look.ly = e.clientY; look.idleT = 0;
    }
  });
  const release = (e) => {
    if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; showJoy(false); }
    if (e.pointerId === look.id) { look.id = null; look.idleT = 0; }
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
  const cycleCam = () => {
    camMode = (camMode + 1) % CAMS.length;
    if (camMode === 3) { orbit.target = rig ? rig.getAbsolutePosition().add(new V3(0, 0.8, 0)) : V3.Zero(); orbit.attachControl(canvas, true); scene.activeCamera = orbit; }
    else { orbit.detachControl(); scene.activeCamera = camera; }
    say(CAMS[camMode]);
  };
  // ---------- parked mode: walk around the car, open doors/hood/tailgate, switch lamps; double-tap the car to drive ----------
  let driving = false;
  const D2 = Math.PI / 180;
  const PARTS = {
    Hood: { axis: BABYLON.Axis.X, angle: -52 * D2, dur: 1.1 }, Tailgate: { axis: BABYLON.Axis.X, angle: 74 * D2, dur: 1.2 },
    Door_FL: { axis: BABYLON.Axis.Y, angle: -66 * D2, dur: 0.9 }, Door_FR: { axis: BABYLON.Axis.Y, angle: 66 * D2, dur: 0.9 },
    Door_RL: { axis: BABYLON.Axis.Y, angle: -62 * D2, dur: 0.9 }, Door_RR: { axis: BABYLON.Axis.Y, angle: 62 * D2, dur: 0.9 },
  };
  if (CAR.rearDoorsBackHinged) { PARTS.Door_RL.angle *= -1; PARTS.Door_RR.angle *= -1; }      // rear-hinged rear doors swing the other way
  if (CAR.doors === 'scissor') for (const k of ['Door_FL', 'Door_FR']) Object.assign(PARTS[k], { axis: BABYLON.Axis.X, angle: 70 * D2 });   // scissor / butterfly doors swing up
  if (CAR.doors === 'gullwing') { Object.assign(PARTS.Door_FL, { axis: BABYLON.Axis.Z, angle: -80 * D2 }); Object.assign(PARTS.Door_FR, { axis: BABYLON.Axis.Z, angle: 80 * D2 }); }
  for (const k in PARTS) Object.assign(PARTS[k], { open: false, t: 0, node: null });
  const hideable = { engine: null, luggage: null, susp: [] };
  let carShadowProxy = null;
  const initParts = () => { for (const k in PARTS) { const n = scene.getTransformNodeByName(k); if (n) { if (!n.rotationQuaternion) n.rotationQuaternion = BABYLON.Quaternion.Identity(); PARTS[k].node = n; } } };
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    for (const k in PARTS) { const p = PARTS[k]; if (!p.node) continue; const g = p.open ? 1 : 0;
      if (p.t !== g) { p.t = g > p.t ? Math.min(1, p.t + dt / p.dur) : Math.max(0, p.t - dt / p.dur); BABYLON.Quaternion.RotationAxisToRef(p.axis, p.angle * easeIO(p.t), p.node.rotationQuaternion); } }
    const hood = PARTS.Hood, tg = PARTS.Tailgate;
    // front-engined: engine under the hood, luggage under the tailgate. Mid-engined: luggage under the front lid,
    // and the engine stays drawn (it shows through the glass engine cover).
    const engLid = CAR.mid ? null : hood, bootLid = CAR.mid ? hood : tg;
    if (hideable.engine) { const vis = !engLid || engLid.open || engLid.t > 0; if (hideable.engine.isEnabled() !== vis) hideable.engine.setEnabled(vis); }
    if (hideable.luggage) { const vis = bootLid.open || bootLid.t > 0; if (hideable.luggage.isEnabled() !== vis) hideable.luggage.setEnabled(vis); }
  });
  const LAMPSET = { tail: ['Lens_Red', 'Bulb_Tail'], hazard: ['Lens_Amber', 'Bulb_Amber'] }, lampOn = { tail: false, hazard: false };
  const setEmit = (names, on, col, k) => scene.materials.forEach((m) => { if (names.includes(m.name)) { m.emissiveColor = on ? col : C3.Black(); m.emissiveIntensity = on ? k : 0; } });
  scene.onBeforeRenderObservable.add(() => { if (lampOn.hazard) setEmit(LAMPSET.hazard, (performance.now() / 1000 * 1.5) % 1 < 0.5, new C3(1, 0.42, 0.02), 2.2); });
  const carHit = () => { if (!rig) return null; const h = scene.pick(scene.pointerX, scene.pointerY, (m) => m.isEnabled() && m.isVisible && m.isDescendantOf(rig)); return h && h.hit ? h.pickedMesh : null; };
  const targetOf = (mesh) => {
    for (let n = mesh; n; n = n.parent) {
      if (/Amber|^Indicator_/.test(n.name)) return 'lamp:hazard';
      if (/^Headlight_/.test(n.name)) return 'lamp:head';
      if (/^Taillight_/.test(n.name)) return 'lamp:tail';
      if (PARTS[n.name]) return 'part:' + n.name;
      if (/^Door_(FL|FR|RL|RR)_Glass$/.test(n.name)) return 'part:' + n.name.replace('_Glass', '');
    }
    return 'car';
  };
  const singleTap = (mesh) => {
    const t = targetOf(mesh);
    if (t.startsWith('part:')) { const p = PARTS[t.slice(5)]; if (p && p.node) { p.open = !p.open; say(t.slice(5).replace('_', ' ') + (p.open ? ' opened' : ' closed')); } }
    else if (t === 'lamp:head') toggleLights();
    else if (t === 'lamp:tail') { lampOn.tail = !lampOn.tail; setEmit(LAMPSET.tail, lampOn.tail, new C3(1, 0.06, 0.03), 1.6); say('Tail lights ' + (lampOn.tail ? 'on' : 'off')); }
    else if (t === 'lamp:hazard') { lampOn.hazard = !lampOn.hazard; if (!lampOn.hazard) setEmit(LAMPSET.hazard, false); say('Hazards ' + (lampOn.hazard ? 'on' : 'off')); }
  };
  const modeChip = $('modeChip');
  const setDriving = (on) => {
    driving = on;
    document.body.classList.toggle('driving', on);
    hideable.susp.forEach((n) => n.setEnabled(!on));
    // while driving the shadow map draws the stand-in; parked, the real car (open doors and hood cast correct shadows)
    if (carShadowProxy) {
      const real = scene.meshes.filter((m) => rig && m.isDescendantOf(rig) && m !== carShadowProxy);
      if (on) { real.forEach((m) => sg.removeShadowCaster(m, false)); carShadowProxy.setEnabled(true); sg.addShadowCaster(carShadowProxy, false); }
      else { sg.removeShadowCaster(carShadowProxy, false); carShadowProxy.setEnabled(false); real.forEach((m) => sg.addShadowCaster(m, false)); }
    }
    if (on) {
      for (const k in PARTS) PARTS[k].open = false;
      orbit.detachControl(); camMode = 0; scene.activeCamera = camera; look.yaw = look.pitch = 0;
      modeChip.hidden = true;
      say('Driving');
    } else {
      joy.id = null; joy.x = joy.y = 0; showJoy(false); look.id = null;
      camMode = 3; orbit.target = chassis ? new V3(chassis.position.x, chassis.position.y - C0Y + 0.8, chassis.position.z) : V3.Zero();
      if (chassis) { const f = new CANNON.Vec3(); chassis.quaternion.vmult(new CANNON.Vec3(0, 0, 1), f); orbit.alpha = Math.atan2(-f.z, -f.x) - 0.3; }
      orbit.beta = 1.2; orbit.radius = 7.5; orbit.attachControl(canvas, true); scene.activeCamera = orbit;
      modeChip.hidden = false; modeChip.textContent = isTouch ? 'Tap doors, hood, tailgate or lamps. Double-tap the car to drive' : 'Click doors, hood, tailgate or lamps. Press W or ↑ to drive (Enter gets you out again)';
      say('Parked');
    }
  };
  let tapTimer = null, lastTap = 0;
  scene.onPointerObservable.add((pi) => {
    if (pi.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
    const mesh = carHit(); const now = performance.now();
    if (!mesh) { lastTap = 0; return; }
    if (now - lastTap < 320) { clearTimeout(tapTimer); lastTap = 0; setDriving(!driving); return; }
    lastTap = now;
    if (!driving) { clearTimeout(tapTimer); tapTimer = setTimeout(() => singleTap(mesh), 330); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && rig) setDriving(!driving);
    // on a keyboard, any drive key gets you in and away
    else if (!driving && rig && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) setDriving(true);
  });
  // ---------- golden hour ----------
  let golden = false;
  const LOOKS = {
    day: { sun: SUN.clone(), col: new C3(1, 0.96, 0.88), k: 3.0, hemi: 0.25, zen: new V3(0.20, 0.40, 0.78), hor: new V3(0.78, 0.84, 0.90), sunc: new V3(1, 0.9, 0.7), fog: new C3(0.74, 0.80, 0.86), dens: 0.0011, env: 0.75, exp: 1.0 },
    gold: { sun: new V3(-0.76, -0.16, -0.63).normalize(), col: new C3(1, 0.68, 0.40), k: 2.6, hemi: 0.14, zen: new V3(0.22, 0.30, 0.55), hor: new V3(1.0, 0.70, 0.46), sunc: new V3(1, 0.55, 0.25), fog: new C3(0.86, 0.70, 0.58), dens: 0.0016, env: 0.42, exp: 1.08 },
  };
  let sunDir = SUN.clone();
  const applyLook = (L) => {
    sunDir = L.sun.clone(); sun.direction = sunDir; sun.diffuse = L.col; sun.intensity = L.k; hemi.intensity = L.hemi;
    skyMat.setVector3('sunDir', sunDir); skyMat.setVector3('zenCol', L.zen); skyMat.setVector3('horCol', L.hor); skyMat.setVector3('sunCol', L.sunc);
    scene.fogColor = L.fog; scene.fogDensity = L.dens; scene.environmentIntensity = L.env; ip.exposure = L.exp;
    scene.materials.forEach((m) => { if (m.name === 'lampGlass') m.emissiveIntensity = golden ? 1.4 : 0.4; });
  };
  const toggleGolden = () => { golden = !golden; $('timeBtn').setAttribute('aria-pressed', String(golden)); applyLook(golden ? LOOKS.gold : LOOKS.day); say(golden ? 'Golden hour' : 'Midday'); };

  // ---------- post-processing: MSAA + bloom + tone mapping, ambient occlusion and sun rays (desktop) ----------
  const post = { pipe: null, ssao: null, rays: null, sunDisc: null };
  try {
    if (NO_POST) throw new Error('post disabled');
    post.pipe = new BABYLON.DefaultRenderingPipeline('post', true, scene, [camera, orbit]);
    post.pipe.samples = isMobile ? 1 : 4; post.pipe.fxaaEnabled = isMobile;
    post.pipe.bloomEnabled = true; post.pipe.bloomThreshold = 0.82; post.pipe.bloomWeight = 0.28; post.pipe.bloomKernel = 48; post.pipe.bloomScale = 0.5;
    post.pipe.imageProcessingEnabled = true;
  } catch (e) { console.warn('post pipeline unavailable', e); }
  if (!isMobile && !NO_SSAO) {
    try {
      post.ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera, orbit]);
      post.ssao.radius = 1.4; post.ssao.totalStrength = 0.9; post.ssao.base = 0.12; post.ssao.samples = 12; post.ssao.maxZ = 160; post.ssao.minZAspect = 0.4; post.ssao.expensiveBlur = false;
    } catch (e) { console.warn('SSAO unavailable', e); }
  }
  if (!isMobile && !NO_RAYS) {
    try {
      post.sunDisc = BABYLON.MeshBuilder.CreateDisc('sunDisc', { radius: 38, tessellation: 24 }, scene);
      const sm = new BABYLON.StandardMaterial('sunDiscMat', scene); sm.emissiveColor = new C3(1, 0.95, 0.8); sm.disableLighting = true; sm.fogEnabled = false;
      post.sunDisc.material = sm; post.sunDisc.applyFog = false; post.sunDisc.isPickable = false; post.sunDisc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      post.rays = new BABYLON.VolumetricLightScatteringPostProcess('sunRays', 0.5, camera, post.sunDisc, 64, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false, scene);
      post.rays.exposure = 0.18; post.rays.decay = 0.965; post.rays.weight = 0.6; post.rays.density = 0.92;
    } catch (e) { console.warn('sun rays unavailable', e); post.rays = null; }
  }
  // the sun disc rides with the camera; rays only run when the sun is roughly in view
  let raysOn = true, raysAttached = true;
  scene.onBeforeRenderObservable.add(() => {
    if (!post.sunDisc) return;
    const cam = scene.activeCamera; post.sunDisc.position = cam.position.subtract(sunDir.scale(900));
    const want = raysOn && cam === camera && V3.Dot(cam.getForwardRay().direction, sunDir.scale(-1)) > 0.25;
    if (want !== raysAttached && post.rays) { if (want) camera.attachPostProcess(post.rays); else camera.detachPostProcess(post.rays); raysAttached = want; }
  });
  // ---------- sound: synthesised boxer engine, tyre squeal, wind, river and waterfall, birds, horn ----------
  let AC = null, snd = null, muted = false;
  const startAudio = () => {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const master = AC.createGain(); master.gain.value = 0.55; master.connect(AC.destination);
    const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = (type, f, q) => { const s = AC.createBufferSource(); s.buffer = nb; s.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q || 0.7; const g = AC.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return { fl, g }; };
    const o1 = AC.createOscillator(), o2 = AC.createOscillator(), o3 = AC.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine';
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 3;
    const shaper = AC.createWaveShaper(); { const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.5); } shaper.curve = c; }
    const eg = AC.createGain(); eg.gain.value = 0; const g2 = AC.createGain(); g2.gain.value = 0.35; const g3 = AC.createGain(); g3.gain.value = 0.6;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp); lp.connect(shaper); shaper.connect(eg); eg.connect(master); o1.start(); o2.start(); o3.start();
    const intake = noise('bandpass', 900, 1.2);
    snd = { master, o1, o2, o3, lp, eg, intake, tyre: noise('bandpass', 2300, 4), wind: noise('lowpass', 500), water: noise('bandpass', 700, 0.6), fall: noise('lowpass', 1400) };
    const chirp = () => { if (!AC) return; const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine';
      const f0 = 2600 + Math.random() * 1800; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * (0.6 + Math.random() * 0.8), t + 0.12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * snd.birds, t + 0.02); g.gain.linearRampToValueAtTime(0, t + 0.14);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16); setTimeout(chirp, 180 + Math.random() * (Math.random() < 0.3 ? 2400 : 500)); };
    snd.birds = 0; chirp();
  };
  window.addEventListener('pointerdown', startAudio, { passive: true }); window.addEventListener('keydown', startAudio);
  const horn = (on) => { if (!AC || muted) return; if (on && !snd.horn) { const g = AC.createGain(); g.gain.value = 0.16; g.connect(snd.master); const a = AC.createOscillator(), b = AC.createOscillator(); a.type = b.type = 'square'; a.frequency.value = 415; b.frequency.value = 520; a.connect(g); b.connect(g); a.start(); b.start(); snd.horn = { g, a, b }; }
    if (!on && snd.horn) { snd.horn.a.stop(); snd.horn.b.stop(); snd.horn = null; } };
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyH') horn(true); if (e.code === 'KeyT') toggleGolden(); });
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyH') horn(false); });
  const GEARS = [0, 38, 66, 98, 132, 999];
  const updateAudio = (kmh, thr, dt) => {
    if (!snd) return;
    const t = AC.currentTime, set = (p, v) => p.setTargetAtTime(v, t, 0.06);
    const gs = CAR.vmax / 205, redline = CAR.redline || 6500, kmhG = kmh / gs;          // gearing scales with top speed
    let gi = 1; while (kmhG > GEARS[gi] && gi < 5) gi++;
    const lo = GEARS[gi - 1], hi = Math.min(GEARS[gi], 190), frac = Math.min(1, (kmhG - lo * 0.75) / Math.max(1, hi - lo * 0.75));
    const rpm = driving ? 900 + frac * (redline - 1300) + thr * 400 : 850, f = rpm / 60 * (CAR.cyl || 4) / 2;   // firing pulses per revolution = cylinders / 2
    if (CAR.ev) {                                                                      // electric: single-speed motor whine that rises with road speed, silent at rest
      const fw = 140 + kmh * 11;
      set(snd.o1.frequency, fw); set(snd.o2.frequency, fw * 1.5); set(snd.o3.frequency, fw * 0.5); set(snd.lp.frequency, 900 + kmh * 25 + thr * 800);
      set(snd.eg.gain, muted || !driving ? 0 : Math.min(0.08, kmh / 900) * (0.4 + thr * 0.6)); set(snd.intake.g.gain, 0);
    } else {
    set(snd.o1.frequency, f); set(snd.o2.frequency, f * 0.5); set(snd.o3.frequency, f * 0.25); set(snd.lp.frequency, 380 + rpm * 0.22 + thr * 600);
    set(snd.eg.gain, muted ? 0 : (driving ? 0.10 + thr * 0.16 : 0.05)); set(snd.intake.g.gain, muted ? 0 : thr * 0.05 * (rpm / 6000)); set(snd.intake.fl.frequency, 500 + rpm * 0.3);
    }
    const skid = vehicle ? vehicle.wheelInfos.reduce((a, w) => a + (1 - (w.skidInfo === undefined ? 1 : w.skidInfo)), 0) / 4 : 0;
    set(snd.tyre.g.gain, muted ? 0 : Math.min(0.22, skid * 0.6) * Math.min(1, kmh / 20));
    set(snd.wind.g.gain, muted ? 0 : Math.min(0.25, kmh / 600));
    const cp = chassis ? chassis.position : { x: 0, z: 0 }, dRiver = Math.abs(cp.x - riverX(cp.z)), dFall = Math.hypot(cp.x - fallPos.x, cp.z - fallPos.z);
    set(snd.water.g.gain, muted ? 0 : 0.10 * Math.max(0, 1 - Math.max(0, dRiver - 60) / 120));
    set(snd.fall.g.gain, muted ? 0 : 0.35 * Math.max(0, 1 - dFall / 160));
    const inTrees = chassis ? (inGrove(cp.x, cp.z) || dRiver < 160) : true; snd.birds = muted ? 0 : (inTrees ? 1 : 0.4);
  };
  const toggleMute = () => { muted = !muted; $('soundBtn').setAttribute('aria-pressed', String(!muted)); say(muted ? 'Sound off' : 'Sound on'); startAudio(); };
  let lightsOn = false;
  const toggleLights = () => {
    lightsOn = !lightsOn; $('lightBtn').setAttribute('aria-pressed', String(lightsOn));
    scene.materials.forEach((m) => { if (m.name === 'Lens_Head' || m.name === 'Bulb_Head') { m.emissiveColor = lightsOn ? new C3(1, 0.93, 0.8) : C3.Black(); m.emissiveIntensity = lightsOn ? (m.name === 'Bulb_Head' ? 6 : 1.2) : 0; }
      if (m.name === 'Lens_Red' || m.name === 'Bulb_Tail') { m.emissiveColor = lightsOn ? new C3(1, 0.06, 0.03) : C3.Black(); m.emissiveIntensity = lightsOn ? 1.6 : 0; } });
    beams.forEach((b) => (b.light.intensity = lightsOn ? 40 : 0));
    say(lightsOn ? 'Lights on' : 'Lights off');
  };
  const resetCar = () => { if (!chassis) return; const ns = nearestSample(chassis.position.x, chassis.position.z, 6); spawnAt(ns ? ns.i : 0); say('Car reset onto the road'); };
  { const sel = $('carSel');                                             // garage: switching car reloads the page with ?car=
    for (const id of CAR_IDS) { const o = document.createElement('option'); o.value = id; o.textContent = CARS[id].name; if (id === CAR_ID) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('car', sel.value); location.href = u.href; });
    $('c').setAttribute('aria-label', `A drivable ${CAR.desc} on a country circuit in the Po valley, crossing the river twice.`); }
  $('camBtn').addEventListener('click', cycleCam); $('lightBtn').addEventListener('click', toggleLights); $('resetBtn').addEventListener('click', resetCar);
  $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
  $('perfBtn').addEventListener('click', () => togglePerf());
  $('timeBtn').addEventListener('click', toggleGolden); $('soundBtn').addEventListener('click', toggleMute);
  $('hornBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); startAudio(); horn(true); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('hornBtn').addEventListener(ev, () => horn(false)));

  // ---------- simulation + camera ----------
  let steer = 0, lapStart = performance.now(), best = null, lastIdx = 0, lapArmed = false;
  const fmt = (ms) => { const s = ms / 1000; return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
  const fwdV = new CANNON.Vec3(), tmpQ = new BABYLON.Quaternion();
  const drive = (dt, sim) => {
    if (!chassis) return;
    chassis.quaternion.vmult(new CANNON.Vec3(0, 0, 1), fwdV);
    const vF = chassis.velocity.dot(fwdV), kmh = Math.abs(vF) * 3.6;
    const on = driving;
    const kUp = on && (keys.ArrowUp || keys.KeyW), kDown = on && (keys.ArrowDown || keys.KeyS), kL = on && (keys.ArrowLeft || keys.KeyA), kR = on && (keys.ArrowRight || keys.KeyD), hand = !on || keys.Space;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.7);          // fine control around the centre of the stick
    const jx = on ? curve(dz(joy.x)) : 0, jy = on ? joy.y : 0;
    const thr = kUp ? 1 : Math.max(0, dz(-jy)), brk = kDown ? 1 : Math.max(0, dz(jy));
    const maxSteer = lerp(0.42, 0.09, Math.min(1, kmh / 130));
    const target = Math.max(-1, Math.min(1, (kR ? 1 : 0) - (kL ? 1 : 0) + jx)) * maxSteer;
    steer += (target - steer) * Math.min(1, dt * (target === 0 ? 4.0 : 2.4));
    let eng = 0, brake = 0;
    if (thr > 0) eng = -2500 * (CAR.power || 1) * thr * Math.max(0, 1 - Math.pow(kmh / CAR.vmax, 1.6)) * (vF < -0.5 ? 1.4 : 1);   // forward drive also cancels a roll backwards
    if (brk > 0) { if (vF > 0.8) brake = 60 * brk; else eng = 1100 * brk * Math.max(0, 1 - kmh / 35); }
    if (thr === 0 && brk === 0) brake = on ? 4 : 0;
    if (!on) { eng = 0; brake = 100; }
    for (let w = 0; w < 4; w++) {
      vehicle.applyEngineForce(w < 2 ? eng : 0, w);
      vehicle.setBrake(hand && w >= 2 ? (on ? 120 : 100) : brake, w);
    }
    vehicle.setSteeringValue(steer, 0); vehicle.setSteeringValue(steer, 1);
    const sp = chassis.velocity.norm(); chassis.applyForce(chassis.velocity.scale(-0.45 * sp), chassis.position);
    const tPhys = performance.now();
    if (sim) world.step(1 / 60); else world.step(1 / 60, dt, 3);
    if (typeof perfAdd === 'function') perfAdd('physics (cannon)', performance.now() - tPhys);
    if (chassis.position.y < -2.2) resetCar();
    if (sim) return;
    // pose the car
    const q = new BABYLON.Quaternion(chassis.quaternion.x, chassis.quaternion.y, chassis.quaternion.z, chassis.quaternion.w);
    rig.rotationQuaternion.copyFrom(q);
    rig.position.copyFrom(new V3(chassis.position.x, chassis.position.y, chassis.position.z).subtract(new V3(0, C0Y, 0).applyRotationQuaternion(q)));
    rig.computeWorldMatrix(true);
    wheels.forEach((w, i) => {
      w.spin += vF * dt / w.r;
      vehicle.updateWheelTransform(i);
      const wp = vehicle.wheelInfos[i].worldTransform.position, par = w.node.parent; par.computeWorldMatrix(true);
      const local = BABYLON.Vector3.TransformCoordinates(new V3(wp.x, wp.y, wp.z), par.getWorldMatrix().clone().invert());
      w.node.position.y = local.y;
      BABYLON.Quaternion.RotationYawPitchRollToRef(w.front ? -steer : 0, w.spin, 0, w.node.rotationQuaternion);
    });
    if (steerWheel) steerWheel.rotationQuaternion.copyFrom(steerWheelRest.multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, -steer * 13)));
    // camera
    const cp = new V3(chassis.position.x, chassis.position.y, chassis.position.z), fw = new V3(fwdV.x, 0, fwdV.z).normalize();
    if (look.id === null) { look.idleT += dt; if (look.idleT > 0.9) { const k2 = 1 - Math.exp(-dt * 2.2); look.yaw *= 1 - k2; look.pitch *= 1 - k2; } }   // view drifts back behind the car
    if (camMode === 0 || camMode === 1) {
      const dist = camMode === 0 ? 6.2 : 11, hgt = camMode === 0 ? 2.1 : 3.6;
      const rb = fw.scale(-dist).applyRotationQuaternion(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, look.yaw));
      const want = cp.add(rb.scale(Math.cos(look.pitch))).add(new V3(0, hgt + Math.sin(look.pitch) * dist, 0));
      want.y = Math.max(want.y, terrainH(want.x, want.z) + 0.8);
      const k = V3.Distance(camera.position, want) > 25 ? 1 : 1 - Math.exp(-dt * 6); camera.position = V3.Lerp(camera.position, want, k);   // snap after resets
      if (kmh > 95) camera.position.addInPlace(new V3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).scale(0.012 * (kmh - 95) / 60));   // a little road buzz at speed
      camera.setTarget(cp.add(fw.scale(3 * Math.max(0, Math.cos(look.yaw)))).add(new V3(0, 0.6, 0))); camera.fov = 0.9 + Math.min(0.2, kmh / 650);
    } else if (camMode === 2) {
      const eye = new V3(CAR.eye[0], CAR.eye[1] - C0Y, CAR.eye[2]).applyRotationQuaternion(q).add(cp);
      const ld = new V3(fwdV.x, fwdV.y, fwdV.z).applyRotationQuaternion(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, look.yaw));
      camera.position = eye; camera.setTarget(eye.add(ld.scale(10)).add(new V3(0, -0.4 - look.pitch * 6, 0))); camera.fov = 1.05;
    } else orbit.target = V3.Lerp(orbit.target, cp.add(new V3(0, 0.6, 0)), 1 - Math.exp(-dt * 8));
    // shadows follow the car
    sun.position = cp.subtract(sunDir.scale(120));
    updateAudio(kmh, thr, dt);
    beams.forEach((b) => { b.light.position = new V3(b.side * CAR.lamp[0], CAR.lamp[1] - C0Y, CAR.lamp[2]).applyRotationQuaternion(q).add(cp); b.light.direction = new V3(fwdV.x, fwdV.y - 0.12, fwdV.z); });
    // lap timing
    const ns = nearestSample(cp.x, cp.z, 3);
    if (ns) {
      const i = ns.i;
      if (i > N * 0.45 && i < N * 0.55) lapArmed = true;
      if (lapArmed && lastIdx > N * 0.9 && i < N * 0.1) { const lt = performance.now() - lapStart; if (best === null || lt < best) best = lt; $('best').textContent = fmt(best); lapStart = performance.now(); lapArmed = false; say('Lap ' + fmt(lt)); }
      lastIdx = i;
    }
    $('spd').textContent = Math.round(kmh); $('lap').textContent = fmt(performance.now() - lapStart);
  };
  scene.onBeforeRenderObservable.add(() => drive(Math.min(engine.getDeltaTime() / 1000, 0.05), false));

  const start = async () => {
    if (!NOCAR) { await setupCar(); setDriving(false); }
    else { chassis = null; camera.position.set(-HALF - RAD - 30, 30, -60); camera.setTarget(new V3(-HALF, 0, 0)); }
    if (mirror) {
      // only what can actually appear in the river: sky, mountains, bridges, bank trees and the waterfall bluff
      const keep = /^(sky|alps|deck|pier|pierCap|chord|diag|vert|railPost|railBeam|rock\d+|fallSheet|rivTrunk|rivCrown|broad(Wood|Leaves))/;
      mirror.renderList = scene.meshes.filter((m) => keep.test(m.name));      // the car is hidden by the bridge deck from the water's point of view
      // far from the river nobody sees it: refresh rarely
      scene.onBeforeRenderObservable.add(() => {
        const p = scene.activeCamera.position, near = Math.abs(p.x - riverX(p.z)) < 260;
        mirror.refreshRate = near ? 3 : 60;
      });
    }
    statusEl.hidden = true; canvas.focus({ preventScroll: true });
  };
  start().catch((e) => { console.error(e); fail('The game could not start: ' + (e.message || e)); });
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  // ---------- performance dashboard (P key or the Perf button): per-pass timings, counters, and switches to A/B each feature ----------
  const PERF = { acc: {}, n: 0, t0: {}, last: performance.now(), frames: 0 };
  const perfAdd = (k, ms) => { PERF.acc[k] = (PERF.acc[k] || 0) + ms; };
  const hookRTT = (name, rtt) => { if (!rtt || rtt.__perf) return; rtt.__perf = 1;
    rtt.onBeforeRenderObservable.add(() => { PERF.t0[name] = performance.now(); }); rtt.onAfterRenderObservable.add(() => perfAdd(name, performance.now() - PERF.t0[name])); };
  const si = new BABYLON.SceneInstrumentation(scene);
  si.captureFrameTime = si.captureRenderTime = si.captureRenderTargetsRenderTime = si.captureActiveMeshesEvaluationTime = si.captureInterFrameTime = si.captureCameraRenderTime = true;
  let ei = null; try { ei = new BABYLON.EngineInstrumentation(engine); ei.captureGPUFrameTime = true; } catch (e) {}
  const gpuName = (() => { try { const i = engine.getInfo ? engine.getInfo() : engine.getGlInfo(); return (i.renderer || '') + ' / ' + (i.vendor || ''); } catch (e) { return 'unknown'; } })();
  const panel = document.createElement('div'); panel.id = 'perf'; panel.hidden = true;
  panel.innerHTML = '<div id="perfStats"></div><div id="perfToggles"></div>';
  document.body.appendChild(panel);
  const css = document.createElement('style');
  css.textContent = `#perf { position: fixed; left: 12px; top: calc(92px + env(safe-area-inset-top, 0px)); z-index: 5; background: rgba(10,14,12,0.86); color: #e9efe9; border-radius: 10px;
    padding: 10px 12px; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; max-height: calc(100% - 120px); overflow: auto; min-width: 300px; }
    #perf[hidden] { display: none; } #perf b { color: #f2c14e; font-weight: 700; } #perf .bar { display: inline-block; height: 8px; background: #f2c14e; vertical-align: middle; margin-left: 6px; border-radius: 2px; }
    #perfToggles { margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; } #perfToggles label { cursor: pointer; white-space: nowrap; }`;
  document.head.appendChild(css);
  const byName = (re) => scene.meshes.filter((m) => re.test(m.name));
  const SWITCHES = [
    ['River reflection', (on) => { if (mirror) wm.reflectionTexture = on ? mirror : null; }],
    ['Shadows', (on) => { sun.shadowEnabled = on; }],
    ['Leafy trees (near)', (on) => detailed.concat(detailedVillage).forEach((m) => { m._perfOff = !on; if (!on) m.setEnabled(false); })],
    ['Far trees', (on) => byName(/^(poplarTrunk|poplarCrown|hedgeTrunk|hedgeCrown|rivTrunkA|rivCrownA|orchTrunk|orchCrown)(@|$)/).forEach((m) => { m._perfOff = !on; if (!on) m.setEnabled(false); })],
    ['Grass & reeds', (on) => byName(/Cards(@|$)/).forEach((m) => { m._perfOff = !on; if (!on) m.setEnabled(false); })],
    ['Village', (on) => byName(/^(village_|villageLod_|lampPoles|lampHeads|fountain|roseGlass|roseRing|villageSign|bale)/).forEach((m) => m.setEnabled(on))],
    ['Bridges', (on) => byName(/^(deck|pier|pierCap|chord|diag|vert|railPost|railBeam)$/).forEach((m) => m.setEnabled(on))],
    ['Waterfall particles', (on) => scene.particleSystems.forEach((p) => (on ? p.start() : p.stop()))],
    ['Car', (on) => { if (rig) scene.meshes.forEach((m) => { if (m.isDescendantOf(rig)) m.setEnabled(on); }); }],
    ['Roadside props', (on) => byName(/^(fence|tele|km)/).forEach((m) => { m._perfOff = !on; if (!on) m.setEnabled(false); })],
    ['Fog', (on) => { scene.fogEnabled = on; }],
    ['Bloom + AA', (on) => { if (post.pipe) { post.pipe.bloomEnabled = on; post.pipe.samples = on ? (isMobile ? 1 : 4) : 1; } }],
    ['Ambient occlusion', (on) => { if (post.ssao) { if (on) scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', [camera, orbit]); else scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('ssao', [camera, orbit]); } }],
    ['Sun rays', (on) => { raysOn = on; }],
  ];
  const tg = panel.querySelector('#perfToggles');
  SWITCHES.forEach(([label, fn], i) => { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" checked data-i="${i}"> ${label}`; tg.appendChild(l); l.querySelector('input').addEventListener('change', (e) => fn(e.target.checked)); });
  const hookAll = () => {
    hookRTT('shadow map', sg.getShadowMap()); if (mirror) hookRTT('river reflection', mirror);
    scene.customRenderTargets.forEach((r, i) => hookRTT(r.name || 'rtt' + i, r));
    scene.meshes.forEach((m) => { const mt = m.material; if (mt && mt.getRenderTargetTextures) { try { mt.getRenderTargetTextures().forEach((r) => hookRTT(r.name || 'material rtt', r)); } catch (e) {} } });
    const th = scene._transmissionHelper; if (th && th._opaqueSceneRT) hookRTT('glass refraction', th._opaqueSceneRT);
  };
  const fmt2 = (v) => (v === undefined || isNaN(v) ? '–' : v.toFixed(2));
  const bar = (ms, frame) => `<span class="bar" style="width:${Math.min(120, (ms / Math.max(frame, 1)) * 120).toFixed(0)}px"></span>`;
  scene.onAfterRenderObservable.add(() => {
    if (panel.hidden) return;
    PERF.frames++;
    const now = performance.now(); if (now - PERF.last < 600) return;
    hookAll();
    const n = PERF.frames, span = now - PERF.last, fps = n * 1000 / span, frame = span / n;
    const rows = Object.entries(PERF.acc).map(([k, v]) => [k, v / n]).sort((a, b) => b[1] - a[1]);
    const gpu = ei && ei.gpuFrameTimeCounter && ei.gpuFrameTimeCounter.average ? (ei.gpuFrameTimeCounter.average * 1e-6) : NaN;
    const activeTris = scene.getActiveIndices() / 3, dc = si.drawCallsCounter ? si.drawCallsCounter.current : NaN;
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : 'n/a';
    document.getElementById('perfStats').innerHTML =
      `<b>${fps.toFixed(1)} fps</b> &nbsp; frame ${fmt2(frame)} ms &nbsp; GPU ${isNaN(gpu) ? 'n/a' : fmt2(gpu) + ' ms'}<br>` +
      `CPU: scene render ${fmt2(si.renderTimeCounter.average)} ms, mesh selection ${fmt2(si.activeMeshesEvaluationTimeCounter.average)} ms, all render targets ${fmt2(si.renderTargetsRenderTimeCounter.average)} ms<br>` +
      rows.map(([k, v]) => `&nbsp; ${k}: ${fmt2(v)} ms ${bar(v, frame)}`).join('<br>') + '<br>' +
      `draw calls ${dc} &nbsp; active meshes ${scene.getActiveMeshes().length} &nbsp; triangles ${(activeTris / 1e6).toFixed(2)} M<br>` +
      `canvas ${engine.getRenderWidth()}×${engine.getRenderHeight()} (scale ${(1 / engine.getHardwareScalingLevel()).toFixed(2)}×, dpr ${window.devicePixelRatio}) &nbsp; JS heap ${mem}<br>` +
      `GPU: ${gpuName}<br>${usingWebGPU ? 'WebGPU' : 'WebGL ' + engine.webGLVersion}, ${isMobile ? 'mobile' : 'desktop'} profile <button id="rendSwitch" type="button">Switch to ${usingWebGPU ? 'WebGL' : 'WebGPU'}</button>`;
    PERF.acc = {}; PERF.frames = 0; PERF.last = now;
  });
  panel.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'rendSwitch') { if (usingWebGPU) sessionStorage.setItem('poForceWebGL', '1'); else sessionStorage.removeItem('poForceWebGL');
      const u = new URL(location.href); u.searchParams.delete('webgl'); location.replace(u.toString()); }
  });
  const togglePerf = () => { panel.hidden = !panel.hidden; PERF.acc = {}; PERF.frames = 0; PERF.last = performance.now(); $('perfBtn').setAttribute('aria-pressed', String(!panel.hidden)); };
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyP') togglePerf(); });
  window.__game = { TRACK_LEN: () => TRACK_LEN, scene, T, terrainH, world, keys, joy, look, setDriving: (v) => setDriving(v), get driving() { return driving; }, get chassis() { return chassis; }, sim: (n) => { for (let i = 0; i < n; i++) drive(1 / 60, true); } };
})();
