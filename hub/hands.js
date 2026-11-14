/* Phronesis hand control — Michael, Nov 14 2026 (second pass: holographic hands, steadier tap, far less lag).
   Point to move, tap your index like a mouse button to click, pinch and hold to drag or spin the world,
   two hands pinched and pulled apart to open the orb, open palm thrown sideways to dismiss.
   MediaPipe runs on his own machine from files served by this site. The picture never leaves the PC and is
   never recorded: each frame is measured, drawn as a hand of light, and thrown away.

   Why this reads smoothly on a slow machine: READING the camera and DRAWING are separate. The camera is read
   as often as the machine manages (maybe 15 times a second); the hand and the cursor are drawn every single
   screen frame, carried between readings by their own speed. So the hand never stutters even when the
   measurements are sparse. */
(function () {
  'use strict';
  if (window.PHR_HANDS) return;

  var MP = '../head/mp/', MODEL = '../hands/hand_landmarker.task';
  var T = {
    gain: 2.1,            // how far a small hand movement travels across the screen
    box: 0.2,             // dead border of the camera view, so he need not reach the edges
    follow: 19,           // how hard the cursor chases where his finger is (higher = snappier)
    lead: 0.055,          // seconds of his own speed added ahead, to cancel the camera's delay
    pinchOn: 0.45, pinchOff: 0.62,
    tap: true, tapDown: 0.80, tapUp: 0.90, tapMs: 600,
    swipe: 1.6,
    zoomGain: 2.6, zoomMax: 3.2,
    hold: 200,
    numHands: 2,          // drops itself to 1 if this machine cannot keep up
    camW: 480, camH: 360  // a smaller picture is read faster and loses no accuracy: the model shrinks it anyway
  };
  try { Object.assign(T, JSON.parse(localStorage.getItem('phrHandTune') || '{}')); } catch (e) {}
  function save() { try { localStorage.setItem('phrHandTune', JSON.stringify(T)); } catch (e) {} }

  var FINGERS = [[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20]];
  var PALM = [0,1,5,9,13,17];
  var TIPS = [8,12,16,20], PIPS = [6,10,14,18];

  var video, cv, g, mark, raf = 0, on = false, starting = false;
  var hands = [], zoomPair = null, txt, dismissAt = 0, vision = null, fileset = null;
  var lastDet = 0, gap = 30, slowRun = 0, lastDraw = 0;
  var D = document;
  function $(s) { return D.querySelector(s); }
  function hud() { return window.__hud || {}; }
  function say(m) { if (txt && txt.textContent !== m) txt.textContent = m; }

  function sizeCanvas() {
    if (!on) { cv.width = cv.height = 1; return; }
    var r = Math.min(1.3, window.devicePixelRatio || 1);
    cv.width = Math.round(innerWidth * r); cv.height = Math.round(innerHeight * r);
    g.setTransform(r, 0, 0, r, 0, 0);
  }

  /* ================= the hand of light ================= */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function drawHand(h) {
    var p = h.sm, i, j, f, w, s = h.scale / 80, hot = h.pinch || h.tapping;
    var core = hot ? 'rgba(255,236,190,' : 'rgba(214,238,255,';
    var skin = hot ? 'rgba(255,196,96,' : 'rgba(92,164,255,';
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.shadowColor = hot ? 'rgba(255,180,70,.95)' : 'rgba(60,140,255,.9)';

    /* the palm, as a pane of lit glass */
    g.beginPath(); g.moveTo(p[PALM[0]].x, p[PALM[0]].y);
    for (i = 1; i < PALM.length; i++) g.lineTo(p[PALM[i]].x, p[PALM[i]].y);
    g.closePath();
    var gr = g.createLinearGradient(p[0].x, p[0].y, p[9].x, p[9].y);
    gr.addColorStop(0, skin + '.42)'); gr.addColorStop(1, skin + '.18)');
    g.shadowBlur = 20; g.fillStyle = gr; g.fill();
    g.shadowBlur = 0; g.strokeStyle = skin + '.5)'; g.lineWidth = 1.2 * s; g.stroke();

    /* the fingers, as tapering limbs of light rather than sticks */
    for (f = 0; f < FINGERS.length; f++) {
      var ch = FINGERS[f];
      for (j = 1; j < ch.length; j++) {
        var a = p[ch[j - 1]], b = p[ch[j]];
        w = (f === 0 ? 21 : 19) * s * (1 - (j - 1) * 0.15);        // thinner toward the tip
        g.shadowBlur = 18; g.strokeStyle = skin + '.42)'; g.lineWidth = Math.max(3, w);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.shadowBlur = 0; g.strokeStyle = core + '.8)'; g.lineWidth = Math.max(1, w * 0.26);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      /* the knuckle and the fingertip read as joints of light */
      var tip = p[ch[ch.length - 1]];
      g.shadowBlur = 14; g.fillStyle = core + '.9)';
      g.beginPath(); g.arc(tip.x, tip.y, Math.max(2.5, 6.4 * s), 0, 6.2832); g.fill();
      g.shadowBlur = 0; g.fillStyle = skin + '.5)';
      g.beginPath(); g.arc(p[ch[1]].x, p[ch[1]].y, Math.max(1.5, 3.4 * s), 0, 6.2832); g.fill();
    }
    /* the wrist, where the hologram fades out */
    var wg = g.createRadialGradient(p[0].x, p[0].y, 0, p[0].x, p[0].y, 26 * s);
    wg.addColorStop(0, skin + '.62)'); wg.addColorStop(1, skin + '0)');
    g.fillStyle = wg; g.beginPath(); g.arc(p[0].x, p[0].y, 34 * s, 0, 6.2832); g.fill();
    g.restore();
  }

  function drawCursor(h, now) {
    var x = h.cx, y = h.cy, r = h.pinch ? 9 : (h.tapping ? 10 : 14);
    if (h.flash) {
      var a = Math.max(0, Math.min(1, (now - h.flash) / 420));
      if (a >= 1) h.flash = 0;
      else { g.save(); g.globalAlpha = 1 - a; g.strokeStyle = '#ffd98c'; g.lineWidth = 2.4;
        g.beginPath(); g.arc(x, y, Math.max(1, 12 + a * 44), 0, 6.2832); g.stroke(); g.restore(); }
    }
    g.save(); g.globalCompositeOperation = 'lighter';
    var gr = g.createRadialGradient(x, y, 0, x, y, r * 2.8);
    gr.addColorStop(0, h.pinch ? 'rgba(255,230,170,.95)' : 'rgba(170,215,255,.9)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.8, 0, 6.2832); g.fill(); g.restore();
    g.strokeStyle = h.pinch ? 'rgba(255,207,134,.95)' : 'rgba(200,230,255,.85)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke();
    for (var k = 0; k < 4; k++) {
      var an = k * Math.PI / 2 + (h.pinch ? 0.78 : 0);
      g.beginPath(); g.moveTo(x + Math.cos(an) * (r + 4), y + Math.sin(an) * (r + 4));
      g.lineTo(x + Math.cos(an) * (r + 9), y + Math.sin(an) * (r + 9)); g.stroke();
    }
  }

  /* ================= turning gestures into things the page already understands ================= */
  function ev(el, type, x, y) {
    var o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window,
              pointerId: 991, pointerType: 'pen', isPrimary: true, button: 0,
              buttons: (type === 'pointerup' || type === 'mouseup') ? 0 : 1 };
    try { el.dispatchEvent(new PointerEvent(type, o)); } catch (e) {
      try { el.dispatchEvent(new MouseEvent(type, o)); } catch (x2) {}
    }
  }
  function tap(x, y) {
    var el = D.elementFromPoint(x, y); if (!el) { say('Nothing there'); return; }
    ev(el, 'pointerdown', x, y); ev(el, 'mousedown', x, y);
    ev(el, 'pointerup', x, y); ev(el, 'mouseup', x, y);
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window })); } catch (e) {}
    var f = el.closest ? el.closest('button,a,[data-nav],[data-ap],[data-city],[data-wtoggle]') : null;
    say(f ? 'Selected ' + (f.textContent || '').trim().slice(0, 22) : 'Tapped');
  }
  function overOrb(x, y) {
    if (D.body.classList.contains('world')) return true;
    var r = hud().slotRect && hud().slotRect(); if (!r) return false;
    return x > r.left && x < r.right && y > r.top && y < r.bottom;
  }
  function panelAt(x, y) {
    var el = D.elementFromPoint(x, y); if (!el || !el.closest) return null;
    var head = el.closest('.ph,.sb-me,.fp>header');
    return head ? head.closest('.panel,.fp,.sb') : null;
  }
  function beginDrag(h) {
    var x = h.cx, y = h.cy;
    if (overOrb(x, y)) { h.mode = 'orb'; h.target = $('#slot') || D.body; ev(h.target, 'pointerdown', x, y); say('Turning the world'); return; }
    var pan = panelAt(x, y);
    if (pan) { h.mode = 'panel'; h.target = pan; h.ox = x; h.oy = y;
      pan.classList.remove('hand-spring'); pan.classList.add('hand-held');
      var t2 = pan.querySelector('h2'); say('Holding ' + (t2 ? t2.textContent.trim() : 'a board')); return; }
    h.mode = 'drag'; h.target = D.elementFromPoint(x, y) || D.body;
    ev(h.target, 'pointerdown', x, y); ev(h.target, 'mousedown', x, y);
  }
  function moveDrag(h) {
    if (h.mode === 'panel') h.target.style.transform = 'translate(' + (h.cx - h.ox).toFixed(1) + 'px,' + (h.cy - h.oy).toFixed(1) + 'px)';
    else if (h.target) { ev(h.target, 'pointermove', h.cx, h.cy); ev(h.target, 'mousemove', h.cx, h.cy); }
  }
  function endDrag(h) {
    if (h.mode === 'panel' && h.target) {
      var p = h.target; p.classList.remove('hand-held'); p.classList.add('hand-spring'); p.style.transform = '';
      setTimeout(function () { p.classList.remove('hand-spring'); }, 600); say('Let go');
    } else if (h.target) { ev(h.target, 'pointerup', h.cx, h.cy); ev(h.target, 'mouseup', h.cx, h.cy); }
    h.mode = null; h.target = null;
  }
  function openPalm(p, size) {
    var n = 0;
    for (var i = 0; i < 4; i++) {
      var tip = p[TIPS[i]], pip = p[PIPS[i]], w = p[0];
      if (Math.hypot(tip.x - w.x, tip.y - w.y) > Math.hypot(pip.x - w.x, pip.y - w.y) * 1.12) n++;
    }
    return n >= 4 && Math.hypot(p[4].x - p[8].x, p[4].y - p[8].y) / size > 0.55;
  }
  function dismiss() {
    if (performance.now() - dismissAt < 1400) return; dismissAt = performance.now();
    var h = hud();
    if (h.orbZoomNow && h.orbZoomNow() > 1.06) { h.orbZoom(1); say('Closed the orb'); return; }
    if (D.body.classList.contains('wfull') && h.closeAgentWorld) { h.closeAgentWorld(); say('Left the world'); return; }
    if (D.body.classList.contains('v-open') && h.closeFocus) { h.closeFocus(); say('Dismissed'); return; }
    if (D.body.classList.contains('phr-live') && window.PHR_LIVE) { window.PHR_LIVE.sleep(); say('Dismissed him'); return; }
    say('Nothing to dismiss');
  }

  /* ================= a reading from the camera ================= */
  function measure(res, now) {
    var list = (res && res.landmarks) || [], i, W = innerWidth, H = innerHeight;
    while (hands.length > list.length) { var gone = hands.pop(); if (gone.mode) endDrag(gone); }
    for (i = 0; i < list.length; i++) {
      var lmk = list[i], h = hands[i];
      if (!h) h = hands[i] = { cx: W / 2, cy: H / 2, tgx: W / 2, tgy: H / 2, hx: W / 2, hy: H / 2,
        vx: 0, vy: 0, mode: null, pinch: false, tapping: false, tapLock: false, down: 0, flash: 0,
        lastx: 0, lastt: now, at: now, pts: null, sm: null, scale: 80 };
      var b = T.box, sc = 1 / Math.max(0.05, 1 - 2 * b);
      var pts = new Array(21);
      for (var q = 0; q < lmk.length; q++) {
        pts[q] = { x: Math.max(-60, Math.min(W + 60, ((1 - lmk[q].x) - b) * sc * W)),
                   y: Math.max(-60, Math.min(H + 60, (lmk[q].y - b) * sc * H)) };
      }
      h.pts = pts;
      if (!h.sm) h.sm = pts.map(function (o) { return { x: o.x, y: o.y }; });
      h.scale = Math.max(14, Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y));

      /* where he is pointing, pushed out from the middle so a small movement carries */
      var tx = Math.max(2, Math.min(W - 2, (pts[8].x - W / 2) * T.gain + W / 2));
      var ty = Math.max(2, Math.min(H - 2, (pts[8].y - H / 2) * T.gain + H / 2));
      var dt = Math.max(0.008, (now - h.at) / 1000); h.at = now;
      h.vx = (tx - (h.rawx == null ? tx : h.rawx)) / dt; h.vy = (ty - (h.rawy == null ? ty : h.rawy)) / dt;
      h.rawx = tx; h.rawy = ty;

      /* a tap: the index bends like a mouse button. The straight length is remembered and bleeds away
         slowly in real seconds, so the frame rate cannot change how a tap feels. */
      var ext = Math.hypot(pts[8].x - pts[5].x, pts[8].y - pts[5].y) / h.scale;
      h.extMax = Math.max(ext, (h.extMax == null ? ext : h.extMax) - 0.10 * dt);
      var curl = ext / Math.max(0.2, h.extMax);
      if (T.tap && !h.pinch) {
        if (curl > T.tapUp) h.tapLock = false;
        if (!h.tapping && !h.tapLock && curl < T.tapDown) { h.tapping = true; h.tapAt = now; h.tx0 = h.hx; h.ty0 = h.hy; }
        else if (h.tapping && curl > T.tapUp) {
          h.tapping = false;
          if (now - h.tapAt < T.tapMs) { h.flash = performance.now(); tap(h.tx0, h.ty0); }
        } else if (h.tapping && now - h.tapAt > T.tapMs) { h.tapping = false; h.tapLock = true; }
      } else { h.tapping = false; h.tapLock = false; }

      if (!h.tapping) { h.tgx = tx + h.vx * T.lead; h.tgy = ty + h.vy * T.lead; h.hx = h.cx; h.hy = h.cy; }
      else { h.tgx = h.tx0; h.tgy = h.ty0; }
      if (!isFinite(h.tgx) || !isFinite(h.tgy)) { h.tgx = W / 2; h.tgy = H / 2; }

      var d = Math.hypot(pts[4].x - pts[8].x, pts[4].y - pts[8].y) / h.scale, was = h.pinch;
      if (!h.pinch && d < T.pinchOn) h.pinch = true; else if (h.pinch && d > T.pinchOff) h.pinch = false;
      if (h.pinch && !was) { h.down = now; h.mode = null; h.sx = h.cx; h.sy = h.cy; }
      if (h.pinch && !h.mode && (now - h.down > T.hold || Math.hypot(h.cx - h.sx, h.cy - h.sy) > 26)) beginDrag(h);
      if (!h.pinch && was && h.mode) endDrag(h);

      if (!h.pinch && !h.tapping && openPalm(pts, h.scale)) {
        var dts = Math.max(1, now - h.lastt), v = Math.abs(h.cx - h.lastx) / dts * 1000 / W;
        if (v > T.swipe) dismiss();
      }
      h.lastx = h.cx; h.lastt = now;
    }
  }

  /* ================= drawn every screen frame, whatever the camera managed ================= */
  function paint(now) {
    var dt = Math.min(0.05, (now - lastDraw) / 1000); lastDraw = now;
    g.clearRect(0, 0, innerWidth, innerHeight);
    var k = 1 - Math.exp(-dt * T.follow), ks = 1 - Math.exp(-dt * 26), i, j;
    for (i = 0; i < hands.length; i++) {
      var h = hands[i]; if (!h.pts) continue;
      h.cx += (h.tgx - h.cx) * k; h.cy += (h.tgy - h.cy) * k;
      for (j = 0; j < h.pts.length; j++) {                    // the hand itself glides to the new reading
        h.sm[j].x += (h.pts[j].x - h.sm[j].x) * ks;
        h.sm[j].y += (h.pts[j].y - h.sm[j].y) * ks;
      }
      if (h.mode) moveDrag(h);
      drawHand(h); drawCursor(h, now);
    }
    var a = hands[0], b = hands[1];
    if (a && b && a.pinch && b.pinch) {
      var span = Math.hypot(a.cx - b.cx, a.cy - b.cy) / Math.hypot(innerWidth, innerHeight);
      if (!zoomPair) { zoomPair = { span: span, base: (hud().orbZoomNow && hud().orbZoomNow()) || 1 };
        if (a.mode) endDrag(a); if (b.mode) endDrag(b); }
      var z = Math.max(1, Math.min(T.zoomMax, zoomPair.base + (span - zoomPair.span) * T.zoomGain * 4));
      if (hud().orbZoom) hud().orbZoom(z);
      g.save(); g.setLineDash([3, 7]); g.strokeStyle = 'rgba(255,207,134,.5)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(a.cx, a.cy); g.lineTo(b.cx, b.cy); g.stroke(); g.restore();
      say(z > 1.06 ? 'Into the orb · ' + z.toFixed(1) + '×' : 'Hold and pull apart');
    } else if (zoomPair) zoomPair = null;
    if (!hands.length) say('Show me a hand');
    else if (!hands.some(function (q) { return q.pinch || q.tapping || q.mode; })) say('Point and tap');
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!on) return;
    var now = performance.now();
    if (mark && video.readyState >= 2 && now - lastDet >= gap) {
      lastDet = now;
      var t0 = performance.now(), res = null;
      try { res = mark.detectForVideo(video, now); } catch (e) { res = null; }
      var cost = performance.now() - t0;
      if (res) measure(res, now);
      gap = cost > 55 ? 60 : cost > 28 ? 40 : 30;
      if (cost > 45 && T.numHands > 1) {                       // too slow for two: carry on with one
        slowRun++;
        if (slowRun > 25) { slowRun = 0; T.numHands = 1; save(); rebuild(); say('One hand — your machine was struggling'); }
      } else if (cost > 320) { slowRun += 8; if (slowRun > 40) { say('Too busy — hands off'); stop(); try { window.__handsBusy && window.__handsBusy(); } catch (x) {} return; } }
      else slowRun = Math.max(0, slowRun - 1);
    }
    paint(now);
  }

  function makeMarker() {
    var opt = function (dl) { return { baseOptions: { modelAssetPath: MODEL, delegate: dl }, runningMode: 'VIDEO',
      numHands: T.numHands, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.45, minTrackingConfidence: 0.45 }; };
    return vision.HandLandmarker.createFromOptions(fileset, opt('GPU'))
      .catch(function () { return vision.HandLandmarker.createFromOptions(fileset, opt('CPU')); });
  }
  function rebuild() {
    var old = mark; mark = null;
    makeMarker().then(function (m) { mark = m; try { old && old.close && old.close(); } catch (e) {} },
                      function () { mark = old; });
  }

  function start() {
    if (on || starting) return Promise.resolve(on);
    starting = true; say('Waking the camera'); D.body.classList.add('hands-on');
    return navigator.mediaDevices.getUserMedia({ video: { width: T.camW, height: T.camH, frameRate: 30, facingMode: 'user' }, audio: false })
      .then(function (st) { video.srcObject = st; return video.play(); })
      .then(function () { say('Loading the hands'); return vision ? vision : import(MP + 'vision_bundle.mjs'); })
      .then(function (v) { vision = v; return fileset ? fileset : v.FilesetResolver.forVisionTasks(MP + 'wasm'); })
      .then(function (fs) { fileset = fs; return makeMarker(); })
      .then(function (m) {
        mark = m; on = true; starting = false; slowRun = 0; lastDraw = performance.now();
        sizeCanvas(); if (!raf) loop(); say('Point and tap'); return true;
      })
      .catch(function (e) {
        starting = false; stop(); say('No camera');
        try { window.__hud && window.__hud.toast && window.__hud.toast('The camera did not open, sir: ' + (e && e.name || e), 1); } catch (x) {}
        return false;
      });
  }
  function stop() {
    on = false;
    hands.forEach(function (h) { if (h.mode) endDrag(h); }); hands.length = 0; zoomPair = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try { if (video.srcObject) video.srcObject.getTracks().forEach(function (t2) { t2.stop(); }); } catch (e) {}
    video.srcObject = null;
    try { if (mark && mark.close) mark.close(); } catch (e) {}
    mark = null;
    if (hud().orbZoom) hud().orbZoom(1);
    if (g) g.clearRect(0, 0, innerWidth, innerHeight);
    D.body.classList.remove('hands-on');
    sizeCanvas();
  }
  function boot() {
    video = $('#handcam'); cv = $('#handfx'); txt = $('#handtxt');
    if (!video || !cv) return;
    g = cv.getContext('2d'); cv.width = cv.height = 1;
    addEventListener('resize', function () { sizeCanvas(); });
  }
  if (D.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();

  window.PHR_HANDS = {
    start: start, stop: stop,
    toggle: function () { return on ? (stop(), Promise.resolve(false)) : start(); },
    isOn: function () { return on; },
    tune: function (o) { if (o) { Object.assign(T, o); save(); if (on && o.numHands) rebuild(); } return Object.assign({}, T); },
    _feed: function (frame, now) { var t = now == null ? performance.now() : now; measure(frame, t); paint(t); },
    _state: function () { return hands.map(function (h) { return { cx: Math.round(h.cx), cy: Math.round(h.cy), pinch: h.pinch, tapping: h.tapping, mode: h.mode }; }); }
  };
})();
