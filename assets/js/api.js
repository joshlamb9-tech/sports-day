/* Sports Day — data layer
 *
 * Thin PostgREST client over fetch() + a durable offline write queue.
 * Reads go straight through (callers handle failure by showing cached data).
 * Writes go through the queue so a flaky school-field signal never loses a result:
 * if the network is down the op is persisted to localStorage and replayed later.
 */
(function () {
  'use strict';

  const REST = window.SD.REST;
  const headers = window.SD.apiHeaders;
  const TIMEOUT_MS = 12000;

  /* ---- uuid ------------------------------------------------------------ */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* ---- fetch with timeout --------------------------------------------- */
  function timedFetch(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, Object.assign({ signal: ctrl.signal }, opts))
      .finally(function () { clearTimeout(t); });
  }

  // A network-level failure (offline / timeout / DNS) vs an HTTP error from the server.
  function isNetworkError(err) {
    return err && (err.name === 'AbortError' || err.name === 'TypeError' || err.__network);
  }

  /* ---- PostgREST query builder ---------------------------------------- */
  // params: { select, order, limit, and arbitrary col: 'eq.value' filters }
  function buildQuery(params) {
    if (!params) return '';
    const parts = [];
    for (const k in params) {
      if (!params.hasOwnProperty(k) || params[k] == null) continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function handle(res) {
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (e) {}
      const err = new Error('HTTP ' + res.status + ': ' + body);
      err.status = res.status;
      throw err;
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  const api = {
    uuid: uuid,

    async select(table, params) {
      const res = await timedFetch(REST + table + buildQuery(params), { headers: headers() });
      return handle(res);
    },

    async insert(table, rows, opts) {
      const pref = (opts && opts.prefer) || 'return=representation';
      const res = await timedFetch(REST + table, {
        method: 'POST',
        headers: headers({ Prefer: pref }),
        body: JSON.stringify(rows)
      });
      return handle(res);
    },

    async update(table, patch, params) {
      const res = await timedFetch(REST + table + buildQuery(params), {
        method: 'PATCH',
        headers: headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(patch)
      });
      return handle(res);
    },

    async del(table, params) {
      const res = await timedFetch(REST + table + buildQuery(params), {
        method: 'DELETE',
        headers: headers({ Prefer: 'return=minimal' })
      });
      return handle(res);
    }
  };

  /* ===================================================================== *
   * Offline write queue
   * ===================================================================== */
  const Q_PREFIX = 'sd_queue_';
  let queueKey = Q_PREFIX + 'default';
  const listeners = [];

  function load() {
    try { return JSON.parse(localStorage.getItem(queueKey) || '[]'); }
    catch (e) { return []; }
  }
  function save(ops) {
    localStorage.setItem(queueKey, JSON.stringify(ops));
    listeners.forEach(function (fn) { try { fn(ops); } catch (e) {} });
  }

  // Execute a single op against the server. Throws on network error (so we retry later);
  // a server/data error (4xx) marks the op failed but does not block the rest of the queue.
  async function runOp(op) {
    if (op.kind === 'replaceEventResults') {
      // 1) clear any existing results for this event, 2) insert the recorded order.
      await api.del('sportsday_results', { event_id: 'eq.' + op.eventId });
      if (op.rows && op.rows.length) {
        await api.insert('sportsday_results', op.rows, { prefer: 'return=minimal' });
      }
      // mark the event done (best-effort; not fatal if it fails)
      try { await api.update('sportsday_events', { status: 'done' }, { id: 'eq.' + op.eventId }); } catch (e) {}
      return;
    }
    if (op.kind === 'raw') {
      // generic: { method, table, params, body }
      if (op.method === 'delete') return api.del(op.table, op.params);
      if (op.method === 'insert') return api.insert(op.table, op.body, { prefer: 'return=minimal' });
      if (op.method === 'update') return api.update(op.table, op.body, op.params);
    }
    throw new Error('Unknown op kind: ' + op.kind);
  }

  let flushing = false;
  const queue = {
    setMeet: function (meetId) { queueKey = Q_PREFIX + (meetId || 'default'); },
    pending: function () { return load(); },
    count: function () { return load().filter(function (o) { return o.status !== 'failed'; }).length; },
    // returns an unsubscribe fn so transient screens can clean up on unmount
    onChange: function (fn) { listeners.push(fn); fn(load()); return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }; },

    enqueue: function (op) {
      const ops = load();
      op.localId = op.localId || uuid();
      op.createdAt = Date.now();
      op.attempts = 0;
      op.status = 'pending';
      ops.push(op);
      save(ops);
      // try straight away; if offline it just stays queued
      queue.flush();
      return op.localId;
    },

    flush: async function () {
      if (flushing) return;
      flushing = true;
      try {
        let ops = load();
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          if (op.status === 'failed') continue;
          try {
            await runOp(op);
            ops = load().filter(function (o) { return o.localId !== op.localId; }); // success → drop
            save(ops);
          } catch (err) {
            if (isNetworkError(err)) {
              // still offline — leave this and everything after for the next flush
              break;
            }
            // server/data error: mark failed, keep for visibility, continue with the rest
            ops = load();
            const me = ops.find(function (o) { return o.localId === op.localId; });
            if (me) { me.status = 'failed'; me.attempts = (me.attempts || 0) + 1; me.lastError = String(err.message || err); }
            save(ops);
          }
        }
      } finally {
        flushing = false;
      }
    },

    retryFailed: function () {
      const ops = load();
      ops.forEach(function (o) { if (o.status === 'failed') { o.status = 'pending'; } });
      save(ops);
      return queue.flush();
    },

    clearFailed: function () {
      save(load().filter(function (o) { return o.status !== 'failed'; }));
    }
  };

  /* ---- connectivity ---------------------------------------------------- */
  const net = {
    get online() { return navigator.onLine !== false; },
    _cbs: [],
    onChange: function (fn) { net._cbs.push(fn); }
  };
  function emitNet() { net._cbs.forEach(function (fn) { try { fn(net.online); } catch (e) {} }); }
  window.addEventListener('online', function () { emitNet(); queue.flush(); });
  window.addEventListener('offline', function () { emitNet(); });
  // periodic flush as a safety net (covers cases where 'online' never fires cleanly)
  setInterval(function () { if (net.online && queue.count() > 0) queue.flush(); }, 15000);

  window.SD.api = api;
  window.SD.queue = queue;
  window.SD.net = net;
})();
