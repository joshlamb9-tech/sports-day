/* Sports Day — Record screen (the workhorse)
 *
 * Phone-first, sun-glare-friendly, one-thumb. Pick an event, tap houses in finishing
 * order, save. Saves are optimistic and go straight to the offline outbox (api.queue),
 * so the teacher's job is done the instant they tap — the network catches up later.
 */
(function () {
  'use strict';

  const { el, $, clear, esc, toast, confirmDialog, fmtTime } = window.SD.ui;
  const api = window.SD.api;
  const store = window.SD.store;
  const queue = window.SD.queue;
  const net = window.SD.net;
  const scoring = window.SD.scoring;

  let container = null, bundle = null, meetId = null;
  let current = null;          // { event, order:[{house_id, tie}], names:{house_id:name} }
  let queueOff = null;

  const RECENT_KEY = function (m) { return 'sd_recent_' + m; };

  async function mount(node, ctx) {
    container = node;
    meetId = store.meetId();
    if (!meetId) { renderNoMeet(); return; }
    bundle = await store.loadBundle(meetId);
    if (!bundle || !bundle.meet) { renderNoMeet(); return; }
    if (ctx && ctx.params && ctx.params.recorder && !store.recorder()) { /* reserved */ }
    renderPicker();
    // keep event statuses fresh when returning to the tab
    document.addEventListener('visibilitychange', onVisible);
    queueOff = queue.onChange(function (ops) { updateChip(); });
  }
  function unmount() {
    document.removeEventListener('visibilitychange', onVisible);
    if (queueOff) { queueOff(); queueOff = null; }
    container = null; bundle = null; current = null;
  }
  async function onVisible() {
    if (document.hidden || !meetId) return;
    const b = await store.loadBundle(meetId);
    if (b && b.meet) { bundle = b; if (!current) renderPicker(); }
  }

  function renderNoMeet() {
    clear(container);
    container.appendChild(el('div.wrap', null, [
      el('div.empty', null, [
        el('h2', { text: 'No meet yet' }),
        el('p.muted', { text: 'Ask the organiser for the recorder link, or set one up.' }),
        el('a.btn.btn-primary', { href: '#/setup', text: 'Go to Setup' })
      ])
    ]));
  }

  /* ---------- chip ---------- */
  function chip() {
    const c = el('div.sync-chip');
    return c;
  }
  function updateChip() {
    const c = $('#sync-chip', container);
    if (!c) return;
    const n = queue.count();
    if (!net.online && n > 0) { c.className = 'sync-chip offline'; c.innerHTML = '<span class="dot"></span> Offline — ' + n + ' saved on phone'; }
    else if (n > 0) { c.className = 'sync-chip waiting'; c.innerHTML = '<span class="dot pulse"></span> Syncing ' + n + '…'; }
    else { c.className = 'sync-chip ok'; c.innerHTML = '<span class="dot"></span> All synced'; }
  }

  /* ---------- event picker ---------- */
  function renderPicker() {
    current = null;
    clear(container);
    const wrap = el('div.wrap.record', null, [
      el('div.row.between.rec-head', null, [
        el('div', null, [el('p.eyebrow', { text: 'Record' }), el('h1', { text: bundle.meet.name })]),
        el('div', { id: 'sync-chip', class: 'sync-chip' })
      ]),
      recorderBar(),
      meetGate()
    ]);

    const groups = groupEventsByAge();
    const search = el('input.input.search', { placeholder: 'Search events…', oninput: function (e) { filterCards(e.target.value); } });
    wrap.appendChild(el('div.field', { style: { marginTop: '8px' } }, [search]));

    const board = el('div.event-groups');
    groups.forEach(function (g) {
      const sec = el('div.event-group');
      if (g.label) sec.appendChild(el('h3.group-title', { text: g.label }));
      const grid = el('div.event-grid');
      g.events.forEach(function (ev) { grid.appendChild(eventCard(ev)); });
      sec.appendChild(grid);
      board.appendChild(sec);
    });
    if (!groups.length || !bundle.events.length) board.appendChild(el('div.empty', null, [el('p.muted', { text: 'No events configured yet.' })]));
    wrap.appendChild(board);
    container.appendChild(wrap);
    updateChip();
  }

  function recorderBar() {
    const name = store.recorder();
    return el('div.recorder-bar', null, [
      el('span.muted', { text: 'Recording as' }),
      el('input.input.recorder-input', { value: name, placeholder: 'your name / station', oninput: function (e) { store.setRecorder(e.target.value); } })
    ]);
  }
  function meetGate() {
    if (bundle.meet.status === 'live') return el('span', { hidden: 'hidden' });
    const msg = bundle.meet.status === 'finished' ? 'This meet is finished — recording is locked.' : 'This meet is not live yet. The organiser needs to “Go live” in Setup before results can be saved.';
    return el('div.banner.offline', { style: { marginTop: '12px' } }, [el('span', { text: msg })]);
  }

  function groupEventsByAge() {
    const byId = {}; bundle.ageGroups.forEach(function (a) { byId[a.id] = a; });
    const order = bundle.ageGroups.slice().sort(function (a, b) { return a.sort - b.sort; });
    const groups = [];
    order.forEach(function (a) {
      const evs = bundle.events.filter(function (e) { return e.age_group_id === a.id; });
      if (evs.length) groups.push({ label: a.label, events: evs });
    });
    const none = bundle.events.filter(function (e) { return !e.age_group_id; });
    if (none.length) groups.push({ label: order.length ? 'Other' : null, events: none });
    return groups;
  }

  function eventCard(ev) {
    const done = ev.status === 'done';
    const cat = ev.category && ev.category !== 'mixed' ? ev.category : '';
    return el('button.event-card' + (done ? '.done' : ''), { onclick: function () { openRecord(ev); } }, [
      el('span.ev-disc', { text: disciplineIcon(ev.discipline) }),
      el('span.ev-name', { text: ev.name || '(unnamed)' }),
      el('div.row', { style: { gap: '6px' } }, [
        cat ? el('span.chip', { text: cat }) : null,
        done ? el('span.chip.done-chip', { text: '✓ recorded' }) : null
      ])
    ]);
  }
  function disciplineIcon(d) { return ({ track: '🏃', field: '🎯', relay: '🤝', other: '•' })[d] || '•'; }

  function filterCards(q) {
    q = (q || '').toLowerCase();
    window.SD.ui.$$('.event-card', container).forEach(function (c) {
      const name = (c.querySelector('.ev-name').textContent || '').toLowerCase();
      c.style.display = name.indexOf(q) !== -1 ? '' : 'none';
    });
  }

  /* ---------- record card ---------- */
  function openRecord(ev) {
    // preload existing recorded order (for re-recording / correcting)
    const existing = (bundle.results || []).filter(function (r) { return r.event_id === ev.id && !r.voided; })
      .sort(function (a, b) { return a.position - b.position; });
    const order = [], names = {};
    let prevPos = null;
    existing.forEach(function (r) { order.push({ house_id: r.house_id, tie: r.position === prevPos }); if (r.athlete_name) names[r.house_id] = r.athlete_name; prevPos = r.position; });
    current = { event: ev, order: order, names: names, tieNext: false };
    renderCard();
  }

  function renderCard() {
    clear(container);
    const ev = current.event;
    const positions = derivePositions(current.order);
    const wrap = el('div.wrap.record', null, [
      el('div.row.between.rec-head', null, [
        el('button.btn.btn-ghost', { text: '‹ Events', onclick: renderPicker }),
        el('div', { id: 'sync-chip', class: 'sync-chip' })
      ]),
      el('div.card.record-card', null, [
        el('div.rc-title', null, [
          el('h2', { text: ev.name }),
          el('p.muted', { text: [ageLabel(ev.age_group_id), ev.category !== 'mixed' ? ev.category : '', ev.is_relay ? 'relay' : ''].filter(Boolean).join(' · ') })
        ]),
        el('p.help', { text: 'Tap houses in finishing order. Tap a chosen house again to remove it.' }),
        houseTiles(positions),
        tieToggle(),
        orderPreview(positions),
        el('div.row.rc-actions', null, [
          el('button.btn.btn-ghost', { text: 'Clear', onclick: function () { current.order = []; current.names = {}; renderCard(); } }),
          el('button.btn.btn-primary.btn-lg.spread', { text: 'Save result', onclick: saveResult, disabled: current.order.length ? null : 'disabled' })
        ])
      ])
    ]);
    container.appendChild(wrap);
    updateChip();
  }

  function houseTiles(positions) {
    const grid = el('div.house-tiles');
    bundle.houses.forEach(function (h) {
      const pos = positions[h.id];
      const tile = el('button.house-tile' + (pos ? '.picked' : ''), {
        style: { '--house': h.colour }, onclick: function () { toggleHouse(h.id); }
      }, [
        el('span.tile-swatch', { style: { background: h.colour } }),
        el('span.tile-name', { text: h.name }),
        pos ? el('span.tile-pos', { text: medal(pos) + ordinal(pos) }) : null
      ]);
      grid.appendChild(tile);
    });
    return grid;
  }
  function tieToggle() {
    const lbl = el('label.tie-toggle', null, [
      (function () { const c = el('input', { type: 'checkbox' }); if (current.tieNext) c.checked = true; c.addEventListener('change', function () { current.tieNext = c.checked; }); return c; })(),
      el('span', { text: 'Next tap ties with the previous place (dead heat)' })
    ]);
    return lbl;
  }
  function orderPreview(positions) {
    if (!current.order.length) return el('p.muted.preview-empty', { text: 'No places yet.' });
    const scheme = bundle.meet.points_scheme, tie = bundle.meet.tie_policy;
    // build pseudo results to award points
    const pseudo = current.order.map(function (o, i) { return { id: i, position: posOf(current.order, i), house_id: o.house_id }; });
    const award = scoring.awardEventPoints(scheme, tie, pseudo);
    const list = el('div.order-preview');
    current.order.forEach(function (o, i) {
      const h = houseById(o.house_id); const pos = pseudo[i].position; const pts = award.points[i] || 0;
      list.appendChild(el('div.preview-row', null, [
        el('span.pv-pos', { text: medal(pos) + ordinal(pos) }),
        el('span.pv-swatch', { style: { background: h.colour } }),
        el('span.pv-name', { text: h.name }),
        bundle.meet.track_individual ? el('input.input.pv-name-input', { placeholder: 'pupil (optional)', value: current.names[o.house_id] || '', oninput: function (e) { current.names[o.house_id] = e.target.value; } }) : null,
        el('span.pv-pts', { text: window.SD.ui.fmtNum(pts) + ' pt' + (pts === 1 ? '' : 's') })
      ]));
    });
    return list;
  }

  function toggleHouse(houseId) {
    const idx = current.order.map(function (o) { return o.house_id; }).indexOf(houseId);
    if (idx !== -1) { current.order.splice(idx, 1); }
    else { current.order.push({ house_id: houseId, tie: !!current.tieNext && current.order.length > 0 }); current.tieNext = false; }
    renderCard();
  }

  // derive position number per house from order (handles ties)
  function derivePositions(order) {
    const out = {}; let pos = 0;
    order.forEach(function (o, i) { pos = (o.tie && i > 0) ? pos : pos + 1; out[o.house_id] = pos; });
    return out;
  }
  function posOf(order, i) { let pos = 0; for (let k = 0; k <= i; k++) { pos = (order[k].tie && k > 0) ? pos : pos + 1; } return pos; }

  async function saveResult() {
    if (bundle.meet.status !== 'live') { toast(bundle.meet.status === 'finished' ? 'Meet is finished — locked' : 'Meet isn’t live yet', 'error'); return; }
    if (!current.order.length) return;
    const ev = current.event;
    const recordedBy = store.recorder() || null;
    const rows = current.order.map(function (o, i) {
      return {
        meet_id: meetId, event_id: ev.id, position: posOf(current.order, i),
        house_id: o.house_id, athlete_name: (current.names[o.house_id] || '').trim() || null,
        recorded_by: recordedBy, client_uuid: api.uuid()
      };
    });
    // enqueue (offline-safe); optimistic local update
    queue.enqueue({ kind: 'replaceEventResults', eventId: ev.id, meetId: meetId, rows: rows, recordedBy: recordedBy });
    // optimistic: mark done in local bundle + replace local results for this event
    ev.status = 'done';
    bundle.results = (bundle.results || []).filter(function (r) { return r.event_id !== ev.id; }).concat(rows.map(function (r) { return Object.assign({ voided: false, created_at: new Date().toISOString() }, r); }));
    rememberRecent(ev);
    if (window.confetti) { try { confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 }, disableForReducedMotion: true }); } catch (e) {} }
    toast('Saved ✓ ' + ev.name);
    renderPicker();
    if (window.SD.live) window.SD.live.refresh && window.SD.live.refresh();
  }

  function rememberRecent(ev) {
    try {
      const k = RECENT_KEY(meetId);
      const list = JSON.parse(localStorage.getItem(k) || '[]').filter(function (x) { return x.id !== ev.id; });
      list.unshift({ id: ev.id, name: ev.name, at: Date.now() });
      localStorage.setItem(k, JSON.stringify(list.slice(0, 30)));
    } catch (e) {}
  }

  /* ---------- helpers ---------- */
  function houseById(id) { return (bundle.houses.filter(function (h) { return h.id === id; })[0]) || { name: '?', colour: '#888' }; }
  function ageLabel(id) { const a = bundle.ageGroups.filter(function (x) { return x.id === id; })[0]; return a ? a.label : ''; }
  function medal(p) { return p === 1 ? '🥇 ' : p === 2 ? '🥈 ' : p === 3 ? '🥉 ' : ''; }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  window.SD = window.SD || {};
  window.SD.record = { mount: mount, unmount: unmount };
})();
