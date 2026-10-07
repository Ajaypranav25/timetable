/*
 * localStorage wrapper (every access guarded) + app state persistence.
 * Writes to the synced keys notify onChange listeners (the cloud sync).
 */
(function (root) {
  'use strict';
  var PREFIX = 'skipexe:';
  var KEYS = { data: 'data', raw: 'raw', session: 'session', plans: 'plans', meta: 'meta' };
  // Keys that make up the plan synced to the cloud; writing one stamps the local copy.
  var SYNCED = [KEYS.data, KEYS.session, KEYS.plans];
  var listeners = [];

  function read(key, fallback) {
    try {
      var v = root.localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function rawWrite(key, json) {
    try {
      root.localStorage.setItem(PREFIX + key, json);
      return true;
    } catch (e) {
      return false;
    }
  }

  function rawRead(key) {
    try {
      return root.localStorage.getItem(PREFIX + key);
    } catch (e) {
      return null;
    }
  }

  /**
   * opts.silent: store without marking the copy as edited (used when loading or applying a cloud copy).
   * Re-saving an identical value is not an edit either, so browsing the planner never looks like a change.
   */
  function write(key, value, opts) {
    var json;
    try {
      json = JSON.stringify(value);
    } catch (e) {
      return false;
    }
    var tracked = SYNCED.indexOf(key) !== -1 && !(opts && opts.silent);
    var changed = tracked && rawRead(key) !== json;
    var ok = rawWrite(key, json);
    if (ok && changed) {
      setMeta({ dirty: true, rev: meta().rev + 1 });
      listeners.forEach(function (fn) { fn(key); });
    }
    return ok;
  }

  /**
   * Sync bookkeeping for the browser copy:
   *   base:  the cloud row version (updated_at string) this copy was last synced with, or null
   *   dirty: edited since that sync;  rev: counts edits (a push only clears dirty if none happened meanwhile)
   *   owner: user id this copy belongs to (null = made while signed out)
   */
  function meta() {
    var m = read(KEYS.meta, {}) || {};
    return {
      base: typeof m.base === 'string' && m.base.length <= 64 ? m.base : null,
      dirty: m.dirty === true,
      rev: Number.isInteger(m.rev) && m.rev >= 0 ? m.rev : 0,
      owner: typeof m.owner === 'string' && m.owner ? m.owner : null
    };
  }

  function setMeta(patch) {
    return rawWrite(KEYS.meta, JSON.stringify(Object.assign(meta(), patch)));
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function clearAll() {
    Object.keys(KEYS).forEach(function (k) { remove(KEYS[k]); });
  }

  function remove(key) {
    try {
      root.localStorage.removeItem(PREFIX + key);
    } catch (e) { /* storage unavailable: nothing to remove */ }
  }

  function localToday() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  var ISO_DATE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var ISO_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
  var SLOT = /^[A-Z]{1,4}\d{1,3}$/;
  var TIME = /^\d{1,2}:\d{2}$/;
  var DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var DAY_TYPES = ['instructional', 'holiday', 'exam', 'other', 'none'];
  var MAX_COURSES = 60;
  var MAX_CELLS = 400;
  var MAX_COUNT = 9999;
  var MAX_PLANS = 50;
  var MAX_PLAN_NAME = 30;
  var RESERVED_NAMES = ['__proto__', 'constructor', 'prototype'];

  function isIso(v) {
    return typeof v === 'string' && ISO_DATE.test(v);
  }

  function str(v, max) {
    return typeof v === 'string' ? v.slice(0, max || 200) : '';
  }

  function count(v) {
    var n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= MAX_COUNT ? n : null;
  }

  function isoOrNull(v) {
    return isIso(v) ? v : null;
  }

  function normCourse(c) {
    if (!c || typeof c !== 'object') return null;
    var attended = count(c.attended);
    var total = count(c.total);
    var id = str(c.id, 40);
    if (!id || attended == null || total == null) return null;
    return {
      id: id,
      code: str(c.code, 20),
      name: str(c.name, 160) || str(c.code, 20),
      type: str(c.type, 40),
      kind: c.kind === 'lab' ? 'lab' : 'theory',
      classId: str(c.classId, 40),
      slots: Array.isArray(c.slots) ? c.slots.filter(function (s) { return typeof s === 'string' && SLOT.test(s); }) : [],
      venue: str(c.venue, 40),
      faculty: str(c.faculty, 120),
      attended: attended,
      total: total
    };
  }

  function normCell(c) {
    if (!c || typeof c !== 'object' || DAY_NAMES.indexOf(c.day) === -1 || typeof c.slot !== 'string' || !SLOT.test(c.slot)) return null;
    var col = count(c.col);
    if (col == null) return null;
    return {
      day: c.day,
      kind: c.kind === 'lab' ? 'lab' : 'theory',
      col: col,
      slot: c.slot,
      code: str(c.code, 20),
      type: str(c.type, 10),
      venue: str(c.venue, 40),
      group: str(c.group, 20),
      start: typeof c.start === 'string' && TIME.test(c.start) ? c.start : null,
      end: typeof c.end === 'string' && TIME.test(c.end) ? c.end : null,
      courseId: typeof c.courseId === 'string' ? c.courseId.slice(0, 40) : null
    };
  }

  function normDay(d) {
    var order = Number.isInteger(d && d.order) && d.order >= 0 && d.order <= 6 ? d.order : null;
    return {
      type: DAY_TYPES.indexOf(d && d.type) !== -1 ? d.type : 'none',
      reason: str(d && d.reason, 120),
      order: order,
      lastTheory: !!(d && d.lastTheory),
      lastLab: !!(d && d.lastLab)
    };
  }

  /** Rebuilds untrusted data (import, localStorage) field by field. Returns null if unusable. */
  function normalizeData(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.courses) || !d.timetable || !d.calendar) return null;
    var courses = d.courses.slice(0, MAX_COURSES).map(normCourse).filter(Boolean);
    var cells = Array.isArray(d.timetable.cells) ? d.timetable.cells.slice(0, MAX_CELLS).map(normCell).filter(Boolean) : [];
    var rawDays = d.calendar.days && typeof d.calendar.days === 'object' ? d.calendar.days : {};
    var days = {};
    Object.keys(rawDays).forEach(function (k) {
      if (isIso(k)) days[k] = normDay(rawDays[k]);
    });
    var cal = d.calendar;
    var months = Array.isArray(cal.months) ? cal.months.filter(function (m) { return typeof m === 'string' && ISO_MONTH.test(m); }) : [];
    if (!courses.length || !cells.length || !months.length) return null;
    return {
      version: 1,
      demo: d.demo === true,
      semester: str(d.semester, 80),
      snapshotDate: isoOrNull(d.snapshotDate),
      courses: courses,
      timetable: { cells: cells },
      calendar: {
        months: months.sort(),
        days: days,
        lastTheory: isoOrNull(cal.lastTheory),
        lastLab: isoOrNull(cal.lastLab),
        lastInstructional: isoOrNull(cal.lastInstructional),
        lastAnnotated: isoOrNull(cal.lastAnnotated)
      },
      warnings: Array.isArray(d.warnings) ? d.warnings.filter(function (w) { return typeof w === 'string'; }).slice(0, 30).map(function (w) { return w.slice(0, 300); }) : []
    };
  }

  function cleanPlan(p) {
    var strings = function (arr) {
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }) : [];
    };
    return { days: strings(p && p.days).filter(isIso), classes: strings(p && p.classes) };
  }

  function defaultSettings(data) {
    var cal = (data && data.calendar) || {};
    var lastTheory = cal.lastTheory || cal.lastInstructional || null;
    return {
      todayOverride: null,
      snapshotDate: (data && data.snapshotDate) || localToday(),
      snapshotIncludesDay: false,
      lastTheory: lastTheory,
      lastLab: cal.lastLab || lastTheory,
      target: 77
    };
  }

  function cleanSettings(s, data) {
    var base = defaultSettings(data);
    s = s || {};
    var target = Number(s.target);
    return {
      todayOverride: isIso(s.todayOverride) ? s.todayOverride : null,
      snapshotDate: isIso(s.snapshotDate) ? s.snapshotDate : base.snapshotDate,
      snapshotIncludesDay: !!s.snapshotIncludesDay,
      lastTheory: isIso(s.lastTheory) ? s.lastTheory : base.lastTheory,
      lastLab: isIso(s.lastLab) ? s.lastLab : base.lastLab,
      target: target >= 1 && target <= 100 ? target : base.target
    };
  }

  /** Settings shaped for the engine (resolves "today"). */
  function engineSettings(s) {
    return Object.assign({}, s, { today: s.todayOverride || localToday() });
  }

  function cleanSession(s, data) {
    s = s && typeof s === 'object' ? s : {};
    return {
      plan: cleanPlan(s.plan),
      settings: cleanSettings(s.settings, data),
      planName: typeof s.planName === 'string' ? s.planName.slice(0, MAX_PLAN_NAME) : ''
    };
  }

  function loadSession(data) {
    return cleanSession(read(KEYS.session, {}), data);
  }

  function saveSession(session, opts) {
    return write(KEYS.session, session, opts);
  }

  function cleanPlans(p) {
    var out = {};
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      Object.keys(p).filter(function (name) {
        return name.length <= MAX_PLAN_NAME && RESERVED_NAMES.indexOf(name) === -1;
      }).slice(0, MAX_PLANS).forEach(function (name) { out[name] = cleanPlan(p[name]); });
    }
    return out;
  }

  function loadPlans() {
    return cleanPlans(read(KEYS.plans, {}));
  }

  function savePlans(plans) {
    return write(KEYS.plans, plans);
  }

  root.VAP = root.VAP || {};
  root.VAP.store = {
    KEYS: KEYS,
    read: read,
    write: write,
    remove: remove,
    clearAll: clearAll,
    meta: meta,
    setMeta: setMeta,
    onChange: onChange,
    localToday: localToday,
    isIso: isIso,
    normalizeData: normalizeData,
    defaultSettings: defaultSettings,
    cleanSettings: cleanSettings,
    engineSettings: engineSettings,
    loadSession: loadSession,
    cleanSession: cleanSession,
    saveSession: saveSession,
    loadPlans: loadPlans,
    cleanPlans: cleanPlans,
    savePlans: savePlans
  };
})(typeof self !== 'undefined' ? self : this);
