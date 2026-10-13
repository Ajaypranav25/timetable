/*
 * Attendance projection engine. Pure functions over parsed data, settings and a plan.
 *   settings: { today, snapshotDate, snapshotIncludesDay, lastTheory, lastLab, target }
 *   plan:     { days: [isoDate], classes: [classId] }   (classId = date|courseId@firstSlot)
 * One theory period = 1 class; one lab slot = 1 class (so L7+L8 counts 2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VAP = root.VAP || {}).engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var SAFE_PCT = 77;
  var MIN_PCT = 75;
  var VTOP_PASS_PCT = 74.01;
  var EPS = 1e-9;

  // ---------- dates (ISO strings, UTC math) ----------

  function parseIso(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  function toIso(d) {
    return d.toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    var d = parseIso(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toIso(d);
  }

  function weekday(iso) {
    return parseIso(iso).getUTCDay();
  }

  var ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var MAX_RANGE_DAYS = 400;

  function dateRange(from, to) {
    var out = [];
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) return out;
    for (var d = from; d <= to && out.length < MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
    return out;
  }

  function maxIso(a, b) {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  // ---------- schedule ----------

  function byStart(a, b) {
    return (a.start || '99').localeCompare(b.start || '99') || a.col - b.col;
  }

  function groupSessions(cells) {
    var sorted = cells.slice().sort(function (a, b) {
      return a.kind.localeCompare(b.kind) || a.col - b.col;
    });
    var sessions = [];
    sorted.forEach(function (cell) {
      var prev = sessions[sessions.length - 1];
      var joins = prev && cell.kind === 'lab' && prev.kind === 'lab' &&
        prev.courseId === cell.courseId && prev.lastCol + 1 === cell.col;
      if (joins) {
        prev.slots = prev.slots.concat([cell.slot]);
        prev.count += 1;
        prev.end = cell.end;
        prev.lastCol = cell.col;
        return;
      }
      sessions.push({
        sid: cell.courseId + '@' + cell.slot,
        courseId: cell.courseId,
        code: cell.code,
        kind: cell.kind,
        slots: [cell.slot],
        count: 1,
        start: cell.start,
        end: cell.end,
        venue: cell.venue,
        col: cell.col,
        lastCol: cell.col
      });
    });
    return sessions.sort(byStart);
  }

  var sessionCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function sessionsByWeekday(data) {
    var cached = sessionCache && sessionCache.get(data);
    if (cached) return cached;
    var table = DAY_NAMES.map(function (name) {
      return groupSessions(data.timetable.cells.filter(function (c) {
        return c.day === name && c.courseId;
      }));
    });
    if (sessionCache) sessionCache.set(data, table);
    return table;
  }

  function dayOrder(data, iso) {
    var day = data.calendar.days[iso];
    if (!day || day.type !== 'instructional') return null;
    var order = day.order;
    return Number.isInteger(order) && order >= 0 && order <= 6 ? order : weekday(iso);
  }

  function lastDateFor(kind, settings) {
    return kind === 'lab' ? settings.lastLab : settings.lastTheory;
  }

  function classesOn(data, settings, iso) {
    var order = dayOrder(data, iso);
    if (order == null) return [];
    return sessionsByWeekday(data)[order]
      .filter(function (s) {
        var last = lastDateFor(s.kind, settings);
        return !last || iso <= last;
      })
      .map(function (s) {
        return Object.assign({}, s, { id: iso + '|' + s.sid, date: iso });
      });
  }

  // ---------- window ----------

  function windowStart(settings) {
    return settings.snapshotIncludesDay ? addDays(settings.snapshotDate, 1) : settings.snapshotDate;
  }

  function windowEnd(settings) {
    return maxIso(settings.lastTheory, settings.lastLab);
  }

  function inWindow(settings, iso) {
    return iso >= windowStart(settings) && iso <= windowEnd(settings);
  }

  // ---------- plan helpers (immutable) ----------

  function emptyPlan() {
    return { days: [], classes: [] };
  }

  function isSkipped(plan, cls) {
    return plan.days.indexOf(cls.date) !== -1 || plan.classes.indexOf(cls.id) !== -1;
  }

  function withoutDate(ids, iso) {
    return ids.filter(function (id) { return id.indexOf(iso + '|') !== 0; });
  }

  /** isFull: whether every class that day is currently skipped (by day or one by one). */
  function toggleDay(plan, iso, isFull) {
    var skipped = isFull != null ? isFull : plan.days.indexOf(iso) !== -1;
    return {
      days: skipped ? plan.days.filter(function (d) { return d !== iso; })
        : plan.days.filter(function (d) { return d !== iso; }).concat([iso]).sort(),
      classes: withoutDate(plan.classes, iso)
    };
  }

  function toggleClass(plan, data, settings, iso, id) {
    var all = classesOn(data, settings, iso).map(function (c) { return c.id; });
    if (plan.days.indexOf(iso) !== -1) {
      return {
        days: plan.days.filter(function (d) { return d !== iso; }),
        classes: withoutDate(plan.classes, iso).concat(all.filter(function (x) { return x !== id; }))
      };
    }
    var has = plan.classes.indexOf(id) !== -1;
    var classes = has ? plan.classes.filter(function (x) { return x !== id; }) : plan.classes.concat([id]);
    var everyone = all.length > 0 && all.every(function (x) { return classes.indexOf(x) !== -1; });
    if (everyone) return { days: plan.days.concat([iso]).sort(), classes: withoutDate(classes, iso) };
    return { days: plan.days.slice(), classes: classes };
  }

  // ---------- projection ----------

  function minNeeded(pct, total) {
    return Math.ceil(pct / 100 * total - EPS);
  }

  function project(data, settings, plan) {
    var acc = {};
    data.courses.forEach(function (c) { acc[c.id] = { future: 0, skipped: 0, sessions: 0 }; });
    dateRange(windowStart(settings), windowEnd(settings)).forEach(function (iso) {
      classesOn(data, settings, iso).forEach(function (cls) {
        var a = acc[cls.courseId];
        if (!a) return;
        a.future += cls.count;
        a.sessions += 1;
        if (isSkipped(plan, cls)) a.skipped += cls.count;
      });
    });
    var target = settings.target || SAFE_PCT;
    var courses = data.courses.map(function (c) {
      var a = acc[c.id];
      var total = c.total + a.future;
      var attended = c.attended + a.future - a.skipped;
      var projectedPct = total ? attended / total * 100 : 100;
      var remaining = a.future - a.skipped;
      var currentPct = c.total ? c.attended / c.total * 100 : 100;
      return Object.assign({}, c, {
        currentPct: currentPct,
        currentStatus: status(currentPct),
        future: a.future,
        skipped: a.skipped,
        remaining: remaining,
        projectedAttended: attended,
        projectedTotal: total,
        projectedPct: projectedPct,
        canSkip75: attended - minNeeded(MIN_PCT, total),
        canSkipTarget: attended - minNeeded(target, total),
        sessionSize: c.kind === 'lab' ? Math.max(2, a.sessions ? Math.round(a.future / a.sessions) : 2) : 1,
        status: status(projectedPct),
        vtopPass: passesVtop(projectedPct)
      });
    });
    var lowest = courses.reduce(function (lo, c) {
      return !lo || c.projectedPct < lo.projectedPct ? c : lo;
    }, null);
    return { courses: courses, lowest: lowest, window: { start: windowStart(settings), end: windowEnd(settings) } };
  }

  function status(pct) {
    if (pct + EPS >= SAFE_PCT) return 'safe';
    if (pct + EPS >= MIN_PCT) return 'warn';
    return 'danger';
  }

  function passesVtop(pct) {
    return pct + EPS >= VTOP_PASS_PCT;
  }

  // ---------- day view + breaks ----------

  function dayInfo(data, settings, plan, iso) {
    var cal = data.calendar.days[iso] || { type: 'none', reason: '', order: null };
    var classes = inWindow(settings, iso) ? classesOn(data, settings, iso) : [];
    var marked = classes.map(function (cls) {
      return Object.assign({}, cls, { skipped: isSkipped(plan, cls) });
    });
    var skippedCount = marked.filter(function (c) { return c.skipped; }).length;
    return {
      date: iso,
      weekday: weekday(iso),
      type: cal.type,
      reason: cal.reason,
      order: cal.order,
      classes: marked,
      skippedCount: skippedCount,
      state: !marked.length ? 'none' : skippedCount === marked.length ? 'full' : skippedCount ? 'partial' : 'open'
    };
  }

  function breaks(data, settings, plan) {
    var start = windowStart(settings);
    var end = maxIso(windowEnd(settings), data.calendar.lastAnnotated);
    var runs = [];
    var run = null;
    dateRange(start, end).forEach(function (iso) {
      var info = dayInfo(data, settings, plan, iso);
      var off = info.type !== 'exam' && info.classes.every(function (c) { return c.skipped; });
      if (off) {
        if (!run) run = { start: iso, end: iso, length: 0, reasons: [] };
        run.end = iso;
        run.length += 1;
        var why = info.state === 'full' ? 'your skips' : info.type === 'holiday' || info.type === 'other' ? info.reason
          : info.weekday === 0 || info.weekday === 6 ? 'weekend' : '';
        if (why && run.reasons.indexOf(why) === -1) run.reasons.push(why);
      } else if (run) {
        runs.push(run);
        run = null;
      }
    });
    if (run) runs.push(run);
    return runs;
  }

  return {
    DAY_NAMES: DAY_NAMES,
    SAFE_PCT: SAFE_PCT,
    MIN_PCT: MIN_PCT,
    VTOP_PASS_PCT: VTOP_PASS_PCT,
    addDays: addDays,
    weekday: weekday,
    dateRange: dateRange,
    classesOn: classesOn,
    windowStart: windowStart,
    windowEnd: windowEnd,
    inWindow: inWindow,
    emptyPlan: emptyPlan,
    isSkipped: isSkipped,
    toggleDay: toggleDay,
    toggleClass: toggleClass,
    project: project,
    status: status,
    passesVtop: passesVtop,
    dayInfo: dayInfo,
    breaks: breaks
  };
});
