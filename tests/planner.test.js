'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const demo = require('../samples/demo-scrapes.js');
const parser = require('../js/parser.js');
const engine = require('../js/engine.js');

function buildData(scrapes) {
  return parser.buildData({
    attendance: scrapes.attendance,
    timetable: scrapes.timetable,
    calendar: scrapes.calendar,
    snapshotDate: '2026-10-05'
  });
}

const data = buildData(demo);

function baseSettings(overrides) {
  return Object.assign({
    today: '2026-10-05',
    snapshotDate: '2026-10-05',
    snapshotIncludesDay: false,
    lastTheory: '2026-11-03',
    lastLab: '2026-11-03',
    target: 77
  }, overrides || {});
}

function classIdsOn(date, code, kind) {
  return engine.classesOn(data, baseSettings(), date)
    .filter((s) => s.code === code && s.kind === kind)
    .map((s) => s.id);
}

function pct(result, code, kind) {
  const c = result.courses.find((x) => x.code === code && x.kind === kind);
  assert.ok(c, `course ${code} ${kind} missing`);
  return Math.round(c.projectedPct * 10) / 10;
}

const firstPlan = {
  days: ['2026-10-16', '2026-11-02', '2026-11-03'],
  classes: [
    ...classIdsOn('2026-10-05', 'BACSE203', 'lab'),
    ...classIdsOn('2026-10-05', 'BACSE202', 'lab')
  ]
};

// ---------- parser ----------

test('attendance parser reads all 13 rows with counts and slots', () => {
  assert.equal(data.courses.length, 13);
  const java = data.courses.find((c) => c.code === 'BACSE102');
  assert.equal(java.kind, 'lab');
  assert.equal(java.type, 'Lab Only');
  assert.deepEqual(java.slots, ['L7', 'L8', 'L29', 'L30']);
  assert.equal(java.attended, 34);
  assert.equal(java.total, 42);
  assert.equal(java.faculty, 'VIVEK D - SCOPE');
  const sts = data.courses.find((c) => c.code === 'BASTS101');
  assert.equal(sts.kind, 'theory');
  assert.equal(sts.type, 'Soft Skill');
  assert.equal(sts.name, 'Qualitative and Quantitative Skills Practice I');
});

test('attendance parser drops virtual slots', () => {
  const rows = parser.parseAttendance(
    '1\tGeneral (Semester)\tBACSE999 - Test Course - Theory Only\tVL2026270100001 - A1+V3+TA1 - SJT101\tSOMEONE - SCOPE\t5\t6\t83%\t-'
  ).courses;
  assert.deepEqual(rows[0].slots, ['A1', 'TA1']);
});

test('timetable parser finds only registered cells with times', () => {
  const tt = data.timetable;
  assert.equal(tt.cells.length, 33);
  const l3 = tt.cells.find((c) => c.slot === 'L3');
  assert.equal(l3.day, 'MON');
  assert.equal(l3.code, 'BACSE203');
  assert.equal(l3.start, '09:51');
  assert.equal(l3.end, '10:40');
  const a2 = tt.cells.find((c) => c.slot === 'A2' && c.day === 'MON');
  assert.equal(a2.start, '14:00');
  assert.equal(a2.end, '14:50');
  assert.equal(a2.venue, 'PRP472');
});

test('calendar parser reads day types, day orders and last day', () => {
  const cal = data.calendar;
  assert.equal(cal.days['2026-10-02'].type, 'holiday');
  assert.equal(cal.days['2026-10-02'].reason, 'Gandhi Jayanthi');
  assert.equal(cal.days['2026-10-01'].type, 'exam');
  assert.equal(cal.days['2026-10-24'].type, 'instructional');
  assert.equal(cal.days['2026-10-24'].order, 1); // Monday
  assert.equal(cal.days['2026-10-31'].order, 3); // Wednesday
  assert.equal(cal.days['2026-10-10'].type, 'none');
  assert.equal(cal.lastTheory, '2026-11-03');
  assert.equal(cal.days['2026-11-11'].reason, 'Deepavali');
});

