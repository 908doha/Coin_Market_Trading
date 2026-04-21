const test = require('node:test');
const assert = require('node:assert/strict');

test('node:test 인프라 동작 확인', () => {
  assert.equal(1 + 1, 2);
});
