// Regression tests for the "Fix duplicated/malformed landing page" PR.
//
// public/index.html previously contained two entire HTML documents
// concatenated together (a stray "New Horizon" marketing page pulled in
// from an unrelated sibling project, followed by the real ReentryApp
// SPA), with public/app.js and public/styles.css exclusively serving the
// removed marketing page. This PR:
//   - deletes public/app.js and public/styles.css (now fully orphaned),
//   - keeps a single valid <!doctype>/<html>/<head>/<body> document,
//   - adds type="button" to all 36 non-submit buttons (previously
//     undeclared, which risks accidental form submission / page reload),
//   - associates every form <label> with its input via for/id.
//
// These tests assert on the on-disk artifacts and the HTML source
// directly, without needing a DOM, so they stay fast and dependency-free
// like the rest of this repo's test suite (see tests/server.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const indexHtmlPath = path.join(publicDir, 'index.html');
const html = fs.readFileSync(indexHtmlPath, 'utf8');

test('public/app.js no longer exists (orphaned by the landing-page removal)', () => {
  assert.equal(fs.existsSync(path.join(publicDir, 'app.js')), false);
});

test('public/styles.css no longer exists (orphaned by the landing-page removal)', () => {
  assert.equal(fs.existsSync(path.join(publicDir, 'styles.css')), false);
});

test('index.html no longer references the removed app.js or styles.css assets', () => {
  assert.doesNotMatch(html, /app\.js/);
  assert.doesNotMatch(html, /styles\.css/);
});

test('index.html is a single, well-formed document (exactly one doctype/html/head/body)', () => {
  assert.equal((html.match(/<!doctype html>/gi) || []).length, 1);
  assert.equal((html.match(/<html[\s>]/gi) || []).length, 1);
  assert.equal((html.match(/<\/html>/gi) || []).length, 1);
  assert.equal((html.match(/<head>/gi) || []).length, 1);
  assert.equal((html.match(/<body>/gi) || []).length, 1);
  assert.equal((html.match(/<\/body>/gi) || []).length, 1);
  // Everything after </html> would indicate leftover duplicated markup,
  // which was exactly the original bug.
  const afterClose = html.slice(html.toLowerCase().lastIndexOf('</html>') + '</html>'.length).trim();
  assert.equal(afterClose, '');
});

test('every non-submit <button> declares type="button" (prevents implicit form submission)', () => {
  const buttonTags = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttonTags.length > 0, 'expected the SPA to contain <button> elements');
  const missingType = buttonTags.filter(
    (tag) => !/type="submit"/.test(tag) && !/type="button"/.test(tag)
  );
  assert.deepEqual(missingType, [], 'every non-submit button must declare type="button"');
});

test('every <label for="..."> references an element that actually has that id', () => {
  const labelFors = [...html.matchAll(/<label\s+for="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labelFors.length > 0, 'expected the SPA forms to use <label for="...">');
  for (const id of labelFors) {
    const idPattern = new RegExp(`id="${id}"`);
    assert.match(html, idPattern, `no element with id="${id}" found for <label for="${id}">`);
  }
});

test('the auth modal login form posts against email/password field ids (matches server contract)', () => {
  assert.match(html, /id="login-email"/);
  assert.match(html, /id="login-password"/);
});

test('the auth modal register form posts against name/email/password field ids (matches server contract)', () => {
  assert.match(html, /id="reg-name"/);
  assert.match(html, /id="reg-email"/);
  assert.match(html, /id="reg-password"/);
});
