/*
 * VTOP scrape parsers. Pure functions, no DOM.
 * Works as a browser global (window.VAP.parser) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.VAP = root.VAP || {}).parser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COURSE_TYPES = 'Theory Only|Embedded Theory|Embedded Lab|Lab Only|Soft Skill|Embedded Project|Online Course|Project';
  var DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST',
    'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  var VIRTUAL_SLOT = /^V\d+$/;
  var LAB_SLOT = /^L\d+$/;

  var MAX_INPUT_CHARS = 300000;
  var TOO_LONG = 'That paste is very long, so only the first ' + MAX_INPUT_CHARS + ' characters were read.';

  function clean(text) {
    return String(text || '').slice(0, MAX_INPUT_CHARS).replace(/\r/g, '').replace(/ /g, ' ');
  }

  function startErrors(text) {
    return String(text || '').length > MAX_INPUT_CHARS ? [TOO_LONG] : [];
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isoDate(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function kindOfType(type) {
    return /lab/i.test(type) ? 'lab' : 'theory';
  }

  function findSemester(text) {
    var m = /((?:Fall|Winter|Summer|Short)[A-Za-z ]*Semester\s+\d{4}-\d{2,4})/i.exec(text);
    return m ? m[1].replace(/\s+/g, ' ') : '';
  }

  // ---------- attendance ----------

  function parseAttendance(text) {
    var flat = clean(text).replace(/\s+/g, ' ');
    var re = new RegExp(
      // bounded quantifiers keep matching linear on long, malformed pastes
      '([A-Z]{3,5}\\d{3,4}[A-Z]?) - (.{1,120}?) - (' + COURSE_TYPES + ') ' + // course detail
      '([A-Z]{2,4}\\d{6,}) - ([A-Z0-9+]{1,60}) - (\\S{1,30}) ' + // class detail
      '(.{1,100}?) (\\d{1,4}) (\\d{1,4}) (\\d{1,3}(?:\\.\\d+)?) ?%', // faculty, attended, total, %
      'g'
    );
    var courses = [];
    var seen = {};
    var m;
    while ((m = re.exec(flat))) {
      var kind = kindOfType(m[3]);
      var slots = m[5] === 'NIL' ? [] : m[5].split('+').filter(function (s) {
        return s && !VIRTUAL_SLOT.test(s);
      });
      var id = m[1] + '-' + (kind === 'lab' ? 'LAB' : 'TH');
      if (seen[id]) id += '-' + (++seen[id]);
      else seen[id] = 1;
      courses.push({
        id: id,
        code: m[1],
        name: m[2].trim(),
        type: m[3],
        kind: kind,
        classId: m[4],
        slots: slots,
        venue: m[6],
        faculty: m[7].trim(),
        attended: parseInt(m[8], 10),
        total: parseInt(m[9], 10)
      });
    }
    var errors = startErrors(text);
    if (!courses.length) {
      errors.push('No course rows found. Copy the attendance table including the course code, slot and attended/total columns.');
    }
    courses.forEach(function (c) {
      if (c.attended > c.total) errors.push(c.code + ': attended (' + c.attended + ') is more than total (' + c.total + ').');
    });
    return { semester: findSemester(flat), courses: courses, errors: errors };
  }

  // ---------- timetable ----------

  function emptyHeader() {
    return { start: [], end: [] };
  }

  function tokenizeGrid(tokens, from) {
    var headers = { THEORY: emptyHeader(), LAB: emptyHeader() };
    var rows = [];
    var section = null;
    var mode = null;
    var day = null;
    var row = null;
    for (var i = from; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === 'THEORY' || t === 'LAB') {
        if (tokens[i + 1] === 'Start') {
          section = t;
          mode = 'start';
          i++;
        } else if (day) {
          row = { day: day, kind: t === 'THEORY' ? 'theory' : 'lab', cells: [] };
          rows.push(row);
          mode = 'row';
        }
        continue;
      }
      if (t === 'End' && mode === 'start') {
        mode = 'end';
        continue;
      }
      if (DAY_NAMES.indexOf(t) !== -1) {
        day = t;
        mode = null;
        continue;
      }
      if (mode === 'start') headers[section].start.push(t);
      else if (mode === 'end') headers[section].end.push(t);
      else if (mode === 'row') row.cells.push(t);
    }
    return { headers: headers, rows: rows };
  }

  function alignRow(cells, header) {
    var width = header.start.length;
    var out = cells.slice(0, Math.max(width, 1) + 1);
    var lunchAt = header.start.indexOf('Lunch');
    if (lunchAt !== -1 && out.indexOf('Lunch') === -1 && out.length < width) {
      out = out.slice(0, lunchAt).concat(['Lunch'], out.slice(lunchAt));
    }
    return width ? out.slice(0, width) : out;
  }

  function timeOrNull(v) {
    return /^\d{1,2}:\d{2}$/.test(v || '') ? v : null;
  }

  function parseTimetable(text) {
    var tokens = clean(text).split(/\s+/).filter(Boolean);
    var start = -1;
    for (var i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === 'THEORY' && tokens[i + 1] === 'Start') { start = i; break; }
    }
    if (start === -1) {
      return { periods: { theory: [], lab: [] }, cells: [], errors: ['Could not find the timetable grid. Include the "THEORY Start 08:00 ..." header row.'] };
    }
    var grid = tokenizeGrid(tokens, start);
    var cellRe = /^([A-Z]+\d+)-([A-Z]{3,5}\d{3,4}[A-Z]?)-([A-Z]+)-(.+)-([A-Z0-9]+)$/;
    var cells = [];
    grid.rows.forEach(function (row) {
      var header = grid.headers[row.kind === 'theory' ? 'THEORY' : 'LAB'];
      alignRow(row.cells, header).forEach(function (raw, col) {
        var m = cellRe.exec(raw);
        if (!m) return;
        cells.push({
          day: row.day,
          kind: LAB_SLOT.test(m[1]) ? 'lab' : 'theory',
          col: col,
          slot: m[1],
          code: m[2],
          type: m[3],
          venue: m[4],
          group: m[5],
          start: timeOrNull(header.start[col]),
          end: timeOrNull(header.end[col])
        });
      });
    });
    function periods(h) {
      return h.start.map(function (s, idx) {
        return { start: timeOrNull(s), end: timeOrNull(h.end[idx]) };
      });
    }
    var errors = startErrors(text);
    if (!grid.rows.length) errors.push('Found the header but no MON-SUN rows.');
    else if (!cells.length) errors.push('No registered classes found. Registered cells look like "A2-BACSE202-ETH-PRP472-ALL".');
    return {
      semester: findSemester(clean(text)),
      periods: { theory: periods(grid.headers.THEORY), lab: periods(grid.headers.LAB) },
      cells: cells,
      errors: errors
    };
  }

  // ---------- calendar ----------

  function classifyDay(content) {
    var text = content.replace(/\s+/g, ' ').trim();
    var paren = /\(([^)]*)\)/.exec(text);
    var info = { type: 'none', reason: '', order: null, raw: text };
    if (!text) return info;
    if (/no instructional/i.test(text)) {
      info.reason = paren ? paren[1] : text;
      return info;
    }
    if (/holiday/i.test(text)) {
      info.type = 'holiday';
      info.reason = paren ? paren[1].trim() : text.replace(/holiday/i, '').trim();
      return info;
    }
    if (/instructional day/i.test(text)) {
      info.type = 'instructional';
      var order = /\(\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+day\s+order\s*\)/i.exec(text);
      if (order) info.order = WEEKDAYS.indexOf(order[1].toLowerCase());
      if (/last instructional day for theory/i.test(text)) info.lastTheory = true;
      if (/last instructional day for lab/i.test(text)) info.lastLab = true;
      if (paren && !order) info.reason = paren[1].trim();
      return info;
    }
    info.type = /exam|\bcat\b|\bfat\b|assessment/i.test(text) ? 'exam' : 'other';
    info.reason = text;
    return info;
  }

  function splitDays(segment, y, m) {
    var dim = daysInMonth(y, m);
    var marks = [];
    var pos = 0;
    for (var d = 1; d <= dim; d++) {
      var re = new RegExp('(^|\\D)(' + d + ')(?!\\d)', 'g');
      re.lastIndex = pos;
      var hit = re.exec(segment);
      if (!hit) break;
      var at = hit.index + hit[1].length;
      marks.push({ day: d, at: at, body: at + String(d).length });
      pos = at + String(d).length;
    }
    return marks.map(function (mk, idx) {
      var stop = idx + 1 < marks.length ? marks[idx + 1].at : segment.length;
      return { day: mk.day, content: segment.slice(mk.body, stop) };
    });
  }

  function parseCalendar(text) {
    var src = clean(text);
    var headerRe = new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(\\d{4})\\b', 'gi');
    var heads = [];
    var h;
    while ((h = headerRe.exec(src))) {
      heads.push({ month: MONTHS.indexOf(h[1].toUpperCase()) + 1, year: parseInt(h[2], 10), start: h.index, body: h.index + h[0].length });
    }
    var days = {};
    var months = [];
    var lastTheory = null;
    var lastLab = null;
    var lastInstructional = null;
    var lastAnnotated = null;
    heads.forEach(function (hd, idx) {
      var segment = src.slice(hd.body, idx + 1 < heads.length ? heads[idx + 1].start : src.length);
      var sat = segment.search(/saturday/i);
      if (sat !== -1) segment = segment.slice(sat + 'saturday'.length);
      // page chrome copied between months ("Calendar Semester ... Class Group ...") is stripped per day below
      var key = hd.year + '-' + pad(hd.month);
      if (months.indexOf(key) === -1) months.push(key);
      splitDays(segment, hd.year, hd.month).forEach(function (entry) {
        var info = classifyDay(entry.content.replace(/\b(Calendar|Class Group)\b[\s\S]*$/i, ''));
        var iso = isoDate(hd.year, hd.month, entry.day);
        days[iso] = info;
        if (info.type !== 'none' && (!lastAnnotated || iso > lastAnnotated)) lastAnnotated = iso;
        if (info.type === 'instructional' && (!lastInstructional || iso > lastInstructional)) lastInstructional = iso;
        if (info.lastTheory && (!lastTheory || iso > lastTheory)) lastTheory = iso;
        if (info.lastLab && (!lastLab || iso > lastLab)) lastLab = iso;
      });
    });
    months.sort();
    var errors = startErrors(text);
    if (!heads.length) errors.push('No month found. Each month should start with its name and year, e.g. "OCTOBER 2026".');
    else if (!lastInstructional) errors.push('No "Instructional Day" entries found in the pasted months.');
    return {
      semester: findSemester(src),
      months: months,
      days: days,
      lastTheory: lastTheory,
      lastLab: lastLab,
      lastInstructional: lastInstructional,
      lastAnnotated: lastAnnotated,
      errors: errors
    };
  }

  // ---------- combine ----------

  function linkCells(courses, cells) {
    return cells.map(function (cell) {
      var match = courses.filter(function (c) {
        return c.code === cell.code && c.slots.indexOf(cell.slot) !== -1;
      })[0] || courses.filter(function (c) {
        return c.code === cell.code && c.kind === cell.kind;
      })[0];
      return Object.assign({}, cell, { courseId: match ? match.id : null });
    });
  }

  var MAX_MONTH_SPAN = 36;

  function monthKeys(from, to) {
    var out = [];
    var y = +from.slice(0, 4);
    var m = +from.slice(5, 7);
    for (var i = 0; i < MAX_MONTH_SPAN; i++) {
      var key = y + '-' + pad(m);
      if (key > to) break;
      out.push(key);
      m = m === 12 ? 1 : m + 1;
      if (m === 1) y += 1;
    }
    return out;
  }

  /** Months between the attendance copy and the last class day that were not pasted. */
  function missingMonths(snapshotDate, cal) {
    var last = [cal.lastTheory, cal.lastLab, cal.lastInstructional].filter(Boolean).sort().pop();
    if (!cal.months.length || !last) return [];
    var first = /^\d{4}-\d{2}/.test(snapshotDate || '') ? snapshotDate.slice(0, 7) : cal.months[0];
    return monthKeys(first, last.slice(0, 7)).filter(function (k) { return cal.months.indexOf(k) === -1; });
  }

  function buildData(input) {
    var att = parseAttendance(input.attendance);
    var tt = parseTimetable(input.timetable);
    var cal = parseCalendar(input.calendar);
    var cells = linkCells(att.courses, tt.cells);
    var warnings = [];
    att.courses.forEach(function (c) {
      var has = cells.some(function (cell) { return cell.courseId === c.id; });
      if (!has && c.slots.length) warnings.push(c.code + ' (' + c.type + ') has no classes in the timetable grid, so no future classes are counted for it.');
    });
    cells.forEach(function (cell) {
      if (!cell.courseId) warnings.push(cell.slot + ' ' + cell.code + ' on ' + cell.day + ' is in the timetable but not in the attendance list; it is ignored.');
    });
    missingMonths(input.snapshotDate, cal).forEach(function (m) {
      warnings.push('The calendar is missing ' + m + ', so no classes are counted in that month. Paste it on the Setup page.');
    });
    var unique = function (arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); };
    return {
      version: 1,
      semester: att.semester || tt.semester || cal.semester,
      snapshotDate: input.snapshotDate || null,
      courses: att.courses,
      timetable: { periods: tt.periods, cells: cells },
      calendar: {
        months: cal.months,
        days: cal.days,
        lastTheory: cal.lastTheory,
        lastLab: cal.lastLab,
        lastInstructional: cal.lastInstructional,
        lastAnnotated: cal.lastAnnotated
      },
      errors: { attendance: att.errors, timetable: tt.errors, calendar: cal.errors },
      warnings: unique(warnings)
    };
  }

  return {
    parseAttendance: parseAttendance,
    parseTimetable: parseTimetable,
    parseCalendar: parseCalendar,
    buildData: buildData,
    DAY_NAMES: DAY_NAMES
  };
});
