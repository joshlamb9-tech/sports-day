/* Sports Day — hash router + PIN gates + screen lifecycle
 *
 * Routes:  #/  → Spectator (open) · #/record → Record (recorder PIN) ·
 *          #/admin → Admin (admin PIN) · #/setup → Setup (admin PIN; open if no meet yet)
 * Reads `?meet=<id>` (sets current meet) and `?code=<pin>` (one-tap recorder link).
 */
(function () {
  'use strict';

  const { el, $, $$, clear, esc, toast } = window.SD.ui;
  const store = window.SD.store;
  const api = window.SD.api;
  const net = window.SD.net;

  const ROUTES = {
    '/':       { module: 'spectator', view: 'view-spectator', gate: null },
    '/meets':  { module: 'lobby',     view: 'view-lobby',     gate: null },
    '/record': { module: 'record',    view: 'view-record',    gate: 'recorder' },
    '/admin':  { module: 'admin',     view: 'view-admin',     gate: 'admin' },
    '/setup':  { module: 'setup',     view: 'view-setup',     gate: 'admin' }
  };
  const VIEW_IDS = ['view-lobby', 'view-spectator', 'view-record', 'view-admin', 'view-setup', 'view-loading'];

  let currentModule = null;

  function parseHash() {
    let h = location.hash.replace(/^#/, '') || '/';
    const qi = h.indexOf('?');
    let path = h, query = {};
    if (qi !== -1) {
      path = h.slice(0, qi);
      h.slice(qi + 1).split('&').forEach(function (kv) {
        const p = kv.split('='); if (p[0]) query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
    }
    if (!path || path === '') path = '/';
    return { path: path, query: query };
  }

  function showView(id) {
    VIEW_IDS.forEach(function (v) { const n = document.getElementById(v); if (n) n.hidden = (v !== id); });
  }
  function setActiveTab(path) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-route') === path); });
    const ml = $('#meet-label');
    if (!ml) return;
    const cached = store.meetId() && store.cachedBundle(store.meetId());
    if (path === '/meets' || !store.meetId()) { ml.hidden = true; }
    else { ml.hidden = false; ml.textContent = '⇄ ' + ((cached && cached.meet && cached.meet.name) || 'Switch meet'); }
  }

  async function getMeet(meetId) {
    const cached = store.cachedBundle(meetId);
    if (cached && cached.meet) return cached.meet;
    try { const r = await api.select('sportsday_meets', { id: 'eq.' + meetId, limit: 1 }); return r && r[0]; }
    catch (e) { return null; }
  }

  async function gate(kind, query) {
    const meetId = store.meetId();
    if (!meetId) return kind === 'admin' ? true : false; // setup/admin allowed to bootstrap; record needs a meet
    const meet = await getMeet(meetId);
    if (!meet) return kind === 'admin'; // can't verify → let admin through to fix, block recorder
    const pin = kind === 'recorder' ? meet.recorder_pin : meet.admin_pin;
    if (!pin) return true; // no gate configured
    const cacheKey = 'sd_auth_' + kind;
    if (localStorage.getItem(cacheKey) === pin) return true;
    if (kind === 'recorder' && query.code && query.code === pin) { localStorage.setItem(cacheKey, pin); return true; }
    return promptPin(kind, pin);
  }

  function promptPin(kind, expected) {
    return new Promise(function (resolve) {
      const overlay = el('div.sd-modal-overlay');
      const input = el('input.input', { type: 'text', placeholder: 'PIN', autocomplete: 'off' });
      const err = el('p.help', { text: '', style: { color: 'var(--danger)' } });
      function submit() {
        if (input.value === expected) { localStorage.setItem('sd_auth_' + kind, expected); overlay.remove(); resolve(true); }
        else { err.textContent = 'Wrong PIN — try again.'; input.value = ''; input.focus(); }
      }
      const box = el('div.sd-modal', null, [
        el('h3', { text: (kind === 'admin' ? 'Admin' : 'Recorder') + ' PIN' }),
        el('p.muted', { text: 'Enter the ' + kind + ' PIN to continue.' }),
        input, err,
        el('div.row', { style: { marginTop: '16px', justifyContent: 'flex-end' } }, [
          el('button.btn.btn-ghost', { text: 'Cancel', onclick: function () { overlay.remove(); resolve(false); } }),
          el('button.btn.btn-primary', { text: 'Enter', onclick: submit })
        ])
      ]);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      setTimeout(function () { input.focus(); }, 50);
    });
  }

  async function route() {
    const { path, query } = parseHash();
    if (query.meet && query.meet !== store.meetId()) store.setMeetId(query.meet);
    else if (store.meetId()) store.setMeetId(store.meetId()); // ensure queue meet is set

    // No meet chosen yet → send to the lobby to pick a (live) one. Setup can bootstrap without one.
    if (!store.meetId() && path !== '/meets' && path !== '/setup') { location.hash = '#/meets'; return; }

    const def = ROUTES[path] || ROUTES['/'];

    // tear down previous screen
    if (currentModule && currentModule.unmount) { try { currentModule.unmount(); } catch (e) {} }
    currentModule = null;

    // gate
    if (def.gate) {
      const ok = await gate(def.gate, query);
      if (!ok) { location.hash = '#/'; return; }
    }

    const mod = window.SD[def.module];
    showView(def.view);
    setActiveTab(path);
    const node = document.getElementById(def.view);
    clear(node);
    if (mod && mod.mount) {
      currentModule = mod;
      try { await mod.mount(node, { params: query }); }
      catch (e) { node.appendChild(el('div.wrap', null, [el('div.empty', null, [el('h2', { text: 'Something went wrong' }), el('p.muted', { text: String(e.message || e) })])])); }
    }
    window.scrollTo(0, 0);
  }

  /* ---- global connection chip ---- */
  function updateConn() {
    const c = $('#conn-chip');
    if (!c) return;
    const n = window.SD.queue.count();
    if (!net.online) { c.className = 'conn off'; c.title = 'Offline' + (n ? ' · ' + n + ' queued' : ''); c.textContent = '⚠ offline'; }
    else if (n > 0) { c.className = 'conn sync'; c.title = n + ' queued'; c.textContent = '↻ ' + n; }
    else { c.className = 'conn ok'; c.title = 'Online'; c.textContent = ''; }
  }

  window.addEventListener('hashchange', route);
  window.SD.queue.onChange(updateConn);
  net.onChange(updateConn);
  window.addEventListener('online', updateConn);
  window.addEventListener('offline', updateConn);

  document.addEventListener('DOMContentLoaded', function () { route(); updateConn(); });
  if (document.readyState !== 'loading') { route(); updateConn(); }
})();
