/** Spotify GET /v1/search only allows limit in the range 1–10 (per API docs). */
import {
  normalizeArtistName,
  pickBestArtistMatch,
  spotifyTrackByArtist,
} from "./musicSearchUtils.js";

export function clampSearchLimit(limit, fallback = 10) {
  const x = Math.floor(Number(limit));
  if (!Number.isFinite(x)) return Math.min(10, Math.max(1, fallback));
  return Math.min(10, Math.max(1, x));
}

export function isSharedSpotifyTokenValid(gs) {
  if (!gs?.spotifyAccessToken || !gs.spotifyTokenObtainedAt || !gs.spotifyTokenExpiresIn) {
    return false;
  }
  const expiresAt = gs.spotifyTokenObtainedAt + gs.spotifyTokenExpiresIn * 1000;
  return Date.now() < expiresAt - 60_000;
}

export async function searchArtistsWithToken(token, q, limit = 10) {
  const lim = clampSearchLimit(limit, 10);
  const params = new URLSearchParams({
    q: String(q).trim(),
    type: "artist",
    limit: String(lim),
    market: "US",
  });
  const res = await fetch(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Artist search failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.artists?.items ?? [];
}

const spotifyArtistCache = new Map();

export async function findArtistWithToken(token, artistName) {
  const key = normalizeArtistName(artistName);
  if (!key) return null;
  if (spotifyArtistCache.has(key)) return spotifyArtistCache.get(key);

  const items = await searchArtistsWithToken(token, artistName, 10);
  const match = pickBestArtistMatch(items, artistName);
  if (match) spotifyArtistCache.set(key, match);
  return match || null;
}

export async function searchTracksWithToken(token, q, limit = 8, opts = {}) {
  const artistName = opts.artistName?.trim();
  if (!artistName) return [];

  const artist = await findArtistWithToken(token, artistName);
  if (!artist) return [];

  const queryStr = `track:${String(q).trim()} artist:"${artist.name.replace(/"/g, "")}"`;
  const lim = clampSearchLimit(limit, 8);
  const params = new URLSearchParams({
    q: queryStr,
    type: "track",
    limit: String(Math.min(10, lim * 3)),
  });
  const res = await fetch(
    `https://api.spotify.com/v1/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Search failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return (data.tracks?.items ?? [])
    .filter((track) => spotifyTrackByArtist(track, artist.id))
    .slice(0, lim);
}
