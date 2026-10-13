'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const demo = require('../samples/demo-scrapes.js');
const parser = require('../js/parser.js');
const engine = require('../js/engine.js');

// planner-view.js is a browser script that hangs itself off self.VAP.
global.self = { VAP: { parser: parser, engine: engine } };
require('../js/setup.js');
require('../js/planner-view.js');
const view = global.self.VAP.plannerView;

const data = parser.buildData({
  attendance: demo.attendance,
  timetable: demo.timetable,
  calendar: demo.calendar,
  snapshotDate: '2026-10-05'
});

function settings(overrides) {
  return Object.assign({
    today: '2026-10-05',
    snapshotDate: '2026-10-05',
    snapshotIncludesDay: false,
    lastTheory: '2026-11-03',
    lastLab: '2026-11-03',
    target: 77
  }, overrides || {});
}

function card(id, plan, overrides) {
  const es = settings(overrides);
  const result = engine.project(data, es, plan || { days: [], classes: [] });
  const c = result.courses.find((x) => x.id === id);
  assert.ok(c, `course ${id} missing`);
  return view.courses({ courses: [c], lowest: null }, es.target);
}

function headline(html) {
  const m = html.match(/class="course-pct">.*?([\d.]+%)/);
  assert.ok(m, 'course-pct headline missing');
  return m[1];
}

test('course card leads with the current %, FINAL sits below it', () => {
  const html = card('BACSE203-TH'); // 27/32 now, 41/46 if every class left is attended
  assert.equal(headline(html), '84.4%');
  assert.match(html, /<small>NOW<\/small>/);
  assert.match(html, /class="course-final">FINAL <b class="st-safe">89\.1%<\/b>/);
  assert.ok(html.indexOf('84.4%') < html.indexOf('89.1%'));
});

test('lowest course gets its own LOWEST FINAL tag under the final %', () => {
  const result = engine.project(data, settings(), { days: [], classes: [] });
  const html = view.courses(result, 77);
  const lowCard = html.split('<article').find((a) => a.includes('id="course-' + result.lowest.id + '"'));
  assert.match(lowCard, /<\/span><small class="course-low">LOWEST FINAL<\/small><\/div>/);
  assert.equal((html.match(/course-low/g) || []).length, 1);
});

test('one note under the heading explains NOW vs FINAL, not a line in every card', () => {
  const intro = view.coursesIntro('2026-11-03');
  assert.match(intro, /^<p class="courses-intro"><b>WHY TWO NUMBERS\?<\/b>/);
  assert.match(intro, /<b>NOW<\/b>: your attendance today/);
  assert.match(intro, /VTOP rounds up, so 82\.35% shows there as 83%/);
  assert.match(intro, /<b>FINAL<\/b> under it is where you end up by <b>3 Nov 2026<\/b>/);
  assert.match(intro, /The strip at the top, the bar, the warnings and the skip budgets all use FINAL\./);
  const result = engine.project(data, settings(), { days: [], classes: [] });
  assert.doesNotMatch(view.courses(result, 77), /WHY TWO NUMBERS|class="why"/);
});

test('skipping classes lowers FINAL but leaves the NOW headline alone', () => {
  const days = engine.dateRange('2026-10-05', '2026-11-03');
  const html = card('BACSE203-TH', { days: days, classes: [] }); // 27/32 now, 27/46 final
  assert.equal(headline(html), '84.4%');
  assert.match(html, /class="course-final">FINAL <b class="st-danger">58\.7%<\/b>/);
});

test('final-band warnings name FINAL now that the headline is the current %', () => {
  const plan = { days: engine.dateRange('2026-10-05', '2026-11-03'), classes: [] };
  const html = card('BACSE203-TH', plan); // 27/46 final
  assert.match(html, /FINAL is below VTOP's 74\.01% pass mark: debar risk\./);
});
