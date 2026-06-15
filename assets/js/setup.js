/* Sports Day — Setup screen
 *
 * Configure the meet (houses, age groups, events, points scheme, PINs), go live,
 * hand out the recorder link, print a paper fallback sheet. Mowden's four houses
 * and a 5/3/1 scheme are pre-seeded but everything is editable. Save diffs against
 * the DB (insert new / update changed / delete removed) so editing config after
 * recording has begun never cascade-deletes recorded results unintentionally.
 */
(function () {
  'use strict';

  const { el, $, clear, esc, toast, confirmDialog } = window.SD.ui;
  const api = window.SD.api;
  const store = window.SD.store;
  const D = window.SD.MOWDEN_DEFAULTS;

  let draft = null;     // { meet, houses, ageGroups, events }
  let container = null;
  const DISCIPLINES = ['track', 'field', 'relay', 'other'];
  const CATEGORIES = ['mixed', 'boys', 'girls'];

  function blankDraft() {
    return {
      meet: {
        name: 'Sports Day ' + new Date().getFullYear(),
        event_date: null,
        status: 'setup',
        points_scheme: Object.assign({}, D.pointsScheme),
        tie_policy: 'split',
        track_individual: true,
        recorder_pin: '',
        admin_pin: ''
      },
      houses: D.houses.map(function (h, i) { return { name: h.name, colour: h.colour, sort: i }; }),
      ageGroups: D.ageGroups.map(function (l, i) { return { _tmp: 'ag' + i, label: l, sort: i }; }),
      events: []
    };
  }

  function fromBundle(b) {
    return {
      meet: Object.assign({}, b.meet),
      houses: b.houses.map(function (h) { return Object.assign({}, h); }),
      ageGroups: b.ageGroups.map(function (a) { return Object.assign({}, a); }),
      events: b.events.map(function (e) { return Object.assign({}, e); })
    };
  }

  /* ---------- mount ---------- */
  async function mount(node, ctx) {
    container = node;
    const meetId = store.meetId();
    if (meetId) {
      const b = await store.loadBundle(meetId);
      draft = b && b.meet ? fromBundle(b) : blankDraft();
    } else {
      draft = blankDraft();
    }
    render();
  }
  function unmount() { container = null; draft = null; }

  /* ---------- render ---------- */
  function render() {
    clear(container);
    const wrap = el('div.wrap.setup', null, [
      el('div.row.between', { style: { marginTop: '24px', marginBottom: '8px' } }, [
        el('div', null, [
          el('p.eyebrow', { text: 'Setup' }),
          el('h1', { text: draft.meet.id ? 'Edit meet' : 'New sports day' })
        ]),
        statusPill()
      ]),
      sectionMeet(),
      sectionHouses(),
      sectionAgeGroups(),
      sectionEvents(),
      sectionPins(),
      sectionActions()
    ]);
    container.appendChild(wrap);
  }

  function statusPill() {
    const s = draft.meet.status || 'setup';
    const map = { setup: ['coral', 'Not live yet'], live: ['', 'LIVE'], finished: ['', 'Finished'] };
    const m = map[s] || map.setup;
    return el('span.chip' + (m[0] ? '.' + m[0] : ''), { text: m[1], style: s === 'live' ? { background: 'var(--ok)', color: '#fff' } : {} });
  }

  /* ---- Meet ---- */
  function sectionMeet() {
    return card('1 · Meet', [
      field('Meet name', el('input.input', { value: draft.meet.name || '', oninput: function (e) { draft.meet.name = e.target.value; } })),
      field('Date', el('input.input', { type: 'date', value: draft.meet.event_date || '', oninput: function (e) { draft.meet.event_date = e.target.value || null; } })),
      el('div.field', null, [
        el('label', { text: 'Points per place' }),
        schemeEditor(),
        el('p.help', { text: 'Points awarded for 1st, 2nd, 3rd… Add as many places as you score. (Confirm Mowden’s actual scheme — 5/3/1 is an assumption.)' })
      ]),
      el('div.field', null, [
        el('label', { text: 'Ties' }),
        el('div.row.wrap-x', null, [
          radio('tie', 'split', draft.meet.tie_policy === 'split', 'Split (share the contested places’ points)', function () { draft.meet.tie_policy = 'split'; }),
          radio('tie', 'shared', draft.meet.tie_policy === 'shared', 'Shared (each gets full points, next place skips)', function () { draft.meet.tie_policy = 'shared'; })
        ])
      ]),
      el('div.field', null, [
        el('label.row', { style: { gap: '10px', cursor: 'pointer' } }, [
          checkbox(draft.meet.track_individual, function (v) { draft.meet.track_individual = v; }),
          el('span', { text: 'Track individual champions (Victor / Victrix Ludorum)' })
        ]),
        el('p.help', { text: 'Lets recorders optionally add a pupil name per place; champions are tallied per age group.' })
      ])
    ]);
  }

  function schemeEditor() {
    const grid = el('div.scheme-grid');
    function redraw() {
      clear(grid);
      const positions = Object.keys(draft.meet.points_scheme).map(Number).sort(function (a, b) { return a - b; });
      positions.forEach(function (p) {
        grid.appendChild(el('div.scheme-cell', null, [
          el('span.scheme-pos', { text: ordinal(p) }),
          el('input.input.scheme-input', {
            type: 'number', min: '0', value: draft.meet.points_scheme[String(p)],
            oninput: function (e) { draft.meet.points_scheme[String(p)] = Number(e.target.value) || 0; }
          })
        ]));
      });
      grid.appendChild(el('div.scheme-cell', null, [
        el('button.btn.btn-ghost.btn-sm', { text: '+ place', onclick: function () {
          const next = (Object.keys(draft.meet.points_scheme).map(Number).reduce(function (a, b) { return Math.max(a, b); }, 0)) + 1;
          draft.meet.points_scheme[String(next)] = 0; redraw();
        } }),
        positions.length > 1 ? el('button.btn.btn-ghost.btn-sm', { text: '− remove', onclick: function () {
          const last = positions[positions.length - 1]; delete draft.meet.points_scheme[String(last)]; redraw();
        } }) : null
      ]));
    }
    redraw();
    return grid;
  }

  /* ---- Houses ---- */
  function sectionHouses() {
    const list = el('div.stack-sm');
    function redraw() {
      clear(list);
      draft.houses.forEach(function (h, i) {
        list.appendChild(el('div.row.editable-row', null, [
          el('input', { type: 'color', value: h.colour || '#888888', class: 'colour-input', oninput: function (e) { h.colour = e.target.value; } }),
          el('input.input', { value: h.name || '', placeholder: 'House name', oninput: function (e) { h.name = e.target.value; } }),
          moveButtons(draft.houses, i, redraw),
          el('button.btn.btn-ghost.btn-icon', { text: '✕', title: 'Remove', onclick: function () { draft.houses.splice(i, 1); redraw(); } })
        ]));
      });
      list.appendChild(el('button.btn.btn-ghost', { text: '+ Add house', onclick: function () { draft.houses.push({ name: '', colour: '#888888', sort: draft.houses.length }); redraw(); } }));
    }
    redraw();
    return card('2 · Houses', [list]);
  }

  /* ---- Age groups ---- */
  function sectionAgeGroups() {
    const list = el('div.stack-sm');
    function redraw() {
      clear(list);
      draft.ageGroups.forEach(function (a, i) {
        list.appendChild(el('div.row.editable-row', null, [
          el('input.input', { value: a.label || '', placeholder: 'e.g. Years 3 & 4', oninput: function (e) { a.label = e.target.value; } }),
          moveButtons(draft.ageGroups, i, redraw),
          el('button.btn.btn-ghost.btn-icon', { text: '✕', title: 'Remove', onclick: function () { removeAgeGroup(i); redraw(); } })
        ]));
      });
      list.appendChild(el('button.btn.btn-ghost', { text: '+ Add age group', onclick: function () { draft.ageGroups.push({ _tmp: 'ag' + Date.now(), label: '', sort: draft.ageGroups.length }); redraw(); } }));
    }
    redraw();
    return card('3 · Age groups / bands', [el('p.help', { text: 'Optional. Group events by year band so the board can show per-band winners.' }), list]);
  }
  function removeAgeGroup(i) {
    const ag = draft.ageGroups[i];
    const key = ag.id || ag._tmp;
    draft.events.forEach(function (ev) { if ((ev.age_group_id || ev._agRef) === key) { ev.age_group_id = null; ev._agRef = null; } });
    draft.ageGroups.splice(i, 1);
  }

  /* ---- Events ---- */
  function sectionEvents() {
    const list = el('div.stack-sm');
    function agOptions(ev) {
      const sel = el('select.select');
      sel.appendChild(el('option', { value: '', text: '— any —' }));
      draft.ageGroups.forEach(function (a) {
        const key = a.id || a._tmp;
        const o = el('option', { value: key, text: a.label || '(unnamed)' });
        if ((ev.age_group_id || ev._agRef) === key) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function (e) {
        const v = e.target.value;
        const ag = draft.ageGroups.filter(function (a) { return (a.id || a._tmp) === v; })[0];
        if (!ag) { ev.age_group_id = null; ev._agRef = null; }
        else if (ag.id) { ev.age_group_id = ag.id; ev._agRef = null; }
        else { ev.age_group_id = null; ev._agRef = ag._tmp; }
      });
      return sel;
    }
    function redraw() {
      clear(list);
      if (!draft.events.length) list.appendChild(el('p.help', { text: 'No events yet. Add your track and field events.' }));
      draft.events.forEach(function (ev, i) {
        const sel = el('select.select.sel-sm');
        DISCIPLINES.forEach(function (d) { const o = el('option', { value: d, text: d }); if (ev.discipline === d) o.selected = true; sel.appendChild(o); });
        sel.addEventListener('change', function (e) { ev.discipline = e.target.value; ev.is_relay = e.target.value === 'relay'; });
        const cat = el('select.select.sel-sm');
        CATEGORIES.forEach(function (c) { const o = el('option', { value: c, text: c }); if (ev.category === c) o.selected = true; cat.appendChild(o); });
        cat.addEventListener('change', function (e) { ev.category = e.target.value; });
        list.appendChild(el('div.event-row', null, [
          el('input.input', { value: ev.name || '', placeholder: 'Event name', oninput: function (e) { ev.name = e.target.value; } }),
          agOptions(ev), sel, cat,
          el('div.row', null, [
            el('button.btn.btn-ghost.btn-icon', { text: '⧉', title: 'Duplicate', onclick: function () { const c = Object.assign({}, ev); delete c.id; c.sort = draft.events.length; draft.events.splice(i + 1, 0, c); redraw(); } }),
            el('button.btn.btn-ghost.btn-icon', { text: '✕', title: 'Remove', onclick: function () { draft.events.splice(i, 1); redraw(); } })
          ])
        ]));
      });
      list.appendChild(el('div.row', null, [
        el('button.btn.btn-ghost', { text: '+ Add event', onclick: function () { draft.events.push({ name: '', discipline: 'track', category: 'mixed', is_relay: false, age_group_id: null, sort: draft.events.length, status: 'pending' }); redraw(); } }),
        D.sampleEvents ? el('button.btn.btn-ghost', { text: 'Add sample set', onclick: function () { addSampleEvents(); redraw(); } }) : null
      ]));
    }
    redraw();
    return card('4 · Events', [list]);
  }
  function addSampleEvents() {
    const ags = draft.ageGroups.length ? draft.ageGroups : [{ _tmp: null }];
    ags.forEach(function (ag) {
      D.sampleEvents.forEach(function (name) {
        draft.events.push({ name: name, discipline: name === 'Relay' ? 'relay' : (/jump|throw|howler/i.test(name) ? 'field' : 'track'), is_relay: name === 'Relay', category: 'mixed', age_group_id: ag.id || null, _agRef: ag.id ? null : ag._tmp, sort: draft.events.length, status: 'pending' });
      });
    });
  }

  /* ---- PINs ---- */
  function sectionPins() {
    return card('5 · Access PINs', [
      el('p.help', { text: 'Light gate (not a password). The recorder PIN unlocks the Record screen; the admin PIN unlocks Setup + Admin. Leave blank for no gate.' }),
      el('div.row.wrap-x', null, [
        field('Recorder PIN', el('input.input', { value: draft.meet.recorder_pin || '', placeholder: 'e.g. 2026', oninput: function (e) { draft.meet.recorder_pin = e.target.value; } })),
        field('Admin PIN', el('input.input', { value: draft.meet.admin_pin || '', placeholder: 'e.g. headof', oninput: function (e) { draft.meet.admin_pin = e.target.value; } }))
      ])
    ]);
  }

  /* ---- Actions ---- */
  function sectionActions() {
    const liveBtn = draft.meet.status === 'live'
      ? el('button.btn', { text: 'Set finished (lock scores)', onclick: function () { setStatus('finished'); } })
      : el('button.btn.btn-primary.btn-lg', { text: draft.meet.status === 'finished' ? 'Re-open meet' : '▶ Go live', onclick: function () { setStatus('live'); } });
    return el('div.card.actions', null, [
      el('div.row.wrap-x', null, [
        el('button.btn.btn-primary', { text: 'Save', onclick: save }),
        liveBtn,
        draft.meet.id ? el('button.btn.btn-ghost', { text: 'Copy recorder link', onclick: copyRecorderLink }) : null,
        draft.meet.id ? el('button.btn.btn-ghost', { text: 'Print event sheet', onclick: printEventSheet }) : null
      ]),
      el('p.help', { id: 'setup-hint', text: draft.meet.id ? '' : 'Save first to create the meet, then go live and share the recorder link.' })
    ]);
  }

  /* ---------- persistence ---------- */
  async function save() {
    if (!draft.meet.name) { toast('Give the meet a name', 'error'); return; }
    if (!window.SD.net.online) { toast('You’re offline — connect to save setup', 'error'); return; }
    try {
      toast('Saving…');
      // 1. meet (insert or update)
      const meetPayload = {
        name: draft.meet.name, event_date: draft.meet.event_date, status: draft.meet.status,
        points_scheme: draft.meet.points_scheme, tie_policy: draft.meet.tie_policy,
        track_individual: !!draft.meet.track_individual,
        recorder_pin: draft.meet.recorder_pin || null, admin_pin: draft.meet.admin_pin || null
      };
      if (draft.meet.id) {
        await api.update('sportsday_meets', meetPayload, { id: 'eq.' + draft.meet.id });
      } else {
        const rows = await api.insert('sportsday_meets', meetPayload);
        draft.meet.id = rows[0].id;
        store.setMeetId(draft.meet.id);
      }
      const meetId = draft.meet.id;

      await syncCollection('sportsday_houses', meetId, draft.houses, ['name', 'colour', 'sort']);
      await syncCollection('sportsday_age_groups', meetId, draft.ageGroups, ['label', 'sort']);
      // map any temp age-group refs on events to real ids now that age groups are saved
      const tmpToId = {};
      draft.ageGroups.forEach(function (a) { if (a._tmp && a.id) tmpToId[a._tmp] = a.id; });
      draft.events.forEach(function (ev) { if (ev._agRef && tmpToId[ev._agRef]) { ev.age_group_id = tmpToId[ev._agRef]; ev._agRef = null; } });
      await syncCollection('sportsday_events', meetId, draft.events, ['name', 'discipline', 'age_group_id', 'category', 'is_relay', 'sort', 'status']);

      toast('Saved ✓');
      render();
    } catch (err) {
      toast('Save failed: ' + (err.message || err), 'error');
    }
  }

  // Insert new (no id), update existing (id), delete removed. Backfills new ids onto draft items.
  async function syncCollection(table, meetId, items, fields) {
    const existing = await api.select(table, { meet_id: 'eq.' + meetId, select: 'id' });
    const existingIds = (existing || []).map(function (r) { return r.id; });
    const keptIds = items.filter(function (it) { return it.id; }).map(function (it) { return it.id; });
    const toDelete = existingIds.filter(function (id) { return keptIds.indexOf(id) === -1; });

    // deletes
    for (let i = 0; i < toDelete.length; i++) {
      await api.del(table, { id: 'eq.' + toDelete[i] });
    }
    // updates + inserts (preserve order via sort)
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; it.sort = i;
      const payload = { meet_id: meetId };
      fields.forEach(function (f) { payload[f] = it[f] != null ? it[f] : (f === 'sort' ? i : null); });
      if (it.id) {
        await api.update(table, payload, { id: 'eq.' + it.id });
      } else {
        const rows = await api.insert(table, payload);
        it.id = rows[0].id;
      }
    }
  }

  async function setStatus(status) {
    if (!draft.meet.id) { await save(); if (!draft.meet.id) return; }
    if (status === 'finished') {
      const ok = await confirmDialog({ title: 'Lock the scores?', body: 'Recording will be closed and the results finalised. You can re-open later.', ok: 'Lock', danger: true });
      if (!ok) return;
    }
    try {
      await api.update('sportsday_meets', { status: status }, { id: 'eq.' + draft.meet.id });
      draft.meet.status = status;
      toast(status === 'live' ? 'Meet is LIVE ✓' : (status === 'finished' ? 'Scores locked' : 'Re-opened'));
      render();
      if (status === 'live') copyRecorderLink();
    } catch (err) { toast('Could not update status: ' + (err.message || err), 'error'); }
  }

  function recorderLink() {
    const base = location.href.split('#')[0];
    const code = draft.meet.recorder_pin ? ('?code=' + encodeURIComponent(draft.meet.recorder_pin)) : '';
    return base + '#/record' + code + (code ? '&' : '?') + 'meet=' + draft.meet.id;
  }
  function copyRecorderLink() {
    const link = recorderLink();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () { toast('Recorder link copied ✓'); }, function () { showLink(link); });
    } else { showLink(link); }
  }
  function showLink(link) {
    confirmDialog({ title: 'Recorder link', body: link, ok: 'Done', cancel: 'Close' });
  }

  function printEventSheet() {
    if (window.SD.exporter) window.SD.exporter.printEventSheet(draft);
  }

  /* ---------- small builders ---------- */
  function card(title, children) {
    return el('div.card.section', null, [el('h3.section-title', { text: title })].concat(children));
  }
  function field(label, control) {
    return el('label.field', null, [el('span.field-label', { text: label }), control]);
  }
  function radio(name, val, checked, label, onpick) {
    const input = el('input', { type: 'radio', name: name, value: val });
    if (checked) input.checked = true;
    input.addEventListener('change', function () { if (input.checked) onpick(); });
    return el('label.radio', null, [input, el('span', { text: label })]);
  }
  function checkbox(checked, onchange) {
    const c = el('input', { type: 'checkbox' });
    if (checked) c.checked = true;
    c.addEventListener('change', function () { onchange(c.checked); });
    return c;
  }
  function moveButtons(arr, i, redraw) {
    return el('div.move-btns', null, [
      el('button.btn.btn-ghost.btn-icon', { text: '↑', title: 'Up', onclick: function () { if (i > 0) { const t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t; redraw(); } } }),
      el('button.btn.btn-ghost.btn-icon', { text: '↓', title: 'Down', onclick: function () { if (i < arr.length - 1) { const t = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = t; redraw(); } } })
    ]);
  }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  window.SD = window.SD || {};
  window.SD.setup = { mount: mount, unmount: unmount };
})();
