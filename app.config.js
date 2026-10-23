const { validateProcessEnvironment, resolveCommandContext } = require('./config/environment-policy.cjs');

module.exports = ({ config }) => {
  const context = resolveCommandContext(process.argv);
  let environment;
  try {
    environment = validateProcessEnvironment(process.env, context.readOnly ? { purpose: 'distribution' } : context);
  } catch (error) {
    if (!context.readOnly) throw error;
    // Configuration discovery must work before EAS can fetch valid variables.
    // Return stable app identity, never unvalidated routing evidence. Every
    // artifact-producing command reruns the strict guard in its own context.
    const extra = { ...config.extra };
    delete extra.appEnvironment;
    delete extra.backendProjectRef;
    return { ...config, extra };
  }
  return {
    ...config,
    extra: {
      ...config.extra,
      // Public routing evidence recorded in native and OTA manifests. Never
      // expose the key or developer credentials in Expo config.
      appEnvironment: environment.appEnvironment,
      backendProjectRef: environment.projectRef,
    },
  };
};
