/**
 * Serves ./dist the way vercel.json says the hosted build is served: static
 * files where they exist, index.html for every app route.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8090);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const candidate = join(root, path);
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`dist on http://localhost:${port}`));