test('parsers tolerate spaces instead of tabs and one-cell-per-line copies', () => {
  const spaced = buildData({
    attendance: demo.attendance.replace(/\t/g, '    '),
    timetable: demo.timetable.replace(/\t/g, '    '),
    calendar: demo.calendar.replace(/\t/g, '    ')
  });
  const lines = buildData({
    attendance: demo.attendance.replace(/\t/g, '\n'),
    timetable: demo.timetable.replace(/\t/g, '\n'),
    calendar: demo.calendar.replace(/\t/g, '\n')
  });
  for (const d of [spaced, lines]) {
    assert.equal(d.courses.length, 13);
    assert.equal(d.timetable.cells.length, 33);
    assert.equal(d.calendar.days['2026-10-31'].order, 3);
    assert.deepEqual(engine.project(d, baseSettings(), { days: [], classes: [] }).courses.map((c) => c.future),
      engine.project(data, baseSettings(), { days: [], classes: [] }).courses.map((c) => c.future));
  }
});

// ---------- engine ----------

test('a lab session counts as two classes', () => {
  const ids = classIdsOn('2026-10-05', 'BACSE203', 'lab');
  assert.equal(ids.length, 1);
  const session = engine.classesOn(data, baseSettings(), '2026-10-05').find((s) => s.id === ids[0]);
  assert.equal(session.count, 2);
  assert.deepEqual(session.slots, ['L3', 'L4']);
});

test('Saturday with Monday day order runs the Monday timetable', () => {
  const codes = engine.classesOn(data, baseSettings(), '2026-10-24').map((s) => s.code + ':' + s.kind);
  assert.ok(codes.includes('BACSE202:lab'));
  assert.ok(codes.includes('BAHUM106:theory'));
  assert.equal(engine.classesOn(data, baseSettings(), '2026-10-17').length, 0);
});

test('scenario 1: lab skips on Oct 5 plus Oct 16, Nov 2, Nov 3', () => {
  const r = engine.project(data, baseSettings(), firstPlan);
  assert.equal(pct(r, 'BACSE102', 'lab'), 80.0);
  assert.equal(pct(r, 'BACSE202', 'lab'), 86.7);
  assert.equal(pct(r, 'BACSE203', 'lab'), 84.6);
});

