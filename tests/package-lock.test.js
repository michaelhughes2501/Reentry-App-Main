// Regression tests for the package-lock.json changes in this PR:
// an `npm audit fix` bump of the transitive `body-parser` dependency
// from 2.2.2 -> 2.3.0 (low severity DoS advisory GHSA-v422-hmwv-36x6),
// which also pulled a pinned `content-type@2.0.0` in as body-parser's
// own nested dependency.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.join(__dirname, '..', 'package-lock.json');

function loadLockfile() {
  return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
}

test('package-lock.json is valid, parseable JSON', () => {
  assert.doesNotThrow(() => loadLockfile());
});

test('body-parser is bumped to 2.3.0 to resolve GHSA-v422-hmwv-36x6', () => {
  const lock = loadLockfile();
  const bodyParser = lock.packages['node_modules/body-parser'];
  assert.ok(bodyParser, 'expected node_modules/body-parser entry in the lockfile');
  assert.equal(bodyParser.version, '2.3.0');
  assert.equal(bodyParser.resolved, 'https://registry.npmjs.org/body-parser/-/body-parser-2.3.0.tgz');
});

test('body-parser declares its updated transitive dependency ranges', () => {
  const lock = loadLockfile();
  const bodyParser = lock.packages['node_modules/body-parser'];
  assert.equal(bodyParser.dependencies['content-type'], '^2.0.0');
  assert.equal(bodyParser.dependencies['http-errors'], '^2.0.1');
  assert.equal(bodyParser.dependencies['iconv-lite'], '^0.7.2');
  assert.equal(bodyParser.dependencies['qs'], '^6.15.2');
  assert.equal(bodyParser.dependencies['raw-body'], '^3.0.2');
  assert.equal(bodyParser.dependencies['type-is'], '^2.1.0');
});

test('body-parser gets its own nested content-type@2.0.0 (diverges from any other content-type in the tree)', () => {
  const lock = loadLockfile();
  const nestedContentType = lock.packages['node_modules/body-parser/node_modules/content-type'];
  assert.ok(nestedContentType, 'expected a nested content-type dependency scoped under body-parser');
  assert.equal(nestedContentType.version, '2.0.0');
  assert.equal(nestedContentType.resolved, 'https://registry.npmjs.org/content-type/-/content-type-2.0.0.tgz');
});

test('lockfile root project metadata matches package.json', () => {
  const lock = loadLockfile();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
});
