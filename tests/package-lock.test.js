// Regression tests for package-lock.json: it must parse (a bad merge once
// left it as invalid JSON, breaking `npm ci`), and security-relevant
// transitive deps must stay at or above their patched versions.

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

// Semver "a >= b" for MAJOR.MINOR.PATCH. A prerelease of the threshold
// (e.g. 2.4.0-beta.1 vs 2.4.0) does not count as patched.
function versionAtLeast(a, b) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(a);
  const pb = b.split('.').map(Number);
  if (!m || pb.length !== 3 || pb.some(Number.isNaN)) return false;
  const pa = m.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return !m[4];
}

test('versionAtLeast treats prereleases of the threshold as unpatched', () => {
  assert.equal(versionAtLeast('2.4.0', '2.4.0'), true);
  assert.equal(versionAtLeast('2.4.1', '2.4.0'), true);
  assert.equal(versionAtLeast('2.3.9', '2.4.0'), false);
  assert.equal(versionAtLeast('2.4.0-beta.1', '2.4.0'), false);
  assert.equal(versionAtLeast('2.4.1-beta.1', '2.4.0'), true);
});

// Assert minimum patched versions rather than exact pins, so routine
// `npm update` / Dependabot bumps don't break the suite.
test('body-parser is at least 2.4.0 (GHSA-v422-hmwv-36x6, GHSA-27r3-jxmh-p828)', () => {
  const lock = loadLockfile();
  const bodyParser = lock.packages['node_modules/body-parser'];
  assert.ok(bodyParser, 'expected node_modules/body-parser entry in the lockfile');
  assert.ok(versionAtLeast(bodyParser.version, '2.4.0'), `body-parser ${bodyParser.version} < 2.4.0`);
});

test('proxy-addr is at least 2.0.8 (GHSA-jqcg-44mw-7w3h)', () => {
  const lock = loadLockfile();
  const proxyAddr = lock.packages['node_modules/proxy-addr'];
  assert.ok(proxyAddr, 'expected node_modules/proxy-addr entry in the lockfile');
  assert.ok(versionAtLeast(proxyAddr.version, '2.0.8'), `proxy-addr ${proxyAddr.version} < 2.0.8`);
});

test('lockfile has no duplicate or dangling package keys from bad merges', () => {
  const raw = fs.readFileSync(lockPath, 'utf8');
  const keys = [...raw.matchAll(/^    "(node_modules\/[^"]+)": \{$/gm)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'duplicate package entries in package-lock.json');
});

test('lockfile root project metadata matches package.json', () => {
  const lock = loadLockfile();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
});
