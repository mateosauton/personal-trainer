const { validateProcessEnvironment } = require('../config/environment-policy.cjs');

function main(args = process.argv.slice(2), env = process.env) {
  let purpose = 'distribution';
  let expectedEnvironment;
  let selectedPurpose = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--distribution' || argument === '--development') {
      if (selectedPurpose) throw new Error('Choose one environment validation purpose.');
      purpose = argument.slice(2);
      selectedPurpose = true;
    } else if (argument === '--environment') {
      if (expectedEnvironment || !args[index + 1] || args[index + 1].startsWith('-')) throw new Error('--environment requires one explicit environment name.');
      expectedEnvironment = args[++index];
    } else throw new Error('Unknown environment validation argument.');
  }
  const config = validateProcessEnvironment(env, {
    purpose, expectedEnvironment, allowLocal: purpose === 'development', allowMock: purpose === 'development',
  });
  console.log(`Environment verified: ${config.appEnvironment} (${config.projectRef || 'loopback only'}; ${purpose}).`);
  return config;
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`Environment check failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { main };