test('scenario 2: also skipping Oct 15, 28, 29, 30, 31', () => {
  const plan = {
    days: firstPlan.days.concat(['2026-10-15', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']),
    classes: firstPlan.classes
  };
  const r = engine.project(data, baseSettings(), plan);
  assert.equal(pct(r, 'BACSE102', 'lab'), 76.7);
  assert.equal(pct(r, 'BACSE324', 'theory'), 77.8);
  assert.equal(pct(r, 'BASTS101', 'theory'), 77.8);
  assert.equal(pct(r, 'BAJAP101', 'lab'), 78.6);

  const brk = engine.breaks(data, baseSettings(), plan).find((b) => b.start === '2026-10-28');
  assert.ok(brk, 'expected a break starting Oct 28');
  assert.equal(brk.end, '2026-11-11');
  assert.equal(brk.length, 15);
});

test('snapshot already including today moves the window to tomorrow', () => {
  const none = { days: [], classes: [] };
  const a = engine.project(data, baseSettings(), none).courses.find((c) => c.code === 'BACSE203' && c.kind === 'lab');
  const b = engine.project(data, baseSettings({ snapshotIncludesDay: true }), none).courses.find((c) => c.code === 'BACSE203' && c.kind === 'lab');
  assert.equal(a.future, 10);
  assert.equal(b.future, 8);
});

test('separate lab cutoff drops later lab sessions only', () => {
  const none = { days: [], classes: [] };
  const r = engine.project(data, baseSettings({ lastLab: '2026-10-30' }), none);
  assert.equal(r.courses.find((c) => c.code === 'BACSE203' && c.kind === 'lab').future, 8);
  assert.equal(r.courses.find((c) => c.code === 'BACSE203' && c.kind === 'theory').future,
    engine.project(data, baseSettings(), none).courses.find((c) => c.code === 'BACSE203' && c.kind === 'theory').future);
});

test('skip budget respects 75% and counts lab classes', () => {
  const r = engine.project(data, baseSettings(), { days: [], classes: [] });
  const java = r.courses.find((c) => c.code === 'BACSE102');
  // 34+18=52 of 60 -> can drop to 45 -> 7 classes (3 full lab sessions)
  assert.equal(java.canSkip75, 7);
  assert.equal(java.canSkipTarget, 5); // ceil(0.77*60)=47 -> 52-47
});

test('status bands', () => {
  assert.equal(engine.status(80), 'safe');
  assert.equal(engine.status(76), 'warn');
  assert.equal(engine.status(74.5), 'danger');
  assert.equal(engine.passesVtop(74.01), true);
  assert.equal(engine.passesVtop(74.0), false);
});

test('current % and its band come from the attendance copy, not the projection', () => {
  const plan = {
    days: firstPlan.days.concat(['2026-10-15', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']),
    classes: firstPlan.classes
  };
  const java = engine.project(data, baseSettings(), plan).courses.find((c) => c.code === 'BACSE102');
  assert.equal(Math.round(java.currentPct * 10) / 10, 81.0); // 34/42
  assert.equal(java.currentStatus, 'safe');
  assert.equal(java.status, 'warn'); // final 76.7%
});

// ---------- hardening (from code review) ----------

const { store } = require('../js/store.js').VAP;

test('normalizeData strips injected markup and bad dates from imported files', () => {
  const evil = JSON.parse(JSON.stringify(data));
  evil.courses[0].kind = 'x"><img src=x onerror=alert(1)>';
  evil.courses[0].total = '<b>1</b>';
  evil.courses[1].kind = 'lab';
  evil.calendar.months.push('2026-10--" onclick="alert(1)" x="');
  evil.calendar.days['2026-10--" onclick="x'] = { type: 'instructional' };
  evil.calendar.days['2026-10-24'].order = 99;
  evil.calendar.lastTheory = 'zzz';
  const clean = store.normalizeData(evil);
  assert.equal(clean.courses.length, 12, 'course with a non-numeric total is dropped');
  assert.equal(clean.courses[0].kind, 'lab');
  assert.deepEqual(clean.calendar.months, ['2026-10', '2026-11']);
  assert.ok(Object.keys(clean.calendar.days).every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)));
  assert.equal(clean.calendar.days['2026-10-24'].order, null);
  assert.equal(clean.calendar.lastTheory, null);
  assert.equal(store.normalizeData({ courses: 'nope' }), null);
  assert.equal(store.normalizeData(null), null);
});

test('normalized parser output still gives the same projections', () => {
  const r = engine.project(store.normalizeData(data), baseSettings(), firstPlan);
  assert.equal(pct(r, 'BACSE102', 'lab'), 80.0);
});

test('isIso rejects far-future years that would stall the date loop', () => {
  assert.equal(store.isIso('9999-12-31'), false);
  assert.equal(store.isIso('2026-11-03'), true);
  assert.ok(engine.dateRange('2026-01-01', '2099-01-01').length <= 400);
  assert.deepEqual(engine.dateRange('zzz', '2026-01-01'), []);
});

test('warns when a calendar month between the snapshot and the last day is missing', () => {
  const novOnly = parser.buildData({
    attendance: demo.attendance,
    timetable: demo.timetable,
    calendar: demo.calendar.slice(demo.calendar.indexOf('NOVEMBER 2026')),
    snapshotDate: '2026-10-05'
  });
  assert.ok(novOnly.warnings.some((w) => w.includes('2026-10')), novOnly.warnings.join('\n'));
  assert.ok(!data.warnings.some((w) => w.includes('missing')));
});

test('attendance parser stays fast on long malformed pastes', () => {
  const header = 'BACSE202 - Database Systems - Embedded Theory VL2026270101681 - A2+TA2 - PRP472 VANI RAJASEKAR - SCOPE ';
  const t0 = Date.now();
  parser.parseAttendance(header.repeat(900));
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});

test('unskip whole day clears a day that was fully skipped class by class', () => {
  const ids = engine.classesOn(data, baseSettings(), '2026-10-06').map((c) => c.id);
  const plan = { days: [], classes: ids };
  const next = engine.toggleDay(plan, '2026-10-06', true);
  assert.deepEqual(next, { days: [], classes: [] });
  assert.deepEqual(engine.toggleDay({ days: [], classes: [] }, '2026-10-06', false).days, ['2026-10-06']);
});
