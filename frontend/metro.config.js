const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // posthog-react-native imports subpaths (@posthog/core/surveys) that only
    // exist in its package.json "exports" map; Metro on RN 0.76 ignores that
    // map unless this is on. On by default from RN 0.79.
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
