/* Sports Day — Admin control-room (the organiser's source of truth)
 *
 * Everything visible, nothing a black box: house totals with their full build-up,
 * declared winners + individual champions, a calculation-transparency panel, the
 * per-event results table with void / re-record corrections that recompute live,
 * and low-ink print + CSV export.
 */
(function () {
  'use strict';

  const { el, $, clear, esc, toast, confirmDialog, fmtNum, fmtTime } = window.SD.ui;
  const api = window.SD.api;
  const store = window.SD.store;
  const live = window.SD.live;

  let container = null, meetId = null, ctxData = null;
  const expanded = {};   // houseId -> bool
  let onData = null;

  async function mount(node) {
    container = node;
    meetId = store.meetId();
    if (!meetId) { renderNoMeet(); return; }
    onData = function (e) { ctxData = e.detail; render(); };
    document.addEventListener('sd:data-changed', onData);
    // initial paint from cache/fetch
    const res = await store.loadScored(meetId);
    ctxData = { bundle: res.bundle, scores: res.scores, stale: res.bundle && res.bundle.stale };
    render();
    live.watch(meetId, { intervalMs: 5000 });
  }
  function unmount() {
    if (onData) document.removeEventListener('sd:data-changed', onData);
    live.stop();
    container = null; ctxData = null;
  }

  function renderNoMeet() {
    clear(container);
    container.appendChild(el('div.wrap', null, [el('div.empty', null, [
      el('h2', { text: 'No meet selected' }),
      el('a.btn.btn-primary', { href: '#/setup', text: 'Go to Setup' })
    ])]));
  }

  function render() {
    if (!container) return;
    const b = ctxData && ctxData.bundle, s = ctxData && ctxData.scores;
    clear(container);
    if (!b || !b.meet) { renderNoMeet(); return; }
    const wrap = el('div.wrap.admin', null, [
      header(b, s),
      revealControl(b),
      tbcBanner(s),
      winnerBanner(s),
      standingsCard(b, s),
      winnersCard(b, s),
      transparencyCard(b, s),
      eventsCard(b, s)
    ]);
    container.appendChild(wrap);
  }

  function header(b, s) {
    const done = s ? s.progress.recordedEvents : 0, total = s ? s.progress.totalEvents : 0;
    return el('div.row.between.admin-head', null, [
      el('div', null, [
        el('p.eyebrow', { text: 'Admin' }),
        el('h1', { text: b.meet.name }),
        el('p.muted', { text: statusText(b.meet.status) + ' · ' + done + '/' + total + ' events recorded' + (ctxData.stale ? ' · reconnecting…' : '') })
      ]),
      el('div.row', null, [
        el('button.btn.btn-ghost', { text: '🖨 Print', onclick: function () { window.print(); } }),
        el('button.btn.btn-ghost', { text: '⬇ CSV', onclick: function () { window.SD.exporter.downloadCSV(b, s); } })
      ])
    ]);
  }
  function statusText(st) { return st === 'live' ? 'LIVE' : st === 'finished' ? 'Finished (locked)' : 'Setup'; }

  // Live big-screen visibility toggle — hide the overall standings for finale jeopardy.
  function revealControl(b) {
    const shown = b.meet.reveal_overall !== false;
    return el('div.reveal-control' + (shown ? '' : '.is-hidden'), null, [
      el('div.rc-text', null, [
        el('strong', { text: shown ? '📺 Big screen: standings SHOWING' : '🙈 Big screen: standings HIDDEN' }),
        el('p.muted', { text: shown
          ? 'The crowd sees live house totals. Hide them before the final relays for a dramatic reveal.'
          : 'The crowd sees a “grand finale” screen — totals blacked out for jeopardy. You still see everything below.' })
      ]),
      el('button.btn.' + (shown ? 'btn-danger' : 'btn-primary'), {
        text: shown ? 'Hide for finale' : 'Reveal standings', onclick: function () { toggleReveal(!shown); }
      })
    ]);
  }
  async function toggleReveal(reveal) {
    try {
      await api.update('sportsday_meets', { reveal_overall: reveal }, { id: 'eq.' + meetId });
      if (ctxData && ctxData.bundle && ctxData.bundle.meet) ctxData.bundle.meet.reveal_overall = reveal; // optimistic
      render();
      toast(reveal ? 'Standings revealed on the big screen' : 'Standings hidden on the big screen');
      live.refresh();
    } catch (e) { toast('Could not update: ' + (e.message || e), 'error'); }
  }

  function tbcBanner(s) {
    const n = s ? s.events.reduce(function (a, e) { return a + (e.tbcCount || 0); }, 0) : 0;
    if (!n) return el('span', { hidden: 'hidden' });
    return el('div.banner.offline', { style: { marginTop: '12px' } }, [
      el('span', { text: '🏷️ ' + n + ' entrant' + (n === 1 ? '' : 's') + ' still set to TBC — assign a house (on the Record screen) so their points count toward a House.' })
    ]);
  }

  function winnerBanner(s) {
    if (!s || !s.winners.length || s.standings[0].total === 0) return el('div', { hidden: 'hidden' });
    const w = s.winners;
    const txt = w.length === 1 ? w[0].name + ' leading' : ('Tie: ' + w.map(function (x) { return x.name; }).join(' & '));
    return el('div.winner-banner', null, [
      el('span.wb-cup', { text: '🏆' }),
      el('span.wb-text', { html: '<strong>' + esc(txt) + '</strong> · ' + fmtNum(w[0].total) + ' pts' })
    ]);
  }

  /* ---- standings with build-up ---- */
  function standingsCard(b, s) {
    const body = el('div.stack-sm');
    if (!s || !s.standings.length) { body.appendChild(empty('No houses configured.')); return section('House standings', body); }
    const ageById = {}; b.ageGroups.forEach(function (a) { ageById[a.id] = a; });
    const eventById = {}; b.events.forEach(function (e) { eventById[e.id] = e; });
    s.standings.forEach(function (st) {
      const open = !!expanded[st.houseId];
      const row = el('div.admin-house', { 'data-rank': st.rank }, [
        el('button.ah-head', { onclick: function () { expanded[st.houseId] = !open; render(); } }, [
          el('span.ah-rank', { text: st.rank }),
          el('span.swatch', { style: { background: st.colour } }),
          el('span.ah-name', { text: st.name }),
          el('span.ah-total.numeral', { text: fmtNum(st.total) }),
          el('span.ah-caret', { text: open ? '▾' : '▸' })
        ])
      ]);
      if (open) {
        const detail = el('div.ah-detail');
        // by event
        const evRows = Object.keys(st.byEvent).map(function (eid) {
          const ev = eventById[eid] || {};
          return { name: (ev.name || '?') + (ev.age_group_id && ageById[ev.age_group_id] ? ' (' + ageById[ev.age_group_id].label + ')' : ''), pts: st.byEvent[eid] };
        }).filter(function (r) { return r.pts; }).sort(function (a, b) { return b.pts - a.pts; });
        detail.appendChild(el('p.detail-h', { text: 'Points by event' }));
        if (!evRows.length) detail.appendChild(el('p.muted', { text: 'No points yet.' }));
        evRows.forEach(function (r) { detail.appendChild(el('div.detail-row', null, [el('span', { text: r.name }), el('span.numeral', { text: fmtNum(r.pts) })])); });
        // by age group
        const agKeys = Object.keys(st.byAge).filter(function (k) { return st.byAge[k]; });
        if (agKeys.length > 1 || (agKeys.length === 1 && agKeys[0] !== '_none')) {
          detail.appendChild(el('p.detail-h', { text: 'Points by age group' }));
          agKeys.forEach(function (k) {
            const lbl = k === '_none' ? 'Unbanded' : ((ageById[k] || {}).label || k);
            detail.appendChild(el('div.detail-row', null, [el('span', { text: lbl }), el('span.numeral', { text: fmtNum(st.byAge[k]) })]));
          });
        }
        row.appendChild(detail);
      }
      body.appendChild(row);
    });
    return section('House standings — with the maths', body);
  }

  /* ---- winners + champions ---- */
  function winnersCard(b, s) {
    if (!s) return el('div', { hidden: 'hidden' });
    const body = el('div.stack-sm');
    // overall
    const ov = s.winners.length && s.standings[0].total > 0
      ? (s.winners.length === 1 ? s.winners[0].name : s.winners.map(function (w) { return w.name; }).join(' & ') + ' (tie)')
      : '—';
    body.appendChild(declared('Overall winning House', ov, s.winners[0] && s.standings[0].total > 0 ? fmtNum(s.standings[0].total) + ' pts' : ''));
    // per age group
    s.ageStandings.forEach(function (ag) {
      if (!ag.winners.length) { body.appendChild(declared(ag.label, '—', '')); return; }
      const names = ag.winners.map(function (w) { return w.name; }).join(' & ') + (ag.winners.length > 1 ? ' (tie)' : '');
      body.appendChild(declared(ag.label + ' winner', names, fmtNum(ag.winners[0].total) + ' pts'));
    });
    // champions
    if (s.trackIndividual && s.champions.length) {
      body.appendChild(el('p.detail-h', { text: 'Individual champions (Victor / Victrix Ludorum)' }));
      s.champions.forEach(function (c) {
        if (!c.leaders.length) return;
        const names = c.leaders.map(function (l) { return l.athlete + ' (' + (l.houseName || '?') + ')'; }).join(' & ');
        body.appendChild(declared(c.label, names, fmtNum(c.leaders[0].points) + ' pts'));
      });
    }
    return section('Winners', body);
  }
  function declared(label, value, sub) {
    return el('div.declared', null, [
      el('span.dec-label', { text: label }),
      el('span.dec-value', null, [el('strong', { text: value }), sub ? el('span.muted', { text: '  ' + sub }) : null])
    ]);
  }

  /* ---- transparency ---- */
  function transparencyCard(b, s) {
    const scheme = b.meet.points_scheme || {};
    const positions = Object.keys(scheme).map(Number).sort(function (a, c) { return a - c; });
    const schemeStr = positions.map(function (p) { return ordinal(p) + ' = ' + scheme[String(p)]; }).join(' · ');
    const tie = b.meet.tie_policy === 'shared'
      ? 'Shared — tied places each get the full points for the higher place; the next place is skipped.'
      : 'Split — tied places share the sum of the places they occupy, divided equally (athletics standard).';
    const voids = (b.results || []).filter(function (r) { return r.voided; });
    const overrides = (s ? s.events : []).filter(function (e) { return e.customScheme; });
    const ovText = overrides.length
      ? overrides.length + ' event' + (overrides.length === 1 ? '' : 's') + ' (e.g. relays score ' + schemeToStr(overrides[0].customScheme) + ')'
      : 'none — all events use the default scheme';
    const body = el('div.stack-sm', null, [
      el('div.detail-row', null, [el('span', { text: 'Default points scheme' }), el('span', { text: schemeStr || '—' })]),
      el('div.detail-row', null, [el('span', { text: 'Per-event overrides' }), el('span', { text: ovText })]),
      el('div.detail-row', null, [el('span', { text: 'Beyond the scheme' }), el('span', { text: 'scores 0 points' })]),
      el('div.detail-row', null, [el('span', { text: 'Tie policy' }), el('span', { text: tie })]),
      el('div.detail-row', null, [el('span', { text: 'Voided (excluded) entries' }), el('span.numeral', { text: String(voids.length) })])
    ]);
    return section('How the numbers are calculated', body);
  }

  /* ---- per-event table + corrections ---- */
  function eventsCard(b, s) {
    const body = el('div.stack-sm');
    if (!s || !s.events.length) { body.appendChild(empty('No events.')); return section('Events & results', body); }
    s.events.forEach(function (ev) {
      const isField = ev.entryMode === 'marks';
      const head = el('div.row.between.ev-head', null, [
        el('div', null, [
          el('strong', { text: ev.name }),
          el('span.muted', { text: '  ' + [ev.ageGroup, ev.category !== 'mixed' ? ev.category : '', ev.isRelay ? 'relay' : '', isField ? 'measured' : ''].filter(Boolean).join(' · ') }),
          ev.customScheme ? el('span.chip.coral', { text: ' ' + schemeToStr(ev.customScheme), title: 'Custom points scheme' }) : null,
          ev.tbcCount ? el('span.chip.tbc-chip', { text: ev.tbcCount + ' TBC' }) : null
        ]),
        ev.recorded
          ? el('button.btn.btn-ghost.btn-sm', { text: 'Void all', onclick: function () { voidEvent(ev); } })
          : el('span.chip', { text: 'not recorded' })
      ]);
      const rows = el('div.ev-results');
      function placingRow(p) {
        const posTxt = p.position != null ? (medal(p.position) + ordinal(p.position)) : '—';
        return el('div.ev-result-row.has-measure', null, [
          el('span.err-pos', { text: posTxt }),
          p.houseId ? el('span.swatch', { style: { background: p.houseColour } }) : el('span.chip.tbc-chip', { text: 'TBC' }),
          el('span.err-house', { text: p.houseName || (p.athlete ? '' : '—') }),
          p.athlete ? el('span.err-athlete.muted', { text: p.athlete }) : el('span'),
          el('span.err-mark.numeral', { text: p.mark != null ? fmtNum(p.mark) : '', title: isField ? 'distance/height' : 'time' }),
          el('span.err-pts.numeral', { text: fmtNum(p.points) }),
          el('button.btn.btn-ghost.btn-icon.no-print', { text: '✕', title: 'Void this entry', onclick: function () { voidResult(p.resultId); } })
        ]);
      }
      if (ev.heated) {
        ev.heats.forEach(function (hk) {
          rows.appendChild(el('div.heat-head', { text: 'Heat ' + hk }));
          ev.placings.filter(function (p) { return p.heat === hk; }).forEach(function (p) { rows.appendChild(placingRow(p)); });
        });
      } else {
        ev.placings.forEach(function (p) { rows.appendChild(placingRow(p)); });
      }
      body.appendChild(el('div.ev-block', null, [head, ev.recorded ? rows : el('p.muted.ev-empty', { text: 'Awaiting result.' })]));
    });
    body.appendChild(el('p.help.no-print', { text: 'Field events rank by best mark automatically. To re-enter a race, void it here then record it again.' }));
    return section('Events & results', body);
  }

  async function voidResult(resultId) {
    try { await api.update('sportsday_results', { voided: true }, { id: 'eq.' + resultId }); toast('Placing voided'); live.refresh(); }
    catch (e) { toast('Could not void: ' + (e.message || e), 'error'); }
  }
  async function voidEvent(ev) {
    const ok = await confirmDialog({ title: 'Void all results for ' + ev.name + '?', body: 'They’ll be excluded from totals (not deleted). The event becomes re-recordable.', ok: 'Void all', danger: true });
    if (!ok) return;
    try {
      await api.update('sportsday_results', { voided: true }, { event_id: 'eq.' + ev.eventId, voided: 'eq.false' });
      await api.update('sportsday_events', { status: 'pending' }, { id: 'eq.' + ev.eventId });
      toast('Event voided'); live.refresh();
    } catch (e) { toast('Could not void: ' + (e.message || e), 'error'); }
  }

  /* ---- builders ---- */
  function section(title, body) { return el('div.card.section', null, [el('h3.section-title', { text: title }), body]); }
  function empty(t) { return el('p.muted', { text: t }); }
  function medal(p) { return p === 1 ? '🥇 ' : p === 2 ? '🥈 ' : p === 3 ? '🥉 ' : ''; }
  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function schemeToStr(sc) { return Object.keys(sc || {}).map(Number).sort(function (a, b) { return a - b; }).map(function (p) { return sc[String(p)]; }).join('/'); }

  window.SD = window.SD || {};
  window.SD.admin = { mount: mount, unmount: unmount };
})();
