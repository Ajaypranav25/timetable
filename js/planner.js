/*
 * Planner controller: owns state, renders via plannerView, handles events.
 */
(function (root) {
  'use strict';
  var VAP = root.VAP;
  var engine = VAP.engine;
  var store = VAP.store;
  var view = VAP.plannerView;
  var esc = VAP.setup.esc;
  var RESERVED_NAMES = ['__proto__', 'constructor', 'prototype'];
  var MAX_PLAN_NAME = 30;
  var CONFIRM_MS = 3000;

  var state = null;
  var hostEl = null;
  var ctxApi = null;
  var armed = {};

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function settingsForEngine() {
    return store.engineSettings(state.settings);
  }

  /** opts.silent: re-save without counting it as a user change (loading must not look newer than the cloud). */
  function persist(opts) {
    store.saveSession({ plan: state.plan, settings: state.settings, planName: state.planName }, opts);
  }

  function update(patch) {
    state = Object.assign({}, state, patch);
    persist();
    render();
  }

  // ---------- render ----------

  function settingsHtml(s, es) {
    function dateField(key, label, value) {
      return '<label class="field"><span>' + label + '</span><input type="date" data-setting="' + key + '" value="' + esc(value || '') + '"></label>';
    }
    return '<details class="card"' + (state.settingsOpen ? ' open' : '') + ' data-details="settings"><summary>SETTINGS</summary><div class="settings-grid">' +
      dateField('todayOverride', 'Today' + (s.todayOverride ? ' (manual)' : ' (auto)'), es.today) +
      dateField('snapshotDate', 'Attendance copied on', s.snapshotDate) +
      dateField('lastTheory', 'Last theory day', s.lastTheory) +
      dateField('lastLab', 'Last lab day', s.lastLab) +
      '<label class="field"><span>Target %</span><input type="number" min="1" max="100" step="0.5" inputmode="decimal" data-setting="target" value="' + s.target + '"></label>' +
      '<label class="check"><input type="checkbox" data-setting="snapshotIncludesDay"' + (s.snapshotIncludesDay ? ' checked' : '') + '>' +
        '<span>The attendance I copied already includes classes held on ' + esc(view.fmtDate(s.snapshotDate)) + ' (start counting from the next day).</span></label>' +
      (s.todayOverride ? '<button type="button" class="btn btn-ghost btn-sm" data-act="today-auto">USE REAL TODAY</button>' : '') +
      '</div></details>';
  }

  function plansHtml() {
    var names = Object.keys(state.plans).sort();
    return '<div class="card plans-box"><h2>PLANS' + (state.planName ? ' · ' + esc(state.planName) : '') + '</h2>' +
      '<form class="plans-row" data-form="plan-save"><label class="sr-only" for="plan-name">Plan name</label>' +
        '<input id="plan-name" maxlength="' + MAX_PLAN_NAME + '" placeholder="Plan A" value="' + esc(state.draftName != null ? state.draftName : state.planName) + '">' +
        '<button class="btn btn-lime btn-sm" type="submit">SAVE</button>' +
        '<button class="btn btn-danger btn-sm" type="button" data-act="reset">' + (armed.reset ? 'SURE?' : 'RESET ALL') + '</button></form>' +
      (names.length ? '<div class="plan-chips">' + names.map(function (n) {
        return '<span class="chip' + (n === state.planName ? ' is-current' : '') + '"><button type="button" data-act="plan-load" data-name="' + esc(n) + '">' + esc(n) + '</button>' +
          '<button type="button" class="chip-x" data-act="plan-del" data-name="' + esc(n) + '" aria-label="' + esc('Delete plan ' + n) + '">' + (armed['del:' + n] ? 'SURE?' : '&times;') + '</button></span>';
      }).join('') + '</div>' : '<p class="hint" style="margin-top:8px">Save the current skips as a named plan to compare later.</p>') +
      '</div>';
  }

  function render() {
    if (!hostEl || !state) return;
    try {
      renderPlanner();
    } catch (err) {
      hostEl.innerHTML = '<div class="page"><div class="card"><h1 class="pixel-h">SOMETHING BROKE</h1>' +
        '<p>The saved data could not be shown (' + esc(err && err.message) + '). Re-paste your scrapes, or delete the saved data and start over.</p>' +
        '<div class="danger-zone"><a class="btn btn-lime btn-sm" href="#/setup">GO TO SETUP</a>' +
        '<button type="button" class="btn btn-danger btn-sm" data-act="wipe">' + (armed.wipe ? 'SURE? CLICK AGAIN' : 'DELETE ALL MY DATA') + '</button></div></div></div>';
    }
  }

  function renderPlanner() {
    var es = settingsForEngine();
    var result = engine.project(state.data, es, state.plan);
    var brks = engine.breaks(state.data, es, state.plan);
    var ctx = {
      today: es.today,
      start: engine.windowStart(es),
      end: engine.windowEnd(es),
      selected: state.selected
    };
    var stripEl = document.getElementById('strip');
    var stripScroll = stripEl ? stripEl.scrollLeft : 0;
    var panelEl = hostEl.querySelector('.panel');
    var panelScroll = panelEl ? panelEl.scrollTop : 0;
    var focusSel = focusSelector(document.activeElement);

    var compareRows = [{ name: state.planName || 'Current', plan: state.plan, result: result, breaks: brks, current: true }]
      .concat(Object.keys(state.plans).sort().filter(function (n) { return n !== state.planName; }).map(function (n) {
        return { name: n, plan: state.plans[n], result: engine.project(state.data, es, state.plans[n]), breaks: engine.breaks(state.data, es, state.plans[n]) };
      }));
    var d = state.data;

    hostEl.innerHTML =
      '<div class="planner">' +
        '<div class="strip-wrap" id="strip-wrap">' + view.strip(result, es.target) + '</div>' +
        '<div class="plan-head"><div><h1 class="pixel-title">YOUR PLAN</h1>' +
          '<p class="plan-meta">' + esc(d.semester || 'Semester') + (d.demo ? ' · <b>DEMO DATA</b>' : '') +
          ' · attendance as of <b>' + esc(view.fmtDate(es.snapshotDate)) + '</b> · counting <b>' + esc(view.fmtDate(ctx.start)) + '</b> &rarr; <b>' + esc(view.fmtDate(ctx.end)) + '</b>' +
          ' · lowest: <b class="st-' + (result.lowest ? result.lowest.status : 'safe') + '">' + (result.lowest ? esc(view.shortName(result.lowest)) + ' ' + view.pct(result.lowest.projectedPct) : '-') + '</b></p></div></div>' +
        (d.warnings && d.warnings.length ? '<ul class="warn-list">' + d.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="toolbar">' + settingsHtml(state.settings, es) + plansHtml() + '</div>' +
        '<div class="layout">' +
          '<div class="months">' + view.legend() + view.calendar(d, es, state.plan, ctx) + '</div>' +
          '<aside class="card panel' + (state.sheetOpen ? ' is-open' : '') + '" id="day-panel" aria-label="Day details">' + view.panel(d, es, state.plan, result, ctx) + '</aside>' +
        '</div>' +
        '<div class="sheet-backdrop' + (state.sheetOpen ? ' is-open' : '') + '" data-act="panel-close"></div>' +
        '<h2 class="section-h">EVERY COURSE</h2>' +
        '<div class="courses">' + view.courses(result, es.target) + '</div>' +
        '<div class="duo">' +
          '<section><h2 class="section-h">BREAKS</h2><div class="card">' + view.breaks(brks) + '</div></section>' +
          '<section><h2 class="section-h">COMPARE PLANS</h2><div class="card">' + view.compare(compareRows) + '</div></section>' +
        '</div>' +
        '<div class="danger-zone">' +
          '<a class="btn btn-ghost btn-sm" href="#/setup">EDIT SCRAPES</a>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="export">EXPORT data.json</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-act="wipe">' + (armed.wipe ? 'SURE? CLICK AGAIN' : 'DELETE ALL MY DATA') + '</button>' +
        '</div>' +
      '</div>';

    var newStrip = document.getElementById('strip');
    if (newStrip) newStrip.scrollLeft = stripScroll;
    var newPanel = hostEl.querySelector('.panel');
    if (newPanel && state.selected === state.lastPanelDate) newPanel.scrollTop = panelScroll;
    state.lastPanelDate = state.selected;
    restoreFocus(focusSel);
    measure();
  }

  function focusSelector(el) {
    if (!el || !hostEl || !hostEl.contains(el)) return null;
    var attrs = ['data-act', 'data-date', 'data-id', 'data-setting', 'data-name', 'data-course'];
    var sel = attrs.filter(function (a) { return el.hasAttribute(a); }).map(function (a) {
      return '[' + a + '="' + String(el.getAttribute(a)).replace(/["\\]/g, '\\$&') + '"]';
    }).join('');
    if (el.id) sel = '#' + el.id;
    return sel ? { sel: sel, inPanel: !!el.closest('.panel') } : null;
  }

  function restoreFocus(f) {
    if (!f) return;
    var scope = f.inPanel ? hostEl.querySelector('.panel') : hostEl;
    var el = scope && scope.querySelector(f.sel);
    if (el) el.focus({ preventScroll: true });
  }

  function measure() {
    var top = document.getElementById('topbar');
    var stripWrap = document.getElementById('strip-wrap');
    var rootStyle = document.documentElement.style;
    if (top) rootStyle.setProperty('--topbar-h', top.offsetHeight + 'px');
    if (stripWrap) rootStyle.setProperty('--strip-h', stripWrap.offsetHeight + 'px');
  }

  // ---------- actions ----------

  function arm(key) {
    if (armed[key]) {
      armed = {};
      return true;
    }
    armed = {};
    armed[key] = true;
    setTimeout(function () {
      if (armed[key]) { armed = {}; render(); }
    }, CONFIRM_MS);
    render();
    return false;
  }

  function isMobile() {
    return root.matchMedia && root.matchMedia('(max-width: 1080px)').matches;
  }

  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t || !hostEl.contains(t)) return;
    var act = t.getAttribute('data-act');
    var date = t.getAttribute('data-date');
    var es = settingsForEngine();
    if (act === 'day-toggle') {
      var info = engine.dayInfo(state.data, es, state.plan, date);
      if (!info.classes.length) return update({ selected: date });
      update({ plan: engine.toggleDay(state.plan, date, info.state === 'full'), selected: date });
    } else if (act === 'day-open') {
      update({ selected: date, sheetOpen: isMobile() });
    } else if (act === 'cls') {
      update({ plan: engine.toggleClass(state.plan, state.data, es, date, t.getAttribute('data-id')) });
    } else if (act === 'panel-close') {
      update({ sheetOpen: false });
    } else if (act === 'pill') {
      var card = document.getElementById('course-' + t.getAttribute('data-course'));
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (act === 'plan-load') {
      var name = t.getAttribute('data-name');
      if (has(state.plans, name)) {
        update({ plan: state.plans[name], planName: name, draftName: null });
        ctxApi.toast('Loaded ' + name);
      }
    } else if (act === 'plan-del') {
      var del = t.getAttribute('data-name');
      if (!arm('del:' + del)) return;
      var rest = {};
      Object.keys(state.plans).forEach(function (n) { if (n !== del) rest[n] = state.plans[n]; });
      store.savePlans(rest);
      update({ plans: rest, planName: state.planName === del ? '' : state.planName });
    } else if (act === 'reset') {
      if (!arm('reset')) return;
      update({ plan: engine.emptyPlan(), planName: '', draftName: null });
      ctxApi.toast('All skips cleared');
    } else if (act === 'today-auto') {
      update({ settings: Object.assign({}, state.settings, { todayOverride: null }) });
    } else if (act === 'export') {
      exportData();
    } else if (act === 'wipe') {
      if (!arm('wipe')) return;
      ctxApi.wipe();
    }
  }

  function savePlan(e) {
    e.preventDefault();
    var input = hostEl.querySelector('#plan-name');
    var name = (input.value || '').trim().slice(0, MAX_PLAN_NAME);
    if (!name) { ctxApi.toast('Give the plan a name'); input.focus(); return; }
    if (RESERVED_NAMES.indexOf(name) !== -1) { ctxApi.toast('Pick another name'); return; }
    var plans = Object.assign({}, state.plans);
    plans[name] = state.plan;
    if (!store.savePlans(plans)) ctxApi.toast('Saved for this visit only (browser storage is off)');
    else ctxApi.toast('Saved ' + name);
    update({ plans: plans, planName: name, draftName: null });
  }

  function onChange(e) {
    var el = e.target;
    var key = el.getAttribute && el.getAttribute('data-setting');
    if (!key) return;
    var value = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'target') {
      var n = Number(value);
      if (!(n >= 1 && n <= 100)) { ctxApi.toast('Target must be 1-100'); render(); return; }
      value = n;
    } else if (el.type === 'date') {
      if (!store.isIso(value)) { ctxApi.toast('Pick a full date'); render(); return; }
    }
    var next = Object.assign({}, state.settings);
    next[key] = value;
    update({ settings: next });
  }

  function onToggleDetails(e) {
    if (e.target.matches && e.target.matches('[data-details="settings"]')) state.settingsOpen = e.target.open;
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- public ----------

  function mount(el, api) {
    hostEl = el;
    ctxApi = api;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', function (e) {
      if (e.target.matches('[data-form="plan-save"]')) savePlan(e);
    });
    el.addEventListener('toggle', onToggleDetails, true);
    el.addEventListener('input', function (e) {
      if (e.target.id === 'plan-name') state.draftName = e.target.value;
    });
    root.addEventListener('resize', measure);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state && state.sheetOpen) update({ sheetOpen: false });
    });
  }

  function load(data, opts) {
    var session = store.loadSession(data);
    var settings = session.settings;
    if (opts && opts.fresh) {
      settings = Object.assign(store.defaultSettings(data), { target: settings.target });
      if (data.demo) settings.todayOverride = data.snapshotDate;
    }
    state = {
      data: data,
      settings: settings,
      plan: session.plan,
      planName: session.planName,
      plans: store.loadPlans(),
      selected: null,
      draftName: null,
      lastPanelDate: null,
      sheetOpen: false,
      settingsOpen: false
    };
    persist({ silent: true });
  }

  function unload() {
    state = null;
    if (hostEl) hostEl.innerHTML = '';
  }

  function show() {
    if (state) {
      state.selected = state.selected || settingsForEngine().today;
      render();
    }
  }

  VAP.planner = { mount: mount, load: load, unload: unload, show: show, hasData: function () { return !!state; } };
})(typeof self !== 'undefined' ? self : this);
