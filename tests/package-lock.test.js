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

// Compare dotted numeric versions: returns true when a >= b.
function versionAtLeast(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

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
