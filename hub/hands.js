/* Phronesis hand control — Michael, Nov 14 2026.
   Point to move the cursor, pinch to select, pinch and drag to move a panel or spin the world,
   two hands pinched and pulled apart to open the orb, open palm to dismiss.
   MediaPipe runs on his own machine from files served by this site. The camera picture never leaves the PC
   and is never recorded: each frame is measured, drawn as a hand of light, and thrown away. */
(function () {
  'use strict';
  if (window.PHR_HANDS) return;

  var MP = '../head/mp/', MODEL = '../hands/hand_landmarker.task';
  var T = {                           // everything he may want to feel different, saved on his machine
    gain: 1.5,                        // how far a small hand movement travels on screen
    box: 0.17,                        // the dead border of the camera view, so he need not reach the edges
    smooth: 0.45,                     // 0 = raw and twitchy, 1 = heavy and laggy
    pinchOn: 0.45, pinchOff: 0.62,    // how closed a pinch counts, and how open it releases
    swipe: 1.6,                       // screens per second of palm movement that counts as a dismiss
    zoomGain: 2.6, zoomMax: 3.2,
    hold: 220                         // ms a pinch must last before it becomes a drag instead of a click
  };
  try { Object.assign(T, JSON.parse(localStorage.getItem('phrHandTune') || '{}')); } catch (e) {}
  function save() { try { localStorage.setItem('phrHandTune', JSON.stringify(T)); } catch (e) {} }

  var BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
               [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  var TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18];

  var video, cv, g, mark, raf = 0, on = false, starting = false, lastT = 0;
  var hands = [];                     // one entry per hand seen, carrying its own gesture state
  var zoomPair = null, pill, txt, dismissAt = 0;
  var D = document;
  function $(s) { return D.querySelector(s); }
  function hud() { return window.__hud || {}; }
  function say(m) { if (txt) txt.textContent = m; }

  /* ---------- the hand of light ---------- */
  function sizeCanvas() {
    var r = window.devicePixelRatio || 1;
    cv.width = Math.round(innerWidth * r); cv.height = Math.round(innerHeight * r);
    g.setTransform(r, 0, 0, r, 0, 0);
  }
  function drawHand(h) {
    var p = h.pts, i, a, b;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = h.pinch ? 'rgba(255,214,140,.92)' : 'rgba(126,186,255,.62)';
    g.shadowColor = h.pinch ? 'rgba(255,190,80,.9)' : 'rgba(70,150,255,.75)'; g.shadowBlur = 16;
    g.lineWidth = 2.1; g.beginPath();
    for (i = 0; i < BONES.length; i++) { a = p[BONES[i][0]]; b = p[BONES[i][1]]; g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
    g.stroke();
    for (i = 0; i < p.length; i++) {
      var big = i === 4 || i === 8, rr = big ? 5.2 : 2.9;
      g.fillStyle = big ? (h.pinch ? '#ffe6b0' : '#cfe6ff') : 'rgba(190,220,255,.8)';
      g.beginPath(); g.arc(p[i].x, p[i].y, rr, 0, 6.2832); g.fill();
    }
    g.shadowBlur = 0;
  }
  function drawCursor(h) {
    var x = h.cx, y = h.cy, r = h.pinch ? 9 : 15, k;
    g.save(); g.globalCompositeOperation = 'lighter';
    var gr = g.createRadialGradient(x, y, 0, x, y, r * 2.6);
    gr.addColorStop(0, h.pinch ? 'rgba(255,230,170,.95)' : 'rgba(170,215,255,.85)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.6, 0, 6.2832); g.fill();
    g.restore();
    g.strokeStyle = h.pinch ? 'rgba(255,207,134,.95)' : 'rgba(190,225,255,.8)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke();
    for (k = 0; k < 4; k++) {           // four ticks, so it reads as an instrument and not a mouse pointer
      var a = k * Math.PI / 2 + (h.pinch ? 0.78 : 0);
      g.beginPath(); g.moveTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
      g.lineTo(x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9)); g.stroke();
    }
  }
  function drawZoom(a, b) {
    g.save(); g.setLineDash([3, 7]); g.strokeStyle = 'rgba(255,207,134,.5)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(a.cx, a.cy); g.lineTo(b.cx, b.cy); g.stroke(); g.restore();
  }

  /* ---------- turning a pinch into something the page already understands ---------- */
  function ev(el, type, x, y, extra) {
    var o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window,
              pointerId: 991, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' || type === 'mouseup' || type === 'click' ? 0 : 1 };
    if (extra) for (var k in extra) o[k] = k in o ? o[k] : extra[k];
    try { el.dispatchEvent(new PointerEvent(type, o)); } catch (e) {
      try { el.dispatchEvent(new MouseEvent(type, o)); } catch (x2) {}
    }
  }
  function tap(x, y) {
    var el = D.elementFromPoint(x, y); if (!el) return;
    ev(el, 'pointerdown', x, y); ev(el, 'mousedown', x, y);
    ev(el, 'pointerup', x, y); ev(el, 'mouseup', x, y);
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window })); } catch (e) {}
    var f = el.closest ? el.closest('button,a,[data-nav],[data-ap],[data-city]') : null;
    say(f ? 'Selected' : 'Pinched');
  }

  /* ---------- what a pinch lands on ---------- */
  function overOrb(x, y) {
    var r = hud().slotRect && hud().slotRect(); if (!r) return false;
    if (D.body.classList.contains('world')) return true;
    return x > r.left && x < r.right && y > r.top && y < r.bottom;
  }
  function panelAt(x, y) {
    var el = D.elementFromPoint(x, y); if (!el || !el.closest) return null;
    var head = el.closest('.ph,.sb-me,.fp>header');   // only the top bar of a board is a handle
    return head ? head.closest('.panel,.fp,.sb') : null;
  }

  function beginDrag(h) {
    var x = h.cx, y = h.cy;
    if (overOrb(x, y)) {
      h.mode = 'orb'; h.target = $('#slot') || D.body;
      ev(h.target, 'pointerdown', x, y); say('Turning the world');
      return;
    }
    var pan = panelAt(x, y);
    if (pan) { h.mode = 'panel'; h.target = pan; h.px = 0; h.py = 0; h.ox = x; h.oy = y;
      pan.classList.remove('hand-spring'); pan.classList.add('hand-held'); say('Holding ' + (pan.querySelector('h2') ? pan.querySelector('h2').textContent.trim() : 'a board')); return; }
    h.mode = 'drag'; h.target = D.elementFromPoint(x, y) || D.body;
    ev(h.target, 'pointerdown', x, y); ev(h.target, 'mousedown', x, y);
  }
  function moveDrag(h) {
    if (h.mode === 'panel') {
      h.px = h.cx - h.ox; h.py = h.cy - h.oy;
      h.target.style.transform = 'translate(' + h.px.toFixed(1) + 'px,' + h.py.toFixed(1) + 'px)';
    } else if (h.target) { ev(h.target, 'pointermove', h.cx, h.cy); ev(h.target, 'mousemove', h.cx, h.cy); }
  }
  function endDrag(h) {
    if (h.mode === 'panel' && h.target) {
      var p = h.target; p.classList.remove('hand-held'); p.classList.add('hand-spring'); p.style.transform = '';
      setTimeout(function () { p.classList.remove('hand-spring'); }, 600); say('Let go');
    } else if (h.target) { ev(h.target, 'pointerup', h.cx, h.cy); ev(h.target, 'mouseup', h.cx, h.cy); }
    h.mode = null; h.target = null;
  }

  /* ---------- open palm: dismiss ---------- */
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

  /* ---------- every frame ---------- */
  function onFrame(res, now) {
    g.clearRect(0, 0, innerWidth, innerHeight);
    var list = (res && res.landmarks) || [], i, W = innerWidth, H = innerHeight;
    while (hands.length > list.length) { var gone = hands.pop(); if (gone.mode) endDrag(gone); }
    for (i = 0; i < list.length; i++) {
      var lmk = list[i], h = hands[i] || (hands[i] = { cx: W / 2, cy: H / 2, mode: null, pinch: false, down: 0, lastx: 0, lastt: 0 });
      var b = T.box, sc = 1 / Math.max(0.05, 1 - 2 * b);
      h.pts = lmk.map(function (q) {
        return { x: Math.max(-40, Math.min(W + 40, ((1 - q.x) - b) * sc * W)), y: Math.max(-40, Math.min(H + 40, (q.y - b) * sc * H)) };
      });
      var size = Math.max(14, Math.hypot(h.pts[0].x - h.pts[9].x, h.pts[0].y - h.pts[9].y));
      /* the cursor is the index fingertip, pushed out from the middle of the view so small moves carry */
      var tx = (h.pts[8].x - W / 2) * T.gain + W / 2, ty = (h.pts[8].y - H / 2) * T.gain + H / 2;
      var k = 1 - Math.pow(T.smooth, Math.max(0.3, (now - lastT) / 16.7));
      h.cx += (Math.max(2, Math.min(W - 2, tx)) - h.cx) * k;
      h.cy += (Math.max(2, Math.min(H - 2, ty)) - h.cy) * k;

      var d = Math.hypot(h.pts[4].x - h.pts[8].x, h.pts[4].y - h.pts[8].y) / size;
      var was = h.pinch;
      if (!h.pinch && d < T.pinchOn) h.pinch = true; else if (h.pinch && d > T.pinchOff) h.pinch = false;
      if (h.pinch && !was) { h.down = now; h.mode = null; h.sx = h.cx; h.sy = h.cy; }
      if (h.pinch && !h.mode && (now - h.down > T.hold || Math.hypot(h.cx - h.sx, h.cy - h.sy) > 26)) beginDrag(h);
      if (h.pinch && h.mode) moveDrag(h);
      if (!h.pinch && was) { if (h.mode) endDrag(h); else if (now - h.down < 650) tap(h.cx, h.cy); }

      /* an open palm thrown sideways dismisses whatever is in front of him */
      if (!h.pinch && openPalm(h.pts, size)) {
        var dt = Math.max(1, now - (h.lastt || now)), v = Math.abs(h.cx - (h.lastx || h.cx)) / dt * 1000 / W;
        if (v > T.swipe) dismiss();
      }
      h.lastx = h.cx; h.lastt = now;
      drawHand(h); drawCursor(h);
    }

    /* two hands pinched: pull apart to open the orb, push together to close it */
    var a = hands[0], b2 = hands[1];
    if (a && b2 && a.pinch && b2.pinch) {
      var span = Math.hypot(a.cx - b2.cx, a.cy - b2.cy) / Math.hypot(W, H);
      if (!zoomPair) { zoomPair = { span: span, base: (hud().orbZoomNow && hud().orbZoomNow()) || 1 };
        if (a.mode) endDrag(a); if (b2.mode) endDrag(b2); }
      var z = Math.max(1, Math.min(T.zoomMax, zoomPair.base + (span - zoomPair.span) * T.zoomGain * 4));
      if (hud().orbZoom) hud().orbZoom(z);
      drawZoom(a, b2); say(z > 1.06 ? 'Into the orb · ' + z.toFixed(1) + '×' : 'Hold and pull apart');
    } else if (zoomPair) { zoomPair = null; }

    if (!list.length) say('Show me a hand');
    lastT = now;
  }

  /* ---------- camera ---------- */
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!on || !mark || video.readyState < 2) return;
    var now = performance.now();
    var res = null;
    try { res = mark.detectForVideo(video, now); } catch (e) { return; }
    onFrame(res, now);
  }

  function start() {
    if (on || starting) return Promise.resolve(on);
    starting = true; say('Waking the camera');
    D.body.classList.add('hands-on');
    return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
      .then(function (stream) {
        video.srcObject = stream; return video.play();
      })
      .then(function () {
        say('Loading the hands');
        return import(MP + 'vision_bundle.mjs');
      })
      .then(function (v) {
        return v.FilesetResolver.forVisionTasks(MP + 'wasm').then(function (fs) {
          return v.HandLandmarker.createFromOptions(fs, {
            baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
            runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
          });
        });
      })
      .then(function (m) {
        mark = m; on = true; starting = false; sizeCanvas();
        if (!raf) loop();
        say('Show me a hand');
        return true;
      })
      .catch(function (e) {
        starting = false; stop();
        say('No camera');
        try { window.__hud && window.__hud.toast && window.__hud.toast('The camera did not open, sir: ' + (e && e.name || e), 1); } catch (x) {}
        return false;
      });
  }
  function stop() {
    on = false; hands.forEach(function (h) { if (h.mode) endDrag(h); }); hands.length = 0; zoomPair = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try { if (video.srcObject) video.srcObject.getTracks().forEach(function (t2) { t2.stop(); }); } catch (e) {}
    video.srcObject = null;
    if (hud().orbZoom) hud().orbZoom(1);
    if (g) g.clearRect(0, 0, innerWidth, innerHeight);
    D.body.classList.remove('hands-on');
  }

  function boot() {
    video = $('#handcam'); cv = $('#handfx'); pill = $('#handpill'); txt = $('#handtxt');
    if (!video || !cv) return;
    g = cv.getContext('2d'); sizeCanvas();
    addEventListener('resize', sizeCanvas);
  }
  if (D.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();

  window.PHR_HANDS = {
    start: start, stop: stop,
    toggle: function () { return on ? (stop(), Promise.resolve(false)) : start(); },
    isOn: function () { return on; },
    tune: function (o) { if (o) { Object.assign(T, o); save(); } return Object.assign({}, T); },
    /* for testing without a camera: feed landmark frames straight in */
    _feed: function (frame, now) { onFrame(frame, now == null ? performance.now() : now); },
    _state: function () { return hands.map(function (h) { return { cx: Math.round(h.cx), cy: Math.round(h.cy), pinch: h.pinch, mode: h.mode }; }); }
  };
})();
