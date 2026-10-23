# Environment isolation

Every app build selects a backend explicitly. Changing an EAS channel, native
bundle identifier or web URL does not create a separate database, Auth tenant
or Storage bucket. Development, preview and production need distinct Supabase
backend references in `config/environments.json`. An isolated Supabase branch
under the existing production project has its own instance, reference and API
credentials, so it can satisfy this boundary without another standalone project.

## Targets and boundaries

| Target | Backend | Data | Distribution |
| --- | --- | --- | --- |
| `local` | Supabase CLI on exactly `http://127.0.0.1:54321` | Synthetic accounts and disposable local records | Development only |
| `mock` | Exact test fixture key and loopback URL | Test fixtures | Development/test only |
| `development` | Its own registered hosted project | Synthetic accounts | EAS development client |
| `preview` | Its own registered hosted project | Synthetic accounts | PR web preview and internal preview binaries |
| `production` | `asbudyijvunpnhrhsubm` | Real user accounts and workouts | Production web, release-test and store builds |

The development and preview project references start as `null`. Their builds
fail until separate projects are provisioned and registered. The guard also
rejects a shared project reference, an incorrect URL, a mismatched legacy anon
JWT, an administrative key, a missing marker, or public developer credentials
in distribution. Opaque publishable keys are checked for public-key format;
Supabase authenticates whether they belong to the configured project.
`APP_ENV` and `EXPO_PUBLIC_APP_ENV` must both name the same target.

The public URL and publishable or legacy anon key belong in client configuration.
Access tokens, database passwords and service-role keys never belong in
`EXPO_PUBLIC_*`, app bundles or source control. Database RLS remains the authority
for user access. Environment validation prevents routing mistakes; it does not
replace RLS or authenticate a JWT.

## What was found on 22 October 2026

Read-only checks found all three EAS environments pointing to
`https://asbudyijvunpnhrhsubm.supabase.co`. The Cloudflare Worker
`personal-trainer` also uses this backend in both build triggers:

| Trigger | Branches | Publish command | Backend reference |
| --- | --- | --- | --- |
| Production `c2a31eac-fa7f-49e8-a448-93c21a1b5c35` | `master` | `npx wrangler deploy` | `asbudyijvunpnhrhsubm` |
| Preview `4c87308a-5735-4284-84fb-36932dd05cd2` | Every branch except `master` | `npx wrangler versions upload` | `asbudyijvunpnhrhsubm` |

Neither trigger contained the new environment markers at the initial inspection.
Existing previews therefore shared production data. The new guards block builds
with that unsafe configuration.

The maintainer selected the existing `office-gym-trainer` project,
`asbudyijvunpnhrhsubm`, in personal organization `phszlihdzycppyvriusv`
(`mateosauton's Org`). The signed-in dashboard confirms its `main` branch is
production, its region is `us-east-1`, and no development branches exist.
The Supabase connector is still scoped to `tfh` and denies this project's API
management requests; browser access is available. Do not use `tfh` for this app.

The current setup keeps this existing project for production and uses the local
stack for development. Hosted development and preview references remain `null`;
no additional paid projects or branches have been created. A future hosted
preview can use an isolated branch of this same parent after its costs and
configuration are reviewed. Its child URL must differ from the production URL;
renaming the production environment is insufficient.

Cloudflare's production trigger has now been configured and read back with
`APP_ENV=production`, `EXPO_PUBLIC_APP_ENV=production` and `EXPO_NO_DOTENV=1`.
Its existing backend URL, public key and provider flags were preserved. This
configuration change does not publish a build. EAS production now has the same
three markers. A clean-shell `eas env:exec production` downloaded those values
and passed the real distribution preflight for `asbudyijvunpnhrhsubm`. A read-only
request to that project's Auth settings API accepted its configured public key
with HTTP 200. No update or web deployment was published by these checks.
Preview configuration remains blocked until an isolated backend is registered.
Production migration history,
hosted Auth settings and PostgreSQL major version remain unverified.

