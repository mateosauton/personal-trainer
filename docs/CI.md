# CI and releases

GitHub Actions runs `.github/workflows/checks.yml` on pull requests, pushes to
`master`, and manual runs. Node 22 and `npm ci` use the committed lockfile.

The checks run TypeScript, core workout and security tests, and a web export.
Pull requests use mock public Supabase settings and receive no release secrets.
There are no screen, layout, animation, screenshot, or browser interaction tests.
The auth-provider test mounts a null-returning probe to check account isolation
and recovery races without exercising a screen.

## Local checks

```sh
npm ci
npm run check:web
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=mock npm run build:web
```

`npm test` runs the retained Jest suite and disposable PostgreSQL checks.
`npm run test:unit` and `npm run test:db` run them separately. Database checks use
PGlite in memory and need no Supabase credentials or running database. They cover
row policies, account isolation, progression replay, write ordering, timed sets,
and complete account exports. The latest-schema checks apply every migration
and execute the SQL tests in `supabase/tests/`. Historical migration checks also
remain to protect existing workout records during upgrades.

## Native CD

After checks pass on `master`, Actions publishes an EAS Update with the
production channel and production environment. Manual runs on other branches
run checks only. The repository needs the `EXPO_TOKEN` Actions secret, which was
already configured when this workflow was added. Public app configuration stays
in the EAS production environment.

Production publishing is serialized and an active publish is never cancelled by
a new push. Queued releases skip commits that are no longer the head of `master`.
Expo's fingerprint runtime policy limits delivery to compatible
installed builds. Native dependency changes require a new binary through EAS
Build; this workflow does not build or submit store binaries.

## Web CD

Cloudflare Workers Builds keeps deploying the `personal-trainer` web app from
`master`. Its existing `npx wrangler deploy` command runs the same
`npm run check:web` gate before exporting the production web bundle through the
custom build in `wrangler.jsonc`. Its build environment supplies the real public
Supabase settings. It does not use the mock bundle built by the PR check job.

Cloudflare runs independently of GitHub's native release job. This change keeps
that integration and requires no new Cloudflare token in GitHub. Legacy GitHub
Pages/CDN publishing and the Vercel polling workflow have been removed.
