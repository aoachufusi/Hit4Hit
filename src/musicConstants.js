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