## Start a separate local backend

Requirements are Node 22, npm and a running local Docker engine. The wrapper pins
Supabase CLI `2.120.0` through `npx`; no Supabase account, login, link or hosted
credential is required. Its first run may download the CLI and container images.

```sh
npm ci
npm run db:local:start
npm run db:local:env
npm run db:local:seed
npm start
```

The local stack has a different container/volume identity,
`office-gym-trainer-local`. It supplies Postgres, GoTrue Auth, API, Storage,
Studio at `http://127.0.0.1:54323`, and a local email inbox at
`http://127.0.0.1:54324`. Migration `0002` creates the local `avatars` bucket
and its ownership policies. Real user records and production avatar objects
are never copied into it.

`db:local:env` writes an ignored `.env.local` containing only the local URL,
public client key, both `local` markers and disabled Google sign-in. It refuses
to overwrite an existing file. Move an existing `.env.local` aside deliberately
before generating one. Environment variables already exported in your shell
take precedence over Expo dotenv files, so unset old hosted values before
starting. Do not put local settings in shared EAS environments.

`db:local:seed` uses the local Auth admin endpoint to create two confirmed
synthetic accounts. Both use password `local-test-password-Only1!`:

- `trainer-a@example.test`
- `trainer-b@example.test`

These are disposable local identities. Sign in through the ordinary app UI and
complete onboarding, equipment selection and plan creation. No public auto-login
password or bypass flag is added to the app. New signups retain email confirmation;
open their messages in the local inbox to test confirmation and password recovery.
Google/Apple provider flows need separate provider configuration and are not
established by this local seed.

The exact loopback URL works in a desktop browser and an iOS simulator sharing
the host network. A physical phone or Android emulator cannot use that address
to reach the host. Use the isolated hosted development project for those devices;
do not substitute the production URL or weaken the local URL guard.

The wrapper accepts only its documented modes, drops hosted Supabase environment
credentials from child processes, checks the returned local API/database origins,
rejects remote Docker hosts, and never forwards CLI output containing admin keys.
An unavailable local stack is an error, never a reason to use production.

### Port conflicts and state

Ports `54320` through `54324` must be free before starting this stack. Another
checkout may already use them. Inspect local container names and ports first:

```sh
docker ps --format '{{.Names}} {{.Ports}}'
```

Stop the other stack only when its owner and data are understood. The wrapper
does not stop unrelated containers or choose a different backend automatically.
Use one running app backend at a time with this committed port contract. Git
worktrees share the configured local stack identity; they do not each receive
their own database.

```sh
npm run db:local:test
npm run db:local:stop
# Deletes records in this local stack and reapplies repository migrations.
npm run db:local:reset -- --confirm-local-reset
npm run db:local:seed
```

`stop` retains local volumes. Start the stack again before resetting it. Reset
requires the explicit confirmation flag and always passes `--local`; it accepts
no project reference, remote database URL or extra CLI flags. Database SQL tests
run only inside `supabase_db_office-gym-trainer-local`, with errors stopping the
run. Existing tests roll back their fixtures.

## Migrations and hosted setup

The nine existing migration files are preserved byte for byte. A fresh local
Supabase database can replay them in filename order. This does not prove an
existing hosted database can replay them safely. The deployed history uses
legacy `0001` through `0007` names mixed with timestamps, and production's
recorded versions have not been reconciled with those files.

For development and preview provisioning, the maintainer should:

1. Use the selected personal organization and production parent above. Choose
   isolated branches of that project or distinct empty standalone projects, with
   explicit cost limits. Branches incur their own compute and usage charges.
   Local development needs neither. Do not create hosted resources without cost approval.
2. For an empty standalone project, apply the reviewed schema. A dashboard
   branch derives its schema from the parent's migration history or a schema dump:
   inspect the resulting schema before applying anything and never blindly replay
   the nine baseline files into a populated branch. Keep "Include data" disabled.
   Verify ownership policies and SQL regression tests using synthetic accounts. Never restore a production data
   dump into a preview project. Confirm the hosted PostgreSQL major version and
   align the local test runtime before treating version parity as established.
