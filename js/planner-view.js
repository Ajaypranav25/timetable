/*
 * Planner HTML builders. Pure: (state) -> HTML string. Every user-derived string goes through esc().
 */
(function (root) {
  'use strict';
  var VAP = root.VAP;
  var engine = VAP.engine;
  var esc = VAP.setup.esc;
  var fmtDate = VAP.setup.fmtDate;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SMALL_WORDS = ['and', 'of', 'using', 'for', 'the', 'in', 'to', 'with', 'level', 'i', 'ii', 'iii', 'iv'];
  var METER_MIN = 50;
  var MIN_BREAK_DAYS = 3;

  function pct(n) {
    return (Math.round(n * 10) / 10).toFixed(1) + '%';
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 'es');
  }

  function shortName(course) {
    var words = String(course.name || '').split(/\s+/).filter(function (w) {
      return w && SMALL_WORDS.indexOf(w.toLowerCase()) === -1;
    });
    if (words.length >= 2) return words.slice(0, 4).map(function (w) { return w[0].toUpperCase(); }).join('');
    return (words[0] || course.code).slice(0, 8);
  }

  function shortDate(iso) {
    var p = iso.split('-');
    return MONTHS[+p[1] - 1].slice(0, 3).toUpperCase() + ' ' + +p[2];
  }

  function longDate(iso) {
    var p = iso.split('-');
    return DOW[engine.weekday(iso)].toUpperCase() + ' ' + +p[2] + ' ' + MONTHS[+p[1] - 1].slice(0, 3).toUpperCase();
  }

  function kindTag(kind) {
    var lab = kind === 'lab';
    return '<span class="kind kind-' + (lab ? 'lab' : 'theory') + '">' + (lab ? 'LAB' : 'TH') + '</span>';
  }

  function meterPos(p) {
    return Math.max(0, Math.min(100, (p - METER_MIN) / (100 - METER_MIN) * 100));
  }

  function meter(c, target, big) {
    return '<div class="meter' + (big ? ' meter-lg' : '') + '" title="Scale ' + METER_MIN + '-100%. White mark = 75%, blue = target.">' +
      '<div class="meter-fill st-' + c.status + '" style="width:' + meterPos(c.projectedPct).toFixed(1) + '%"></div>' +
      '<div class="meter-mark" style="left:' + meterPos(engine.MIN_PCT) + '%"></div>' +
      (target !== engine.MIN_PCT ? '<div class="meter-mark target" style="left:' + meterPos(target) + '%"></div>' : '') +
      '</div>';
  }

  // ---------- summary strip ----------

  function strip(result, target) {
    return '<div class="strip" id="strip" role="list" aria-label="Projected final attendance">' + result.courses.map(function (c) {
      var low = result.lowest && result.lowest.id === c.id;
      return '<button type="button" role="listitem" class="pill' + (low ? ' is-lowest' : '') + '" data-act="pill" data-course="' + esc(c.id) + '" ' +
        'aria-label="' + esc(c.name + ' ' + c.kind + ': ' + pct(c.projectedPct)) + '">' +
        (low ? '<span class="lowest-tag">LOWEST</span>' : '') +
        '<span class="pill-top"><span class="pill-code">' + esc(shortName(c)) + '</span>' + kindTag(c.kind) + '</span>' +
        '<span class="pill-pct st-' + c.status + '">' + pct(c.projectedPct) + '</span>' +
        meter(c, target, false) +
        '</button>';
    }).join('') + '</div>';
  }

  // ---------- calendar ----------

  function monthsToShow(data, settings) {
    var from = engine.windowStart(settings).slice(0, 7);
    var last = [engine.windowEnd(settings), data.calendar.lastAnnotated].filter(Boolean).sort().pop();
    var to = (last || from).slice(0, 7);
    return (data.calendar.months || []).filter(function (m) { return m >= from && m <= to; });
  }

  function dayCell(data, settings, plan, iso, ctx) {
    var info = engine.dayInfo(data, settings, plan, iso);
    var cls = ['day'];
    var sub = '';
    var orderTag = '';
    var count = '';
    var interactive = info.classes.length > 0;
    var past = iso < ctx.today && iso >= ctx.start;
    if (iso === ctx.today) cls.push('is-today');
    if (iso === ctx.selected) cls.push('is-sel');
    if (iso < ctx.start) cls.push('is-out');
    if (past) cls.push('is-past');
    if (info.type === 'holiday') { cls.push('is-off', 'is-holiday'); sub = info.reason || 'Holiday'; }
    else if (info.type === 'exam') { cls.push('is-exam'); sub = info.reason; }
    else if (info.type === 'other') { cls.push('is-off'); sub = info.reason; }
    else if (info.type === 'instructional') {
      if (info.order != null && info.order !== info.weekday) orderTag = DOW[info.weekday] + ' · ' + DOW[info.order] + ' order';
      if (!interactive) {
        cls.push('is-off');
        sub = iso > ctx.end ? 'after last day' : iso < ctx.start ? 'already counted' : 'no classes';
      }
    } else cls.push('is-off');

    if (interactive) {
      var total = info.classes.reduce(function (s, c) { return s + c.count; }, 0);
      var skipped = info.classes.reduce(function (s, c) { return s + (c.skipped ? c.count : 0); }, 0);
      if (info.state === 'full') cls.push('is-skip');
      else if (info.state === 'partial') cls.push('is-partial');
      else cls.push('is-open');
      count = info.state === 'partial' ? skipped + '/' + total + ' off' : total + ' cls';
      if (past) sub = info.state === 'open' ? 'past · tap if missed' : 'missed';
      else if (info.reason) sub = info.reason;
    }

    var label = longDate(iso) + (sub ? ', ' + sub : '') + (orderTag ? ', ' + orderTag : '') +
      (interactive ? (info.state === 'full' ? ', skipped' : info.state === 'partial' ? ', partly skipped' : ', ' + count) : '');
    var body = '<span class="dnum">' + +iso.slice(8) + '</span>' +
      (orderTag ? '<span class="dorder"><span class="o-long">' + DOW[info.weekday] + ' · </span><span class="o-short">&rarr;</span>' + DOW[info.order] + '<span class="o-long"> order</span></span>' : '') +
      (sub ? '<span class="dsub">' + esc(sub) + '</span>' : '') +
      (count ? '<span class="dcount">' + esc(count) + '</span>' : '');
    if (!interactive) {
      var canInspect = info.type !== 'none';
      return '<div class="' + cls.join(' ') + '">' +
        (canInspect ? '<button type="button" class="day-main" data-act="day-open" data-date="' + esc(iso) + '" aria-label="' + esc(label) + '">' + body + '</button>'
          : '<div class="day-main" aria-label="' + esc(label) + '">' + body + '</div>') + '</div>';
    }
    return '<div class="' + cls.join(' ') + '">' +
      '<button type="button" class="day-main" data-act="day-toggle" data-date="' + esc(iso) + '" aria-pressed="' + (info.state === 'full') + '" aria-label="' + esc(label + '. Toggle whole day') + '">' + body + '</button>' +
      '<button type="button" class="day-expand" data-act="day-open" data-date="' + esc(iso) + '" aria-label="' + esc('Pick single classes on ' + longDate(iso)) + '">&#8942;</button>' +
      '</div>';
  }

  function calendar(data, settings, plan, ctx) {
    var months = monthsToShow(data, settings);
    if (!months.length) return '<div class="card"><p class="empty">No calendar months after your attendance date. Paste the remaining months on the Setup page.</p></div>';
    return months.map(function (ym) {
      var y = +ym.slice(0, 4);
      var m = +ym.slice(5, 7);
      var first = ym + '-01';
      var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var lead = engine.weekday(first);
      var cells = [];
      for (var i = 0; i < lead; i++) cells.push('<div class="day is-blank" aria-hidden="true"></div>');
      for (var d = 1; d <= dim; d++) cells.push(dayCell(data, settings, plan, ym + '-' + (d < 10 ? '0' : '') + d, ctx));
      return '<section class="card month" aria-label="' + MONTHS[m - 1] + ' ' + y + '">' +
        '<h2>' + MONTHS[m - 1].toUpperCase() + ' ' + y + '<small>tap = skip day · &#8942; = single classes</small></h2>' +
        '<div class="grid7">' + DOW.map(function (w) { return '<div class="dow" aria-hidden="true">' + w + '</div>'; }).join('') + cells.join('') + '</div>' +
        '</section>';
    }).join('');
  }

  function legend() {
    return '<ul class="legend" aria-label="Legend">' +
      '<li><i class="lg-open"></i>has classes</li><li><i class="lg-skip"></i>skipped</li><li><i class="lg-part"></i>some skipped</li>' +
      '<li><i class="lg-off"></i>holiday / no class</li><li><i class="lg-exam"></i>exam</li></ul>';
  }

  // ---------- side panel ----------

  function panel(data, settings, plan, result, ctx) {
    var close = '<button type="button" class="btn btn-ghost btn-sm panel-close" data-act="panel-close">CLOSE</button>';
    if (!ctx.selected) {
      return '<div class="panel-head"><div><h2>PICK A DAY</h2><p>Tap a date to skip the whole day. Tap &#8942; on a date to skip single classes, like just the morning lab.</p></div>' + close + '</div>';
    }
    var info = engine.dayInfo(data, settings, plan, ctx.selected);
    var byId = {};
    result.courses.forEach(function (c) { byId[c.id] = c; });
    var subtitle = info.type === 'holiday' ? 'Holiday: ' + (info.reason || '') :
      info.type === 'exam' ? info.reason :
      info.type === 'instructional' ? 'Instructional day' + (info.order != null && info.order !== info.weekday ? ' · follows ' + DOW[info.order] + ' timetable' : '') :
      info.reason || 'No classes';
    if (ctx.selected < ctx.today && ctx.selected >= ctx.start) subtitle += ' · past day: mark what you missed';
    var head = '<div class="panel-head"><div><h2>' + longDate(ctx.selected) + '</h2><p>' + esc(subtitle) + '</p></div>' + close + '</div>';
    if (!info.classes.length) return head + '<p class="empty">Nothing to skip on this day.</p>';
    var full = info.state === 'full';
    var list = info.classes.map(function (cls) {
      var c = byId[cls.courseId];
      return '<li class="cls' + (cls.skipped ? ' is-skipped' : '') + '">' +
        '<span class="cls-time">' + esc((cls.start || '?') + '-' + (cls.end || '?')) + '</span>' +
        '<span class="cls-name">' + esc(c ? c.name : cls.code) + '</span>' +
        '<span class="cls-meta">' + kindTag(cls.kind) + esc(cls.slots.join('+')) + ' · ' + esc(cls.venue) +
          (cls.count > 1 ? ' · counts ' + cls.count : '') +
          (c ? ' · <b class="st-' + c.status + '">' + pct(c.projectedPct) + '</b>' : '') + '</span>' +
        '<button type="button" class="btn btn-sm ' + (cls.skipped ? 'btn-lime' : 'btn-ghost') + '" data-act="cls" data-date="' + esc(info.date) + '" data-id="' + esc(cls.id) + '" aria-pressed="' + cls.skipped + '">' +
          (cls.skipped ? 'UNDO' : 'SKIP') + '</button>' +
        '</li>';
    }).join('');
    return head +
      '<button type="button" class="btn ' + (full ? 'btn-lime' : 'btn-danger') + '" data-act="day-toggle" data-date="' + esc(info.date) + '">' +
        (full ? 'UNSKIP WHOLE DAY' : 'SKIP WHOLE DAY') + '</button>' +
      '<ul class="cls-list">' + list + '</ul>';
  }

  // ---------- courses ----------

  function budgetLine(n, c, label) {
    if (n < 0) {
      var need = -n;
      if (c.skipped >= need) return '<p>&ge;' + label + ': <b class="st-danger">' + need + ' over</b>. Attend ' + plural(need, 'class') + ' you marked as skipped.</p>';
      return '<p>&ge;' + label + ': <b class="st-danger">out of reach</b>, even if you attend everything left.</p>';
    }
    if (c.remaining === 0) return '<p>&ge;' + label + ': <b class="st-safe">safe</b>, no classes left to skip.</p>';
    var k = Math.min(n, c.remaining);
    var sessions = c.kind === 'lab' ? ' (' + Math.floor(k / c.sessionSize) + ' lab session' + (Math.floor(k / c.sessionSize) === 1 ? '' : 's') + ', each costs ' + c.sessionSize + ')' : '';
    var all = k === c.remaining && n > c.remaining ? ', which is every class left' : '';
    return '<p>&ge;' + label + ': can skip <b class="' + (k ? 'st-safe' : 'st-warn') + '">' + k + '</b> more ' + (k === 1 ? 'class' : 'classes') + sessions + all + '.</p>';
  }

  function courses(result, target) {
    return result.courses.map(function (c) {
      var low = result.lowest && result.lowest.id === c.id;
      var note = c.status === 'danger'
        ? (c.vtopPass ? 'Below 75%, though VTOP passes 74.01%+. Plan around 75%.' : 'Below VTOP\'s 74.01% pass mark: debar risk.')
        : c.status === 'warn' ? 'Safe, but inside the 75-77% warning band.' : '';
      return '<article class="card course' + (low ? ' is-lowest' : '') + '" id="course-' + esc(c.id) + '">' +
        '<div class="course-top"><div><h3>' + esc(c.name) + ' ' + kindTag(c.kind) + '</h3>' +
          '<div class="course-sub">' + esc(c.code + ' · ' + c.type + ' · ' + c.slots.join('+') + ' · ' + c.faculty) + '</div></div>' +
          '<div class="course-pct st-' + c.status + '">' + pct(c.projectedPct) + '<small>' + (low ? 'LOWEST · FINAL' : 'FINAL') + '</small></div></div>' +
        meter(c, target, true) +
        '<dl class="stats">' +
          '<div><dt>NOW</dt><dd>' + Number(c.attended) + '/' + Number(c.total) + '</dd></div>' +
          '<div><dt>AHEAD</dt><dd>+' + c.future + '</dd></div>' +
          '<div><dt>SKIPPED</dt><dd>' + (c.skipped ? '&minus;' + c.skipped : '0') + '</dd></div>' +
          '<div><dt>FINAL</dt><dd>' + Number(c.projectedAttended) + '/' + Number(c.projectedTotal) + '</dd></div>' +
        '</dl>' +
        '<div class="budget">' + budgetLine(c.canSkip75, c, '75%') + (target !== engine.MIN_PCT ? budgetLine(c.canSkipTarget, c, target + '%') : '') + '</div>' +
        (note ? '<p class="vtop-note">' + note + '</p>' : '') +
        '</article>';
    }).join('');
  }

  // ---------- breaks + plans ----------

  function longestBreak(list) {
    return list.reduce(function (best, b) { return !best || b.length > best.length ? b : best; }, null);
  }

  function breaks(list) {
    var shown = list.filter(function (b) { return b.length >= MIN_BREAK_DAYS; });
    if (!shown.length) return '<p class="empty">No breaks of ' + MIN_BREAK_DAYS + '+ days yet. Skip a Friday or Monday next to a weekend.</p>';
    var best = longestBreak(shown);
    return '<ul class="break-list">' + shown.map(function (b) {
      return '<li class="' + (b === best ? 'is-longest' : '') + '">' +
        '<span class="break-range">' + shortDate(b.start) + (b.start !== b.end ? ' &ndash; ' + shortDate(b.end) : '') + '</span>' +
        '<span class="break-len">' + b.length + ' days off' + (b === best ? ' &#9733;' : '') + '</span>' +
        (b.reasons.length ? '<span class="break-why">' + esc(b.reasons.join(', ')) + '</span>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }

  function compare(rows) {
    return '<div class="table-scroll"><table class="compare"><thead><tr><th scope="col">PLAN</th><th scope="col">LOWEST</th><th scope="col">DAYS</th><th scope="col">CLASSES</th><th scope="col">LONGEST BREAK</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var low = r.result.lowest;
        var best = longestBreak(r.breaks);
        var skippedClasses = r.result.courses.reduce(function (s, c) { return s + c.skipped; }, 0);
        return '<tr class="' + (r.current ? 'is-current' : '') + '"><td>' + esc(r.name) + (r.current ? ' <small>(on screen)</small>' : '') + '</td>' +
          '<td>' + (low ? esc(shortName(low)) + ' ' + kindTag(low.kind) + ' <b class="st-' + low.status + '">' + pct(low.projectedPct) + '</b>' : '-') + '</td>' +
          '<td>' + r.plan.days.length + '</td><td>' + skippedClasses + '</td>' +
          '<td>' + (best ? best.length + 'd' : '-') + '</td>' +
          '<td>' + (r.current ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-act="plan-load" data-name="' + esc(r.name) + '">LOAD</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  VAP.plannerView = {
    pct: pct,
    shortName: shortName,
    longDate: longDate,
    fmtDate: fmtDate,
    strip: strip,
    calendar: calendar,
    legend: legend,
    panel: panel,
    courses: courses,
    breaks: breaks,
    compare: compare
  };
})(typeof self !== 'undefined' ? self : this);
