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
  let family = null;           // the open event-family { key, name, category, discipline, rows:[event,...] }
  let queueOff = null;
  let groupMode = 'type';      // list grouping: 'type' = track/field/relay/fun, 'all' = flat A–Z

  const RECENT_KEY = function (m) { return 'sd_recent_' + m; };

  async function mount(node, ctx) {
    container = node;
    meetId = store.meetId();
    try { groupMode = localStorage.getItem('sd_group_mode') || 'type'; } catch (e) {}
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
    family = null;
    clear(container);
    const wrap = el('div.wrap.record', null, [
      el('div.row.between.rec-head', null, [
        el('div', null, [el('p.eyebrow', { text: 'Record' }), el('h1', { text: bundle.meet.name })]),
        el('div', { id: 'sync-chip', class: 'sync-chip' })
      ]),
      recorderBar(),
      meetGate()
    ]);

    const search = el('input.input.search', { placeholder: 'Search events…', oninput: function (e) { filterCards(e.target.value); } });
    wrap.appendChild(el('div.picker-controls', null, [groupToggle(), search]));

    const groups = groupFamilies();
    const board = el('div.event-groups');
    groups.forEach(function (g) {
      const sec = el('div.event-group');
      if (g.label) sec.appendChild(el('h3.group-title', { text: g.label }));
      const grid = el('div.event-grid');
      g.families.forEach(function (fam) { grid.appendChild(familyCard(fam)); });
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

  // An event "family" is the same event across age groups, e.g. Long Jump for
  // Junior / Inter / Senior. One teacher owns the whole family: they open it once
  // and flip between age groups inside, rather than hopping in and out per cohort.
  function familyKey(ev) {
    return [(ev.name || '').trim().toLowerCase(), ev.category || 'mixed', ev.discipline || 'track', ev.entry_mode || 'places'].join('|');
  }
  function ageSortVal(id) { const a = bundle.ageGroups.filter(function (x) { return x.id === id; })[0]; return a ? a.sort : 999; }

  function buildFamilies() {
    const map = {}; const orderKeys = [];
    bundle.events.forEach(function (ev) {
      const key = familyKey(ev);
      if (!map[key]) {
        map[key] = { key: key, name: ev.name || '(unnamed)', category: ev.category, discipline: ev.discipline || 'track', entry_mode: ev.entry_mode || 'places', rows: [] };
        orderKeys.push(key);
      }
      map[key].rows.push(ev);
    });
    orderKeys.forEach(function (k) { map[k].rows.sort(function (a, b) { return ageSortVal(a.age_group_id) - ageSortVal(b.age_group_id); }); });
    return orderKeys.map(function (k) { return map[k]; });
  }

  function groupFamilies() {
    const fams = buildFamilies();
    if (groupMode === 'all') {
      const sorted = fams.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      return [{ label: null, families: sorted }];
    }
    const order = [['track', 'Track'], ['field', 'Field'], ['relay', 'Relay'], ['other', 'Fun & novelty']];
    const known = order.map(function (p) { return p[0]; });
    const out = [];
    order.forEach(function (pair) {
      const fs = fams.filter(function (f) { return (f.discipline || 'track') === pair[0]; });
      if (fs.length) out.push({ label: pair[1], families: fs });
    });
    const rest = fams.filter(function (f) { return known.indexOf(f.discipline || 'track') === -1; });
    if (rest.length) out.push({ label: 'Other', families: rest });
    return out;
  }

  // has anything been recorded for one age-group row?
  function familyRowDone(ev) {
    const isMarks = (ev.entry_mode || 'places') === 'marks';
    const isTrackEv = !isMarks && (ev.discipline || 'track') === 'track';
    const rs = (bundle.results || []).filter(function (r) { return r.event_id === ev.id && !r.voided; });
    if (isMarks || isTrackEv) return rs.length > 0;
    return ev.status === 'done';
  }

  function groupToggle() {
    function btn(mode, label) {
      return el('button.seg-btn' + (groupMode === mode ? '.active' : ''), {
        text: label,
        onclick: function () {
          if (groupMode === mode) return;
          groupMode = mode;
          try { localStorage.setItem('sd_group_mode', mode); } catch (e) {}
          renderPicker();
        }
      });
    }
    return el('div.seg', null, [btn('type', 'By type'), btn('all', 'All A–Z')]);
  }

  function familyCard(fam) {
    const cat = fam.category && fam.category !== 'mixed' ? fam.category : '';
    let ages;
    const ageRows = fam.rows.filter(function (ev) { return ev.age_group_id; });
    if (ageRows.length) {
      ages = el('div.row.wrap-x', { style: { gap: '6px' } }, ageRows.map(function (ev) {
        const done = familyRowDone(ev);
        return el('span.chip' + (done ? '.done-chip' : ''), { text: (done ? '✓ ' : '') + ageLabel(ev.age_group_id) });
      }));
    } else {
      const done = familyRowDone(fam.rows[0]);
      ages = done ? el('div.row.wrap-x', { style: { gap: '6px' } }, [el('span.chip.done-chip', { text: '✓ recorded' })]) : null;
    }
    return el('button.event-card', { onclick: function () { openFamily(fam); } }, [
      el('span.ev-disc', { text: disciplineIcon(fam.discipline) }),
      el('span.ev-name', { text: fam.name }),
      cat ? el('div.row.wrap-x', { style: { gap: '6px' } }, [el('span.chip', { text: cat })]) : null,
      ages
    ]);
  }

  function openFamily(fam) {
    family = fam;
    const undone = fam.rows.filter(function (ev) { return !familyRowDone(ev); });
    const ev = undone[0] || fam.rows[0];
    if ((ev.entry_mode || 'places') === 'marks') openField(ev); else openRecord(ev);
  }

  // the age-group toggle shown INSIDE an open event — flip cohort without leaving
  function familyAgeBar() {
    if (!family || family.rows.length <= 1) return null;
    const bar = el('div.heat-bar.age-bar');
    family.rows.forEach(function (ev) {
      const active = current && current.event && current.event.id === ev.id;
      bar.appendChild(el('button.heat-pill' + (active ? '.active' : ''), { onclick: function () { switchFamilyEvent(ev); } },
        [el('span', { text: ageLabel(ev.age_group_id) || 'All ages' }), familyRowDone(ev) ? el('span.heat-tick', { text: ' ✓' }) : null]));
    });
    return el('div.age-switch', null, [el('span.eyebrow', { text: 'Age group' }), bar]);
  }

  function switchFamilyEvent(ev) {
    if (current && current.event && current.event.id === ev.id) return;
    // field entrants persist on every change; track heats need an explicit flush
    if (current && current.mode !== 'marks' && current.dirty && current.order.length) persistHeat();
    if ((ev.entry_mode || 'places') === 'marks') openField(ev); else openRecord(ev);
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
    if ((ev.entry_mode || 'places') === 'marks') { return openField(ev); }
    const heatsPresent = raceHeats(ev);
    current = { event: ev, order: [], tieNext: false, dirty: false, heatsSeen: heatsPresent.length ? heatsPresent : ['A'], heat: heatsPresent[0] || 'A' };
    loadHeat(current.heat);
    renderCard();
  }
  function isTrack() { return (current.event.discipline || 'track') === 'track'; }
  function raceHeats(ev) {
    const set = {};
    (bundle.results || []).forEach(function (r) { if (r.event_id === ev.id && !r.voided) set[r.heat || 'A'] = 1; });
    return Object.keys(set).sort();
  }
  function heatHasData(heat) {
    return (bundle.results || []).some(function (r) { return r.event_id === current.event.id && (r.heat || 'A') === heat && !r.voided; });
  }
  function loadHeat(heat) {
    current.heat = heat;
    const ev = current.event;
    const existing = (bundle.results || []).filter(function (r) { return r.event_id === ev.id && (r.heat || 'A') === heat && !r.voided; })
      .sort(function (a, b) { return a.position - b.position; });
    const order = []; let prevPos = null;
    existing.forEach(function (r) { order.push({ house_id: r.house_id, tie: r.position === prevPos, name: r.athlete_name || '', time: r.mark != null ? String(r.mark) : '' }); prevPos = r.position; });
    current.order = order; current.tieNext = false; current.dirty = false;
  }

  function renderCard() {
    clear(container);
    const ev = current.event;
    const positions = derivePositions(current.order);
    const track = isTrack();
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
        familyAgeBar(),
        track ? heatBar() : null,
        el('p.help', { text: track ? ('Heat ' + current.heat + ' — tap houses in finishing order (a house can place more than once). Save each heat; points are summed across heats.') : 'Tap houses in finishing order. Remove a place with ✕ in the list below.' }),
        houseTiles(positions),
        tieToggle(),
        orderPreview(positions),
        el('div.row.rc-actions', null, [
          el('button.btn.btn-ghost', { text: 'Clear', onclick: function () { current.order = []; current.dirty = true; renderCard(); } }),
          el('button.btn.btn-primary.btn-lg.spread', { text: track ? ('Save Heat ' + current.heat) : 'Save result', onclick: saveRaceHeat, disabled: current.order.length ? null : 'disabled' })
        ])
      ])
    ]);
    container.appendChild(wrap);
    updateChip();
  }

  function heatBar() {
    const bar = el('div.heat-bar');
    current.heatsSeen.forEach(function (h) {
      bar.appendChild(el('button.heat-pill' + (h === current.heat ? '.active' : ''), { onclick: function () { switchHeat(h); } },
        [el('span', { text: 'Heat ' + h }), heatHasData(h) ? el('span.heat-tick', { text: ' ✓' }) : null]));
    });
    bar.appendChild(el('button.heat-pill.heat-add', { text: '+ heat', onclick: addHeat }));
    return bar;
  }
  function switchHeat(h) {
    if (h === current.heat) return;
    if (current.dirty && current.order.length) persistHeat();
    loadHeat(h); renderCard();
  }
  function addHeat() {
    let i = 0, letter;
    do { letter = String.fromCharCode(65 + i); i++; } while (current.heatsSeen.indexOf(letter) !== -1);
    if (current.dirty && current.order.length) persistHeat();
    current.heatsSeen.push(letter); current.heatsSeen.sort();
    loadHeat(letter); renderCard();
  }

  function houseTiles(positions) {
    const grid = el('div.house-tiles');
    bundle.houses.forEach(function (h) {
      const count = current.order.filter(function (o) { return o.house_id === h.id; }).length;
      const tile = el('button.house-tile' + (count ? '.picked' : ''), {
        style: { '--house': h.colour }, onclick: function () { addPlacing(h.id); }
      }, [
        el('span.tile-swatch', { style: { background: h.colour } }),
        el('span.tile-name', { text: h.name }),
        count ? el('span.tile-pos', { text: count > 1 ? ('×' + count) : (medal(positions[h.id]) + ordinal(positions[h.id])) }) : null
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
    const scheme = (current.event.points_scheme && Object.keys(current.event.points_scheme).length) ? current.event.points_scheme : bundle.meet.points_scheme;
    const tie = bundle.meet.tie_policy;
    const pseudo = current.order.map(function (o, i) { return { id: i, position: posOf(current.order, i), house_id: o.house_id }; });
    const award = scoring.awardEventPoints(scheme, tie, pseudo);
    const list = el('div.order-preview');
    current.order.forEach(function (o, i) {
      const h = houseById(o.house_id); const pos = pseudo[i].position; const pts = award.points[i] || 0;
      list.appendChild(el('div.preview-row', null, [
        el('span.pv-pos', { text: medal(pos) + ordinal(pos) }),
        el('span.pv-swatch', { style: { background: h.colour } }),
        el('span.pv-name', { text: h.name }),
        bundle.meet.track_individual ? el('input.input.pv-name-input', { placeholder: 'pupil (optional)', value: o.name || '', oninput: function (e) { o.name = e.target.value; current.dirty = true; } }) : null,
        el('input.input.pv-time-input', { type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'time', value: o.time || '', oninput: function (e) { o.time = e.target.value; current.dirty = true; } }),
        el('span.pv-pts', { text: window.SD.ui.fmtNum(pts) + ' pt' + (pts === 1 ? '' : 's') }),
        el('button.btn.btn-ghost.btn-icon', { text: '✕', title: 'Remove place', onclick: function () { removePlacing(i); } })
      ]));
    });
    return list;
  }

  function addPlacing(houseId) {
    current.order.push({ house_id: houseId, tie: !!current.tieNext && current.order.length > 0, name: '' });
    current.tieNext = false; current.dirty = true;
    renderCard();
  }
  function removePlacing(i) { current.order.splice(i, 1); current.dirty = true; renderCard(); }

  // derive a representative position per house from the order (handles ties + repeats)
  function derivePositions(order) {
    const out = {}; let pos = 0;
    order.forEach(function (o, i) { pos = (o.tie && i > 0) ? pos : pos + 1; if (out[o.house_id] == null) out[o.house_id] = pos; });
    return out;
  }
  function posOf(order, i) { let pos = 0; for (let k = 0; k <= i; k++) { pos = (order[k].tie && k > 0) ? pos : pos + 1; } return pos; }

  function persistHeat() {
    const ev = current.event;
    const recordedBy = store.recorder() || null;
    const heat = current.heat;
    const rows = current.order.map(function (o, i) {
      return {
        meet_id: meetId, event_id: ev.id, heat: heat, position: posOf(current.order, i),
        house_id: o.house_id, athlete_name: (o.name || '').trim() || null,
        mark: (o.time !== '' && o.time != null && !isNaN(Number(o.time))) ? Number(o.time) : null,
        recorded_by: recordedBy, client_uuid: api.uuid()
      };
    });
    queue.enqueue({ kind: 'replaceEventResults', eventId: ev.id, heat: heat, meetId: meetId, rows: rows, recordedBy: recordedBy });
    ev.status = 'done';
    const stamped = rows.map(function (r) { return Object.assign({ voided: false, created_at: new Date().toISOString() }, r); });
    bundle.results = (bundle.results || []).filter(function (r) { return !(r.event_id === ev.id && (r.heat || 'A') === heat && !r.voided); }).concat(stamped);
    current.dirty = false;
    rememberRecent(ev);
  }

  async function saveRaceHeat() {
    if (bundle.meet.status !== 'live') { toast(bundle.meet.status === 'finished' ? 'Meet is finished — locked' : 'Meet isn’t live yet', 'error'); return; }
    if (!current.order.length) return;
    const ev = current.event, track = isTrack();
    persistHeat();
    if (window.confetti) { try { confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 }, disableForReducedMotion: true }); } catch (e) {} }
    if (window.SD.live && window.SD.live.refresh) window.SD.live.refresh();
    if (track) { toast('Heat ' + current.heat + ' saved ✓'); renderCard(); }
    else { toast('Saved ✓ ' + ev.name); renderPicker(); }
  }

  function rememberRecent(ev) {
    try {
      const k = RECENT_KEY(meetId);
      const list = JSON.parse(localStorage.getItem(k) || '[]').filter(function (x) { return x.id !== ev.id; });
      list.unshift({ id: ev.id, name: ev.name, at: Date.now() });
      localStorage.setItem(k, JSON.stringify(list.slice(0, 30)));
    } catch (e) {}
  }

  /* ---------- field event (measured marks, open entrant list) ---------- */
  function newEntrant() { return { clientUuid: api.uuid(), id: null, name: '', houseId: null, attempts: [''] }; }
  function numericAttempts(arr) { return (arr || []).filter(function (a) { return a !== '' && a != null && !isNaN(Number(a)); }).map(Number); }

  function openField(ev) {
    const existing = (bundle.results || []).filter(function (r) { return r.event_id === ev.id && !r.voided; })
      .sort(function (a, b) { return (scoring.bestMark(b.attempts) || -1) - (scoring.bestMark(a.attempts) || -1); });
    const entrants = existing.map(function (r) {
      return { clientUuid: r.client_uuid || api.uuid(), id: r.id, name: r.athlete_name || '', houseId: r.house_id || null, attempts: (r.attempts || []).map(String) };
    });
    if (!entrants.length) entrants.push(newEntrant());
    current = { event: ev, mode: 'marks', entrants: entrants };
    renderField();
  }

  function renderField() {
    clear(container);
    const ev = current.event;
    if (current.attemptCols == null) {
      current.attemptCols = Math.max(3, current.entrants.reduce(function (m, e) { return Math.max(m, e.attempts.length); }, 0));
    }
    const tbody = el('tbody');
    current._tbody = tbody;
    current.entrants.forEach(function (en) { tbody.appendChild(entrantTr(en)); });
    const headCells = [el('th.th-name', { text: 'Name' }), el('th', { text: 'House' })];
    for (let i = 0; i < current.attemptCols; i++) headCells.push(el('th.th-att', { text: 'Att ' + (i + 1) }));
    headCells.push(el('th.th-best', { text: 'Best' }), el('th', { text: '' }));
    const table = el('table.entrant-table', null, [el('thead', null, [el('tr', null, headCells)]), tbody]);

    const wrap = el('div.wrap.record.wide', null, [
      el('div.row.between.rec-head', null, [
        el('button.btn.btn-ghost', { text: '‹ Events', onclick: renderPicker }),
        el('div', { id: 'sync-chip', class: 'sync-chip' })
      ]),
      el('div.card.record-card', null, [
        el('div.rc-title', null, [
          el('h2', { text: ev.name }),
          el('p.muted', { text: [ageLabel(ev.age_group_id), ev.category !== 'mixed' ? ev.category : '', 'measured — best counts'].filter(Boolean).join(' · ') })
        ]),
        familyAgeBar(),
        el('p.help', { text: 'Add each child as they compete; type each attempt along their row (best counts). House can be TBC for now. The leaderboard ranks automatically.' }),
        el('div.entrant-table-wrap', null, [table]),
        el('div.row.field-actions.wrap-x', null, [
          el('button.btn.btn-primary', { text: '+ Add entrant', onclick: addEntrantToTable }),
          el('button.btn.btn-ghost', { text: '+ Attempt column', onclick: function () { current.attemptCols++; renderField(); } }),
          current.attemptCols > 1 ? el('button.btn.btn-ghost', { text: '− Attempt column', onclick: removeAttemptCol }) : null
        ]),
        el('h3.section-title', { text: 'Provisional leaderboard', style: { marginTop: '20px' } }),
        el('div', { id: 'field-board' })
      ])
    ]);
    container.appendChild(wrap);
    updateChip();
    refreshBoard();
  }

  function addEntrantToTable() {
    const en = newEntrant();
    while (en.attempts.length < current.attemptCols) en.attempts.push('');
    current.entrants.push(en);
    if (current._tbody) current._tbody.appendChild(entrantTr(en, true));
  }

  // drop the last attempt column; only confirm if it actually holds marks, so the
  // common case (clearing a stray 4th column back to three) is a single tap
  function removeAttemptCol() {
    if (current.attemptCols <= 1) return;
    const idx = current.attemptCols - 1;
    const hasData = current.entrants.some(function (en) {
      const v = en.attempts[idx];
      return v !== '' && v != null && !isNaN(Number(v));
    });
    function doRemove() {
      current.attemptCols--;
      current.entrants.forEach(function (en) {
        const v = en.attempts[idx];
        const wasNum = v !== '' && v != null && !isNaN(Number(v));
        if (en.attempts.length > current.attemptCols) en.attempts = en.attempts.slice(0, current.attemptCols);
        if (wasNum) persistEntrant(en);
      });
      renderField();
    }
    if (hasData) {
      confirmDialog({ title: 'Remove the last attempt column?', body: 'Some entrants have a mark in this column — it will be deleted.', ok: 'Remove', danger: true })
        .then(function (ok) { if (ok) doRemove(); });
    } else {
      doRemove();
    }
  }

  function entrantTr(en, focus) {
    while (en.attempts.length < current.attemptCols) en.attempts.push('');
    const bestCell = el('td.et-best');
    function changed() { updateBestCell(en, bestCell); persistEntrant(en); refreshBoard(); }
    const nameInput = el('input.input.et-name', { value: en.name, placeholder: 'Name', onchange: function (e) { en.name = e.target.value; changed(); } });
    const houseSel = el('select.select.et-house');
    houseSel.appendChild(el('option', { value: '', text: 'TBC' }));
    bundle.houses.forEach(function (h) { const o = el('option', { value: h.id, text: h.name }); if (en.houseId === h.id) o.selected = true; houseSel.appendChild(o); });
    houseSel.addEventListener('change', function (e) { en.houseId = e.target.value || null; changed(); });
    const attCells = [];
    for (let i = 0; i < current.attemptCols; i++) {
      (function (idx) {
        const inp = el('input.input.et-att', { type: 'number', step: 'any', inputmode: 'decimal', value: en.attempts[idx] != null ? en.attempts[idx] : '' });
        inp.addEventListener('change', function (e) { en.attempts[idx] = e.target.value; changed(); });
        attCells.push(el('td', null, [inp]));
      })(i);
    }
    const tr = el('tr.entrant-tr', null, [
      el('td.td-name', null, [nameInput]),
      el('td.td-house', null, [houseSel])
    ].concat(attCells, [
      bestCell,
      el('td.td-x', null, [el('button.btn.btn-ghost.btn-icon', { text: '✕', title: 'Remove', onclick: function () { removeEntrant(en, tr); } })])
    ]));
    updateBestCell(en, bestCell);
    if (focus) setTimeout(function () { nameInput.focus(); }, 30);
    return tr;
  }

  function updateBestCell(en, cell) {
    const b = scoring.bestMark(numericAttempts(en.attempts));
    cell.textContent = b != null ? window.SD.ui.fmtNum(b) : '–';
  }

  function persistEntrant(en) {
    const name = (en.name || '').trim();
    const attempts = numericAttempts(en.attempts);
    if (!name && !attempts.length && !en.houseId) return; // nothing worth saving yet
    const row = { meet_id: meetId, event_id: current.event.id, athlete_name: name || null, house_id: en.houseId || null, position: null, attempts: attempts, recorded_by: store.recorder() || null, client_uuid: en.clientUuid };
    queue.enqueue({ kind: 'upsertResult', eventId: current.event.id, row: row });
    bundle.results = (bundle.results || []).filter(function (r) { return r.client_uuid !== en.clientUuid; }).concat([Object.assign({ id: en.id, voided: false, created_at: new Date().toISOString() }, row)]);
  }
  async function removeEntrant(en, rowNode) {
    const ok = await confirmDialog({ title: 'Remove this entrant?', ok: 'Remove', danger: true });
    if (!ok) return;
    current.entrants = current.entrants.filter(function (x) { return x !== en; });
    if (en.id || numericAttempts(en.attempts).length || en.name) queue.enqueue({ kind: 'deleteResult', clientUuid: en.clientUuid });
    bundle.results = (bundle.results || []).filter(function (r) { return r.client_uuid !== en.clientUuid; });
    if (rowNode) rowNode.remove();
    refreshBoard();
  }

  function refreshBoard() {
    const board = window.SD.ui.$('#field-board', container);
    if (!board) return;
    clear(board);
    const scheme = (current.event.points_scheme && Object.keys(current.event.points_scheme).length) ? current.event.points_scheme : bundle.meet.points_scheme;
    const ranked = current.entrants.map(function (e) { return { e: e, best: scoring.bestMark(numericAttempts(e.attempts)) }; })
      .filter(function (x) { return x.best != null; }).sort(function (a, b) { return b.best - a.best; });
    if (!ranked.length) { board.appendChild(el('p.muted', { text: 'No marks entered yet.' })); return; }
    let pos = 0, prev = null; const rows = [];
    ranked.forEach(function (x, i) { if (prev === null || x.best !== prev) { pos = i + 1; prev = x.best; } rows.push({ en: x.e, best: x.best, position: pos }); });
    const pseudo = rows.map(function (r, i) { return { id: i, position: r.position, house_id: r.en.houseId }; });
    const award = scoring.awardEventPoints(scheme, bundle.meet.tie_policy, pseudo);
    rows.forEach(function (r, i) { r.points = award.points[i] || 0; });
    rows.forEach(function (r) {
      const h = houseById(r.en.houseId);
      board.appendChild(el('div.fb-row', null, [
        el('span.fb-pos', { text: medal(r.position) + ordinal(r.position) }),
        el('span.fb-name', { text: r.en.name || '(no name)' }),
        r.en.houseId ? el('span.swatch', { style: { background: h.colour } }) : el('span.chip', { text: 'TBC' }),
        el('span.fb-mark.numeral', { text: window.SD.ui.fmtNum(r.best) }),
        el('span.fb-pts', { text: window.SD.ui.fmtNum(r.points) + ' pt' + (r.points === 1 ? '' : 's') })
      ]));
    });
  }

  /* ---------- helpers ---------- */
  function houseById(id) { return (bundle.houses.filter(function (h) { return h.id === id; })[0]) || { name: '?', colour: '#888' }; }
  function ageLabel(id) { const a = bundle.ageGroups.filter(function (x) { return x.id === id; })[0]; return a ? a.label : ''; }
  function medal(p) { return p === 1 ? '🥇 ' : p === 2 ? '🥈 ' : p === 3 ? '🥉 ' : ''; }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  window.SD = window.SD || {};
  window.SD.record = { mount: mount, unmount: unmount };
})();
