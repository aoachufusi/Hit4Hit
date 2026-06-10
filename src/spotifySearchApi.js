import {
  searchArtistsWithToken,
  searchTracksWithToken,
} from "./spotifyApi.js";

async function proxySearch(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/spotify/search?${qs.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Spotify search failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body.items ?? [];
}

export async function searchSpotifyArtistsViaProxy(q, limit = 10) {
  return proxySearch({
    kind: "artists",
    q: String(q).trim(),
    limit: String(limit),
  });
}

export async function searchSpotifyTracksViaProxy(q, artistName, limit = 8) {
  return proxySearch({
    kind: "tracks",
    q: String(q).trim(),
    artistName: String(artistName).trim(),
    limit: String(limit),
  });
}

/** Proxy first; fall back to a local host token when the server secret is not configured. */
export async function searchSpotifyArtists(q, limit, { hostToken } = {}) {
  try {
    return await searchSpotifyArtistsViaProxy(q, limit);
  } catch (e) {
    if (e.status === 503 && hostToken) {
      return searchArtistsWithToken(hostToken, q, limit);
    }
    throw e;
  }
}

export async function searchSpotifyTracks(q, artistName, limit, { hostToken } = {}) {
  try {
    return await searchSpotifyTracksViaProxy(q, artistName, limit);
  } catch (e) {
    if (e.status === 503 && hostToken) {
      return searchTracksWithToken(hostToken, q, limit, { artistName });
    }
    throw e;
  }
}
