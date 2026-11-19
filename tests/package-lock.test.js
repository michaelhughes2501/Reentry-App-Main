// Regression tests for package-lock.json: it must stay valid JSON, keep the
// transitive `body-parser` at or above 2.3.0 (low severity DoS advisory
// GHSA-v422-hmwv-36x6), and stay in sync with package.json.

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

function semverAtLeast(version, min) {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

test('body-parser is at least 2.3.0 to resolve GHSA-v422-hmwv-36x6', () => {
  const lock = loadLockfile();
  const bodyParser = lock.packages['node_modules/body-parser'];
  assert.ok(bodyParser, 'expected node_modules/body-parser entry in the lockfile');
  assert.ok(
    semverAtLeast(bodyParser.version, '2.3.0'),
    `expected body-parser >= 2.3.0, got ${bodyParser.version}`,
  );
  assert.equal(
    bodyParser.resolved,
    `https://registry.npmjs.org/body-parser/-/body-parser-${bodyParser.version}.tgz`,
  );
});

test('every installed content-type satisfies body-parser\'s declared range', () => {
  const lock = loadLockfile();
  const bodyParser = lock.packages['node_modules/body-parser'];
  const range = bodyParser.dependencies['content-type'];
  assert.ok(range, 'expected body-parser to declare a content-type dependency');
  const resolved =
    lock.packages['node_modules/body-parser/node_modules/content-type'] ||
    lock.packages['node_modules/content-type'];
  assert.ok(resolved, 'expected content-type to be installed');
  const [major] = resolved.version.split('.');
  assert.equal(`^${major}`, range.split('.')[0]);
  assert.ok(semverAtLeast(resolved.version, range.replace('^', '')));
});

test('lockfile root project metadata matches package.json', () => {
  const lock = loadLockfile();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
});
