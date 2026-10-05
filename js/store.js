/*
 * localStorage wrapper (every access guarded) + app state persistence.
 */
(function (root) {
  'use strict';
  var PREFIX = 'skipexe:';
  var KEYS = { data: 'data', raw: 'raw', session: 'session', plans: 'plans' };

  function read(key, fallback) {
    try {
      var v = root.localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      root.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
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
    if (!c || typeof c !== 'object' || DAY_NAMES.indexOf(c.day) === -1 || !SLOT.test(c.slot || '')) return null;
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
      start: TIME.test(c.start || '') ? c.start : null,
      end: TIME.test(c.end || '') ? c.end : null,
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

  function loadSession(data) {
    var s = read(KEYS.session, {});
    return {
      plan: cleanPlan(s.plan),
      settings: cleanSettings(s.settings, data),
      planName: typeof s.planName === 'string' ? s.planName : ''
    };
  }

  function saveSession(session) {
    return write(KEYS.session, session);
  }

  function loadPlans() {
    var p = read(KEYS.plans, {});
    var out = {};
    if (p && typeof p === 'object') {
      Object.keys(p).forEach(function (name) { out[name] = cleanPlan(p[name]); });
    }
    return out;
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
    localToday: localToday,
    isIso: isIso,
    normalizeData: normalizeData,
    defaultSettings: defaultSettings,
    cleanSettings: cleanSettings,
    engineSettings: engineSettings,
    loadSession: loadSession,
    saveSession: saveSession,
    loadPlans: loadPlans,
    savePlans: savePlans
  };
})(typeof self !== 'undefined' ? self : this);
