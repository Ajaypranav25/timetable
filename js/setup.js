/*
 * Setup view: paste boxes with live parsing + preview, build/import/demo.
 */
(function (root) {
  'use strict';
  var VAP = root.VAP;
  var parser = VAP.parser;
  var store = VAP.store;
  var PARSE_DELAY_MS = 250;

  var STEPS = [
    {
      key: 'attendance',
      title: 'ATTENDANCE',
      crumbs: ['VTOP', 'Academics', 'Class Attendance', 'choose semester', 'View'],
      from: 'the table header <code>Sl.No. Class Group Course Detail ...</code>',
      to: 'the end of the last course row, e.g. <code>... 26 31 84% -</code>',
      note: 'Each row needs the course code, the slot (like A2+TA2 or L7+L8), the faculty, and the attended and total counts.',
      placeholder: '1  General (Semester)  BACSE102 - Problem Solving using Java - Lab Only  VL2026270103224 - L7+L8+L29+L30 - PRP353  VIVEK D - SCOPE  34  42  81%  -'
    },
    {
      key: 'timetable',
      title: 'TIME TABLE',
      crumbs: ['VTOP', 'Academics', 'Time Table', 'choose semester'],
      from: 'the grid header <code>THEORY Start 08:00 09:00 ...</code> (under the course list)',
      to: 'the last grid row, Sunday lab: <code>LAB L83 L84 ... L94 -</code>',
      note: 'Only your registered cells are used, the ones that look like A2-BACSE202-ETH-PRP472-ALL. Keep both the THEORY and LAB time rows; labs run on different times.',
      placeholder: 'THEORY  Start  08:00  09:00  10:00 ...\nEnd  08:50  09:50 ...\nLAB  Start  08:00  08:51 ...\nMON  THEORY  A1  F1  D1 ...'
    },
    {
      key: 'calendar',
      title: 'ACADEMIC CALENDAR',
      crumbs: ['VTOP', 'Academics', 'Academic Calendar', 'Class Group: General (Semester)', 'pick a month'],
      from: 'the month heading, e.g. <code>OCTOBER 2026</code>',
      to: 'the last date of that month, e.g. <code>31Instructional Day(...)</code>',
      note: 'Do this for every month you still have classes in and paste them one after another in this box (October, then November...). Include the month that says "Last instructional day for theory classes".',
      placeholder: 'OCTOBER 2026\nSunday  Monday  Tuesday ...\n1CAT - II(Exam Day)\n2Holiday(Gandhi Jayanthi)\n...\nNOVEMBER 2026\n...'
    }
  ];

  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return '?';
    var p = iso.split('-');
    return +p[2] + ' ' + MONTH_SHORT[+p[1] - 1] + ' ' + p[0];
  }

  function stepHtml(step, i) {
    var crumbs = step.crumbs.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    return '' +
      '<section class="card scrape" aria-labelledby="h-' + step.key + '">' +
        '<div class="scrape-head"><span class="scrape-n">' + (i + 1) + '</span><h2 id="h-' + step.key + '">' + step.title + '</h2></div>' +
        '<ol class="crumbs" aria-label="Where to find it">' + crumbs + '</ol>' +
        '<div class="fromto">' +
          '<div class="marker from"><b>START COPYING AT</b>' + step.from + '</div>' +
          '<div class="marker to"><b>STOP AT</b>' + step.to + '</div>' +
        '</div>' +
        '<p class="scrape-note">' + esc(step.note) + '</p>' +
        '<label class="sr-only" for="ta-' + step.key + '">Paste ' + step.title.toLowerCase() + ' here</label>' +
        '<textarea id="ta-' + step.key + '" data-key="' + step.key + '" spellcheck="false" autocomplete="off" placeholder="' + esc(step.placeholder) + '"></textarea>' +
        '<div class="parse-line idle" id="st-' + step.key + '" role="status" aria-live="polite">Waiting for a paste.</div>' +
        '<div id="pv-' + step.key + '"></div>' +
      '</section>';
  }

  function table(headers, rows) {
    return '<div class="table-scroll"><table><thead><tr>' +
      headers.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function preview(label, html) {
    return '<details class="preview"><summary>Preview what I read (' + esc(label) + ')</summary>' + html + '</details>';
  }

  function summarize(key, text) {
    if (!text.trim()) return { cls: 'idle', msg: 'Waiting for a paste.', preview: '' };
    if (key === 'attendance') {
      var a = parser.parseAttendance(text);
      if (a.errors.length && !a.courses.length) return { cls: 'bad', msg: a.errors.join(' '), preview: '' };
      var labs = a.courses.filter(function (c) { return c.kind === 'lab'; }).length;
      return {
        cls: a.errors.length ? 'bad' : 'ok',
        msg: (a.errors.length ? '! ' + a.errors.join(' ') + ' ' : '✓ ') + a.courses.length + ' courses: ' + (a.courses.length - labs) + ' theory, ' + labs + ' lab.',
        preview: preview(a.courses.length + ' rows', table(['Code', 'Course', 'Type', 'Slots', 'Att/Total'], a.courses.map(function (c) {
          return [c.code, c.name, c.type, c.slots.join('+'), c.attended + '/' + c.total];
        })))
      };
    }
    if (key === 'timetable') {
      var t = parser.parseTimetable(text);
      if (t.errors.length) return { cls: 'bad', msg: t.errors.join(' '), preview: '' };
      var days = t.cells.map(function (c) { return c.day; }).filter(function (d, i, arr) { return arr.indexOf(d) === i; });
      var untimed = t.cells.filter(function (c) { return !c.start; }).length;
      return {
        cls: untimed ? 'bad' : 'ok',
        msg: '✓ ' + t.cells.length + ' registered slots on ' + days.join(', ') + '.' + (untimed ? ' ! ' + untimed + ' have no time; check that both time header rows were copied.' : ''),
        preview: preview(t.cells.length + ' slots', table(['Day', 'Slot', 'Course', 'Time', 'Venue'], t.cells.map(function (c) {
          return [c.day, c.slot, c.code + ' ' + c.type, (c.start || '?') + '-' + (c.end || '?'), c.venue];
        })))
      };
    }
    var cal = parser.parseCalendar(text);
    if (cal.errors.length) return { cls: 'bad', msg: cal.errors.join(' '), preview: '' };
    var special = Object.keys(cal.days).sort().filter(function (d) {
      var x = cal.days[d];
      return x.type === 'holiday' || x.type === 'exam' || x.type === 'other' || x.order != null || x.lastTheory || x.lastLab;
    });
    var count = Object.keys(cal.days).filter(function (d) { return cal.days[d].type === 'instructional'; }).length;
    return {
      cls: 'ok',
      msg: '✓ ' + cal.months.length + ' month(s), ' + count + ' instructional days. Last theory day: ' +
        (cal.lastTheory ? fmtDate(cal.lastTheory) : 'not marked (using ' + fmtDate(cal.lastInstructional) + ')') + '.',
      preview: preview(special.length + ' special days', table(['Date', 'Type', 'Detail'], special.map(function (d) {
        var x = cal.days[d];
        var detail = x.order != null ? parser.DAY_NAMES[x.order] + ' day order' : x.reason;
        if (x.lastTheory) detail = (detail ? detail + '; ' : '') + 'last theory day';
        if (x.lastLab) detail = (detail ? detail + '; ' : '') + 'last lab day';
        return [fmtDate(d), x.type, detail];
      })))
    };
  }

  function init(ctx) {
    var host = document.getElementById('setup-steps');
    host.innerHTML = STEPS.map(stepHtml).join('');
    var areas = {};
    var timers = {};
    var raw = store.read(store.KEYS.raw, {}) || {};
    var snap = document.getElementById('snapshot-date');
    snap.value = store.isIso(raw.snapshotDate) ? raw.snapshotDate : store.localToday();

    function persistRaw() {
      store.write(store.KEYS.raw, {
        attendance: areas.attendance.value,
        timetable: areas.timetable.value,
        calendar: areas.calendar.value,
        snapshotDate: snap.value
      });
    }

    function refresh(key) {
      var s = summarize(key, areas[key].value);
      var line = document.getElementById('st-' + key);
      line.className = 'parse-line ' + s.cls;
      line.textContent = s.msg;
      document.getElementById('pv-' + key).innerHTML = s.preview;
    }

    STEPS.forEach(function (step) {
      var ta = document.getElementById('ta-' + step.key);
      areas[step.key] = ta;
      ta.value = typeof raw[step.key] === 'string' ? raw[step.key] : '';
      refresh(step.key);
      ta.addEventListener('input', function () {
        clearTimeout(timers[step.key]);
        timers[step.key] = setTimeout(function () {
          refresh(step.key);
          persistRaw();
        }, PARSE_DELAY_MS);
      });
    });
    snap.addEventListener('change', persistRaw);

    var statusBox = document.getElementById('build-status');

    function build() {
      var data = parser.buildData({
        attendance: areas.attendance.value,
        timetable: areas.timetable.value,
        calendar: areas.calendar.value,
        snapshotDate: store.isIso(snap.value) ? snap.value : store.localToday()
      });
      var errs = [];
      Object.keys(data.errors).forEach(function (k) {
        data.errors[k].forEach(function (e) { errs.push(k.toUpperCase() + ': ' + e); });
      });
      var fatal = !data.courses.length || !data.timetable.cells.length || !data.calendar.lastInstructional;
      if (fatal) {
        statusBox.innerHTML = '<b class="bad">Can\'t build yet:</b><ul>' + errs.map(function (e) {
          return '<li class="bad">' + esc(e) + '</li>';
        }).join('') + '</ul>';
        return;
      }
      persistRaw();
      ctx.onData(data, { fresh: true });
    }

    document.getElementById('build-btn').addEventListener('click', build);

    host.closest('.page').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="clear-scrapes"]');
      if (!btn) return;
      STEPS.forEach(function (s) { areas[s.key].value = ''; refresh(s.key); });
      statusBox.innerHTML = '';
      persistRaw();
    });

    document.getElementById('import-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = store.normalizeData(JSON.parse(String(reader.result)));
          if (!data) throw new Error('not a planner data file');
          ctx.onData(data, { fresh: true });
        } catch (err) {
          statusBox.innerHTML = '<span class="bad">Couldn\'t import that file: ' + esc(err.message) + '.</span>';
        }
      };
      reader.onerror = function () {
        statusBox.innerHTML = '<span class="bad">Couldn\'t read that file.</span>';
      };
      reader.readAsText(file);
      e.target.value = '';
    });

  }

  VAP.setup = { init: init, esc: esc, fmtDate: fmtDate };
})(typeof self !== 'undefined' ? self : this);
