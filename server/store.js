'use strict';
/* The hub's data lives in one Supabase table: docs(coll, id, data, updated_at).
   This is the only file that talks to it. Swap this file and the data can live anywhere. */
function makeStore(url, key, fetchImpl) {
  const f = fetchImpl || fetch;
  const base = String(url || '').replace(/\/+$/, '') + '/rest/v1/docs';
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  async function list(coll) {
    const r = await f(base + '?select=id,data&coll=eq.' + encodeURIComponent(coll) + '&limit=1000', { headers: H });
    if (!r.ok) throw new Error('hub read failed (' + r.status + ')');
    return r.json();
  }
  async function get(coll, id) {
    const r = await f(base + '?select=id,data&coll=eq.' + encodeURIComponent(coll) + '&id=eq.' + encodeURIComponent(id), { headers: H });
    if (!r.ok) throw new Error('hub read failed (' + r.status + ')');
    const rows = await r.json();
    return rows[0] ? rows[0].data : null;
  }
  async function put(coll, id, data) {
    const r = await f(base + '?on_conflict=coll,id', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, H),
      body: JSON.stringify([{ coll: coll, id: id, data: data, updated_at: new Date().toISOString() }])
    });
    if (!r.ok) throw new Error('hub write failed (' + r.status + ')');
  }
  return { list, get, put };
}
module.exports = { makeStore };
