import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { bundleIdentity, releaseInputs, requireValue, validateCandidate, validateRelease } from './release-policy.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_FIELDS = `id status platform distribution app { id } buildProfile updateChannel { name }
  resolvedEnvironment isGitWorkingTreeDirty gitCommitHash developmentClient isForIosSimulator
  appIdentifier runtime { version } fingerprint { hash }`;
const UPDATE_FIELDS = `id group app { id } branch { id name } platform gitCommitHash
  isGitWorkingTreeDirty environment runtime { version } fingerprint { hash }
  codeSigningInfo { keyid alg } manifestFragment isRollBackToEmbedded
  rolloutControlUpdate { id } rolloutPercentage manifestHostOverride assetHostOverride`;
const CHANNEL_FIELDS = 'name isPaused branchMapping updateBranches { id name }';
export const RELEASE_QUERY = `query ReleaseEvidence($test: ID!, $production: ID!, $group: ID!, $app: String!) {
  builds { test: byId(buildId: $test) { ${BUILD_FIELDS} } production: byId(buildId: $production) { ${BUILD_FIELDS} } }
  updatesByGroup(group: $group) { ${UPDATE_FIELDS} }
  app { byId(appId: $app) { candidateChannel: updateChannelByName(name: "release-test") { ${CHANNEL_FIELDS} }
    productionChannel: updateChannelByName(name: "production") { ${CHANNEL_FIELDS} } } }
}`;

export async function queryEas(query, variables, env, fetcher) {
  requireValue(typeof env.EXPO_TOKEN === 'string' && env.EXPO_TOKEN.length > 0, 'EXPO_TOKEN is required.');
  const response = await fetcher('https://api.expo.dev/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${env.EXPO_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000),
  });
  requireValue(response.ok, `EAS metadata request failed (${response.status}).`);
  const payload = await response.json();
  // Do not print responses, which may contain environment values or credentials.
  requireValue(!payload.errors?.length && payload.data, 'EAS metadata is unavailable or its schema changed. No release was authorized.');
  return payload.data;
}

export async function promoteRelease({ env = process.env, cwd = ROOT, fetcher = globalThis.fetch } = {}) {
  const input = releaseInputs(env);
  const run = (name, args) => execFileSync(name, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const { validateProcessEnvironment } = require(join(ROOT, 'config/environment-policy.cjs'));
  const backend = validateProcessEnvironment(env, { purpose: 'distribution' });
  requireValue(backend.appEnvironment === 'production', 'Promotion requires the production environment.');
  requireValue(/^eas-cli\/23\.2\.0\b/.test(run('eas', ['--version'])), 'Release tooling requires EAS CLI 23.2.0.');
  const assertSource = () => {
    requireValue(run('git', ['rev-parse', 'HEAD']) === input.sha, 'Checkout does not match the candidate source SHA.');
    requireValue(run('git', ['status', '--porcelain']) === '', 'Release checkout must be clean.');
    const remote = run('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/master']).split(/\s+/);
    requireValue(remote[0] === input.sha && remote[1] === 'refs/heads/master', 'Master moved; validate and test a fresh candidate.');
  };
  assertSource();
  const expoConfig = JSON.parse(run(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'public', '--json']));
  const projectId = expoConfig.extra?.eas?.projectId;
  requireValue(projectId === 'aa04a2aa-93a1-4e8f-ad57-84ed3e8c2bf5', 'Unexpected EAS project.');
  requireValue(expoConfig.extra?.appEnvironment === 'production' && expoConfig.extra?.backendProjectRef === backend.projectRef, 'Resolved Expo config has the wrong environment or backend.');
  const config = { projectId, projectRef: backend.projectRef, expoConfig };
  const variables = { test: input.testBuild, production: input.productionBuild, group: input.group, app: projectId };
  const data = await queryEas(RELEASE_QUERY, variables, env, fetcher);
  const verified = validateRelease(data, input, config);
  for (const build of [verified.test, verified.production]) {
    run('git', ['merge-base', '--is-ancestor', build.gitCommitHash, input.sha]);
    const sourceConfig = JSON.parse(run('git', ['show', `${build.gitCommitHash}:app.json`]));
    requireValue(!sourceConfig.expo?.updates?.codeSigningCertificate && !sourceConfig.expo?.updates?.codeSigningMetadata, 'Binary source signing configuration is unsupported.');
  }
  requireValue(env.RUNNER_TEMP, 'RUNNER_TEMP is required for a release receipt.');
  const receiptPath = join(env.RUNNER_TEMP, 'native-release.json');
  mkdirSync(dirname(receiptPath), { recursive: true });
  const receipt = { schemaVersion: 1, status: 'validated', sourceSha: input.sha, platform: input.platform,
    candidateGroup: input.group, candidateUpdate: verified.update.id, candidateBundleSha256: bundleIdentity(verified.update),
    runtime: verified.update.runtime.version, environment: 'production', backendProjectRef: backend.projectRef,
    testBuild: { id: verified.test.id, sourceSha: verified.test.gitCommitHash },
    productionBuild: { id: verified.production.id, sourceSha: verified.production.gitCommitHash },
    phoneTestAttestation: { actor: env.GITHUB_ACTOR, evidence: input.evidence, confirmed: true },
    workflowRun: env.GITHUB_RUN_ID, validatedAt: new Date().toISOString() };
  const save = () => writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  save();
  // Re-read channel/build/group evidence and master immediately before mutation.
  const latest = await queryEas(RELEASE_QUERY, variables, env, fetcher);
  const rechecked = validateRelease(latest, input, config);
  requireValue(bundleIdentity(rechecked.update) === receipt.candidateBundleSha256 && rechecked.productionBranch.id === verified.productionBranch.id, 'Candidate or production branch changed during validation.');
  assertSource();
  receipt.status = 'promotion-attempted';
  receipt.attemptedAt = new Date().toISOString();
  save();
  try {
    // The verified destination branch avoids resolving/creating a channel during this write.
    // This reuses the tested JS and assets. Never call `eas update` here.
    const output = JSON.parse(run('eas', ['update:republish', '--group', input.group, '--platform', input.platform,
      '--destination-branch', verified.productionBranch.name, '--message', `Promote ${input.sha.slice(0, 7)} (${input.platform})`, '--non-interactive', '--json']));
    requireValue(Array.isArray(output) && output.length === 1 && output[0].group && output[0].group !== input.group, 'Promotion returned an unexpected update group.');
    receipt.productionGroup = output[0].group;
    save();
    const published = await queryEas(`query PromotedEvidence($group: ID!) { updatesByGroup(group: $group) { ${UPDATE_FIELDS} } }`, { group: receipt.productionGroup }, env, fetcher);
    const update = validateCandidate(published, { ...input, group: receipt.productionGroup }, config, 'production');
    requireValue(bundleIdentity(update) === receipt.candidateBundleSha256 && update.branch?.id === verified.productionBranch.id, 'Production payload differs from the tested candidate.');
    receipt.status = 'promoted';
    receipt.promotedAt = new Date().toISOString();
    save();
    return receipt;
  } catch (error) {
    receipt.status = 'unknown-after-promotion-attempt';
    save();
    // A CLI error can contain a private environment value; log only this safe message.
    throw new Error('Promotion or post-promotion verification failed. Inspect the saved receipt and EAS before retrying; the write may already have succeeded.', { cause: error });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  promoteRelease().then(receipt => console.log(`Promoted ${receipt.productionGroup}; receipt: ${join(process.env.RUNNER_TEMP, 'native-release.json')}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
