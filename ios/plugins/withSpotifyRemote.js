/**
 * Expo config plugin: Spotify URL scheme + LSApplicationQueriesSchemes
 * for react-native-spotify-remote / Spotify iOS SDK.
 */
const {
  withInfoPlist,
  createRunOncePlugin,
} = require("@expo/config-plugins");

function withSpotifyRemote(config, props = {}) {
  const scheme = props.scheme || "hit4hit";
  const callbackHost = props.callbackHost || "spotify-callback";

  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;

    const schemes = new Set([
      ...(Array.isArray(plist.CFBundleURLTypes)
        ? plist.CFBundleURLTypes.flatMap((t) => t.CFBundleURLSchemes || [])
        : []),
      scheme,
    ]);

    const existing = Array.isArray(plist.CFBundleURLTypes)
      ? plist.CFBundleURLTypes
      : [];
    const hasScheme = existing.some((t) =>
      (t.CFBundleURLSchemes || []).includes(scheme)
    );
    if (!hasScheme) {
      plist.CFBundleURLTypes = [
        ...existing,
        {
          CFBundleURLName: "app.hit4hit.spotify",
          CFBundleURLSchemes: [scheme],
        },
      ];
    }

    const queries = new Set([
      ...(plist.LSApplicationQueriesSchemes || []),
      "spotify",
    ]);
    plist.LSApplicationQueriesSchemes = Array.from(queries);

    // Document callback path for Spotify dashboard
    plist.SpotifyCallbackURL = `${scheme}://${callbackHost}`;

    return cfg;
  });
}

module.exports = createRunOncePlugin(
  withSpotifyRemote,
  "with-spotify-remote",
  "1.0.0"
);
