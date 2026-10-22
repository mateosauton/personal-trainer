const { validateProcessEnvironment, resolveCommandContext } = require('./config/environment-policy.cjs');

module.exports = ({ config }) => {
  const context = resolveCommandContext(process.argv);
  if (context.readOnly) return config;
  const environment = validateProcessEnvironment(process.env, context);
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
