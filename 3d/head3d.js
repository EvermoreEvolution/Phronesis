// Phronesis 3D head: the bust generated from Michael's turnaround sheet, painted by projecting the
// front, side and back views, with a procedural jaw and lips driven by his voice, and a hologram finish.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// where the face sits on the mesh (measured from the front view)
const F = { mouthY: 0.262, chinY: 0.113, noseY: 0.374, eyeY: 0.517, cx: -0.010 };

const VS = `
uniform float uJaw, uWide, uTime;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying float vSeam;
const float MY = ${F.mouthY.toFixed(3)}; const float CY = ${F.chinY.toFixed(3)}; const float CX = ${F.cx.toFixed(3)};
void main(){
  vec3 p = position; vec3 n = normal;
  float ax = abs(p.x - CX);
  float front = smoothstep(0.02, 0.14, p.z);
  float side = 1.0 - smoothstep(0.10, 0.17, ax);
  // lower jaw: everything below the lip line down to the neck, front of the face
  float below = 1.0 - smoothstep(MY - 0.026, MY - 0.002, p.y);
  float neck = smoothstep(CY - 0.075, CY - 0.02, p.y);
  float wj = below * neck * front * side;
  float ang = uJaw * 0.20;
  vec3 piv = vec3(CX, MY + 0.05, -0.06);
  vec3 q = p - piv; float c = cos(ang), s = sin(ang);
  vec3 r = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c) + piv;
  p = mix(p, r, wj);
  // upper lip lifts a touch, corners widen
  float above = smoothstep(MY - 0.002, MY + 0.006, position.y) * (1.0 - smoothstep(MY + 0.012, MY + 0.030, position.y));
  p.y += above * front * side * uJaw * 0.007;
  float lipBand = (1.0 - smoothstep(0.0, 0.03, abs(position.y - MY))) * front * side;
  p.x += sign(p.x - CX) * lipBand * uWide * 0.012 * smoothstep(0.02, 0.07, ax);
  // the seam between the lips opens: mark it so the fragment can darken it as the mouth interior
  vSeam = (1.0 - smoothstep(0.0, 0.010, abs(position.y - (MY - 0.004)))) * front * (1.0 - smoothstep(0.035, 0.06, ax)) * uJaw;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vPos = position; vN = normalize(normalMatrix * n); vView = -(viewMatrix * wp).xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = `
uniform sampler2D tF, tS, tB; uniform float uHolo, uTime, uAwake, uReveal; uniform vec3 uTint;
varying vec3 vPos; varying vec3 vN; varying vec3 vView; varying float vSeam;
vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// cell edges (circuit traces) and cell centres (nodes)
vec2 cells(vec2 x){ vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0; vec2 c1;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec2 o = h2(n + g); vec2 r = g + o - f; float d = max(abs(r.x), abs(r.y)) * 0.6 + length(r) * 0.4;
    if (d < d1) { d2 = d1; d1 = d; c1 = r; } else if (d < d2) d2 = d; }
  return vec2(d2 - d1, length(c1)); }
