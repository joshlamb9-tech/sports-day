/* Sports Day — state + data loading
 *
 * Loads a meet's full bundle in parallel and caches it to localStorage, so the
 * Admin / Spectator / Record screens keep rendering the last-known state even when
 * the network drops. Tracks the current meet id + recorder identity.
 */
(function () {
  'use strict';

  const api = window.SD.api;
  const LS = {
    meet: 'sd_meet_id',
    recorder: 'sd_recorder',
    bundle: function (id) { return 'sd_bundle_' + id; }
  };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  const store = {
    meetId: function () { return get(LS.meet); },
    setMeetId: function (id) {
      set(LS.meet, id || '');
      if (window.SD.queue) window.SD.queue.setMeet(id);
    },
    recorder: function () { return get(LS.recorder) || ''; },
    setRecorder: function (name) { set(LS.recorder, name || ''); },

    // List all meets (for the home / picker screen)
    listMeets: function () {
      return api.select('sportsday_meets', { select: '*', order: 'created_at.desc' });
    },

    cachedBundle: function (meetId) {
      try { return JSON.parse(get(LS.bundle(meetId)) || 'null'); } catch (e) { return null; }
    },

    // Load everything for a meet. On network failure, fall back to cache (marked stale).
    loadBundle: async function (meetId) {
      try {
        const eq = 'eq.' + meetId;
        const [meetRows, houses, ageGroups, events, results] = await Promise.all([
          api.select('sportsday_meets', { id: eq, select: '*', limit: 1 }),
          api.select('sportsday_houses', { meet_id: eq, select: '*', order: 'sort.asc' }),
          api.select('sportsday_age_groups', { meet_id: eq, select: '*', order: 'sort.asc' }),
          api.select('sportsday_events', { meet_id: eq, select: '*', order: 'sort.asc' }),
          api.select('sportsday_results', { meet_id: eq, select: '*' })
        ]);
        const bundle = {
          meet: (meetRows && meetRows[0]) || null,
          houses: houses || [], ageGroups: ageGroups || [],
          events: events || [], results: results || [],
          fetchedAt: Date.now(), stale: false
        };
        if (bundle.meet) set(LS.bundle(meetId), JSON.stringify(bundle));
        return bundle;
      } catch (err) {
        const cached = store.cachedBundle(meetId);
        if (cached) { cached.stale = true; return cached; }
        throw err;
      }
    },

    // Convenience: load + compute scores in one go.
    loadScored: async function (meetId) {
      const b = await store.loadBundle(meetId);
      if (!b || !b.meet) return { bundle: b, scores: null };
      const scores = window.SD.scoring.compute(b.meet, b.houses, b.ageGroups, b.events, b.results);
      return { bundle: b, scores: scores };
    }
  };

  window.SD = window.SD || {};
  window.SD.store = store;
})();
