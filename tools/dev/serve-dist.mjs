/**
 * Serves ./dist with the Cloudflare SPA fallback configured in wrangler.jsonc:
 * static files where they exist, index.html for every app route.
 */
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

function isWithinRoot(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function findFile(root, path) {
  let file;
  try {
    file = await realpath(path);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
  // Check real paths too, so a symlink cannot bypass the URL path boundary.
  if (!isWithinRoot(root, file)) throw Object.assign(new Error('Forbidden'), { code: 'EACCES' });
  return (await stat(file)).isFile() ? file : null;
}

function sendError(res, status) {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end({ 400: 'Bad request', 403: 'Forbidden', 404: 'Not found', 500: 'Internal server error' }[status]);
}

export function createRequestHandler(directory) {
  const root = resolve(directory);
  return async (req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path.includes('\0')) return sendError(res, 400);
    } catch {
      return sendError(res, 400);
    }

    try {
      const realRoot = await realpath(root);
      const candidate = resolve(realRoot, `.${path}`);
      if (!isWithinRoot(realRoot, candidate)) return sendError(res, 403);
      const file = await findFile(realRoot, candidate) ?? await findFile(realRoot, join(realRoot, 'index.html'));
      if (!file) return sendError(res, 404);
      // Read before sending headers so failed reads produce a controlled response.
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      const status = error.code === 'EACCES' || error.code === 'EPERM' ? 403
        : error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500;
      sendError(res, status);
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? 'dist';
  const port = Number(process.argv[3] ?? 8090);
  createServer(createRequestHandler(root))
    .listen(port, '127.0.0.1', () => console.log(`dist on http://127.0.0.1:${port}`));
}
