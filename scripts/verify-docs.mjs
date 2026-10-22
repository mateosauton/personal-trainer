/**
 * Checks the claims in docs/ that a machine can check.
 *
 * The handoff and improvement docs make a lot of numeric and structural
 * assertions. Every one that drifted in review drifted because a human had to
 * re-read 1,500 lines to notice. These are the ones that need not depend on
 * that: counts, byte sizes, anchors, and a few "this must stay absent" greps.
 *
 *   node scripts/verify-docs.mjs
 *
 * Exits non-zero on the first category that fails, so it can gate CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const docs = ['docs/ENGINEERING_HANDOFF.md', 'docs/IMPROVEMENTS.md'];

const failures = [];
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${actual}${ok ? '' : ` (docs say ${expected})`}`);
  if (!ok) failures.push(name);
};

// ---------------------------------------------------------------- catalog --
const catalog = JSON.parse(read('lib/data/exercises.json'));
check('catalog rows', catalog.length, 873);
check('catalog bytes', statSync(join(ROOT, 'lib/data/exercises.json')).size, 1082256);

const PREFIX = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises';
const derivable = catalog.every(
  (e) => e.media_refs.start === `${PREFIX}/${e.id}/0.jpg` && e.media_refs.end === `${PREFIX}/${e.id}/1.jpg`,
);
check('media_refs derivable from id', derivable, true);

// Keep the documented field consumers and preset writers explicit. Update R13
// when another source file starts using one of these fields.
const src = ['app', 'components', 'lib', 'scripts']
  .flatMap(function walk(d) {
    const full = join(ROOT, d);
    return readdirSync(full).flatMap((f) => {
      const p = join(d, f);
      return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
    });
  })
  .filter((p) => /\.(ts|tsx|mjs)$/.test(p)
    && !p.includes('data/exercises')
    && p !== 'scripts/verify-docs.mjs');   // this file names the very strings it hunts for

const fieldReferences = {
  instructions: ['app/session/[dayId]/run.tsx', 'lib/data/gym-routine-exercises.ts'],
  secondary_muscles: ['lib/data/gym-routine-exercises.ts'],
  force_type: ['lib/data/gym-routine-exercises.ts'],
};
for (const [field, expected] of Object.entries(fieldReferences)) {
  const references = src.filter(
    (p) => read(p).includes(field) && !/types\.ts$|build-catalog\.mjs$/.test(p),
  );
  check(`"${field}" reference files outside types.ts/build-catalog`, references.sort().join(','), expected.sort().join(','));
}

// ------------------------------------------------------------------ tests --
const queryFns = (read('lib/db/queries.ts').match(/^export (async )?function /gm) ?? []).length;
check('exported query functions', queryFns, 16);

// ------------------------------------------------- invariants docs rely on --
const alertCallers = src.filter(
  (p) => p !== 'lib/alerts.ts' && /\bAlert\.alert\b/.test(read(p)),
);
check('no direct Alert.alert outside lib/alerts.ts', alertCallers.join(',') || 'none', 'none');

const allEquipInTests = readdirSync(join(ROOT, '__tests__')).filter((f) =>
  read(join('__tests__', f)).includes('ALL_EQUIPMENT'),
);
check('ALL_EQUIPMENT still unreferenced by tests (R18)', allEquipInTests.join(',') || 'none', 'none');

const faintSites = src.filter((p) => read(p).includes('colors.faint'))
  .reduce((n, p) => n + (read(p).match(/colors\.faint/g) ?? []).length, 0);
check('colors.faint call sites', faintSites, 10);

// ------------------------------------------------------------- doc anchors --
const slug = (h) => h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-');
const anchors = Object.fromEntries(
  docs.map((d) => [d.split('/').pop(), new Set((read(d).match(/^#{2,4}\s+.*$/gm) ?? []).map((h) => slug(h.replace(/^#+\s+/, ''))))]),
);
let broken = 0;
for (const d of docs) {
  const self = d.split('/').pop();
  for (const m of read(d).matchAll(/\[[^\]]+\]\((?:\.\/)?([A-Za-z_]*\.md)?(#[a-z0-9-]+)\)/g)) {
    const target = m[1] ?? self;
    if (!anchors[target]?.has(m[2].slice(1))) { console.log(`      broken anchor in ${self}: ${m[1] ?? ''}${m[2]}`); broken += 1; }
  }
}
check('broken doc anchors', broken, 0);

// Mermaid: a sequence diagram must declare every participant it messages, and
// must not put %% comments on a message line (they render verbatim).
let mermaidProblems = 0;
for (const d of docs) {
  for (const [, block] of read(d).matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    if (/^\s*sequenceDiagram/.test(block)) {
      const declared = new Set([...block.matchAll(/(?:participant|actor) (\w+)/g)].map((m) => m[1]));
      for (const m of block.matchAll(/^\s*(\w+)\s*--?>>?\s*\+?-?(\w+)\s*:/gm)) {
        for (const p of [m[1], m[2]]) {
          if (!declared.has(p)) { console.log(`      undeclared participant "${p}" in ${d}`); mermaidProblems += 1; }
        }
      }
    }
    for (const line of block.split('\n')) {
      if (/--?>>?.*:/.test(line) && line.includes('%%')) { console.log(`      inline %% renders verbatim: ${line.trim()}`); mermaidProblems += 1; }
    }
  }
}
check('mermaid problems', mermaidProblems, 0);

// ------------------------------------------------------------------- drift --
const head = execFileSync('git', ['log', '--oneline', '-1'], { cwd: ROOT }).toString().split(' ')[0];
const pin = (read('docs/ENGINEERING_HANDOFF.md').match(/Verified against commit `([0-9a-f]+)`/) ?? [])[1];
if (head !== pin) {
  console.log(`note  HEAD is ${head}, docs pinned to ${pin} — re-read §5, §8, §11 and §13.2 before trusting them`);
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall doc checks passed');
process.exit(failures.length ? 1 : 0);
