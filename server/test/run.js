'use strict';
/* Tests for the sender. No network, no real mail: an in-memory hub and a fake post office. */
const assert = require('assert');
const { makeSender } = require('../sender');

function hub(seed) {
  const db = JSON.parse(JSON.stringify(seed));
  return {
    db,
    list: async (c) => Object.keys(db[c] || {}).map((id) => ({ id, data: db[c][id] })),
    get: async (c, id) => (db[c] && db[c][id]) || null,
    put: async (c, id, d) => { (db[c] = db[c] || {})[id] = JSON.parse(JSON.stringify(d)); }
  };
}
function post(fail) { const sent = []; return { sent, sendMail: async (m) => { if (fail) throw new Error('535 auth'); sent.push(m); return { messageId: '<m' + sent.length + '@x>' }; } }; }
const BODY = 'Hi Maria, I noticed the menu page on your site has not loaded since the summer. I build and fix sites for Worcester restaurants.';
const need = (o) => Object.assign({ kind: 'draft', status: 'approved', channel: 'email', sendState: 'queued', unit: 'mev', email: 'owner@cafereyes.com', subject: 'Your menu page', preview: BODY }, o || {});
const cmd = (o) => Object.assign({ type: 'send', status: 'queued', needId: 'n1', to: 'owner@cafereyes.com', words: 'yes send the Cafe Reyes one', createdAt: 1 }, o || {});
const MAIL = { evolution: 'evermoreevolution@gmail.com', visuals: '', mev: 'mev@example.com' };
const seed = (n, c, mail) => ({ meta: { mail: mail || MAIL }, needs: { n1: n }, commands: { c1: c } });

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok    ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } }
async function refused(name, n, c, mail, wantWhy) {
  await t(name, async () => {
    const h = hub(seed(n, c, mail)), p = post();
    const r = await makeSender({ store: h, transport: p }).runOnce();
    assert.strictEqual(p.sent.length, 0, 'mail went out');
    assert.strictEqual(r.skipped.length, 1);
    assert.ok(r.skipped[0].why.includes(wantWhy), 'reason was: ' + r.skipped[0].why);
    assert.strictEqual(h.db.commands.c1.status, 'skipped');
  });
}

(async () => {
  await t('a named, approved email draft is sent, exactly as written, as the right brand', async () => {
    const h = hub(seed(need(), cmd())), p = post();
    const r = await makeSender({ store: h, transport: p }).runOnce();
    assert.strictEqual(r.sent.length, 1);
    assert.strictEqual(p.sent[0].text, BODY);
    assert.strictEqual(p.sent[0].to, 'owner@cafereyes.com');
    assert.ok(p.sent[0].from.includes('Filmed by Mev') && p.sent[0].from.includes('mev@example.com'));
    assert.ok(!p.sent[0].cc && !p.sent[0].bcc);
    assert.strictEqual(h.db.needs.n1.sendState, 'sent');
    assert.ok(h.db.needs.n1.sentAt > 0);
    assert.strictEqual(h.db.commands.c1.status, 'done');
    assert.strictEqual(h.db.news['sent-c1'].kind, 'sent');
  });
  await refused('a draft that is not approved is refused', need({ status: 'pending' }), cmd(), null, 'not approved');
  await refused('a text is refused: email only', need({ channel: 'text' }), cmd(), null, 'not an email');
  await refused('an address that does not match the draft is refused', need(), cmd({ to: 'someone@else.com' }), null, 'does not match');
  await refused('a brand with no send-as address is refused, not sent under another name', need({ unit: 'visuals' }), cmd(), null, 'no send-as address');
  await refused('a command without his words is refused', need(), cmd({ words: '' }), null, 'no word from Mr. Evermore');
  await refused('a draft containing a key is refused', need({ preview: BODY + ' api_key: sk-abcdefghijklmnopqrstuv' }), cmd(), null, 'secret');
  await refused('a draft already sent is refused', need({ sendState: 'sent' }), cmd(), null, 'not queued');
  await refused('an empty draft is refused', need({ preview: 'hi' }), cmd(), null, 'no text');
  await t('running twice never sends twice', async () => {
    const h = hub(seed(need(), cmd())), p = post(), s = makeSender({ store: h, transport: p });
    await s.runOnce(); await s.runOnce(); await s.runOnce();
    assert.strictEqual(p.sent.length, 1);
  });
  await t('a mail-server failure is recorded and not retried', async () => {
    const h = hub(seed(need(), cmd())), p = post(true), s = makeSender({ store: h, transport: p });
    const r = await s.runOnce(); await s.runOnce();
    assert.strictEqual(r.failed.length, 1);
    assert.strictEqual(h.db.needs.n1.sendState, 'failed');
    assert.strictEqual(h.db.commands.c1.status, 'problem');
  });
  await t('at most five leave per run, oldest first', async () => {
    const s0 = { meta: { mail: MAIL }, needs: {}, commands: {} };
    for (let i = 1; i <= 8; i++) { s0.needs['n' + i] = need({ email: 'o' + i + '@b.com' }); s0.commands['c' + i] = cmd({ needId: 'n' + i, to: 'o' + i + '@b.com', createdAt: i }); }
    const h = hub(s0), p = post();
    await makeSender({ store: h, transport: p }).runOnce();
    assert.strictEqual(p.sent.length, 5);
    assert.deepStrictEqual(p.sent.map((m) => m.to), ['o1@b.com', 'o2@b.com', 'o3@b.com', 'o4@b.com', 'o5@b.com']);
    assert.strictEqual(h.db.commands.c6.status, 'queued');
  });
  await t('the daily limit holds the rest for tomorrow without losing them', async () => {
    const s0 = { meta: { mail: MAIL }, needs: {}, commands: {} };
    for (let i = 1; i <= 4; i++) { s0.needs['n' + i] = need({ email: 'o' + i + '@b.com' }); s0.commands['c' + i] = cmd({ needId: 'n' + i, to: 'o' + i + '@b.com', createdAt: i }); }
    const h = hub(s0), p = post(), s = makeSender({ store: h, transport: p, perDay: 2 });
    await s.runOnce(); await s.runOnce();
    assert.strictEqual(p.sent.length, 2);
    assert.strictEqual(h.db.commands.c3.status, 'queued');
    assert.strictEqual(h.db.needs.n3.sendState, 'queued');
  });
  await t('a command that is not a send, or not queued, is never touched', async () => {
    const h = hub(seed(need(), cmd({ type: 'task' }))), p = post();
    await makeSender({ store: h, transport: p }).runOnce();
    assert.strictEqual(p.sent.length, 0);
    assert.strictEqual(h.db.commands.c1.status, 'queued');
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
