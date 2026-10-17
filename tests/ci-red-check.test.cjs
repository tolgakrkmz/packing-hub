/* Temporary: proves CI turns red on a failing test. Reverted in the next commit. */
const test = require('node:test');
const assert = require('node:assert/strict');
test('deliberately failing CI acceptance check', () => assert.equal(1, 2));
