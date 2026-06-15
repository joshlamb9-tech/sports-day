/* Sports Day — live data layer (polling)
 *
 * Deliberate choice over websockets: a self-healing poll survives flaky school-field
 * wifi far more gracefully than a dropped Realtime socket, matches Josh's other apps,
 * and a few seconds' latency on a leaderboard is imperceptible. (Realtime is an easy
 * v2 accelerator if ever wanted — the contract below would not change.)
 *
 * Responsibilities:
 *   - poll the current meet's bundle on an interval while a screen is watching
 *   - keep a "last good" snapshot so the board never blanks on a failed fetch
 *   - emit a `sd:data-changed` event with { bundle, scores, stale } whenever data refreshes
 */
(function () {
  'use strict';

  const store = window.SD.store;
  let timer = null;
  let meetId = null;
  let intervalMs = 5000;
  let last = null;          // last good { bundle, scores }
  let inFlight = false;

  function emit(detail) {
    document.dispatchEvent(new CustomEvent('sd:data-changed', { detail: detail }));
  }

  async function tick() {
    if (!meetId || inFlight) return;
    inFlight = true;
    try {
      const res = await store.loadScored(meetId);
      if (res && res.bundle && res.bundle.meet) {
        last = res;
        emit({ bundle: res.bundle, scores: res.scores, stale: !!res.bundle.stale });
      }
    } catch (e) {
      // network failure — keep showing last good, flag stale
      if (last) emit({ bundle: last.bundle, scores: last.scores, stale: true });
    } finally {
      inFlight = false;
    }
  }

  const live = {
    last: function () { return last; },
    // start watching a meet; fires immediately then every intervalMs
    watch: function (id, opts) {
      opts = opts || {};
      meetId = id;
      intervalMs = opts.intervalMs || 5000;
      live.stop();
      tick();
      timer = setInterval(tick, intervalMs);
      // refresh the instant the tab regains focus / network
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', tick);
    },
    refresh: tick,          // force an immediate poll (e.g. just after a local write)
    stop: function () {
      if (timer) { clearInterval(timer); timer = null; }
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', tick);
    }
  };

  function onVisible() { if (!document.hidden) tick(); }

  window.SD = window.SD || {};
  window.SD.live = live;
})();
