/* Phronesis hologram head, embedded: the portrait photo drawn by WebGL with eyes, lips, glow and states.
   Flat on purpose (no turning). cfg: cv, fx (canvases), imgs {hero, glow}, audio {i: dataURI}, tracks {i: {o,s,c,f}}, onEnd(i) */
window.PhrHead = function (cfg) {
  var cv = cfg.cv, fx = cfg.fx, fxc = fx.getContext('2d');
  var AUDIO = cfg.audio || {}, TRACKS = cfg.tracks || {}, IMG = cfg.imgs;
  var HW = 938, HH = 826;
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var api = { ok: false, active: true, level: 0, state: 'dormant' };
  var gl = null;
  try { gl = cv.getContext('webgl', { antialias: true, alpha: false }) || cv.getContext('experimental-webgl'); } catch (e) {}
  if (!gl) return api;

  function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var prog, U = {}, tex = {}, loaded = 0;
  try {
    var fsrc = FS.replace('#extension GL_OES_standard_derivatives : enable', '');
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    prog = p; gl.useProgram(prog);
    var P = new Float32Array([0, 0, 0, HW, 0, 0, 0, HH, 0, HW, HH, 0]), I = new Uint16Array([0, 2, 1, 1, 2, 3]);
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    ['uA', 'uB', 'uC', 'uG', 'uRes', 'uLook', 'uS', 'uDPR', 'uTime', 'uAwake', 'uGreen', 'uReveal', 'uBloom', 'uEye', 'uBlL', 'uBlR', 'uJaw', 'uWide', 'uClose', 'uFV', 'uSpark', 'uPulse', 'uCut', 'uW', 'uVP', 'uRC', 'uFC', 'uRB', 'uRH', 'uF', 'uZk', 'uPuck'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    for (var u = 0; u < 4; u++) {
      var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([2, 5, 11, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tex[u] = t;
    }
    gl.uniform1i(U.uA, 0); gl.uniform1i(U.uB, 1); gl.uniform1i(U.uC, 2); gl.uniform1i(U.uG, 3);
    [[0, IMG.hero], [3, IMG.glow]].forEach(function (a) {
      var im = new Image(); im.onload = function () { gl.activeTexture(gl.TEXTURE0 + a[0]); gl.bindTexture(gl.TEXTURE_2D, tex[a[0]]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); loaded++; }; im.src = a[1];
    });
  } catch (e) { try { console.error(e); } catch (x) {} return api; }
  api.ok = true;

  // ---------- state ----------
  var TG = {
    dormant:    { awake: 0.0,  green: 0.0,  bloom: 0.20, eye: 0.0, orbG: 0.0, orbP: 0.0, closed: 0.0,  spark: 0.45, base: 0.25 },
    activating: { awake: 0.92, green: 1.0,  bloom: 0.55, eye: 0.3, orbG: 1.0, orbP: 0.0, closed: 0.0,  spark: 1.0,  base: 0.8 },
    appearing:  { awake: 0.97, green: 0.12, bloom: 0.55, eye: 0.5, orbG: 0.30, orbP: 0.0, closed: 0.0, spark: 1.0, base: 0.8 },
    listening:  { awake: 1.0,  green: 0.0,  bloom: 0.62, eye: 1.0, orbG: 0.0, orbP: 0.0, closed: 0.0,  spark: 1.0,  base: 1.0 },
    processing: { awake: 1.0,  green: 0.0,  bloom: 0.72, eye: 0.0, orbG: 0.0, orbP: 1.0, closed: 0.94, spark: 1.2,  base: 1.0 },
    speaking:   { awake: 1.03, green: 0.0,  bloom: 0.66, eye: 0.6, orbG: 0.0, orbP: 0.0, closed: 0.0,  spark: 1.0,  base: 1.0 }
  };
  var S = { awake: 0, green: 0, bloom: .2, eye: 0, orbG: 0, orbP: 0, closed: 0, spark: .45, base: .25, reveal: 1, jaw: 0, wide: 0, close: 0, fv: 0, viewK: 0 };
  var state = 'dormant', timers = [], revealAnim = null, curLine = 0, speakStart = 0, audio = null, usingAudio = false, frameK = 0, clock = 0;
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  var AE = null;
  function ae() { if (!AE) { AE = new Audio(); AE.preload = 'auto'; } return AE; }
  function stopVoice() { usingAudio = false; try { if (audio) { audio.onended = null; audio.onplaying = null; audio.pause(); } } catch (e) {} audio = null; }
  api.unlock = function () { try { var a = ae(); a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} };
  function setState(s, opts) {
    opts = opts || {}; state = s; api.state = s;
    if (s !== 'speaking') stopVoice();
    if (opts.scan || (s === 'activating' && S.awake < 0.4)) { revealAnim = { t: 0, dur: opts.dur || 2.5 }; S.reveal = 0; }
    else if (s === 'dormant') { revealAnim = null; S.reveal = 1; }
    else if (!revealAnim) S.reveal = 1;
    if (cfg.onState) cfg.onState(s);
  }
  // mouth tracks per 20 ms: o open, s spread (+) or round (-), c lips closed (m, b, p), f lip to teeth (f, v)
  function lerpArr(a, f, n) { var i = Math.floor(f), k = f - i, j = Math.min(i + 1, n - 1); return (a[i] + (a[j] - a[i]) * k) / 100; }
  function mouthAt(i, t) {
    var T = TRACKS[i]; if (!T) return [0, 0, 0, 0];
    var n = T.o.length, f = Math.max(0, t) / 0.02;
    if (f >= n - 1) return [0, 0, 0, 0];
    return [lerpArr(T.o, f, n), lerpArr(T.s, f, n), lerpArr(T.c, f, n), lerpArr(T.f, f, n)];
  }
  function finishLine(i) { usingAudio = false; if (state === 'speaking') { setState('listening'); } if (cfg.onEnd) cfg.onEnd(i); }
  api.setState = function (s, o) { clearTimers(); setState(s, o); };
  api.say = function (i, silent) {
    clearTimers(); curLine = i; speakStart = clock; setState('speaking');
    usingAudio = false; if (silent || !AUDIO[i]) return;
    try {
      audio = ae(); audio.onplaying = function () { usingAudio = true; };
      audio.onended = function () { finishLine(i); };
      audio.src = AUDIO[i];
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function () { usingAudio = false; audio = null; });
    } catch (e) { usingAudio = false; }
  };
  api.stop = function () { clearTimers(); if (state === 'speaking') setState('listening'); else stopVoice(); };
  api.wake = function () {
    clearTimers(); S.awake = 0.05; S.green = 0; S.eye = 0; setState('activating', { scan: true });
    later(function () { setState('appearing'); }, 2600); later(function () { setState('listening'); if (cfg.onAwake) cfg.onAwake(); }, 4600);
  };
  api.progress = function () { if (state !== 'speaking') return 0; var T = TRACKS[curLine], dur = (audio && audio.duration && isFinite(audio.duration)) ? audio.duration : (T ? (T.dur || T.o.length * 0.02) : 3), tt = usingAudio && audio ? audio.currentTime : clock - speakStart; return Math.max(0, Math.min(1, tt / dur)); };
  api.time = function () { if (state !== 'speaking') return 0; return usingAudio && audio ? audio.currentTime : clock - speakStart; };
  api.reveal = function (dur) { revealAnim = { t: 0, dur: dur || 1.6 }; S.reveal = 0; };
  api.setFrame = function (k) { frameK = k === 'face' ? 1 : 0; };
  var extMouth = null; api.mouth = function (fn) { extMouth = fn; };
  api.snap = function (s) { var T = TG[s]; Object.keys(T).forEach(function (k) { S[k] = T[k]; }); S.reveal = 1; revealAnim = null; setState(s); };

  // ---------- camera ----------
  var W = 1, H = 1, DPR = 1;
  var FR = { bust: [20, 0, 918, 826], face: [300, 20, 700, 500] };
  var cam = { s: 1, fx: 469, fy: 413, rx: 0, ry: 0 };
  function resize() {
    W = cv.clientWidth || 1; H = cv.clientHeight || 1;
    DPR = Math.min(window.devicePixelRatio || 1, 2); DPR = Math.max(.75, Math.min(DPR, Math.sqrt(2.2e6 / Math.max(1, W * H))));
    [cv, fx].forEach(function (c) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
    gl.viewport(0, 0, cv.width, cv.height);
  }
  function placeCam() {
    var a = FR.bust, b = FR.face, k = S.viewK, r = [0, 1, 2, 3].map(function (i) { return a[i] + (b[i] - a[i]) * k; });
    var rw = r[2] - r[0], rh = r[3] - r[1], s = Math.min(W / rw, H / rh);
    cam.s = s; cam.fx = (r[0] + r[2]) / 2; cam.fy = (r[1] + r[3]) / 2; cam.rx = W / 2; cam.ry = H / 2;
  }
  function X(ix) { return cam.rx + (ix - cam.fx) * cam.s; }
  function Y(iy) { return cam.ry + (iy - cam.fy) * cam.s; }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);
  resize();

  // ---------- helpers ----------
  function ease(a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); }
  function sm(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  var blink = { next: 2.2, t0: -1, dbl: false };
  function blinkAt(t) {
    if (blink.t0 < 0) { if (t > blink.next) { blink.t0 = t; blink.dbl = Math.random() < .18; } return 0; }
    var u = t - blink.t0, b;
    if (u < .07) b = u / .07; else if (u < .12) b = 1; else if (u < .26) b = 1 - (u - .12) / .14;
    else { b = 0; blink.t0 = -1; blink.next = t + (blink.dbl ? .2 : 2.2 + Math.random() * 3.8); blink.dbl = false; }
    return sm(b);
  }
  var look = { x: 0, y: 0, sx: 0, sy: 0, next: 1 }, ptr = { x: 0, y: 0, t: -99 };
  window.addEventListener('pointermove', function (e) { ptr.x = Math.max(-1, Math.min(1, (e.clientX / innerWidth - .5) * 2)); ptr.y = Math.max(-1, Math.min(1, (e.clientY / innerHeight - .5) * 2)); ptr.t = clock; });

  // ---------- 2D light layer ----------
  var sparks = [], i0;
  for (i0 = 0; i0 < 70; i0++) sparks.push({ x: 90 + Math.random() * 760, y: 60 + Math.random() * 720, v: 10 + Math.random() * 34, r: .7 + Math.random() * 1.3, p: Math.random() * 6.28, c: Math.random() < .12 ? 2 : (Math.random() < .45 ? 1 : 0) });
  var pulses = [], nextPulse = 0, SPK = ['150,215,255', '90,255,170', '255,205,120'];
  function drawFx(t, dt) {
    fxc.setTransform(DPR, 0, 0, DPR, 0, 0); fxc.clearRect(0, 0, W, H); fxc.globalCompositeOperation = 'lighter';
    var s = cam.s, aw = Math.min(1, S.awake);
    if (!reduce) {
      for (var i = 0; i < sparks.length; i++) {
        var k = sparks[i]; k.y -= k.v * dt * (state === 'activating' || state === 'appearing' ? 1.8 : 1); if (k.y < 40) { k.y = 790; k.x = 90 + Math.random() * 760; }
        var tw = .5 + .5 * Math.sin(t * 2.2 + k.p), al = (.10 + .5 * tw) * (.25 + .75 * aw) * (state === 'dormant' ? .35 : 1);
        fxc.fillStyle = 'rgba(' + SPK[k.c] + ',' + al.toFixed(3) + ')'; fxc.beginPath(); fxc.arc(X(k.x), Y(k.y), Math.max(.6, k.r * s * 1.2), 0, 6.283); fxc.fill();
      }
    }
    var bx = X(469), by = Y(772), amp = S.jaw, interval = state === 'processing' ? .55 : (state === 'speaking' ? .32 : (state === 'dormant' ? 3.2 : 2.4));
    if (t > nextPulse) { pulses.push({ t0: t, a: state === 'speaking' ? .25 + .6 * amp : 1, c: state === 'processing' ? '255,205,120' : (S.green > .4 ? '90,255,170' : '110,190,255') }); nextPulse = t + interval; }
    for (var j = pulses.length - 1; j >= 0; j--) {
      var Pu = pulses[j], u = (t - Pu.t0) / (state === 'processing' ? 1.4 : 2.1);
      if (u >= 1) { pulses.splice(j, 1); continue; }
      var rx = (150 + 270 * u) * s, a2 = (1 - u) * (1 - u) * .42 * Pu.a * S.base * (state === 'dormant' ? .5 : 1);
      fxc.strokeStyle = 'rgba(' + Pu.c + ',' + a2.toFixed(3) + ')'; fxc.lineWidth = Math.max(1, 2 * s);
      fxc.beginPath(); fxc.ellipse(bx, by, rx, rx * .09, 0, 0, 6.283); fxc.stroke();
    }
    var gl0 = (.10 + .20 * S.base + (state === 'speaking' ? .35 * amp : 0)) * (.3 + .7 * aw);
    var gr = fxc.createRadialGradient(bx, by, 0, bx, by, 260 * s); gr.addColorStop(0, 'rgba(90,170,255,' + gl0.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(90,170,255,0)');
    fxc.fillStyle = gr; fxc.save(); fxc.translate(bx, by); fxc.scale(1, .16); fxc.translate(-bx, -by); fxc.beginPath(); fxc.arc(bx, by, 260 * s, 0, 6.283); fxc.fill(); fxc.restore();
    if (S.orbG > .02) {
      for (var n = 0; n < 3; n++) {
        var cx = X(484), cy = Y(176 + n * 16), erx = (255 - n * 30) * s, ery = (56 - n * 7) * s;
        fxc.save(); fxc.translate(cx, cy); fxc.rotate(-.14 + n * .05); fxc.setLineDash([170 * s, 640 * s]); fxc.lineDashOffset = -t * (250 + 70 * n) * s;
        fxc.strokeStyle = 'rgba(90,255,170,' + (.20 * S.orbG).toFixed(3) + ')'; fxc.lineWidth = 6 * s; fxc.beginPath(); fxc.ellipse(0, 0, erx, ery, 0, 0, 6.283); fxc.stroke();
        fxc.strokeStyle = 'rgba(150,255,210,' + (.85 * S.orbG).toFixed(3) + ')'; fxc.lineWidth = Math.max(1, 1.6 * s); fxc.beginPath(); fxc.ellipse(0, 0, erx, ery, 0, 0, 6.283); fxc.stroke();
        fxc.setLineDash([]); fxc.strokeStyle = 'rgba(90,255,170,' + (.12 * S.orbG).toFixed(3) + ')'; fxc.lineWidth = 1; fxc.beginPath(); fxc.ellipse(0, 0, erx, ery, 0, 0, 6.283); fxc.stroke();
        fxc.restore();
      }
    }
    if (S.orbP > .02) {
      var RG = [[490, 215, 235, 62, .30, 1.1], [486, 235, 205, 46, -.34, -1.5], [492, 195, 268, 84, .08, .8]];
      for (var m = 0; m < RG.length; m++) {
        var R = RG[m], ccx = X(R[0]), ccy = Y(R[1]), ax = R[2] * s, ay = R[3] * s, rot = R[4], co = Math.cos(rot), si = Math.sin(rot);
        fxc.strokeStyle = 'rgba(160,200,255,' + (.10 * S.orbP).toFixed(3) + ')'; fxc.lineWidth = 1; fxc.beginPath(); fxc.ellipse(ccx, ccy, ax, ay, rot, 0, 6.283); fxc.stroke();
        for (var q = 0; q < 5; q++) {
          var th0 = t * R[5] + q * 1.2566 + m;
          for (var tr = 0; tr < 9; tr++) {
            var th = th0 - tr * .07 * Math.sign(R[5]), ex = ax * Math.cos(th), ey = ay * Math.sin(th), px = ccx + ex * co - ey * si, py = ccy + ex * si + ey * co;
            var al = (1 - tr / 9) * .9 * S.orbP, gold = (q + m) % 2 === 0;
            fxc.fillStyle = (gold ? 'rgba(255,205,120,' : 'rgba(140,200,255,') + al.toFixed(3) + ')';
            fxc.beginPath(); fxc.arc(px, py, Math.max(.7, (2.3 - tr * .2) * s), 0, 6.283); fxc.fill();
          }
        }
      }
    }
  }

  // ---------- main loop ----------
  var last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!api.active) { last = now; return; }
    var dt = Math.min(.05, (now - last) / 1000 || .016); last = now; clock += dt; var t = clock;
    if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
    var T = TG[state], rate = state === 'dormant' ? 1.6 : 3.4;
    ['awake', 'green', 'bloom', 'eye', 'orbG', 'orbP', 'closed', 'spark', 'base'].forEach(function (k) { S[k] = ease(S[k], T[k], rate, dt); });
    if (revealAnim) { revealAnim.t += dt; var u = Math.min(1, revealAnim.t / revealAnim.dur); S.reveal = u < 1 ? u * u * (3 - 2 * u) * .5 + u * .5 : 1; if (u >= 1) revealAnim = null; }
    S.viewK = ease(S.viewK, frameK, 5, dt);
    var oT = 0, sT = 0, cT = 0, fT = 0;
    if (state === 'speaking') {
      var tt = usingAudio && audio ? audio.currentTime : t - speakStart;
      var mv = extMouth ? extMouth() : mouthAt(curLine, tt); oT = Math.min(1, mv[0]); sT = mv[1]; cT = mv[2]; fT = mv[3];
      if (!extMouth && !usingAudio && !audio && TRACKS[curLine] && tt > TRACKS[curLine].o.length * 0.02 + .25) finishLine(curLine);
    }
    S.jaw = ease(S.jaw, oT, 42, dt); S.wide = ease(S.wide, sT, 34, dt); S.close = ease(S.close, cT, 46, dt); S.fv = ease(S.fv, fT, 46, dt);
    api.level = S.jaw;
    look.next -= dt; if (look.next < 0) { look.sx = (Math.random() - .5) * .5; look.sy = (Math.random() - .5) * .3; look.next = .7 + Math.random() * 2.2; }
    var usePtr = !reduce && ((t - ptr.t) < 5), lt = usePtr ? [ptr.x * .9, ptr.y * .7] : [look.sx, look.sy]; if (state === 'speaking') lt = [lt[0] * .4, lt[1] * .4];
    look.x = ease(look.x, lt[0], 9, dt); look.y = ease(look.y, lt[1], 9, dt);
    var bl = Math.max(state === 'dormant' ? 0 : blinkAt(t), S.closed);
    placeCam();
    if (loaded >= 1) {
      gl.clearColor(.002, .010, .026, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uVP, W, H); gl.uniform2f(U.uRC, cam.rx, cam.ry); gl.uniform2f(U.uFC, cam.fx, cam.fy); gl.uniform1f(U.uS, cam.s);
      gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform1f(U.uDPR, DPR); gl.uniform1f(U.uF, 1800); gl.uniform1f(U.uZk, 0);
      gl.uniform3f(U.uRB, 0, 0, 0); gl.uniform3f(U.uRH, 0, 0, 0); gl.uniform1f(U.uPuck, 0); gl.uniform1f(U.uCut, 0);
      gl.uniform1f(U.uTime, t); gl.uniform1f(U.uAwake, S.awake); gl.uniform1f(U.uGreen, S.green); gl.uniform1f(U.uReveal, S.reveal); gl.uniform1f(U.uBloom, S.bloom);
      gl.uniform1f(U.uEye, S.eye); gl.uniform1f(U.uBlL, bl); gl.uniform1f(U.uBlR, bl); gl.uniform1f(U.uJaw, S.jaw);
      gl.uniform1f(U.uWide, S.wide); gl.uniform1f(U.uClose, S.close); gl.uniform1f(U.uFV, S.fv);
      gl.uniform1f(U.uSpark, S.spark * (reduce ? 0 : 1)); gl.uniform1f(U.uPulse, .5 + .5 * Math.sin(t * 2.1) + (state === 'speaking' ? S.jaw : 0));
      gl.uniform2f(U.uLook, look.x, look.y); gl.uniform3f(U.uW, 1, 0, 0);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    drawFx(t, dt);
  }
  requestAnimationFrame(frame);
  api.S = S;
  return api;
};
