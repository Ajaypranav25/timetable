/*
 * Cloud sync rules (pure). Decides what to do when a signed-in user's browser copy and
 * their database row disagree. No clocks are compared: the browser remembers the row
 * version (`updated_at`, as the server's string) it last synced with.
 *   local:  { hasData, dirty (edited since that sync), base (that version or null), owner (user id or null) }
 *   remote: null | { version (the row's updated_at string) }
 * Returns 'pull' (database -> browser), 'push' (browser -> database), 'conflict' (both
 * changed since the last sync), 'clear' (drop the browser copy) or 'none'.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VAP = root.VAP || {}).sync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function decide(local, remote, userId) {
    var mine = local.owner === userId;
    if (remote) {
      // Someone else's (or a signed-out) copy never overwrites an account that already has a plan.
      if (!mine || !local.hasData) return 'pull';
      if (remote.version === local.base) return local.dirty ? 'push' : 'none';
      return local.dirty ? 'conflict' : 'pull';
    }
    if (!local.hasData) return 'none';
    if (local.owner == null) return 'push'; // a signed-out copy is adopted by an empty account
    if (!mine) return 'clear'; // never upload another account's copy
    // the row was deleted (e.g. "delete all my data" on another device) unless we have new edits
    return local.dirty || !local.base ? 'push' : 'clear';
  }

  return { decide: decide };
});
