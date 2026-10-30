/* The Command globe: a draggable holographic Earth with 22 agent satellites on three orbit rings,
   route drawings between agents, and arcs from Worcester. Three.js r128. All demo data. */
window.PhrGlobe = function (cfg) {
  var cv = cfg.cv, lab = cfg.lab, labc = lab.getContext('2d');
  var AGENTS = cfg.agents, api = { ok: false, active: true };
  var renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return api; }
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  renderer.setClearColor(0x000000, 0);
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  var pitchG = new THREE.Group(), yawG = new THREE.Group(); scene.add(pitchG); pitchG.add(yawG);
  var W = 1, H = 1, DPR = 1, PX = 1000;
  var D2R = Math.PI / 180;
  function ll(lat, lon, r) { var p = lat * D2R, l = lon * D2R; return new THREE.Vector3(r * Math.cos(p) * Math.sin(l), r * Math.sin(p), r * Math.cos(p) * Math.cos(l)); }
  var WORC = { lat: 42.2626, lon: -71.8023 };
  var uniforms = { uTime: { value: 0 }, uPx: { value: 1000 }, uDPR: { value: 1 }, uW: { value: ll(WORC.lat, WORC.lon, 1).normalize() } };

  // ---------- body, atmosphere, graticule ----------
  var body = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 54), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec3 n = normalize(vN); float f = 1.0 - max(dot(n, normalize(vV)), 0.0); float l = dot(n, normalize(vec3(-.55,.55,.65)))*.5+.5; vec3 c = mix(vec3(.010,.026,.066), vec3(.09,.32,.78), pow(f,2.6)); c += vec3(.012,.04,.10)*l; gl_FragColor = vec4(c, .80 + .18*pow(f,2.0)); }'
  }));
  body.renderOrder = 1; yawG.add(body);
  var atmo = new THREE.Mesh(new THREE.SphereGeometry(1.17, 56, 42), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float i = pow(max(0.0, 0.66 - dot(vN, vec3(0.,0.,1.))), 3.2); gl_FragColor = vec4(.22,.52,1.0,1.0)*i*1.25; }'
  }));
  atmo.renderOrder = 0; pitchG.add(atmo);
  (function () {
    var pos = [], i, j, seg = 72;
    for (i = -60; i <= 60; i += 30) for (j = 0; j < seg; j++) { var a = ll(i, j * 360 / seg, 1.002), b = ll(i, (j + 1) * 360 / seg, 1.002); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    for (i = 0; i < 360; i += 30) for (j = -90; j < 90; j += 5) { var c = ll(j, i, 1.002), d = ll(j + 5, i, 1.002); pos.push(c.x, c.y, c.z, d.x, d.y, d.z); }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4a7fe0, transparent: true, opacity: .13, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.renderOrder = 2; yawG.add(m);
  })();

  // ---------- land dots ----------
  (function () {
    var bin = atob(cfg.landBits), bytes = new Uint8Array(bin.length), k;
    for (k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    function land(lat, lon) { var c = Math.floor((lon + 180) / 360 * 720) % 720, r = Math.min(359, Math.max(0, Math.floor((90 - lat) / 180 * 360))), b = r * 720 + c; return (bytes[b >> 3] >> (7 - (b & 7))) & 1; }
    var N = 30000, pos = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var z = 1 - 2 * (i + .5) / N, lat = Math.asin(z) / D2R, lon = ((i * ga) / D2R) % 360 - 180;
      if (lon < -180) lon += 360;
      if (land(lat, lon)) { var v = ll(lat, lon, 1.004); pos.push(v.x, v.y, v.z); }
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: [
        'uniform float uPx; uniform float uDPR; uniform vec3 uW; varying float vF; varying float vG;',
        'void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vec3 n = normalize(wp.xyz); vF = dot(n, normalize(cameraPosition - wp.xyz));',
        'vG = smoothstep(0.9905, 0.9985, dot(normalize(position), uW));',
        'vec4 mv = viewMatrix*wp; gl_PointSize = max(1.0, (0.0135 + vG*0.006) * uPx * uDPR / -mv.z); gl_Position = projectionMatrix*mv; }'
      ].join('\n'),
      fragmentShader: [
        'varying float vF; varying float vG;',
        'void main(){ vec2 q = gl_PointCoord - .5; float d = length(q); if (d > .5) discard; float a = smoothstep(.5, .2, d);',
        'float near = smoothstep(-.15, .55, vF); float al = mix(.10, 1.0, near) * a;',
        'vec3 c = mix(vec3(.38,.72,1.0), vec3(1.0,.80,.42), vG); gl_FragColor = vec4(c, al*(.78 + .22*vG)); }'
      ].join('\n')
    }));
    m.renderOrder = 3; yawG.add(m);
  })();

  // ---------- Worcester marker, lead dots, arcs ----------
  var wv = ll(WORC.lat, WORC.lon, 1.006);
  var mark = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([wv.x, wv.y, wv.z], 3)), new THREE.ShaderMaterial({
    uniforms: uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uPx; uniform float uDPR; uniform float uTime; varying float vF; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vF = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)); vec4 mv = viewMatrix*wp; gl_PointSize = (0.15 + 0.02*sin(uTime*2.6)) * uPx * uDPR / -mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying float vF; void main(){ vec2 q = gl_PointCoord-.5; float d = length(q); if (d>.5) discard; float core = smoothstep(.10,.0,d); float halo = smoothstep(.5,.0,d)*.55; float ring = smoothstep(.04,.0,abs(d-.30))*.9; float al = (core+halo+ring)*smoothstep(-.1,.35,vF); gl_FragColor = vec4(1.0,.80,.42, al); }'
  }));
  mark.renderOrder = 6; yawG.add(mark);
  var PLACES = [
    ['Boston', 42.3601, -71.0589], ['Providence', 41.824, -71.4128], ['Hartford', 41.7658, -72.6734], ['Springfield', 42.1015, -72.5898],
    ['Manchester', 42.9956, -71.4548], ['Portland', 43.6591, -70.2568], ['New Haven', 41.3083, -72.9279], ['Albany', 42.6526, -73.7562]
  ];
  var LEADS = [['Auburn', 42.1945, -71.8368], ['Shrewsbury', 42.2959, -71.7128], ['Leominster', 42.5251, -71.7598], ['Framingham', 42.2793, -71.4162], ['Marlborough', 42.3459, -71.5523], ['Northbridge', 42.1487, -71.6502], ['Holden', 42.3526, -71.8640], ['Westborough', 42.2696, -71.6162]];
  var leadPts = (function () {
    var pos = [], i; for (i = 0; i < LEADS.length; i++) { var v = ll(LEADS[i][1], LEADS[i][2], 1.006); pos.push(v.x, v.y, v.z); }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(new Float32Array(LEADS.length), 1));
    var m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'uniform float uPx; uniform float uDPR; attribute float aB; varying float vF; varying float vB; void main(){ vB = aB; vec4 wp = modelMatrix*vec4(position,1.0); vF = dot(normalize(wp.xyz), normalize(cameraPosition - wp.xyz)); vec4 mv = viewMatrix*wp; gl_PointSize = max(3.0, (0.035 + 0.06*aB) * uPx * uDPR / -mv.z); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying float vF; varying float vB; void main(){ vec2 q = gl_PointCoord-.5; float d = length(q); if (d>.5) discard; float a = smoothstep(.5,.05,d); float al = a*(.35+.65*vB)*smoothstep(-.1,.35,vF); gl_FragColor = vec4(1.0,.84,.5, al); }'
    }));
    m.renderOrder = 6; yawG.add(m); return m;
  })();
  function arcLine(a, b, lift, segs) {
    var va = ll(a[0], a[1], 1), vb = ll(b[0], b[1], 1), pos = [], ts = [], i;
    var ang = va.angleTo(vb);
    for (i = 0; i <= segs; i++) {
      var t = i / segs, p = new THREE.Vector3().copy(va).lerp(vb, t).normalize().multiplyScalar(1.005 + Math.sin(Math.PI * t) * lift * ang);
      pos.push(p.x, p.y, p.z); ts.push(t);
    }
    return { pos: pos, ts: ts };
  }
  var arcs = PLACES.map(function (pl, idx) {
    var a = arcLine([WORC.lat, WORC.lon], [pl[1], pl[2]], 0.5, 40);
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(a.ts, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uB: { value: 0 }, uOff: { value: idx * 0.37 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uTime; uniform float uB; uniform float uOff; varying float vT; void main(){ float p = fract(uTime*.22 + uOff); float d = abs(vT - p); d = min(d, 1.0-d); float pulse = smoothstep(.12, .0, d); float al = .16 + .85*pulse*(.35+uB) + .5*uB*(1.0-vT); gl_FragColor = vec4(mix(vec3(.4,.72,1.0), vec3(1.0,.82,.5), pulse), al*.8); }'
    });
    var line = new THREE.Line(g, mat); line.renderOrder = 5; yawG.add(line); return { m: mat, b: 0 };
  });

  // ---------- orbit rings and satellites ----------
  var RINGS = [
    { r: 1.34, tilt: [1.08, 0.0, 0.35], speed: .060, teams: ['command', 'care'] },
    { r: 1.60, tilt: [-0.52, 0.0, -0.30], speed: -.042, teams: ['research', 'outreach'] },
    { r: 1.88, tilt: [0.26, 0.0, 0.12], speed: .030, teams: ['marketing', 'delivery'] }
  ];
  var sats = [];
  RINGS.forEach(function (R, ri) {
    var eul = new THREE.Euler(R.tilt[0], R.tilt[1], R.tilt[2]);
    var pts = []; for (var i = 0; i <= 160; i++) { var th = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(th) * R.r, 0, Math.sin(th) * R.r)); }
    var g = new THREE.BufferGeometry().setFromPoints(pts);
    [[0x5aa8ff, .38, 1], [0x5aa8ff, .10, 1.012]].forEach(function (q) {
      var l = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: q[0], transparent: true, opacity: q[1], depthWrite: false, blending: THREE.AdditiveBlending }));
      l.rotation.copy(eul); l.scale.setScalar(q[2]); l.renderOrder = 4; pitchG.add(l);
    });
    var mem = AGENTS.filter(function (a) { return R.teams.indexOf(a.team) >= 0; });
    mem.forEach(function (a, i) { sats.push({ id: a.id, name: a.name, ring: ri, th: i / mem.length * Math.PI * 2 + ri * .7, eul: eul, r: R.r, speed: R.speed, color: new THREE.Color(a.color), s: 'waiting', pos: new THREE.Vector3(), scr: [0, 0, 0], occ: false }); });
  });
  var SAT = {}; sats.forEach(function (s) { SAT[s.id] = s; });
  var N = sats.length, satPos = new Float32Array(N * 3), satCol = new Float32Array(N * 3), satSize = new Float32Array(N), satMode = new Float32Array(N), satAl = new Float32Array(N);
  var satG = new THREE.BufferGeometry();
  satG.setAttribute('position', new THREE.BufferAttribute(satPos, 3)); satG.setAttribute('aCol', new THREE.BufferAttribute(satCol, 3));
  satG.setAttribute('aSize', new THREE.BufferAttribute(satSize, 1)); satG.setAttribute('aMode', new THREE.BufferAttribute(satMode, 1)); satG.setAttribute('aAl', new THREE.BufferAttribute(satAl, 1));
  var satMat = new THREE.ShaderMaterial({
    uniforms: uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uPx; uniform float uDPR; attribute vec3 aCol; attribute float aSize; attribute float aMode; attribute float aAl; varying vec3 vC; varying float vM; varying float vA; void main(){ vC = aCol; vM = aMode; vA = aAl; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize * uPx * uDPR / -mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform float uTime; varying vec3 vC; varying float vM; varying float vA; void main(){ vec2 q = gl_PointCoord-.5; float d = length(q); if (d>.5) discard; float core = smoothstep(.17,.04,d); float halo = smoothstep(.5,.0,d)*.5; float ring = 0.0; if (vM > .5 && vM < 1.5) ring = smoothstep(.035,.0,abs(d-.36))*(.6+.4*sin(uTime*4.0)); float blink = 1.0; if (vM > 1.5) { blink = .45 + .55*step(0.0, sin(uTime*7.0)); ring = smoothstep(.035,.0,abs(d-.36)); } vec3 c = mix(vC, vec3(1.0), core*.55); gl_FragColor = vec4(c, (core + halo + ring)*vA*blink); }'
  });
  var satPts = new THREE.Points(satG, satMat); satPts.frustumCulled = false; satPts.renderOrder = 8; pitchG.add(satPts);
  AGENTS.forEach(function (a, i) { var s = SAT[a.id]; if (s) { s.idx = i; } });
  sats.forEach(function (s, i) { s.k = i; satCol[i * 3] = s.color.r; satCol[i * 3 + 1] = s.color.g; satCol[i * 3 + 2] = s.color.b; });

  // ---------- routes between agents ----------
  var ROUTE_N = 12, routes = [];
  for (var ri2 = 0; ri2 < ROUTE_N; ri2++) {
    var rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(31 * 3), 3));
    var rl = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: .0, depthWrite: false, blending: THREE.AdditiveBlending }));
    rl.frustumCulled = false; rl.renderOrder = 7; scene.add(rl);
    var dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    var dm = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffffff, size: 7 * 1, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    dm.frustumCulled = false; dm.renderOrder = 9; scene.add(dm);
    routes.push({ line: rl, dot: dm, on: false });
  }
  var routeData = [];
  api.setRoutes = function (list) { routeData = list || []; };
  api.setStates = function (map) {
    for (var id in map) { var s = SAT[id]; if (s) { s.s = map[id].s; } }
  };
  var worcWorld = new THREE.Vector3();

  // ---------- stars ----------
  (function () {
    var pos = [], n = 260; for (var i = 0; i < n; i++) { var u = Math.random() * 2 - 1, t = Math.random() * 6.283, r = 14 + Math.random() * 6, q = Math.sqrt(1 - u * u); pos.push(r * q * Math.cos(t), r * u, r * q * Math.sin(t)); }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var m = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fc2ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: .55, depthWrite: false }));
    m.renderOrder = 0; scene.add(m);
  })();

  // ---------- camera and interaction ----------
  var view = { yaw: -WORC.lon * D2R, pitch: WORC.lat * D2R * .72, zoom: 1, tYaw: null, tPitch: null, tZoom: 1, vy: 0, vp: 0, sx: 0, sy: 0, idle: 0 };
  var hover = null, selected = null, dragging = false, last = { x: 0, y: 0 }, moved = 0, downAt = 0;
  var clock = 0, pinch = null, ptrs = {};
  function norm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  api.flyTo = function (lat, lon, zoom) { view.tYaw = view.yaw + norm(-lon * D2R - view.yaw); view.tPitch = Math.max(-1.2, Math.min(1.2, lat * D2R * .85)); view.tZoom = zoom || 1; view.idle = -6; };
  api.flyWorcester = function () { api.flyTo(WORC.lat, WORC.lon, .62); };
  api.flyHome = function () { api.flyTo(WORC.lat, WORC.lon, 1); };
  api.select = function (id) { selected = id; };
  api.ping = function (i) { if (leadPts) { var a = leadPts.geometry.attributes.aB; a.array[i % LEADS.length] = 1; a.needsUpdate = true; } var ar = arcs[i % arcs.length]; if (ar) ar.b = 1; };
  api.pingAll = function () { for (var i = 0; i < LEADS.length; i++) (function (i) { setTimeout(function () { api.ping(i); }, i * 220); })(i); };
  cv.addEventListener('pointerdown', function (e) {
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    var ids = Object.keys(ptrs);
    if (ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.tZoom }; dragging = false; return; }
    dragging = true; moved = 0; downAt = performance.now(); last.x = e.clientX; last.y = e.clientY; view.vy = view.vp = 0; view.tYaw = null; view.tPitch = null; cv.classList.add('drag');
  });
  cv.addEventListener('pointermove', function (e) {
    if (ptrs[e.pointerId]) { ptrs[e.pointerId].x = e.clientX; ptrs[e.pointerId].y = e.clientY; }
    var ids = Object.keys(ptrs);
    if (pinch && ids.length === 2) { var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y); view.tZoom = Math.max(.45, Math.min(1.5, pinch.z * pinch.d / Math.max(20, d))); return; }
    if (dragging) {
      var dx = e.clientX - last.x, dy = e.clientY - last.y; last.x = e.clientX; last.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      var k = .0058 * view.zoom; view.yaw += dx * k; view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + dy * k)); view.vy = dx * k * 60; view.vp = dy * k * 60; view.idle = 0;
    } else { pickAt(e.clientX, e.clientY, false); }
  });
  function up(e) {
    delete ptrs[e.pointerId]; if (Object.keys(ptrs).length < 2) pinch = null;
    if (dragging) { dragging = false; cv.classList.remove('drag'); if (moved < 6 && performance.now() - downAt < 500) pickAt(e.clientX, e.clientY, true); }
  }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', function () { if (!dragging) { hover = null; cfg.onHover && cfg.onHover(null); } });
  cv.addEventListener('wheel', function (e) { e.preventDefault(); view.tZoom = Math.max(.45, Math.min(1.5, view.tZoom * (1 + e.deltaY * .0012))); view.idle = 0; }, { passive: false });
  cv.addEventListener('dblclick', function () { api.flyWorcester(); });
  function pickAt(cx, cy, click) {
    var r = cv.getBoundingClientRect(), x = cx - r.left, y = cy - r.top, best = null, bd = 18 * 18, i;
    for (i = 0; i < sats.length; i++) { var s = sats[i]; if (s.occ) continue; var dx = s.scr[0] - x, dy = s.scr[1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s; } }
    var id = best ? best.id : null;
    if (click) { if (id && cfg.onPick) cfg.onPick(id); return; }
    if (id !== hover) { hover = id; cfg.onHover && cfg.onHover(id, best ? best.scr[0] : 0, best ? best.scr[1] : 0); }
    cv.style.cursor = id ? 'pointer' : '';
  }

  function resize() {
    W = cv.clientWidth || 1; H = cv.clientHeight || 1;
    DPR = Math.min(window.devicePixelRatio || 1, 2); DPR = Math.max(.75, Math.min(DPR, Math.sqrt(2.4e6 / Math.max(1, W * H))));
    renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
    lab.width = Math.round(W * DPR); lab.height = Math.round(H * DPR);
    camera.aspect = W / H; camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);
  resize();

  var tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), cp = new THREE.Vector3();
  function occluded(p) { // does the segment from the camera to p pass through the unit sphere?
    var c = camera.position, dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, L = dx * dx + dy * dy + dz * dz;
    var t = -(c.x * dx + c.y * dy + c.z * dz) / L; if (t <= 0 || t >= 1) return false;
    var qx = c.x + dx * t, qy = c.y + dy * t, qz = c.z + dz * t; return qx * qx + qy * qy + qz * qz < 0.97;
  }
  function sx(v) { return (v.x * .5 + .5) * W; } function sy(v) { return (-v.y * .5 + .5) * H; }
  var last2 = 0, tHover = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!api.active) { last2 = now; return; }
    var dt = Math.min(.05, (now - last2) / 1000 || .016); last2 = now; clock += dt;
    if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
    // view
    view.idle += dt;
    if (!dragging) {
      if (view.tYaw !== null) { var k = 1 - Math.exp(-3.2 * dt); view.yaw += (view.tYaw - view.yaw) * k; view.pitch += (view.tPitch - view.pitch) * k; if (Math.abs(view.tYaw - view.yaw) < .002 && Math.abs(view.tPitch - view.pitch) < .002) { view.tYaw = null; view.tPitch = null; } }
      else { view.yaw += view.vy * dt; view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + view.vp * dt)); view.vy *= Math.exp(-3.2 * dt); view.vp *= Math.exp(-3.2 * dt); if (view.idle > 7 && !reduce) view.yaw += .035 * dt; }
    }
    view.zoom += (view.tZoom - view.zoom) * (1 - Math.exp(-4 * dt));
    var sw = reduce ? 0 : Math.sin(clock * .21) * .06;
    yawG.rotation.y = view.yaw + sw; pitchG.rotation.x = view.pitch + (reduce ? 0 : Math.sin(clock * .16) * .02);
    var base = 2.08 / (Math.tan(16 * D2R) * Math.min(1, W / H));
    camera.position.set(0, 0, base * view.zoom); camera.lookAt(0, 0, 0);
    PX = H / (2 * Math.tan(16 * D2R)); uniforms.uPx.value = PX; uniforms.uDPR.value = DPR; uniforms.uTime.value = clock;
    scene.updateMatrixWorld(true);
    // satellites
    var i, s, alAll = 1;
    for (i = 0; i < sats.length; i++) {
      s = sats[i]; s.th += s.speed * dt * (reduce ? 0 : 1);
      tmp.set(Math.cos(s.th) * s.r, 0, Math.sin(s.th) * s.r).applyEuler(s.eul); s.pos.copy(tmp);
      satPos[i * 3] = tmp.x; satPos[i * 3 + 1] = tmp.y; satPos[i * 3 + 2] = tmp.z;
      tmp2.copy(tmp).applyMatrix4(pitchG.matrixWorld); s.world = s.world || new THREE.Vector3(); s.world.copy(tmp2);
      s.occ = occluded(tmp2); tmp2.project(camera); s.scr[0] = sx(tmp2); s.scr[1] = sy(tmp2);
      var st = s.s, size = .14, mode = 0, pulse = .5 + .5 * Math.sin(clock * 5 + i);
      if (st === 'working') { size = .18 + .035 * pulse; } else if (st === 'ready') { size = .16 + .02 * pulse; } else if (st === 'needs') { size = .19; mode = 1; } else if (st === 'problem') { size = .19; mode = 2; } else if (st === 'dormant') { size = .11; } else if (st === 'paused') { size = .11; } else if (st === 'done') { size = .165; }
      if (hover === s.id || selected === s.id) size *= 1.35;
      satSize[i] = size; satMode[i] = mode; satAl[i] = (s.occ ? .22 : 1) * (st === 'dormant' || st === 'paused' ? .45 : 1);
    }
    satG.attributes.position.needsUpdate = satG.attributes.aSize.needsUpdate = satG.attributes.aMode.needsUpdate = satG.attributes.aAl.needsUpdate = true;
    mark.updateMatrixWorld(); worcWorld.copy(wv).applyMatrix4(yawG.matrixWorld);
    var worcOcc = occluded(worcWorld);
    // arcs and leads decay
    arcs.forEach(function (a) { if (a.b > 0) { a.b = Math.max(0, a.b - dt * .22); a.m.uniforms.uB.value = a.b; } });
    var lb = leadPts.geometry.attributes.aB, dirty = false; for (i = 0; i < LEADS.length; i++) if (lb.array[i] > 0) { lb.array[i] = Math.max(0, lb.array[i] - dt * .12); dirty = true; } if (dirty) lb.needsUpdate = true;
    // routes
    for (i = 0; i < ROUTE_N; i++) {
      var R = routes[i], d = routeData[i];
      if (!d) { R.line.material.opacity = 0; R.dot.material.opacity = 0; continue; }
      var A = SAT[d.a], B = d.b === 'you' ? null : SAT[d.b];
      var pa = A ? A.world : null, pb = B ? B.world : worcWorld; if (!pa) { R.line.material.opacity = 0; R.dot.material.opacity = 0; continue; }
      cp.copy(pa).add(pb).multiplyScalar(.5); var ml = cp.length(); cp.normalize().multiplyScalar(Math.max(ml, 1) + .30 + .22 * pa.distanceTo(pb) * .3);
      var arr = R.line.geometry.attributes.position.array, j;
      for (j = 0; j <= 30; j++) { var t = j / 30, u = 1 - t; arr[j * 3] = u * u * pa.x + 2 * u * t * cp.x + t * t * pb.x; arr[j * 3 + 1] = u * u * pa.y + 2 * u * t * cp.y + t * t * pb.y; arr[j * 3 + 2] = u * u * pa.z + 2 * u * t * cp.z + t * t * pb.z; }
      R.line.geometry.attributes.position.needsUpdate = true; R.line.material.color.set(d.color || '#7fd0ff'); R.line.material.opacity = .55 * (d.fade == null ? 1 : d.fade);
      var tp = Math.max(0, Math.min(1, d.t)), uu = 1 - tp, da = R.dot.geometry.attributes.position.array;
      da[0] = uu * uu * pa.x + 2 * uu * tp * cp.x + tp * tp * pb.x; da[1] = uu * uu * pa.y + 2 * uu * tp * cp.y + tp * tp * pb.y; da[2] = uu * uu * pa.z + 2 * uu * tp * cp.z + tp * tp * pb.z;
      R.dot.geometry.attributes.position.needsUpdate = true; R.dot.material.color.set(d.color || '#ffffff'); R.dot.material.opacity = d.fade == null ? 1 : d.fade; R.dot.material.size = 6;
    }
    renderer.render(scene, camera);
    // labels
    labc.setTransform(DPR, 0, 0, DPR, 0, 0); labc.clearRect(0, 0, W, H);
    labc.font = '500 10.5px "IBM Plex Mono", ui-monospace, Menlo, monospace'; labc.textBaseline = 'middle';
    var boxes = [];
    function place(px, py, tw) { var tries = 0; while (tries < 4) { var hit = false; for (var q = 0; q < boxes.length; q++) { var b = boxes[q]; if (px - 5 < b[0] + b[2] && px + tw + 5 > b[0] && py - 9 < b[1] + 16 && py + 9 > b[1]) { hit = true; break; } } if (!hit) break; py += 17; tries++; } boxes.push([px - 5, py - 8, tw + 10]); return py; }
    if (!worcOcc) { tmp2.copy(worcWorld).project(camera); var wx0 = sx(tmp2), wy0 = sy(tmp2), wtw = labc.measureText('WORCESTER, MA').width; boxes.push([wx0 + 14, wy0 + 8, wtw + 10]); }
    for (i = 0; i < sats.length; i++) {
      s = sats[i]; var show = hover === s.id || selected === s.id || (!s.occ && (s.s === 'working' || s.s === 'needs' || s.s === 'problem'));
      if (!show) continue;
      var big = hover === s.id || selected === s.id, txt = s.name.toUpperCase();
      labc.globalAlpha = s.occ ? .3 : (big ? 1 : .82);
      var tw = labc.measureText(txt).width, px = s.scr[0] + 11, py = s.scr[1] - 11;
      if (px + tw + 12 > W) px = s.scr[0] - 11 - tw;
      py = place(px, py, tw);
      labc.fillStyle = 'rgba(4,8,18,.72)'; labc.fillRect(px - 5, py - 8, tw + 10, 16);
      labc.fillStyle = big ? '#ffffff' : '#' + s.color.getHexString(); labc.fillText(txt, px, py + .5);
    }
    labc.globalAlpha = 1;
    if (!worcOcc) {
      tmp2.copy(worcWorld).project(camera); var wx = sx(tmp2), wy = sy(tmp2);
      labc.fillStyle = 'rgba(4,8,18,.72)'; var wt = 'WORCESTER, MA'; var ww = labc.measureText(wt).width; labc.fillRect(wx + 14, wy + 8, ww + 10, 16); labc.fillStyle = '#E4BE7B'; labc.fillText(wt, wx + 19, wy + 16.5);
      if (view.zoom < .85) {
        labc.font = '500 9px "IBM Plex Mono", ui-monospace, Menlo, monospace';
        var drawnLeads = [];
        for (i = 0; i < LEADS.length; i++) { var lp = ll(LEADS[i][1], LEADS[i][2], 1.006).applyMatrix4(yawG.matrixWorld); if (occluded(lp)) continue; lp.project(camera); var lx = sx(lp), ly = sy(lp); if (Math.abs(lx - wx) < 70 && Math.abs(ly - wy) < 34) continue; var clash = false; for (var z = 0; z < drawnLeads.length; z++) { if (Math.abs(lx - drawnLeads[z][0]) < 72 && Math.abs(ly - drawnLeads[z][1]) < 12) { clash = true; break; } } if (clash) continue; drawnLeads.push([lx, ly]); labc.fillStyle = 'rgba(228,190,123,.85)'; labc.fillText(LEADS[i][0].toUpperCase(), lx + 8, ly - 7); }
      }
    }
  }
  requestAnimationFrame(frame);
  api.ok = true; api.view = view; api.sats = SAT;
  return api;
};
