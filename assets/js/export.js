/* Sports Day — export: CSV download + low-ink printable paper event sheet */
(function () {
  'use strict';

  const { el, esc } = window.SD.ui;

  function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function csvCell(v) {
    v = v == null ? '' : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function downloadCSV(bundle, scores) {
    const lines = [];
    lines.push(['Sports Day', bundle.meet.name].map(csvCell).join(','));
    lines.push('');
    lines.push(['HOUSE STANDINGS'].join(','));
    lines.push(['Rank', 'House', 'Total points'].map(csvCell).join(','));
    (scores ? scores.standings : []).forEach(function (s) {
      lines.push([s.rank, s.name, s.total].map(csvCell).join(','));
    });
    lines.push('');
    lines.push(['RESULTS BY EVENT'].join(','));
    lines.push(['Event', 'Age group', 'Category', 'Heat', 'Place', 'House', 'Pupil', 'Mark', 'Points'].map(csvCell).join(','));
    (scores ? scores.events : []).forEach(function (ev) {
      if (!ev.placings.length) { lines.push([ev.name, ev.ageGroup || '', ev.category || '', '', '', '(not recorded)', '', '', ''].map(csvCell).join(',')); return; }
      ev.placings.forEach(function (p) {
        const place = p.position != null ? ordinal(p.position) : '—';
        lines.push([ev.name, ev.ageGroup || '', ev.category || '', p.heat || '', place, p.houseName || 'TBC', p.athlete || '', p.mark != null ? p.mark : '', p.points].map(csvCell).join(','));
      });
    });
    if (scores && scores.trackIndividual && scores.champions.length) {
      lines.push('');
      lines.push(['INDIVIDUAL CHAMPIONS'].join(','));
      lines.push(['Age group', 'Athlete', 'House', 'Points'].map(csvCell).join(','));
      scores.champions.forEach(function (c) {
        c.leaders.forEach(function (l) { lines.push([c.label, l.athlete, l.houseName || '', l.points].map(csvCell).join(',')); });
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (bundle.meet.name || 'sports-day').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-results.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Printable A4 sheet: every event with blank place lines — the paper fallback if a phone dies.
  function printEventSheet(draft) {
    const area = document.getElementById('print-area') || el('div#print-area');
    area.innerHTML = '';
    const places = Object.keys(draft.meet.points_scheme || { '1': 0, '2': 0, '3': 0 }).map(Number).sort(function (a, b) { return a - b; });
    const agById = {}; (draft.ageGroups || []).forEach(function (a) { agById[a.id || a._tmp] = a; });

    const head = el('div.print-head', null, [
      el('h1', { text: draft.meet.name || 'Sports Day' }),
      el('p', { text: 'Event recording sheet · fill in the finishing order · ' + (draft.meet.event_date || '') })
    ]);
    area.appendChild(head);

    (draft.events || []).forEach(function (ev) {
      const ag = agById[ev.age_group_id || ev._agRef];
      const block = el('div.print-event', null, [
        el('h3', { text: (ev.name || 'Event') + (ag ? '  —  ' + ag.label : '') + (ev.category && ev.category !== 'mixed' ? '  (' + ev.category + ')' : '') })
      ]);
      places.forEach(function (p) {
        block.appendChild(el('div.print-line', null, [el('span.pl-pos', { text: ordinal(p) + ':' }), el('span.pl-blank')]));
      });
      area.appendChild(block);
    });

    if (!document.getElementById('print-area')) document.body.appendChild(area);
    document.body.classList.add('printing-sheet');
    function cleanup() { document.body.classList.remove('printing-sheet'); window.removeEventListener('afterprint', cleanup); }
    window.addEventListener('afterprint', cleanup);
    setTimeout(function () { window.print(); }, 60);
    setTimeout(cleanup, 3000);
  }

  window.SD = window.SD || {};
  window.SD.exporter = { downloadCSV: downloadCSV, printEventSheet: printEventSheet };
})();
