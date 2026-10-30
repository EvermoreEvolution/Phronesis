/* Phronesis standalone: 3D head + Earth + live two-way voice with the ElevenLabs agent.
   Backend: ElevenLabs Agents over WebSocket (public agent id, no API key in this page). */
(function () {
  'use strict';
  var Q = new URLSearchParams(location.search);
  var AGENT_ID = Q.get('agent') || 'agent_9701m656szq1ea0vm3kwdxwtaw63';
  var WS_URL = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=' + AGENT_ID;
  var IDLE_MS = +(Q.get('idle') || 10000);       // silence before he stops listening
  var DEEP = +(Q.get('deep') || 1);              // playback rate for live voice (0.95 = lower, slower)
  var GREET = {"morning": ["Good morning, Mr. Evermore. Top of the morning to you, sir.", "Good morning, sir. I trust you slept well. The team has been busy.", "Top of the morning, sir. Shall we see what the night brought in?", "Morning, Mr. Evermore. A splendid day ahead, I should think.", "Good morning, sir. How does it go?"], "afternoon": ["Good afternoon, Mr. Evermore. How does it go, sir?", "Good day, sir. A splendid afternoon so far.", "Afternoon, Mr. Evermore. What can I do for you?", "Good afternoon, sir. All is in order. Where shall we begin?", "Good day to you, sir. How are things on your end?"], "evening": ["Good evening, Mr. Evermore. A full day behind us.", "Evening, sir. How did the day treat you?", "Good evening, sir. Splendid to hear from you.", "Good evening, Mr. Evermore. What's on your mind tonight?", "Ah, good evening, sir. At your service."], "late": ["Burning the midnight oil, sir? I'm right here.", "Good evening, Mr. Evermore. Still at it, I see.", "A late one tonight, sir. What can I do for you?", "At your service, sir, whatever the hour."], "back": ["Yes, sir?", "At your service, sir.", "I'm here, sir.", "Go ahead, sir.", "Back again, sir. What do you need?"]};   // recorded in Adam deeper, Oct 30

  function $(id) { return document.getElementById(id); }
  var body = document.body, cap = $('cap'), chip = $('chip'), st = $('st'), mic = $('mic'), hint = $('hint');
  var log = window.PHR_LOG = [];
  function L(m) { log.push(new Date().toTimeString().slice(0, 8) + ' ' + m); if (log.length > 300) log.shift(); try { console.log('[phr] ' + m); } catch (e) {} try { lisSend({ log: m }); } catch (e) {} if (dbg && !dbg.hidden) dbg.textContent = log.slice(-30).join('\n'); }
  var dbg = null, micState = 'off', wsState = 'closed';

  // ---------- visuals ----------
  var head = null, globe = null;
  var IMG = { hero: 'hero.jpg', glow: 'glow.jpg' };
  try { globe = window.PhrGlobe({ cv: $('gl'), lab: $('lab'), landBits: window.LAND, agents: [], onPick: function () {}, onHover: function () {} }); } catch (e) { L('globe ' + e.message); }
  try { head = window.PhrHead({ cv: $('hd'), fx: $('fx'), imgs: IMG, audio: {}, tracks: {}, onAwake: function () { if (pendingAwake) { var f = pendingAwake; pendingAwake = null; f(); } } }); } catch (e) { L('head ' + e.message); }
  if (head && head.setState) head.snap('dormant');

  function setStatus(s, text) { chip.dataset.s = s; st.textContent = text; body.classList.toggle('speaking', s === 'speaking'); }
  function say(text, you) { cap.innerHTML = ''; if (you) { var y = document.createElement('span'); y.className = 'you'; y.textContent = 'You: ' + you; cap.appendChild(y); } if (text) cap.appendChild(document.createTextNode(text)); }

  // ---------- audio out ----------
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = new AC({ latencyHint: 'interactive' });
  var out = ctx.createGain(); out.gain.value = 1;
  var shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 120; shelf.gain.value = 2.5;
  var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
  var an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.2;
  out.connect(shelf); shelf.connect(comp); comp.connect(an); an.connect(ctx.destination);
  var td = new Float32Array(an.fftSize), fd = new Uint8Array(an.frequencyBinCount);
  var playing = [], nextT = 0, outRate = 44100;

  function mouth() {
    an.getFloatTimeDomainData(td); var s = 0; for (var i = 0; i < td.length; i++) s += td[i] * td[i];
    var rms = Math.sqrt(s / td.length);
    an.getByteFrequencyData(fd); var bin = ctx.sampleRate / an.fftSize, lo = 0, hi = 0;
    for (var k = Math.floor(300 / bin); k < 1000 / bin; k++) lo += fd[k];
    for (k = Math.floor(2000 / bin); k < 5000 / bin; k++) hi += fd[k];
    var o = Math.max(0, Math.min(1, (rms - 0.012) * 7.5));
    var sp = lo + hi > 0 ? (hi / (lo + hi) - 0.25) * 2.2 : 0;
    var c = rms < 0.01 && playing.length ? 0.5 : 0;
    mic.style.setProperty('--lv', o.toFixed(2));
    return [o, Math.max(-0.6, Math.min(0.8, sp)), c, 0];
  }
  if (head && head.mouth) head.mouth(mouth);

  function track(src) {
    playing.push(src);
    src.onended = function () {
      var i = playing.indexOf(src); if (i >= 0) playing.splice(i, 1);
      if (!playing.length) onVoiceDone();
    };
  }
  function playBuffer(buf, rate) {
    var src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate || 1; src.connect(out);
    var t = Math.max(ctx.currentTime + 0.04, nextT); src.start(t); nextT = t + buf.duration / (rate || 1);
    track(src); speakingNow();
  }
  function stopVoice() { playing.slice().forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} }); playing = []; nextT = 0; }
  function speakingNow() { if (head && head.state !== 'speaking') head.say(-1, true); setStatus('speaking', 'Speaking'); clearIdle(); }
  function onVoiceDone() {
    if (!live) return; if (head) head.setState('listening');
    if (sending) { setStatus('listening', 'Listening'); armIdle(); return; }
    setStatus('thinking', micState !== 'on' ? 'Waiting for microphone' : 'Connecting');
    waitHint();
  }
  var hintT = null;
  function waitHint() {
    clearTimeout(hintT);
    hintT = setTimeout(function () {
      if (!live || sending) return;
      L('still waiting: mic ' + micState + ', link ' + wsState);
      if (micState !== 'on') say('I cannot hear you yet, sir. Click Allow on the microphone prompt at the top left of this window.');
      else say('My voice link is slow to connect, sir. One moment.');
    }, 4000);
  }

  function b64ToBytes(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function pcmToBuffer(bytes, rate) {
    var n = bytes.length >> 1, dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2), buf = ctx.createBuffer(1, n, rate), ch = buf.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
    return buf;
  }

  // ---------- recorded lines (Adam deeper) ----------
  var REC = {};
  function loadLine(k) { return fetch('voice/g/' + k + '.mp3').then(function (r) { if (!r.ok) throw new Error(k + ' ' + r.status); return r.arrayBuffer(); }).then(function (ab) { return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); }); }).then(function (b) { REC[k] = b; }); }
  function period() { var h = new Date().getHours(); return h < 4 ? 'late' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 23 ? 'evening' : 'late'; }
  function pickLine(set) {   // a different line each time, never the same twice in a row
    var list = GREET[set], last = null; try { last = localStorage.getItem('phr.last.' + set); } catch (e) {}
    var choices = list.map(function (t, i) { return set + '_' + i; }).filter(function (k) { return k !== last; });
    var k = choices[Math.floor(Math.random() * choices.length)]; try { localStorage.setItem('phr.last.' + set, k); } catch (e) {}
    return k;
  }
  function lineText(k) { var m = /^(\w+)_(\d+)$/.exec(k); return m ? GREET[m[1]][+m[2]] : ''; }
  var NEXT = { greet: null, back: null };
  function prepNext() { NEXT.greet = pickLine(period()); NEXT.back = pickLine('back'); return Promise.all([loadLine(NEXT.greet), loadLine(NEXT.back)]); }

  // ---------- microphone ----------
  var stream = null, micNode = null, micSrc = null, micLevel = 0;
  var WORKLET = "class P extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.p=0;this.b=new Int16Array(1600);this.n=0;this.e=0;this.c=0}process(i){var x=i[0]&&i[0][0];if(!x)return true;for(var k=0;k<x.length;k++){this.e+=x[k]*x[k];this.c++}var p=this.p;while(p<x.length){var j=Math.floor(p),f=p-j,a=x[j],b=j+1<x.length?x[j+1]:a,v=a+(b-a)*f;v=Math.max(-1,Math.min(1,v));this.b[this.n++]=v<0?v*32768:v*32767;if(this.n===1600){this.port.postMessage({pcm:this.b.buffer,rms:Math.sqrt(this.e/this.c)},[this.b.buffer]);this.b=new Int16Array(1600);this.n=0;this.e=0;this.c=0}p+=this.r}this.p=p-x.length;return true}}registerProcessor('phr-mic',P);";
  var workletReady = null;
  function startMic() {
    if (stream) return Promise.resolve();
    micState = 'asking';
    if (!workletReady) workletReady = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      .then(function (s) { stream = s; micState = 'on'; L('mic allowed: ' + (s.getAudioTracks()[0] || {}).label); return workletReady; }, function (e) { micState = e && e.name === 'NotAllowedError' ? 'denied' : 'error'; throw e; })
      .then(function () {
        micSrc = ctx.createMediaStreamSource(stream); micNode = new AudioWorkletNode(ctx, 'phr-mic');
        var sink = ctx.createGain(); sink.gain.value = 0; micSrc.connect(micNode); micNode.connect(sink); sink.connect(ctx.destination);
        micNode.port.onmessage = function (e) {
          micLevel = e.data.rms;
          if (micLevel > 0.03 && live && !playing.length) armIdle();
          if (ws && ws.readyState === 1 && sending) ws.send(JSON.stringify({ user_audio_chunk: bytesToB64(new Uint8Array(e.data.pcm)) }));
        };
        L('mic on ' + ctx.sampleRate);
      });
  }
  function stopMic() { try { if (micSrc) micSrc.disconnect(); if (micNode) micNode.disconnect(); } catch (e) {} if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; micNode = micSrc = null; }
  function bytesToB64(u) { var s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

  // ---------- conversation ----------
  var ws = null, live = false, sending = false, convId = null, idleT = null, pendingAwake = null, greeted = false;
  function clearIdle() { if (idleT) { clearTimeout(idleT); idleT = null; } }
  function armIdle() { clearIdle(); idleT = setTimeout(function () { if (live && !playing.length) { L('idle sleep'); sleep('Resting. Say "Hello Phronesis" or tap when you need me.'); } }, IDLE_MS); }

  function connect() {
    return new Promise(function (res, rej) {
      var w = new WebSocket(WS_URL); ws = w; var opened = false; wsState = 'connecting';
      setTimeout(function () { if (!opened && ws === w) { L('link timeout'); try { w.close(); } catch (e) {} rej(new Error('timeout')); } }, 10000);
      w.onopen = function () {
        opened = true; wsState = 'open'; L('voice link open');
        var now = new Date();
        w.send(JSON.stringify({ type: 'conversation_initiation_client_data', dynamic_variables: {} }));
        w.send(JSON.stringify({ type: 'contextual_update', text: 'Right now it is ' + now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' in Worcester. Michael is talking to you from the Phronesis page. You already greeted him; do not greet him again.' }));
        res();
      };
      w.onerror = function () { L('ws error'); if (!opened) rej(new Error('connect failed')); };
      w.onclose = function (e) { wsState = 'closed ' + e.code; L('voice link closed ' + e.code + ' ' + (e.reason || '')); if (!opened) rej(new Error('closed ' + e.code)); if (ws === w) { ws = null; sending = false; if (live) sleep(e.code === 1000 ? 'Conversation ended. Tap to talk again.' : 'Connection dropped (' + (e.reason || e.code) + '). Tap to try again.'); } };
      w.onmessage = function (m) { var d; try { d = JSON.parse(m.data); } catch (e) { return; } onEvent(d); };
    });
  }
  function onEvent(d) {
    switch (d.type) {
      case 'conversation_initiation_metadata':
        var md = d.conversation_initiation_metadata_event || {}; convId = md.conversation_id;
        var f = /pcm_(\d+)/.exec(md.agent_output_audio_format || ''); if (f) outRate = +f[1];
        L('conv ' + convId + ' out ' + md.agent_output_audio_format + ' in ' + md.user_input_audio_format); break;
      case 'audio':
        var a = d.audio_event || {}; if (a.audio_base_64) playBuffer(pcmToBuffer(b64ToBytes(a.audio_base_64), outRate), DEEP); break;
      case 'agent_response':
        say((d.agent_response_event || {}).agent_response || ''); break;
      case 'agent_response_correction':
        var c = d.agent_response_correction_event || {}; if (c.corrected_agent_response) say(c.corrected_agent_response); break;
      case 'user_transcript':
        var u = (d.user_transcription_event || {}).user_transcript || ''; L('heard: ' + u);
        if (u) { say('', u); setStatus('thinking', 'Thinking'); if (head) head.setState('processing'); clearIdle(); }
        break;
      case 'interruption':
        L('interrupted'); stopVoice(); if (head) head.setState('listening'); setStatus('listening', 'Listening'); armIdle(); break;
      case 'ping':
        var p = d.ping_event || {}; setTimeout(function () { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong', event_id: p.event_id })); }, p.ping_ms || 0); break;
    }
  }

  // ---------- PC listener (ws://127.0.0.1:8770): wakes him by name when no tab is open ----------
  var lis = null, lisOn = false, lisWait = 3000;
  function lisSend(o) { try { if (lis && lis.readyState === 1) lis.send(JSON.stringify(o)); } catch (e) {} }
  function lisConnect() {
    var w; try { w = new WebSocket('ws://127.0.0.1:8770'); } catch (e) { return; }
    w.onopen = function () { lis = w; lisOn = true; stopWakeWord(); L('listener linked'); lisSend({ live: live }); };
    w.onmessage = function (m) { var d; try { d = JSON.parse(m.data); } catch (e) { return; } if (d.cmd === 'wake') { L('listener: wake'); if (!$('load').classList.contains('gone')) { if ($('load').classList.contains('ready')) { $('load').classList.add('gone'); greeted = true; wake(true); } else autoWake = true; } else if (!live) wake(!greeted && (greeted = true)); } };
    w.onclose = function () { if (lis === w) { lis = null; if (lisOn) { lisOn = false; if (!live) startWakeWord(); } } lisWait = lisOn || lis ? 3000 : Math.min(30000, lisWait * 1.6); setTimeout(lisConnect, lisWait); };
    w.onerror = function () {};
  }
  var autoWake = Q.get('wake') === '1';
  setTimeout(lisConnect, 300);

  function wake(first) {
    if (live) return;
    live = true; stopWakeWord(); lisSend({ live: true }); body.classList.remove('dormant'); body.classList.add('live');
    setStatus('thinking', 'Waking'); say('');
    ctx.resume();
    var micP = startMic().catch(function (e) { L('mic ' + e.name); throw e; });
    var wsP = connect();
    var line = first ? NEXT.greet : NEXT.back;
    pendingAwake = function () {
      var b = REC[line];
      if (b) { say(lineText(line)); playBuffer(b, 1); } else onVoiceDone();
      setTimeout(function () { prepNext().catch(function () {}); }, 4000);   // a fresh line ready for next time
    };
    if (head) head.wake(); else pendingAwake();
    Promise.all([micP, wsP]).then(function () { sending = true; clearTimeout(hintT); L('live: mic on, link open'); if (live && !playing.length) { setStatus('listening', 'Listening'); say(''); armIdle(); } })
      .catch(function (e) { L('wake failed: ' + (e && (e.name + ' ' + e.message))); live = false; sending = false; pendingAwake = null; clearTimeout(hintT); stopVoice(); if (head) head.setState('dormant'); lisSend({ live: false }); setStatus('error', 'Problem'); say(micState === 'denied' ? 'The microphone is blocked for this page, sir. Click the lock icon by the address, allow the microphone, then tap me again.' : micState !== 'on' ? 'I could not open the microphone, sir. Check that one is plugged in and not used by another app, then tap me again.' : 'I could not reach my voice service. Tap to try again.'); body.classList.remove('live'); if (ws) try { ws.close(); } catch (x) {} });
  }
  function sleep(msg) {
    live = false; sending = false; clearIdle(); lisSend({ live: false }); stopVoice(); pendingAwake = null;
    if (ws) { var w = ws; ws = null; try { w.close(1000); } catch (e) {} }
    stopMic(); body.classList.remove('live', 'speaking'); body.classList.add('dormant');
    if (head) head.setState('dormant'); setStatus('dormant', 'Dormant'); say(msg || '');
    if (!lisOn) startWakeWord();
  }

  // ---------- wake word ("Phronesis") ----------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, wantWW = false;
  function startWakeWord() {
    if (!SR) { hint.textContent = 'Tap to talk'; return; }
    wantWW = true; if (rec) return;
    try {
      rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
      rec.onresult = function (e) { for (var i = e.resultIndex; i < e.results.length; i++) { var t = e.results[i][0].transcript; if (/phr?on[aei]s[iea]s|fr?on[aei]s[iea]s|phonesis|phronesis|fronesis|for nicest|fernesis|phoenix is|phone assist/i.test(t)) { L('wake word: ' + t); stopWakeWord(); wake(false); return; } } };
      rec.onend = function () { rec = null; if (wantWW && !live) setTimeout(startWakeWord, 400); };
      rec.onerror = function (e) { L('ww ' + e.error); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantWW = false; hint.textContent = 'Tap to talk'; } };
      rec.start();
    } catch (e) { rec = null; }
  }
  function stopWakeWord() { wantWW = false; if (rec) { try { rec.onend = null; rec.abort(); } catch (e) {} rec = null; } }

  // ---------- debug: tap the status chip to see what he is doing ----------
  dbg = document.createElement('pre'); dbg.hidden = true;
  dbg.style.cssText = 'position:fixed;left:12px;right:12px;top:56px;max-height:45vh;overflow:auto;z-index:9;margin:0;padding:10px;font:11px/1.4 ui-monospace,monospace;color:#cfe3ff;background:rgba(1,6,16,.92);border:1px solid rgba(140,190,255,.25);border-radius:10px;white-space:pre-wrap';
  document.body.appendChild(dbg);
  chip.style.cursor = 'pointer'; chip.title = 'Tap for details';
  chip.addEventListener('click', function () { dbg.hidden = !dbg.hidden; dbg.textContent = log.slice(-30).join('\n') || 'Nothing yet.'; });
  L('page ' + (navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/g) || []).join(' ') + (window.claude ? ' (inside Claude)' : ''));

  // ---------- controls ----------
  mic.addEventListener('click', function () {
    if (live) { if (playing.length) { stopVoice(); onVoiceDone(); } else sleep('Resting. Say "Hello Phronesis" or tap when you need me.'); }
    else wake(!greeted && (greeted = true));
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && live) sleep(''); });

  // ---------- load everything before the first word ----------
  function imgP(src) { return new Promise(function (r) { var i = new Image(); i.onload = i.onerror = r; i.src = src; }); }
  var lmsg = $('lmsg');
  Promise.all([prepNext(), imgP(IMG.hero), imgP(IMG.glow), new Promise(function (r) { setTimeout(r, 600); })])
    .then(function () { $('load').classList.add('ready'); lmsg.textContent = 'Ready.'; if (autoWake) { autoWake = false; $('load').classList.add('gone'); greeted = true; wake(true); } })
    .catch(function (e) { L('load ' + e.message); $('load').classList.add('ready'); lmsg.textContent = 'Ready (some sounds missing).'; });
  $('go').addEventListener('click', function () { $('load').classList.add('gone'); greeted = true; wake(true); });

  window.PHR = { wake: wake, sleep: sleep, state: function () { return { live: live, sending: sending, ws: ws && ws.readyState, playing: playing.length, head: head && head.state, conv: convId }; } };
})();
