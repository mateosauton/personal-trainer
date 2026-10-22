import assert from 'node:assert/strict';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const previewUrl = new URL('./serve-dist.mjs', import.meta.url);
let importId = 0;

async function loadPreview(root, runCLI = true) {
  const originalCreateServer = http.createServer;
  const originalArgv = process.argv;
  let listenArguments;
  http.createServer = () => {
    return { listen: (...args) => { listenArguments = args; } };
  };
  syncBuiltinESMExports();
  process.argv = ['node', runCLI ? fileURLToPath(previewUrl) : fileURLToPath(import.meta.url), root, '8090'];
  try {
    const module = await import(`${previewUrl}?test=${importId++}`);
    return { handler: module.createRequestHandler(root), listenArguments };
  } finally {
    http.createServer = originalCreateServer;
    syncBuiltinESMExports();
    process.argv = originalArgv;
  }
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'trainer-preview-'));
  const root = join(directory, 'dist');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<main>app shell</main>');
  writeFileSync(join(root, 'app.js'), 'window.preview = true;');
  writeFileSync(join(directory, 'outside.txt'), 'synthetic private file');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, root };
}

async function request(handler, url, method = 'GET') {
  const chunks = [];
  let status;
  let headers;
  const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.writeHead = (code, values) => { status = code; headers = values; return response; };
  const finished = new Promise((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
  });
  await handler({ url, method }, response);
  await finished;
  return { status, headers, body: Buffer.concat(chunks).toString() };
}

test('rejects encoded traversal outside the static root', async (t) => {
  const { root } = fixture(t);
  const { handler } = await loadPreview(root);
  for (const url of ['/..%2foutside.txt', '/%2e%2e%2foutside.txt', '/..%2fdist-other%2foutside.txt']) {
    const result = await request(handler, url);
    assert.equal(result.status, 403, url);
    assert.doesNotMatch(result.body, /synthetic private file/);
  }
});

test('rejects file and directory symlinks that leave the static root', async (t) => {
  const { directory, root } = fixture(t);
  symlinkSync(join(directory, 'outside.txt'), join(root, 'linked.txt'));
  symlinkSync(directory, join(root, 'linked-directory'));
  const { handler } = await loadPreview(root);
  for (const url of ['/linked.txt', '/linked-directory/outside.txt']) {
    const result = await request(handler, url);
    assert.equal(result.status, 403, url);
    assert.doesNotMatch(result.body, /synthetic private file/);
  }
});

test('checks containment of the SPA fallback', async (t) => {
  const { directory, root } = fixture(t);
  rmSync(join(root, 'index.html'));
  symlinkSync(join(directory, 'outside.txt'), join(root, 'index.html'));
  const { handler } = await loadPreview(root);
  assert.equal((await request(handler, '/plan')).status, 403);
});

test('serves static files and SPA routes', async (t) => {
  const { root } = fixture(t);
  const { handler } = await loadPreview(root);
  const asset = await request(handler, '/app.js?cache=1');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers['content-type'], 'text/javascript');
  assert.equal(asset.body, 'window.preview = true;');
  const route = await request(handler, '/session/synthetic/summary');
  assert.equal(route.status, 200);
  assert.equal(route.headers['content-type'], 'text/html');
  assert.equal(route.body, '<main>app shell</main>');
});

test('returns a controlled response for malformed URL encoding', async (t) => {
  const { root } = fixture(t);
  const { handler } = await loadPreview(root);
  for (const url of ['/%E0%A4%A', '/%00', 'http://[invalid']) {
    assert.equal((await request(handler, url)).status, 400, url);
  }
});

test('returns a controlled response when the SPA entry is missing', async (t) => {
  const { root } = fixture(t);
  rmSync(join(root, 'index.html'));
  const { handler } = await loadPreview(root);
  assert.equal((await request(handler, '/missing')).status, 404);
});

test('returns a controlled response when a static file cannot be read', async (t) => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('Requires Unix file permissions');
  const { root } = fixture(t);
  const asset = join(root, 'app.js');
  chmodSync(asset, 0);
  const { handler } = await loadPreview(root);
  const result = await request(handler, '/app.js');
  assert.equal(result.status, 403);
  assert.equal(result.body, 'Forbidden');
});

test('binds the CLI server to loopback', async (t) => {
  const { root } = fixture(t);
  const { listenArguments } = await loadPreview(root);
  assert.equal(listenArguments[0], 8090);
  assert.equal(listenArguments[1], '127.0.0.1');
});

test('can be imported without starting a server', async (t) => {
  const { root } = fixture(t);
  const { handler, listenArguments } = await loadPreview(root, false);
  assert.equal(listenArguments, undefined);
  assert.equal(typeof handler, 'function');
});
