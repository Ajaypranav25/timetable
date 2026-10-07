'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { decide } = require('../js/sync.js');

const ME = 'user-a';
const OTHER = 'user-b';
const V1 = '2026-10-07T07:00:00.123456+00:00';
const V2 = '2026-10-07T08:00:00.654321+00:00';

function local(overrides) {
  return Object.assign({ hasData: true, dirty: false, base: V1, owner: ME }, overrides || {});
}

test('does nothing when the row is the version I last synced and I have no edits', () => {
  assert.equal(decide(local(), { version: V1 }, ME), 'none');
});

test('pushes my edits when the row has not changed since my last sync', () => {
  assert.equal(decide(local({ dirty: true }), { version: V1 }, ME), 'push');
});

test('pulls when another device changed the row and I have no edits', () => {
  assert.equal(decide(local(), { version: V2 }, ME), 'pull');
});

test('reports a conflict when both the row and my copy changed', () => {
  assert.equal(decide(local({ dirty: true }), { version: V2 }, ME), 'conflict');
});

test('pulls into an empty browser', () => {
  assert.equal(decide(local({ hasData: false, owner: null, base: null }), { version: V1 }, ME), 'pull');
});

test('a signed-out copy never overwrites an existing account row, even with edits', () => {
  assert.equal(decide(local({ owner: null, base: null, dirty: true }), { version: V1 }, ME), 'pull');
});

test("another account's copy never overwrites my row", () => {
  assert.equal(decide(local({ owner: OTHER, dirty: true }), { version: V1 }, ME), 'pull');
});

test('a signed-out copy is adopted by a new account with no row', () => {
  assert.equal(decide(local({ owner: null, base: null, dirty: true }), null, ME), 'push');
});

test('my never-uploaded copy is pushed when I have no row yet', () => {
  assert.equal(decide(local({ base: null }), null, ME), 'push');
});

test('a row deleted on another device clears my unedited copy instead of resurrecting it', () => {
  assert.equal(decide(local(), null, ME), 'clear');
});

test('a row deleted elsewhere is recreated when I made new edits since', () => {
  assert.equal(decide(local({ dirty: true }), null, ME), 'push');
});

test("another account's copy is cleared, not uploaded, when my row is missing", () => {
  assert.equal(decide(local({ owner: OTHER }), null, ME), 'clear');
});

test('nothing to do with an empty browser and no row', () => {
  assert.equal(decide(local({ hasData: false }), null, ME), 'none');
});
