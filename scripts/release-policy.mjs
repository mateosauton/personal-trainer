import { createHash } from 'node:crypto';

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function releaseInputs(env) {
  requireValue(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Native promotion requires a manual GitHub Actions run.');
  requireValue(env.EXPO_NO_DOTENV === '1', 'Release commands must disable local dotenv loading.');
  requireValue(env.GITHUB_REF === 'refs/heads/master', 'Dispatch this workflow from master.');
  requireValue(/^[0-9a-f]{40}$/.test(env.RELEASE_SHA ?? ''), 'RELEASE_SHA must be a full commit SHA.');
  requireValue(env.GITHUB_SHA === env.RELEASE_SHA, 'The dispatched master commit must equal RELEASE_SHA.');
  requireValue(['android', 'ios'].includes(env.RELEASE_PLATFORM), 'Select one explicit native platform.');
  for (const name of ['RELEASE_GROUP', 'RELEASE_TEST_BUILD', 'RELEASE_PRODUCTION_BUILD']) {
    requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env[name] ?? ''), `${name} must be an EAS ID.`);
  }
  requireValue(env.RELEASE_PHONE_TESTED === 'true', 'Explicit phone-test attestation is required.');
  requireValue(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+(?:#[-\w]+)?$/.test(env.RELEASE_EVIDENCE ?? ''), 'Link the phone test and backend compatibility evidence in a GitHub issue or PR.');
  return { sha: env.RELEASE_SHA, platform: env.RELEASE_PLATFORM, group: env.RELEASE_GROUP,
    testBuild: env.RELEASE_TEST_BUILD, productionBuild: env.RELEASE_PRODUCTION_BUILD,
    evidence: env.RELEASE_EVIDENCE };
}

function manifestOf(update) {
  const manifest = JSON.parse(update.manifestFragment);
  requireValue(manifest && typeof manifest === 'object', 'EAS returned an invalid update manifest.');
  return manifest;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function bundleIdentity(update) {
  const manifest = manifestOf(update);
  requireValue(manifest.launchAsset && Array.isArray(manifest.assets), 'Candidate asset identity is missing.');
  requireValue([manifest.launchAsset, ...manifest.assets].every(asset => typeof asset?.fileSHA256 === 'string' && asset.fileSHA256.length > 0 && typeof asset.storageKey === 'string' && asset.storageKey.length > 0), 'Candidate asset hashes or storage keys are missing.');
  return createHash('sha256').update(JSON.stringify(canonical({ launchAsset: manifest.launchAsset, assets: manifest.assets, extra: manifest.extra }))).digest('hex');
}

export function channelBranch(channel, expectedName) {
  requireValue(channel?.name === expectedName && channel.isPaused === false, `${expectedName} channel is missing or paused.`);
  const mapping = JSON.parse(channel.branchMapping);
  requireValue(mapping.version === 0 && mapping.data?.length === 1 && mapping.data[0].branchMappingLogic === 'true', `${expectedName} must have one unconditional branch mapping; rollouts are unsupported.`);
  const branch = channel.updateBranches?.find(candidate => candidate.id === mapping.data[0].branchId);
  requireValue(branch?.name === expectedName, `${expectedName} must point to its dedicated branch.`);
  return branch;
}

export function validateBuild(build, id, profile, channel, input, projectId) {
  requireValue(build?.id === id && build.app?.id === projectId, `${profile} build does not belong to this EAS project.`);
  requireValue(build.status === 'FINISHED' && build.platform?.toLowerCase() === input.platform, `${profile} build must be finished for ${input.platform}.`);
  requireValue(build.distribution === (profile === 'production' ? 'STORE' : 'INTERNAL'), `${profile} build has the wrong distribution. `);
  requireValue(build.buildProfile === profile && build.updateChannel?.name === channel, `${profile} build has the wrong profile or channel.`);
  requireValue(build.resolvedEnvironment === 'production', `${profile} build did not resolve the production environment.`);
  requireValue(build.isGitWorkingTreeDirty === false && /^[0-9a-f]{40}$/.test(build.gitCommitHash ?? ''), `${profile} build source is dirty or unknown.`);
  requireValue(build.developmentClient === false && build.isForIosSimulator === false, `${profile} must be a device release build.`);
  requireValue(build.appIdentifier === 'co.officegym.trainer', `${profile} build has the wrong application identifier.`);
  requireValue(typeof build.runtime?.version === 'string' && /^[0-9a-f]{40,64}$/.test(build.runtime.version) && build.fingerprint?.hash === build.runtime.version, `${profile} build lacks a matching fingerprint runtime.`);
  return build;
}

export function validateCandidate(data, input, { projectId, projectRef, expoConfig }, expectedBranch = 'release-test') {
  requireValue(Array.isArray(data.updatesByGroup) && data.updatesByGroup.length === 1, 'Candidate group must contain exactly one platform.');
  const update = data.updatesByGroup[0];
  requireValue(update.group === input.group && update.app?.id === projectId, 'Candidate group does not belong to this EAS project.');
  requireValue(update.platform === input.platform && update.gitCommitHash === input.sha && update.isGitWorkingTreeDirty === false, 'Candidate platform, source SHA, or clean source proof does not match.');
  requireValue(update.environment === 'production', 'Candidate was not exported with the production EAS environment.');
  requireValue(update.branch?.name === expectedBranch && update.isRollBackToEmbedded === false && !update.rolloutControlUpdate && [null, undefined, 100].includes(update.rolloutPercentage), 'Candidate branch or rollout state is unsupported.');
  requireValue(update.codeSigningInfo === null && !expoConfig.updates?.codeSigningCertificate && !expoConfig.updates?.codeSigningMetadata, 'This pipeline supports the current unsigned update configuration only; signing changes require a separate reviewed release design.');
  requireValue(!update.manifestHostOverride && !update.assetHostOverride, 'Custom manifest or asset hosts are unsupported.');
  const config = manifestOf(update).extra?.expoClient;
  requireValue(config?.extra?.appEnvironment === 'production' && config.extra.backendProjectRef === projectRef && config.extra.eas?.projectId === projectId, 'Candidate manifest does not prove the registered production backend and EAS project.');
  requireValue(config.updates?.url === `https://u.expo.dev/${projectId}`, 'Candidate update URL does not match this EAS project.');
  requireValue(!config.updates?.codeSigningCertificate && !config.updates?.codeSigningMetadata, 'Candidate signing configuration differs from the unsigned release policy.');
  requireValue(update.runtime?.version === update.fingerprint?.hash && /^[0-9a-f]{40,64}$/.test(update.runtime?.version ?? ''), 'Candidate lacks a matching fingerprint runtime.');
  bundleIdentity(update);
  return update;
}

export function validateRelease(data, input, config) {
  const test = validateBuild(data.builds?.test, input.testBuild, 'release-test', 'release-test', input, config.projectId);
  const production = validateBuild(data.builds?.production, input.productionBuild, 'production', 'production', input, config.projectId);
  const update = validateCandidate(data, input, config);
  requireValue(test.runtime.version === update.runtime.version && production.runtime.version === update.runtime.version, 'Candidate runtime must match both the tested binary and intended installed production binary; create a new binary for native changes.');
  const candidateBranch = channelBranch(data.app?.byId?.candidateChannel, 'release-test');
  const productionBranch = channelBranch(data.app?.byId?.productionChannel, 'production');
  requireValue(candidateBranch.id === update.branch.id && candidateBranch.id !== productionBranch.id, 'Candidate and production channels must use separate branches.');
  return { test, production, update, productionBranch };
}
