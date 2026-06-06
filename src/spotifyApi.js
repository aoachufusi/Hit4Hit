/** Spotify GET /v1/search only allows limit in the range 1–10 (per API docs). */
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

export async function searchTracksWithToken(token, q, limit = 8, opts = {}) {
  const hint = opts.artistName?.trim();
  const queryStr = hint
    ? `${String(q).trim()} artist:${hint.replace(/"/g, "")}`
    : String(q).trim();
  const lim = clampSearchLimit(limit, 8);
  const params = new URLSearchParams({
    q: queryStr,
    type: "track",
    limit: String(lim),
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
  return data.tracks?.items ?? [];
}
