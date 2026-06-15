/* Sports Day — Spectator board (public, read-only, big-screen)
 *
 * Dark "stadium" theme for projection. House bars sized to live totals, leader crowned,
 * auto-rotating between Overall and each age group, confetti on a lead change, and a
 * graceful "reconnecting" badge so the board never blanks. Loads no write code.
 */
(function () {
  'use strict';

  const { el, $, clear, esc, fmtNum, fmtTime } = window.SD.ui;
  const store = window.SD.store;
  const live = window.SD.live;

  let container = null, meetId = null, data = null;
  let views = [];          // ['overall', ageGroupId, ...]
  let viewIdx = 0, rotTimer = null, onData = null;
  let lastLeader = null;

  async function mount(node) {
    container = node;
    meetId = store.meetId();
    document.body.setAttribute('data-theme', 'stadium');
    if (!meetId) { renderNoMeet(); return; }
    onData = function (e) { data = e.detail; rebuildViews(); render(); };
    document.addEventListener('sd:data-changed', onData);
    const res = await store.loadScored(meetId);
    data = { bundle: res.bundle, scores: res.scores, stale: res.bundle && res.bundle.stale };
    rebuildViews();
    render();
    live.watch(meetId, { intervalMs: 5000 });
    rotTimer = setInterval(rotate, 12000);
  }
  function unmount() {
    document.body.removeAttribute('data-theme');
    if (onData) document.removeEventListener('sd:data-changed', onData);
    if (rotTimer) clearInterval(rotTimer);
    live.stop();
    container = null; data = null; views = [];
  }

  function renderNoMeet() {
    clear(container);
    container.appendChild(el('div.wrap', null, [el('div.empty', null, [
      el('div.numeral', { text: '🏅', style: { fontSize: '3rem' } }),
      el('h2', { text: 'Sports Day' }),
      el('p.muted', { text: 'No meet is live yet.' }),
      el('a.btn.btn-ghost', { href: '#/setup', text: 'Set one up' })
    ])]));
  }

  function rebuildViews() {
    const s = data && data.scores;
    views = ['overall'];
    if (s && s.ageStandings) {
      s.ageStandings.forEach(function (ag) {
        const any = ag.rows.some(function (r) { return r.total > 0; });
        if (any) views.push(ag.ageGroupId);
      });
    }
    if (viewIdx >= views.length) viewIdx = 0;
  }
  function rotate() { if (views.length <= 1) return; viewIdx = (viewIdx + 1) % views.length; render(); }

  function currentRows() {
    const s = data.scores;
    if (!s) return { title: 'Overall', rows: [] };
    const v = views[viewIdx] || 'overall';
    if (v === 'overall') return { title: 'Overall', rows: s.standings.map(function (x) { return { name: x.name, colour: x.colour, total: x.total, rank: x.rank, pct: x.pct }; }) };
    const ag = s.ageStandings.filter(function (a) { return a.ageGroupId === v; })[0];
    if (!ag) return { title: 'Overall', rows: [] };
    const max = ag.rows.length ? ag.rows[0].total : 0;
    let rank = 0, prev = null;
    const rows = ag.rows.map(function (r, i) {
      if (prev === null || r.total !== prev) { rank = i + 1; prev = r.total; }
      return { name: r.name, colour: r.colour, total: r.total, rank: rank, pct: max > 0 ? Math.round((r.total / max) * 100) : 0 };
    });
    return { title: ag.label, rows: rows };
  }

  function render() {
    if (!container) return;
    const b = data && data.bundle, s = data && data.scores;
    clear(container);
    if (!b || !b.meet) { renderNoMeet(); return; }
    const hidden = b.meet.reveal_overall === false;   // Admin has blacked out the standings
    const view = currentRows();

    // confetti when the overall leader changes (only while standings are visible)
    if (!hidden && views[viewIdx] === 'overall' && s && s.winners.length === 1 && s.standings[0].total > 0) {
      const leader = s.winners[0].houseId;
      if (lastLeader && lastLeader !== leader && window.confetti) {
        try { confetti({ particleCount: 140, spread: 100, origin: { y: 0.4 }, disableForReducedMotion: true }); } catch (e) {}
      }
      lastLeader = leader;
    }

    const wrap = el('div.wrap.spectator', null, [
      el('div.spec-head', null, [
        el('div', null, [
          el('p.eyebrow', { text: b.meet.name }),
          el('h1.spec-title', { text: hidden ? 'The Grand Finale' : (view.title === 'Overall' ? 'House Standings' : view.title) })
        ]),
        hidden ? el('span') : viewDots()
      ]),
      hidden ? hiddenBoard(b) : board(view.rows),
      footer(b)
    ]);
    container.appendChild(wrap);
  }

  function board(rows) {
    if (!rows.length || rows.every(function (r) { return r.total === 0; })) {
      return el('div.empty', null, [el('h2', { text: 'No points yet' }), el('p.muted', { text: 'Results will appear here as events finish.' })]);
    }
    const board = el('div.board.spec-board');
    rows.forEach(function (r) {
      board.appendChild(el('div.house-row' + (r.rank === 1 ? '.leader' : ''), { 'data-rank': r.rank, style: { '--house': r.colour, '--pct': r.pct + '%' } }, [
        el('div.rank', { text: r.rank === 1 ? '👑' : r.rank }),
        el('div.house-meta', null, [
          el('div.house-name', { text: r.name }),
          el('div.house-bar')
        ]),
        el('div.house-score.numeral', { text: fmtNum(r.total) })
      ]));
    });
    return board;
  }

  // Admin has hidden the standings for jeopardy before the finale.
  function hiddenBoard(b) {
    const chips = el('div.hb-houses');
    (b.houses || []).forEach(function (h) {
      chips.appendChild(el('div.hb-house', { style: { '--house': h.colour } }, [
        el('span.hb-swatch', { style: { background: h.colour } }),
        el('span', { text: h.name })
      ]));
    });
    return el('div.hidden-board', null, [
      el('div.hb-emoji', { text: '🤫' }),
      el('h2.hb-title', { text: 'Standings under wraps' }),
      el('p.hb-sub', { text: 'Big points still up for grabs — the final results decide it. Stand by for the reveal…' }),
      chips
    ]);
  }

  function viewDots() {
    if (views.length <= 1) return el('span');
    const dots = el('div.view-dots');
    views.forEach(function (v, i) { dots.appendChild(el('span.vdot' + (i === viewIdx ? '.on' : ''), { onclick: function () { viewIdx = i; render(); } })); });
    return dots;
  }

  function footer(b) {
    const stale = data && data.stale;
    return el('div.spec-foot', null, [
      stale
        ? el('span.banner.offline', null, [el('span.dot'), el('span', { text: 'Reconnecting · last updated ' + fmtTime((data.bundle.fetchedAt && new Date(data.bundle.fetchedAt).toISOString()) || '') })])
        : el('span.banner.live', null, [el('span.dot.pulse'), el('span', { text: b.meet.status === 'finished' ? 'FINAL RESULTS' : 'LIVE' })]),
      el('button.btn.btn-ghost.no-print', { text: '🖨 Print final', onclick: function () { window.print(); } })
    ]);
  }

  window.SD = window.SD || {};
  window.SD.spectator = { mount: mount, unmount: unmount };
})();
