'use strict';
/* Phronesis's own server. Three jobs today:
   1. serve the hub (the same files GitHub Pages serves)
   2. run the sender on its own clock, every 30 seconds
   3. answer POST /fire, his own trigger, so a queued email leaves at once
   Secrets come from the host's environment only. Nothing secret is in this repo. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { makeStore } = require('./store');
const { makeSender } = require('./sender');

const ENV = process.env;
const ROOT = path.join(__dirname, '..');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const log = function (m) { console.log(new Date().toISOString() + ' ' + m); };
const ready = !!(ENV.SUPABASE_URL && ENV.SUPABASE_SERVICE_KEY);
const mailReady = !!(ENV.GMAIL_USER && ENV.GMAIL_APP_PASSWORD);
const senderOn = String(ENV.SENDER_ON || '').toLowerCase() === 'true';
let sender = null, lastRun = null;

if (ready && mailReady) {
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: ENV.GMAIL_USER, pass: ENV.GMAIL_APP_PASSWORD } });
  sender = makeSender({ store: makeStore(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_KEY), transport: transport, log: log });
}
async function tick(why) {
  if (!sender || !senderOn) return null;
  try { const r = await sender.runOnce(); lastRun = { at: Date.now(), why: why, sent: r.sent.length, skipped: r.skipped.length, failed: r.failed.length }; return r; }
  catch (e) { lastRun = { at: Date.now(), why: why, error: String(e.message || e).slice(0, 200) }; log('sender run failed: ' + lastRun.error); return null; }
}
if (sender && senderOn) setInterval(function () { tick('clock'); }, 30000);

// never serve the server's own code, package files or dotfiles
app.use(function (req, res, next) {
  const p = decodeURIComponent(req.path).toLowerCase();
  if (p.startsWith('/server') || p.startsWith('/node_modules') || p.includes('/.') || /^\/(package(-lock)?\.json|render\.yaml)$/.test(p)) return res.status(404).end();
  next();
});

app.get('/healthz', function (req, res) {
  res.json({ ok: true, hub: ready, mail: mailReady, senderOn: senderOn, lastRun: lastRun });
});

function secretOk(req) {
  const want = String(ENV.FIRE_SECRET || ''), got = String(req.get('x-phronesis-secret') || '');
  if (want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
// his own trigger: run the sender now instead of waiting for the clock
app.post('/fire', async function (req, res) {
  if (!secretOk(req)) return res.status(401).json({ ok: false });
  if (!sender || !senderOn) return res.status(503).json({ ok: false, why: 'the sender is not switched on' });
  const r = await tick('fire');
  res.json({ ok: !!r, sent: r ? r.sent.length : 0, skipped: r ? r.skipped.length : 0, failed: r ? r.failed.length : 0 });
});

// GitHub Pages serves the site under /Phronesis/; answer that path too so old links keep working
app.use('/Phronesis', express.static(ROOT, { extensions: ['html'] }));
app.use(express.static(ROOT, { extensions: ['html'] }));

const port = Number(ENV.PORT) || 4173;
if (require.main === module) app.listen(port, function () { log('Phronesis is up on ' + port + ' | hub ' + ready + ' | mail ' + mailReady + ' | sender ' + senderOn); });
module.exports = app;
