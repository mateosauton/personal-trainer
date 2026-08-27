/**
 * GitHub Pages serves a project site from /<repo>/, not from the domain root,
 * so the exported bundle has to know its prefix. Expo takes that as
 * `experiments.baseUrl`, which is a build-time value baked into every asset
 * URL — hence patching app.json in CI rather than committing it, so a
 * root-hosted build of the same commit stays correct.
 *
 *   node .github/scripts/set-base-url.mjs /personal-trainer
 */
import { readFileSync, writeFileSync } from 'node:fs';

const baseUrl = process.argv[2] ?? '';
const path = new URL('../../app.json', import.meta.url);

const config = JSON.parse(readFileSync(path, 'utf8'));
config.expo.experiments = { ...config.expo.experiments, baseUrl };
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);

console.log(`experiments.baseUrl = ${JSON.stringify(baseUrl)}`);