// projection: mesh units -> pixel coords in the 768px views
vec2 uvF(vec3 p){ return vec2((p.x + 0.469) / 0.912 * (336.0/768.0) + 215.0/768.0, 1.0 - ((0.973 - p.y) / 1.973 * (757.0/768.0) + 10.0/768.0)); }
vec2 uvS(vec3 p){ return vec2((0.399 - p.z) / 0.797 * (267.0/768.0) + 250.0/768.0, 1.0 - ((0.973 - p.y) / 1.973 * (757.0/768.0) + 12.0/768.0)); }
vec2 uvB(vec3 p){ return vec2((0.443 - p.x) / 0.912 * (322.0/768.0) + 223.0/768.0, 1.0 - ((0.973 - p.y) / 1.973 * (757.0/768.0) + 11.0/768.0)); }
void main(){
  vec3 n = normalize(vN), v = normalize(vView);
  vec3 on = normalize(cross(dFdx(vPos), dFdy(vPos)));
  float wf = pow(max(on.z, 0.0), 3.0), wb = pow(max(-on.z, 0.0), 3.0), ws = pow(abs(on.x), 3.0) * 1.2;
  vec3 col = (texture2D(tF, uvF(vPos)).rgb * wf + texture2D(tS, uvS(vPos)).rgb * ws + texture2D(tB, uvB(vPos)).rgb * wb) / max(wf + wb + ws, 1e-3);
  col = mix(col, vec3(0.06, 0.03, 0.03), clamp(vSeam * 1.6, 0.0, 0.92));
  // light: soft key from the front-left
  float lit = 0.75 + 0.35 * max(dot(n, normalize(vec3(-0.3, 0.4, 1.0))), 0.0);
  vec3 real = col * lit;
  // hologram finish (Michael's reference): real face with a soft blue edge glow; the suit is the
  // glowing blue circuit suit with gold piping
  float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  float jacket = 1.0 - smoothstep(0.05, 0.12, vPos.y);
  float scan = 0.95 + 0.05 * sin(vPos.y * 520.0 - uTime * 4.0);
  float bp = fract(vPos.y * 1.1 - uTime * 0.16); float band = smoothstep(0.0, 0.012, bp) * (1.0 - smoothstep(0.012, 0.05, bp));
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  // face and hair: real colour, cooled, soft blue rim only at the silhouette
  vec3 face = mix(real, real * vec3(0.85, 0.96, 1.16), 0.55) * scan + uTint * (pow(fr, 1.6) * 0.7 + band * 0.10);
  // suit: deep navy base, blue circuit traces, glowing nodes, gold piping from the bright seams
  vec2 cp = vec2(vPos.x * (abs(on.x) > 0.6 ? 0.0 : 1.0) + vPos.z * (abs(on.x) > 0.6 ? 1.0 : 0.0), vPos.y) * 9.0;
  vec2 ce = cells(cp + vec2(0.0, 0.0));
  float trace = 1.0 - smoothstep(0.0, 0.035, ce.x);
  float node = 1.0 - smoothstep(0.0, 0.06, ce.y);
  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h2(floor(cp)).x * 6.28);
  float gold = smoothstep(0.17, 0.32, lum) * (1.0 - smoothstep(0.55, 0.8, lum));
  vec3 navy = vec3(0.02, 0.06, 0.16) + real * 0.2 + uTint * 0.10 * (0.6 + 0.4 * sin(vPos.y * 30.0 + uTime));
  vec3 suit = navy + vec3(0.25, 0.6, 1.0) * trace * 1.1 * tw + vec3(0.6, 0.85, 1.0) * node * 1.2 * tw
            + vec3(1.0, 0.72, 0.30) * gold * 1.6 + uTint * (fr * 1.8 + band * 0.3);
  vec3 holo = mix(face, suit, jacket);
  vec3 outc = mix(real, holo, uHolo);
  float fade = smoothstep(-0.98, -0.55, vPos.y);   // the bust dissolves into light at the base
  outc += uTint * (1.0 - fade) * 0.35;
  gl_FragColor = vec4(outc * (0.25 + 0.75 * uAwake), fade * uAwake);
  if (gl_FragColor.a < 0.01) discard;
}`;

export async function createHead3D(canvas, opts = {}) {
  const base = opts.base || './';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
  const tl = new THREE.TextureLoader();
  const [gltf, tF, tS, tB] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'head.glb'),
    tl.loadAsync(base + 'front.jpg'), tl.loadAsync(base + 'side.jpg'), tl.loadAsync(base + 'back.jpg')]);
  [tF, tS, tB].forEach(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
  const U = { tF: { value: tF }, tS: { value: tS }, tB: { value: tB }, uJaw: { value: 0 }, uWide: { value: 0 }, uTime: { value: 0 },
    uHolo: { value: opts.holo ?? 0.65 }, uAwake: { value: 1 }, uReveal: { value: 0 }, uTint: { value: new THREE.Color(0.35, 0.7, 1.0) } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, extensions: { derivatives: true } });
  const pivot = new THREE.Group(); scene.add(pivot);
  gltf.scene.traverse(o => { if (o.isMesh) { o.geometry.computeVertexNormals(); o.material = mat; } });
  pivot.add(gltf.scene);
  // base ring like the reference
  const ringM = new THREE.MeshBasicMaterial({ color: 0x5ab4ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = [0.62, 0.72, 0.84].map((r, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004 + i * 0.002, 6, 128), ringM); m.rotation.x = Math.PI / 2; m.position.y = -0.98; scene.add(m); return m; });

  const api = { state: 'listening', jaw: 0, wide: 0, holo: U.uHolo, U, mouthFn: null };
  let look = { x: 0, y: 0, tx: 0, ty: 0, next: 0 }, t0 = performance.now(), last = t0;
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    const fit = opts.frame === 'face' ? 0.9 : 1.75, dist = fit / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / Math.min(1, cam.aspect * 1.1);
    cam.position.set(0, opts.frame === 'face' ? 0.42 : 0.12, dist * 0.55); cam.lookAt(0, opts.frame === 'face' ? 0.40 : 0.10, 0);
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = (now - t0) / 1000; U.uTime.value = t;
    resize();
    let target = [0, 0];
    if (api.state === 'speaking' && api.mouthFn) { const m = api.mouthFn(); target = [m[0], m[1]]; }
    api.jaw += (target[0] - api.jaw) * Math.min(1, dt * 28); api.wide += (target[1] - api.wide) * Math.min(1, dt * 20);
    U.uJaw.value = api.jaw; U.uWide.value = api.wide;
    look.next -= dt; if (look.next < 0) { look.tx = (Math.random() - 0.5) * 0.22; look.ty = (Math.random() - 0.5) * 0.08; look.next = 1.5 + Math.random() * 3; }
    look.x += (look.tx - look.x) * dt * 2; look.y += (look.ty - look.y) * dt * 2;
    const sp = api.state === 'speaking' ? 0.5 : 1;
    pivot.rotation.y = look.x * sp + Math.sin(t * 0.4) * 0.03; pivot.rotation.x = look.y * sp + (api.state === 'speaking' ? api.jaw * 0.03 : 0) + (api.state === 'processing' ? 0.06 : 0);
    pivot.position.y = Math.sin(t * 0.9) * 0.006;
    rings.forEach((r, i) => { r.rotation.z = t * (0.2 + i * 0.13) * (i % 2 ? -1 : 1); r.material.opacity = 0.35 + 0.2 * Math.sin(t * 2 + i); });
    renderer.render(scene, cam);
  }
  requestAnimationFrame(frame);
  // same controls as the flat head, so the page can use either
  let awakeAnim = null;
  api.ok = true; api.is3D = true;
  api.setState = (st) => { api.state = st; if (st === 'dormant') { U.uAwake.value = 0; awakeAnim = null; } else if (U.uAwake.value < 1 && !awakeAnim) U.uAwake.value = 1; };
  api.snap = (st) => api.setState(st);
  api.say = () => { api.state = 'speaking'; if (U.uAwake.value < 1 && !awakeAnim) U.uAwake.value = 1; };
  api.stop = () => { if (api.state === 'speaking') api.state = 'listening'; };
  api.mouth = (fn) => { api.mouthFn = fn; };
  api.wake = () => { api.state = 'activating'; U.uAwake.value = 0; const st = performance.now();
    awakeAnim = setInterval(() => { const u = Math.min(1, (performance.now() - st) / 2200); U.uAwake.value = u * u * (3 - 2 * u);
      if (u >= 1) { clearInterval(awakeAnim); awakeAnim = null; api.state = 'listening'; if (api.onAwake) api.onAwake(); } }, 30); };
  return api;
}
