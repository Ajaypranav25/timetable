/*
 * Optional Google login + cloud sync through Supabase.
 * Off unless js/config.js has a project URL and anon key and supabase-js loaded.
 * localStorage stays the working copy; the user's single `planner_state` row mirrors it.
 *
 * Sync never compares clocks: the browser remembers which row version it last synced
 * with (store.meta().base) and whether it has edits since (dirty). Uploads are
 * conditional on the row still being that version, and all sync work runs one task at a time.
 */
(function (root) {
  'use strict';
  var VAP = root.VAP;
  var store = VAP.store;
  var rules = VAP.sync;

  var TABLE = 'planner_state';
  var PUSH_DELAY_MS = 1500;
  var RETRY_BASE_MS = 5000;
  var RETRY_MAX_MS = 60000;
  var CONFIRM_MS = 4000;
  var MAX_RECONCILE_DEPTH = 2;
  var RETURN_KEY = 'skipexe:return';
  var AUTH_STORAGE_KEY = 'skipexe:auth';
  var NAME_MAX = 12;
  var AUTH_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state', 'sb_flow_id'];
  var STATUS_TEXT = {
    synced: 'Saved to your account',
    pending: 'Saving soon',
    syncing: 'Syncing',
    demo: 'Demo data is not saved to your account',
    error: 'Not saved yet, retrying'
  };
  var GOOGLE_ICON = '<svg viewBox="0 0 18 18" aria-hidden="true" width="16" height="16"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z"/><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3z"/><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z"/></svg>';
  var EXIT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14" shape-rendering="crispEdges"><path fill="currentColor" d="M1 1h8v3H7V3H3v10h4v-1h2v3H1zM10 4h2v2h2v4h-2v2h-2v-2H5V6h5z"/></svg>';

  var client = null;
  var user = null;
  var ctx = null;
  var slot = null;
  var status = 'synced';
  var queue = Promise.resolve();
  var pushTimer = null;
  var retryTimer = null;
  var retries = 0;
  var applying = false;
  var signingOut = false;
  var logoutArmed = false;
  var unreadableVersion = null;

  // ---------- config ----------

  function isSecretKey(key) {
    if (/^sb_secret_/.test(key)) return true;
    try {
      var payload = JSON.parse(root.atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload && payload.role === 'service_role';
    } catch (e) {
      return false;
    }
  }

  function config() {
    var c = root.VAP_CONFIG || {};
    if (!c.supabaseUrl && !c.supabaseAnonKey) return null;
    var ok = typeof c.supabaseUrl === 'string' && /^https:\/\/\S+$/.test(c.supabaseUrl) &&
      typeof c.supabaseAnonKey === 'string' && c.supabaseAnonKey.length > 20;
    if (!ok) return warn('js/config.js needs an https project URL and the anon key; login is off.');
    if (isSecretKey(c.supabaseAnonKey)) return warn('js/config.js holds a secret (service_role) key. Use the anon key; login is off.');
    if (!root.supabase || typeof root.supabase.createClient !== 'function') return warn('supabase-js did not load; login is off.');
    return c;
  }

  function warn(msg) {
    if (root.console) root.console.warn('[skipexe cloud] ' + msg);
    return null;
  }

  function enabled() {
    return !!client;
  }

  // ---------- UI ----------

  function displayName(u) {
    var meta = (u && u.user_metadata) || {};
    var name = meta.full_name || meta.name || (u && u.email) || 'ME';
    return String(name).split(/[\s@]/)[0].slice(0, NAME_MAX);
  }

  function render() {
    if (!slot) return;
    slot.hidden = !enabled();
    if (!enabled()) return;
    if (!user) {
      slot.innerHTML = '<button type="button" class="btn btn-sm auth-in" data-auth="in" aria-label="Log in with Google">' + GOOGLE_ICON + '<span class="auth-label">LOG IN</span></button>';
      return;
    }
    slot.innerHTML = '<span class="auth-user"><span class="auth-dot"></span><span class="auth-name"></span></span>' +
      '<button type="button" class="btn btn-sm btn-ghost auth-out" data-auth="out" aria-label="Log out">' + EXIT_ICON + '<span class="auth-label">LOG OUT</span></button>';
    slot.querySelector('.auth-name').textContent = displayName(user);
    paintStatus();
  }

  function paintStatus() {
    var dot = slot && slot.querySelector('.auth-dot');
    if (!dot) return;
    dot.className = 'auth-dot is-' + status;
    dot.title = STATUS_TEXT[status] || '';
    slot.querySelector('.auth-user').setAttribute('aria-label', 'Signed in as ' + displayName(user) + '. ' + dot.title);
  }

  function setStatus(s) {
    status = s;
    paintStatus();
  }

  // ---------- task queue + retry ----------

  /** Runs sync tasks one at a time, so a pull can never land in the middle of a push. */
  function enqueue(task) {
    var run = queue.then(task);
    queue = run.catch(function () {});
    return run;
  }

  function failed(err, msg) {
    setStatus('error');
    if (root.console) root.console.error('[skipexe cloud]', err);
    if (retries === 0 && msg) ctx.toast(msg);
    clearTimeout(retryTimer);
    var delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, retries));
    retries += 1;
    retryTimer = setTimeout(function () { enqueue(function () { return reconcile(0, false); }); }, delay);
    return false;
  }

  function succeeded() {
    retries = 0;
    clearTimeout(retryTimer);
  }

  // ---------- sync ----------

  function localData() {
    return store.read(store.KEYS.data, null);
  }

  function push(depth) {
    if (!user) return Promise.resolve(false);
    var uid = user.id;
    var m = store.meta();
    var data = localData();
    if (m.owner !== uid || !m.dirty || !data) return Promise.resolve(true);
    if (data.demo) {
      setStatus('demo');
      return Promise.resolve(true);
    }
    var row = { data: data, session: store.read(store.KEYS.session, {}) || {}, plans: store.read(store.KEYS.plans, {}) || {} };
    setStatus('syncing');
    // Only overwrite the version this copy was based on; if the row moved on, reconcile instead.
    var req = m.base ?
      client.from(TABLE).update(row).eq('user_id', uid).eq('updated_at', m.base).select('updated_at') :
      client.from(TABLE).insert(Object.assign({ user_id: uid }, row)).select('updated_at');
    return req.then(function (res) {
      if (!user || user.id !== uid) return false;
      if (res.error && !(res.error.code === '23505' && !m.base)) return failed(res.error, 'Could not save to your account. Retrying.');
      if (res.error || !res.data || !res.data.length) return reconcile((depth || 0) + 1, false);
      succeeded();
      var now = store.meta();
      var clean = now.rev === m.rev;
      store.setMeta(clean ? { base: res.data[0].updated_at, dirty: false } : { base: res.data[0].updated_at });
      setStatus(clean ? 'synced' : 'pending');
      if (!clean) schedulePush();
      return true;
    }, function (err) { return failed(err, 'Could not save to your account. Retrying.'); });
  }

  function apply(row) {
    var uid = user.id;
    var data = store.normalizeData(row.data);
    if (!data) {
      unreadableVersion = row.updated_at;
      failed(new Error('cloud copy failed validation'), 'Your saved plan could not be read. Keeping this browser copy.');
      return false;
    }
    clearTimeout(pushTimer);
    pushTimer = null;
    applying = true;
    var ok;
    try {
      ok = store.write(store.KEYS.data, data, { silent: true }) &&
        store.write(store.KEYS.session, store.cleanSession(row.session, data), { silent: true }) &&
        store.write(store.KEYS.plans, store.cleanPlans(row.plans), { silent: true });
      if (ok) store.setMeta({ owner: uid, base: row.updated_at, dirty: false });
    } finally {
      applying = false;
    }
    if (!ok) {
      ctx.toast('Browser storage is off, so your saved plan cannot be loaded here');
      return false;
    }
    succeeded();
    setStatus('synced');
    ctx.onCloudData();
    return true;
  }

  /**
   * Compares the browser copy with the account row and acts on rules.decide().
   * initial: first check after login/page load (demo data then gives way to the saved plan).
   */
  function reconcile(depth, initial) {
    if (!user) return Promise.resolve(false);
    if (depth > MAX_RECONCILE_DEPTH) return Promise.resolve(failed(new Error('sync kept racing another device')));
    var uid = user.id;
    var data = localData();
    if (data && data.demo && !initial && store.meta().owner === uid) {
      setStatus('demo');
      return Promise.resolve(true);
    }
    setStatus('syncing');
    return client.from(TABLE).select('data, session, plans, updated_at').eq('user_id', uid).maybeSingle().then(function (res) {
      if (!user || user.id !== uid) return false;
      if (res.error) return failed(res.error, 'Could not reach your saved plan. Working offline.');
      var row = res.data;
      var m = store.meta();
      var hasData = !!data && !data.demo;
      var action = rules.decide({ hasData: hasData, dirty: m.dirty, base: m.base, owner: m.owner }, row ? { version: row.updated_at } : null, uid);
      if (m.owner && m.owner !== uid && action !== 'push') store.remove(store.KEYS.raw); // another account's pasted pages
      if ((action === 'pull' || action === 'conflict') && row.updated_at === unreadableVersion) action = 'none';
      if (action === 'pull') {
        if (apply(row) && hasData) ctx.toast('Loaded your plan from your account');
        return true;
      }
      if (action === 'conflict') {
        if (apply(row)) ctx.toast('Your plan changed on another device; loaded that version');
        return true;
      }
      if (action === 'clear') {
        store.clearAll();
        store.setMeta({ owner: uid });
        succeeded();
        setStatus('synced');
        ctx.onCloudData();
        return true;
      }
      if (action === 'push') {
        store.setMeta({ owner: uid, base: row ? row.updated_at : null, dirty: true });
        return push(depth);
      }
      store.setMeta({ owner: uid });
      succeeded();
      setStatus(data && data.demo ? 'demo' : 'synced');
      return true;
    }, function (err) { return failed(err, 'Could not reach your saved plan. Working offline.'); });
  }

  function schedulePush() {
    if (!user || applying || store.meta().owner !== user.id) return;
    clearTimeout(pushTimer);
    setStatus('pending');
    pushTimer = setTimeout(function () {
      pushTimer = null;
      enqueue(function () { return push(0); });
    }, PUSH_DELAY_MS);
  }

  function flushPush() {
    if (!pushTimer) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    enqueue(function () { return push(0); });
  }

  // ---------- auth ----------

  function signIn() {
    if (root.location.protocol === 'file:') {
      ctx.toast('Open the site over http(s) to log in');
      return;
    }
    try { root.sessionStorage.setItem(RETURN_KEY, root.location.hash || '#/'); } catch (e) { /* optional */ }
    client.auth.signInWithOAuth({
      provider: 'google',
      // shared lab PCs: always ask which Google account, never silently reuse the last one
      options: { redirectTo: root.location.origin + root.location.pathname, queryParams: { prompt: 'select_account' } }
    }).then(function (res) {
      if (res.error) failed(res.error, 'Google login failed. Try again.');
    });
  }

  function forgetDevice() {
    signingOut = true;
    store.clearAll();
    try {
      Object.keys(root.localStorage).forEach(function (k) {
        if (k.indexOf(AUTH_STORAGE_KEY) === 0) root.localStorage.removeItem(k);
      });
    } catch (e) { /* storage unavailable: nothing to remove */ }
    root.location.hash = '#/';
    root.location.reload();
  }

  function signOut() {
    flushPush();
    enqueue(function () {
      if (!user) return forgetDevice();
      var m = store.meta();
      var data = localData();
      var unsaved = m.dirty && m.owner === user.id && data && !data.demo;
      if (unsaved && !logoutArmed) {
        logoutArmed = true;
        setTimeout(function () { logoutArmed = false; }, CONFIRM_MS);
        ctx.toast('Some changes are not in your account yet. Press LOG OUT again to discard them.');
        return null;
      }
      // the browser copy belongs to the account, so it leaves with it (shared lab PCs);
      // 'local' keeps the user's phone and laptop logged in
      return client.auth.signOut({ scope: 'local' }).catch(function (err) {
        if (root.console) root.console.error('[skipexe cloud]', err);
      }).then(forgetDevice);
    });
  }

  /**
   * Deletes this user's cloud row after any pending upload. Resolves 'ok' (nothing left in
   * the cloud), 'signed-out' (a cloud copy may exist but we cannot reach it) or 'failed'.
   */
  function deleteRemote() {
    if (!enabled()) return Promise.resolve('ok');
    if (!user) return Promise.resolve(store.meta().owner ? 'signed-out' : 'ok');
    clearTimeout(pushTimer);
    pushTimer = null;
    var uid = user.id;
    return enqueue(function () {
      return client.from(TABLE).delete().eq('user_id', uid).then(function (res) {
        if (res.error) {
          failed(res.error);
          return 'failed';
        }
        store.setMeta({ base: null });
        return 'ok';
      }, function (err) {
        failed(err);
        return 'failed';
      });
    });
  }

  function cleanAuthUrl() {
    var params = new URLSearchParams(root.location.search);
    var err = params.get('error_description') || params.get('error');
    var started = false;
    try { started = root.sessionStorage.getItem(RETURN_KEY) != null; } catch (e) { /* optional */ }
    if (err && started) {
      // the URL text is attacker-controllable, so it goes to the console, not the page
      if (root.console) root.console.warn('[skipexe cloud] login error:', err);
      ctx.toast('Login failed or was cancelled');
      try { root.sessionStorage.removeItem(RETURN_KEY); } catch (e) { /* optional */ }
    }
    if (!AUTH_PARAMS.some(function (k) { return params.has(k); })) return;
    AUTH_PARAMS.forEach(function (k) { params.delete(k); });
    var q = params.toString();
    root.history.replaceState(null, '', root.location.pathname + (q ? '?' + q : '') + root.location.hash);
  }

  function restoreReturnHash() {
    var hash = null;
    try {
      hash = root.sessionStorage.getItem(RETURN_KEY);
      root.sessionStorage.removeItem(RETURN_KEY);
    } catch (e) { /* optional */ }
    if (hash && /^#\/[a-z]*$/.test(hash) && hash !== root.location.hash) root.location.hash = hash;
  }

  function onAuth(event, session) {
    var next = (session && session.user) || null;
    var prev = user;
    if ((next && next.id) === (prev && prev.id)) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    user = next;
    if (prev && !next && !signingOut) {
      // logged out in another tab, or the session expired: drop the account's copy unless it has unsaved edits
      if (!store.meta().dirty) return forgetDevice();
      ctx.toast('You were logged out. Log in again to save your latest changes.');
    }
    render();
    if (next) {
      restoreReturnHash();
      enqueue(function () { return reconcile(0, true); });
    }
  }

  function init(api) {
    ctx = api;
    slot = document.getElementById('auth');
    var c = config();
    if (c) {
      client = root.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY }
      });
      // supabase-js warns against awaiting its own calls inside this callback, hence the defer
      client.auth.onAuthStateChange(function (event, session) {
        setTimeout(function () { onAuth(event, session); }, 0);
      });
      // getSession waits for the ?code= exchange, so the URL is only cleaned afterwards
      client.auth.getSession().then(cleanAuthUrl, cleanAuthUrl);
      store.onChange(schedulePush);
      document.addEventListener('visibilitychange', function () {
        if (!user) return;
        if (document.visibilityState === 'hidden') flushPush();
        else if (!pushTimer) enqueue(function () { return reconcile(0, false); });
      });
      root.addEventListener('online', function () {
        if (user) enqueue(function () { return reconcile(0, false); });
      });
      if (slot) {
        slot.addEventListener('click', function (e) {
          var b = e.target.closest('[data-auth]');
          if (!b) return;
          if (b.getAttribute('data-auth') === 'in') signIn();
          else signOut();
        });
      }
    }
    render();
  }

  VAP.cloud = {
    init: init,
    enabled: enabled,
    signedIn: function () { return !!user; },
    deleteRemote: deleteRemote
  };
})(typeof self !== 'undefined' ? self : this);
