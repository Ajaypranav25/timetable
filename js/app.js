/*
 * Boot + hash router (#/, #/setup, #/plan). Works from file:// and any static host.
 */
(function (root) {
  'use strict';
  var VAP = root.VAP;
  var store = VAP.store;
  var TOAST_MS = 2200;
  var toastTimer = null;

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, TOAST_MS);
  }

  function route() {
    var hash = (root.location.hash || '').replace(/^#\/?/, '');
    if (hash === 'plan' && !VAP.planner.hasData()) {
      toast('Paste your scrapes first');
      root.location.replace('#/setup');
      return;
    }
    var name = hash === 'setup' || hash === 'plan' ? hash : 'landing';
    document.querySelectorAll('[data-view]').forEach(function (v) {
      v.hidden = v.getAttribute('data-view') !== name;
    });
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-nav') === name);
    });
    document.getElementById('topbar').classList.toggle('is-solid', name !== 'landing');
    if (name === 'plan') VAP.planner.show();
    root.scrollTo(0, 0);
  }

  function onData(raw, opts) {
    var data = store.normalizeData(raw);
    if (!data) {
      toast('That data could not be used. Check the pasted pages.');
      return;
    }
    var saved = store.write(store.KEYS.data, data);
    VAP.planner.load(data, opts);
    if (!saved) toast('Browser storage is off: your plan will reset when you close this tab');
    if (root.location.hash === '#/plan') route();
    else root.location.hash = '#/plan';
  }

  function wipe() {
    VAP.cloud.deleteRemote().then(function (result) {
      if (result === 'signed-out') {
        toast('Log in first, so the copy saved in your account is deleted too');
        return;
      }
      if (result !== 'ok') {
        toast('Could not delete the copy in your account. Try again.');
        return;
      }
      store.clearAll();
      root.location.hash = '#/';
      root.location.reload();
    });
  }

  /** The cloud replaced (or cleared) the browser copy: reload the planner from storage. */
  function onCloudData() {
    var saved = store.normalizeData(store.read(store.KEYS.data, null));
    if (saved) VAP.planner.load(saved);
    else VAP.planner.unload();
    if (!/^#\/plan/.test(root.location.hash)) return;
    if (saved) VAP.planner.show(); // re-render in place, keeping the scroll position
    else route();
  }

  function boot() {
    VAP.setup.init({ onData: onData });
    VAP.planner.mount(document.getElementById('planner'), { toast: toast, wipe: wipe });
    VAP.cloud.init({ toast: toast, onCloudData: onCloudData });

    var saved = store.normalizeData(store.read(store.KEYS.data, null));
    if (saved) VAP.planner.load(saved);
    else store.remove(store.KEYS.data);

    document.addEventListener('click', function (e) {
      var demoBtn = e.target.closest('[data-action="demo"]');
      if (demoBtn) {
        // the demo never touches the user's own pasted scrapes, so they can rebuild from Setup,
        // and demo data is never uploaded to their account (see cloud.js)
        var data = VAP.parser.buildData(root.VAP_DEMO);
        data.demo = true;
        onData(data, { fresh: true });
        toast('Demo loaded: CSE student, Fall 2026');
        return;
      }
      var scrollLink = e.target.closest('[data-scroll]');
      if (scrollLink) {
        e.preventDefault();
        if (root.location.hash && root.location.hash !== '#/') {
          root.location.hash = '#/';
        }
        setTimeout(function () {
          var target = document.getElementById(scrollLink.getAttribute('data-scroll'));
          if (target) target.scrollIntoView({ behavior: 'smooth' });
        }, 30);
      }
    });

    root.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);