3. Register each public project reference in `config/environments.json`. Keep keys
   out of that registry. Configure the matching URL, public key and both environment
   markers in the corresponding EAS environment and Cloudflare build trigger.
4. Configure exact Auth callback URLs for each environment and native scheme,
   email templates/SMTP, any OAuth credentials and function secrets separately.
   A database migration does not copy these settings. Check avatar bucket ownership
   with both accounts. Upload only synthetic image files.
5. Build and exercise onboarding, allowed equipment, plan creation, set logging,
   interrupted sync, avatar upload and password recovery. Record the backend
   reference beside the app commit and build identifier before promotion.

For production, capture the deployed migration history and backup evidence before
any database upgrade. Reconcile legacy file versions without replaying the schema
or rewriting old migration bytes. This PR does not perform that operation.

## Cloudflare and EAS configuration

For each EAS environment, configure these names with that target's own values:

```text
APP_ENV=development|preview|production
EXPO_PUBLIC_APP_ENV=development|preview|production
EXPO_PUBLIC_SUPABASE_URL=https://<that-target-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=<that-target-public-client-key>
```

EAS profiles select their corresponding target. `release-test` deliberately uses
production to test the production runtime and must follow production controls.
It is not a sandbox for destructive tests. OTA channel choice also follows the
target. Use the guarded `npm run update:preview` or `npm run update:candidate`
commands inside the matching `eas env:exec`; only the manual promotion workflow
can publish through the supported production path. Expo config discovery runs
in a child process and cannot validate raw EAS channel arguments. Direct raw
EAS publishing is outside this guard; keep publishing access restricted and
follow [RELEASE_SAFETY.md](RELEASE_SAFETY.md).

Set the same four names separately on Cloudflare's production and preview build
triggers. Keep `EXPO_NO_DOTENV=1`, `EXPO_NO_TELEMETRY=1` and Node 22 in hosted builds.
Worker runtime variables do not populate an Expo static bundle. The values must
exist when the web assets are exported.

Cloudflare Workers injects `WORKERS_CI_BRANCH`. The environment guard requires
`production` on `master` and `preview` on every other branch. A source branch
cannot opt into production by setting its own `APP_ENV`. Production still needs
its explicit markers; existing production values are not inferred automatically.

Changing backend settings affects future builds. Already installed apps and
already exported web assets retain their embedded backend URL until replaced.
Deleting a configuration variable does not disconnect those clients.

## Verification evidence

On 22 October 2026, the local guard tests passed. A real disposable Supabase
stack using CLI `2.120.0`, PostgreSQL 17 and unchanged copies of all nine migrations
also passed both SQL regressions, two synthetic Auth password sign-ins, separate
profile reads through PostgREST/RLS, an owner avatar upload, and rejection of
another user's upload into that owner's Storage folder.

An existing unrelated local stack occupied the committed `5432x` ports. That
startup failed safely. The integration check ran under its own temporary stack
identity on `55320` through `55324`; it did not stop or modify the existing stack.
The alternate-port check verifies the service configuration and migration replay,
while the committed wrapper's exact-port routing and refusal paths are covered
by its boundary tests. No hosted service or installed native app was verified
by that integration check.

## References

- [Supabase local development configuration](https://supabase.com/docs/guides/local-development/cli/config) defines the local service settings and callback allowlist.
- [Supabase branching](https://supabase.com/docs/guides/deployment/branching) explains isolated instances, separate credentials and branches without production data.
- [Supabase branch billing](https://supabase.com/docs/guides/platform/manage-your-usage/branching) describes usage charges; branches are not covered by compute credits or the spend cap.
- [Supabase database migrations](https://supabase.com/docs/guides/local-development/database-migrations) describes fresh-local replay and deployment history.
- [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) documents build variables and `WORKERS_CI_BRANCH`.
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/) explains public values embedded in app bundles.
