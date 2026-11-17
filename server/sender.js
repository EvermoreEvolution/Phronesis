'use strict';
/* THE SENDER. Mr. Evermore's standing rule: approving a draft does not send it. A draft leaves only
   when he names that one draft and tells Phronesis to send it. Phronesis records that as a command
   row (type "send", status "queued") carrying his words. This file is the only thing that puts mail
   in the post, and every check below refuses rather than guesses. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// anything that smells like a secret stops the send: a key, a token, a card number
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.|AKIA[0-9A-Z]{12,}|\b(?:\d[ -]?){13,19}\b|password\s*[:=]\s*\S+|api[_ -]?key\s*[:=]\s*\S+)/i;
const BRAND = { evolution: 'Evermore Evolution', visuals: 'Evermore Visuals', mev: 'Filmed by Mev' };

function check(cmd, need, mail) {
  if (!need) return 'the draft is not in the hub';
  if (need.kind !== 'draft') return 'it is not a draft';
  if (need.status !== 'approved') return 'the draft is not approved';
  if (String(need.channel || '').toLowerCase() !== 'email') return 'it is a ' + (need.channel || 'message') + ', not an email';
  if (need.sendState !== 'queued') return 'its send state is "' + (need.sendState || 'none') + '", not queued';
  if (typeof cmd.words !== 'string' || cmd.words.trim().length < 2) return 'the command carries no word from Mr. Evermore';
  if (!EMAIL.test(String(cmd.to || ''))) return 'the address on the command is not a real address';
  if (String(cmd.to).trim().toLowerCase() !== String(need.email || '').trim().toLowerCase()) return 'the address on the command does not match the draft';
  const body = String(need.preview || '');
  if (body.trim().length < 20) return 'the draft has no text';
  if (SECRET.test(body) || SECRET.test(String(need.subject || ''))) return 'the draft contains what looks like a secret';
  const unit = String(need.unit || '').toLowerCase();
  const from = mail && typeof mail[unit] === 'string' ? mail[unit].trim() : '';
  if (!EMAIL.test(from)) return (BRAND[unit] || 'that brand') + ' has no send-as address on record';
  return null;
}

function makeSender(opts) {
  const store = opts.store, transport = opts.transport, log = opts.log || function () {};
  const perRun = opts.perRun || 5, perDay = opts.perDay || 20;
  let busy = false;

  async function sentToday() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const rows = await store.list('commands');
    return rows.filter(function (r) { const d = r.data || {}; return d.type === 'send' && d.status === 'done' && Number(d.sentAt) >= start.getTime(); }).length;
  }

  async function runOnce() {
    if (busy) return { sent: [], skipped: [], failed: [], note: 'a run is already going' };
    busy = true;
    const out = { sent: [], skipped: [], failed: [] };
    try {
      const mail = (await store.get('meta', 'mail')) || {};
      const queued = (await store.list('commands'))
        .filter(function (r) { return r.data && r.data.type === 'send' && r.data.status === 'queued'; })
        .sort(function (a, b) { return Number(a.data.createdAt || 0) - Number(b.data.createdAt || 0); });
      if (!queued.length) return out;
      let room = perDay - (await sentToday());
      for (const row of queued.slice(0, perRun)) {
        const cmd = row.data, id = row.id;
        const need = await store.get('needs', String(cmd.needId || ''));
        const why = check(cmd, need, mail);
        if (why) {
          // a refusal is recorded once, so it is not re-judged every thirty seconds
          await store.put('commands', id, Object.assign({}, cmd, { status: 'skipped', skippedAt: Date.now(), error: why }));
          if (need && need.sendState === 'queued') await store.put('needs', cmd.needId, Object.assign({}, need, { sendState: 'failed', sendError: why }));
          out.skipped.push({ id: id, why: why }); log('skipped ' + id + ': ' + why); continue;
        }
        if (room <= 0) { out.skipped.push({ id: id, why: 'daily limit of ' + perDay + ' reached; it stays queued for tomorrow' }); log('daily limit reached, ' + id + ' stays queued'); continue; }
        const unit = String(need.unit).toLowerCase(), from = mail[unit].trim(), now = Date.now();
        // CLAIM before sending, so nothing can ever go twice
        await store.put('commands', id, Object.assign({}, cmd, { status: 'sending', sendingAt: now }));
        await store.put('needs', cmd.needId, Object.assign({}, need, { sendState: 'sending' }));
        try {
          const info = await transport.sendMail({
            from: '"' + (BRAND[unit] || 'Evermore') + '" <' + from + '>',
            to: cmd.to.trim(),
            subject: String(need.subject || cmd.subject || '').slice(0, 200),
            text: String(need.preview)            // exactly what he approved: no rewording, no additions
          });
          const at = Date.now(), mid = (info && info.messageId) || '';
          await store.put('commands', id, Object.assign({}, cmd, { status: 'done', sendingAt: now, sentAt: at, messageId: mid, sentFrom: from }));
          await store.put('needs', cmd.needId, Object.assign({}, need, { sendState: 'sent', sentAt: at, messageId: mid, sentFrom: from }));
          await store.put('news', 'sent-' + id, { kind: 'sent', brand: BRAND[unit] || unit, gist: 'Your email "' + String(need.subject || '').slice(0, 80) + '" has gone out', status: 'new', at: at });
          out.sent.push({ id: id, to: cmd.to, from: from }); room--; log('sent ' + id + ' from ' + unit);
        } catch (e) {
          const msg = 'the mail server refused it: ' + String(e && e.message || e).slice(0, 160);
          await store.put('commands', id, Object.assign({}, cmd, { status: 'problem', failedAt: Date.now(), error: msg }));
          await store.put('needs', cmd.needId, Object.assign({}, need, { sendState: 'failed', sendError: msg }));
          out.failed.push({ id: id, why: msg }); log('FAILED ' + id + ': ' + msg);
        }
      }
      return out;
    } finally { busy = false; }
  }
  return { runOnce, check };
}
module.exports = { makeSender, check };
