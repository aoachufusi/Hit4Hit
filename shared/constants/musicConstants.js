export const MUSIC_PROVIDERS = {
  SPOTIFY: "spotify",
  APPLE: "apple",
};

export function normalizeMusicProvider(value) {
  return value === MUSIC_PROVIDERS.APPLE
    ? MUSIC_PROVIDERS.APPLE
    : MUSIC_PROVIDERS.SPOTIFY;
}

export function musicProviderLabel(provider) {
  return provider === MUSIC_PROVIDERS.APPLE ? "Apple Music" : "Spotify";
}

/** Host clip length options (seconds) for full-track playback. */
export const PLAYBACK_LIMIT_OPTIONS = [15, 30, 45, 60, 90, 120];

export const DEFAULT_PLAYBACK_LIMIT_SEC = 30;

export function normalizePlaybackLimitSec(value) {
  const n = Number(value);
  return PLAYBACK_LIMIT_OPTIONS.includes(n) ? n : DEFAULT_PLAYBACK_LIMIT_SEC;
}

/** Host plays 30s preview clips — no Spotify login, DRM, or Premium required. */
export const SPOTIFY_PREVIEW_ONLY = true;

/** Normalize MusicKit catalog artists to match Spotify search shape. */
export function normalizeAppleArtists(results) {
  const data = results?.artists?.data ?? results?.artists ?? [];
  return data
    .map((item) => ({
      id: item.id,
      name: item.attributes?.name || item.name || "",
    }))
    .filter((item) => item.name);
}

/** Normalize MusicKit catalog songs to match Spotify search shape. */
export function normalizeAppleTracks(results) {
  const data = results?.songs?.data ?? results?.songs ?? [];
  return data
    .map((item) => {
      const name = item.attributes?.name || item.name || "";
      const artistName =
        item.attributes?.artistName ||
        item.attributes?.albumName ||
        "Unknown artist";
      return {
        id: item.id,
        name,
        uri: item.id,
        artists: [{ name: artistName }],
      };
    })
    .filter((item) => item.name);
}
