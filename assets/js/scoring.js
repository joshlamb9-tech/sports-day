/* Sports Day — scoring engine (pure, deterministic, transparent)
 *
 * Single source of truth for every number the app shows. The Admin page renders
 * this output verbatim so the maths is never a black box.
 *
 * Inputs are plain rows as stored in Supabase. No network, no DOM — easy to reason about/test.
 */
(function () {
  'use strict';

  function num(v) { return typeof v === 'number' ? v : Number(v) || 0; }

  function pointsForPosition(scheme, pos) {
    if (!scheme) return 0;
    const v = scheme[String(pos)];
    return v == null ? 0 : num(v);
  }

  // round to 2dp but keep integers clean
  function tidy(n) { return Math.round(n * 100) / 100; }

  /* For one event's results, award points per placing, honouring ties.
   * tiePolicy 'split'  → tied places share the sum of the places they occupy (athletics standard).
   * tiePolicy 'shared' → every tied place gets the full points for that position; next position skips.
   * Returns { [resultId]: points } plus an ordered explanation array.
   */
  function awardEventPoints(scheme, tiePolicy, eventResults) {
    const byPos = {};
    eventResults.forEach(function (r) {
      const p = num(r.position);
      (byPos[p] = byPos[p] || []).push(r);
    });
    const positions = Object.keys(byPos).map(Number).sort(function (a, b) { return a - b; });
    const points = {};
    const explain = [];
    positions.forEach(function (p) {
      const group = byPos[p];
      const n = group.length;
      let pts, basis;
      if (tiePolicy === 'split' && n > 1) {
        let sum = 0;
        const occupied = [];
        for (let k = 0; k < n; k++) { sum += pointsForPosition(scheme, p + k); occupied.push(p + k); }
        pts = sum / n;
        basis = 'tie of ' + n + ' at place ' + p + ' — share places ' + occupied.join('+') + ' = ' + tidy(sum) + ' ÷ ' + n;
      } else {
        pts = pointsForPosition(scheme, p);
        basis = n > 1 ? ('tie of ' + n + ' at place ' + p + ' — each gets place ' + p + ' points') : ('place ' + p);
      }
      pts = tidy(pts);
      group.forEach(function (r) { points[r.id] = pts; });
      explain.push({ position: p, count: n, pointsEach: pts, basis: basis, houseIds: group.map(function (r) { return r.house_id; }) });
    });
    return { points: points, explain: explain };
  }

  /* Main entry. Returns a complete, render-ready snapshot. */
  function compute(meet, houses, ageGroups, events, results) {
    meet = meet || {};
    houses = houses || []; ageGroups = ageGroups || []; events = events || [];
    // Only committed, non-voided rows count toward any published number.
    results = (results || []).filter(function (r) { return !r.voided; });
    const scheme = meet.points_scheme || { '1': 5, '2': 3, '3': 1 };
    const tiePolicy = meet.tie_policy || 'split';

    const houseById = {}; houses.forEach(function (h) { houseById[h.id] = h; });
    const eventById = {}; events.forEach(function (e) { eventById[e.id] = e; });
    const ageById = {}; ageGroups.forEach(function (a) { ageById[a.id] = a; });

    const resultsByEvent = {};
    results.forEach(function (r) { (resultsByEvent[r.event_id] = resultsByEvent[r.event_id] || []).push(r); });

    // ---- per-event awards -------------------------------------------------
    const pointsByResult = {};
    const eventBreakdown = []; // for admin: each event, its placings + points
    events.forEach(function (ev) {
      const er = resultsByEvent[ev.id] || [];
      const evScheme = (ev.points_scheme && Object.keys(ev.points_scheme).length) ? ev.points_scheme : scheme;
      const res = awardEventPoints(evScheme, tiePolicy, er);
      Object.keys(res.points).forEach(function (id) { pointsByResult[id] = res.points[id]; });
      const placings = er.slice().sort(function (a, b) { return num(a.position) - num(b.position); })
        .map(function (r) {
          const h = houseById[r.house_id] || {};
          return {
            resultId: r.id, position: num(r.position), houseId: r.house_id,
            houseName: h.name, houseColour: h.colour, athlete: r.athlete_name || null,
            points: pointsByResult[r.id] || 0
          };
        });
      eventBreakdown.push({
        eventId: ev.id, name: ev.name, discipline: ev.discipline,
        ageGroupId: ev.age_group_id, ageGroup: (ageById[ev.age_group_id] || {}).label || null,
        category: ev.category, isRelay: ev.is_relay, status: ev.status,
        customScheme: evScheme !== scheme ? evScheme : null,
        recorded: er.length > 0, placings: placings, explain: res.explain
      });
    });

    // ---- house totals (+ breakdowns) -------------------------------------
    const totals = {};            // houseId -> total
    const byEvent = {};           // houseId -> { eventId: points }
    const byAge = {};             // houseId -> { ageGroupId|'_none': points }
    houses.forEach(function (h) { totals[h.id] = 0; byEvent[h.id] = {}; byAge[h.id] = {}; });

    results.forEach(function (r) {
      const p = pointsByResult[r.id] || 0;
      if (!(r.house_id in totals)) return; // orphaned house (deleted) — ignore
      totals[r.house_id] += p;
      byEvent[r.house_id][r.event_id] = (byEvent[r.house_id][r.event_id] || 0) + p;
      const ev = eventById[r.event_id] || {};
      const agKey = ev.age_group_id || '_none';
      byAge[r.house_id][agKey] = (byAge[r.house_id][agKey] || 0) + p;
    });

    const standings = houses.map(function (h) {
      return { houseId: h.id, name: h.name, colour: h.colour, total: tidy(totals[h.id] || 0), byEvent: byEvent[h.id], byAge: byAge[h.id] };
    }).sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });

    // dense rank with ties
    let rank = 0, prev = null;
    standings.forEach(function (s, i) {
      if (prev === null || s.total !== prev) { rank = i + 1; prev = s.total; }
      s.rank = rank;
    });
    const maxTotal = standings.length ? standings[0].total : 0;
    standings.forEach(function (s) { s.pct = maxTotal > 0 ? Math.round((s.total / maxTotal) * 100) : 0; });
    const topTotal = standings.length ? standings[0].total : 0;
    const winners = standings.filter(function (s) { return s.total === topTotal && topTotal > 0; });

    // ---- per age-group standings -----------------------------------------
    const ageStandings = ageGroups.map(function (ag) {
      const rows = houses.map(function (h) {
        return { houseId: h.id, name: h.name, colour: h.colour, total: tidy((byAge[h.id] || {})[ag.id] || 0) };
      }).sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
      const top = rows.length ? rows[0].total : 0;
      return { ageGroupId: ag.id, label: ag.label, rows: rows, winners: rows.filter(function (r) { return r.total === top && top > 0; }) };
    });

    // ---- individual champions (Victor / Victrix Ludorum) -----------------
    // Top athlete by points across non-relay events, grouped by age group.
    let champions = [];
    if (meet.track_individual) {
      const tally = {}; // ageKey -> { athleteName -> {points, houseId, categories:Set} }
      results.forEach(function (r) {
        if (!r.athlete_name) return;
        const ev = eventById[r.event_id] || {};
        if (ev.is_relay) return;
        const agKey = ev.age_group_id || '_none';
        const name = r.athlete_name.trim();
        if (!name) return;
        tally[agKey] = tally[agKey] || {};
        const a = tally[agKey][name] = tally[agKey][name] || { points: 0, houseId: r.house_id, cats: {} };
        a.points += pointsByResult[r.id] || 0;
        if (ev.category) a.cats[ev.category] = true;
      });
      champions = Object.keys(tally).map(function (agKey) {
        const ag = ageById[agKey];
        const arr = Object.keys(tally[agKey]).map(function (name) {
          const a = tally[agKey][name];
          const cats = Object.keys(a.cats);
          const cat = cats.length === 1 ? cats[0] : 'mixed';
          const h = houseById[a.houseId] || {};
          return { athlete: name, points: tidy(a.points), houseId: a.houseId, houseName: h.name, houseColour: h.colour, category: cat };
        }).sort(function (x, y) { return y.points - x.points; });
        const top = arr.length ? arr[0].points : 0;
        return {
          ageGroupId: agKey === '_none' ? null : agKey,
          label: ag ? ag.label : 'Open',
          leaders: arr.filter(function (x) { return x.points === top && top > 0; }),
          all: arr
        };
      }).filter(function (c) { return c.all.length > 0; });
    }

    // ---- progress / recency ----------------------------------------------
    const recordedEvents = eventBreakdown.filter(function (e) { return e.recorded; }).length;
    const recent = results.slice().sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }).slice(0, 12).map(function (r) {
      const ev = eventById[r.event_id] || {}; const h = houseById[r.house_id] || {};
      return { event: ev.name, ageGroup: (ageById[ev.age_group_id] || {}).label || '', position: num(r.position), houseName: h.name, houseColour: h.colour, athlete: r.athlete_name, points: pointsByResult[r.id] || 0, at: r.created_at };
    });

    return {
      scheme: scheme, tiePolicy: tiePolicy, trackIndividual: !!meet.track_individual,
      standings: standings, winners: winners,
      ageStandings: ageStandings, champions: champions,
      events: eventBreakdown,
      pointsByResult: pointsByResult,
      progress: { recordedEvents: recordedEvents, totalEvents: events.length },
      recent: recent
    };
  }

  window.SD = window.SD || {};
  window.SD.scoring = { compute: compute, awardEventPoints: awardEventPoints, pointsForPosition: pointsForPosition, tidy: tidy };
})();
