const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(fs.readFileSync('hello.txt', 'utf8'), 'Fleet smoke test OK\n');
console.log('PASS: hello.txt has the exact expected UTF-8 content and newline.');
