/* Sports Day — Lobby / meet picker
 *
 * The landing when no meet is chosen: lists meets with the LIVE ones up top,
 * click one to enter its board. Also reachable any time via the top-bar
 * "switch meet" chip, so you can hop between running sports days.
 */
(function () {
  'use strict';

  const { el, clear } = window.SD.ui;
  const store = window.SD.store;
  let container = null;

  async function mount(node) {
    container = node;
    render(null);
    let meets = null;
    try { meets = (await store.listMeets()) || []; }
    catch (e) { meets = store.meetId() ? null : []; }
    render(meets);
  }
  function unmount() { container = null; }

  function statusRank(s) { return s === 'live' ? 0 : s === 'setup' ? 1 : 2; }

  function render(meets) {
    if (!container) return;
    clear(container);
    const wrap = el('div.wrap.lobby', null, [
      el('div.lobby-head', null, [
        el('span.brand-big', null, [el('span.mark', { text: '🏅' }), el('span', { html: 'Sports <span class="gold-accent">Day</span>' })]),
        el('h1', { text: 'Choose a meet' })
      ])
    ]);

    if (meets === null) {
      wrap.appendChild(el('div.empty', null, [el('p.muted', { text: 'Loading meets…' })]));
      container.appendChild(wrap); return;
    }
    if (!meets.length) {
      wrap.appendChild(el('div.empty', null, [
        el('h2', { text: 'No sports days yet' }),
        el('p.muted', { text: 'Set one up to get started.' }),
        el('a.btn.btn-primary', { href: '#/setup', text: 'Create a sports day' })
      ]));
      container.appendChild(wrap); return;
    }

    const sorted = meets.slice().sort(function (a, b) {
      return statusRank(a.status) - statusRank(b.status) || (a.name || '').localeCompare(b.name || '');
    });
    const live = sorted.filter(function (m) { return m.status === 'live'; });
    const others = sorted.filter(function (m) { return m.status !== 'live'; });

    if (live.length) {
      wrap.appendChild(el('h3.lobby-sec', null, [el('span.dot.pulse'), el('span', { text: 'Live now' })]));
      const g = el('div.meet-grid'); live.forEach(function (m) { g.appendChild(meetCard(m)); }); wrap.appendChild(g);
    }
    if (others.length) {
      wrap.appendChild(el('h3.lobby-sec', { text: live.length ? 'Other meets' : 'Meets' }));
      const g = el('div.meet-grid'); others.forEach(function (m) { g.appendChild(meetCard(m)); }); wrap.appendChild(g);
    }
    wrap.appendChild(el('a.btn.btn-ghost', { href: '#/setup', text: '+ New sports day', style: { marginTop: 'var(--s5)' } }));
    container.appendChild(wrap);
  }

  function enter(m) { store.setMeetId(m.id); location.hash = '#/'; }

  function meetCard(m) {
    const isLive = m.status === 'live';
    const badge = isLive
      ? el('span.meet-badge', null, [el('span.dot.pulse'), el('span', { text: 'LIVE' })])
      : el('span.chip', { text: m.status === 'finished' ? 'Finished' : 'Setup' });
    return el('button.meet-card' + (isLive ? '.is-live' : ''), { onclick: function () { enter(m); } }, [
      el('div.row.between', null, [el('h3', { text: m.name }), badge]),
      el('p.muted', { text: m.event_date || ' ' })
    ]);
  }

  window.SD = window.SD || {};
  window.SD.lobby = { mount: mount, unmount: unmount };
})();
