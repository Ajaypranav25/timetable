#!/usr/bin/env node
/*
 * Turn raw VTOP scrapes into data.json (the same format the website exports/imports).
 *
 *   node tools/parse.js --attendance att.txt --timetable tt.txt --calendar cal.txt \
 *        [--snapshot 2026-10-05] [--out data.json]
 *
 * Import the result on the Setup page ("IMPORT data.json").
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../js/parser.js');

const USAGE = 'Usage: node tools/parse.js --attendance FILE --timetable FILE --calendar FILE [--snapshot YYYY-MM-DD] [--out data.json]';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith('--') || argv[i + 1] === undefined) throw new Error(`Bad argument near "${key}"`);
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

function readFile(file, label) {
  if (!file) throw new Error(`Missing --${label}`);
  try {
    return fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${label} file "${file}": ${err.message}`);
  }
}

/** Local calendar date (not UTC), so IST users after midnight get the right day. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.snapshot && !/^\d{4}-\d{2}-\d{2}$/.test(args.snapshot)) throw new Error('--snapshot must look like 2026-10-05');
  const data = parser.buildData({
    attendance: readFile(args.attendance, 'attendance'),
    timetable: readFile(args.timetable, 'timetable'),
    calendar: readFile(args.calendar, 'calendar'),
    snapshotDate: args.snapshot || localToday()
  });
  const problems = [].concat(data.errors.attendance, data.errors.timetable, data.errors.calendar);
  problems.forEach((p) => console.error('error:', p));
  data.warnings.forEach((w) => console.error('warning:', w));
  if (!data.courses.length || !data.timetable.cells.length || !data.calendar.lastInstructional) process.exit(1);

  const out = path.resolve(args.out || 'data.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Wrote ${out}: ${data.courses.length} courses, ${data.timetable.cells.length} timetable slots, ` +
    `last theory day ${data.calendar.lastTheory || data.calendar.lastInstructional}.`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  console.error(USAGE);
  process.exit(1);
}
