/* Sports Day — Supabase connection config
 *
 * Shared "Caerus" project (dlcseuejvducbsjhqvze). Every table is namespaced `sportsday_`.
 * The anon key is a PUBLIC key — designed to ship in a static site. RLS guards the data.
 * (Never embed a service-role key here.)
 *
 * Convention (matches Josh's other GitHub Pages apps): raw fetch() against the PostgREST
 * endpoint, credentials hardcoded, no supabase-js, no build step.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://dlcseuejvducbsjhqvze.supabase.co';
  var SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsY3NldWVqdmR1Y2JzamhxdnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzY3NTUsImV4cCI6MjA4ODExMjc1NX0.MPkeXx_3cgm99RabE4W97jhFtB1ZXycUsR0ofCnNEPs';

  function apiHeaders(extra) {
    var h = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    };
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) h[k] = extra[k]; } }
    return h;
  }

  window.SD = window.SD || {};
  window.SD.SUPABASE_URL = SUPABASE_URL;
  window.SD.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.SD.REST = SUPABASE_URL + '/rest/v1/';
  window.SD.apiHeaders = apiHeaders;

  // Mowden defaults for the (fully editable) setup screen.
  window.SD.MOWDEN_DEFAULTS = {
    houses: [
      { name: 'Collingwood', colour: '#C0392B' },
      { name: 'Grey',        colour: '#27AE60' },
      { name: 'Stephenson',  colour: '#D4A017' },
      { name: 'Bewick',      colour: '#2471A3' }
    ],
    ageGroups: ['Years 3 & 4', 'Years 5 & 6', 'Year 7', 'Year 8'],
    pointsScheme: { '1': 5, '2': 3, '3': 1 },
    sampleEvents: ['100m', '200m', 'Long Jump', 'High Jump', 'Howler / Throw', 'Relay']
  };
})();
