/**
 * Spotify catalog search via the web proxy (`GET /api/spotify/search`).
 * Same contract as web/src/spotifySearchApi.js.
 */

import { apiGetJson } from "./apiBase";
import type { SearchArtist, SearchTrack } from "../utils/trackMeta";

async function proxySearch(params: Record<string, string>) {
  const { ok, status, body } = await apiGetJson<{
    items?: SearchTrack[] | SearchArtist[];
    error?: string;
  }>("/api/spotify/search", params);
  if (!ok) {
    const err = new Error(body.error || `Spotify search failed (${status})`) as Error & {
      status?: number;
    };
    err.status = status;
    throw err;
  }
  return body.items ?? [];
}

export async function searchSpotifyArtists(
  q: string,
  limit = 10
): Promise<SearchArtist[]> {
  const items = await proxySearch({
    kind: "artists",
    q: String(q).trim(),
    limit: String(limit),
  });
  return (items as SearchArtist[])
    .map((a) => ({
      id: a.id,
      name: a.name,
      image: (a as SearchArtist & { images?: { url?: string }[] }).images?.[0]
        ?.url ?? (a as SearchArtist).image ?? null,
    }))
    .filter((a) => a.name);
}

export async function searchSpotifyTracks(
  q: string,
  artistName: string,
  limit = 8
): Promise<SearchTrack[]> {
  const items = await proxySearch({
    kind: "tracks",
    q: String(q).trim(),
    artistName: String(artistName).trim(),
    limit: String(limit),
  });
  return (items as SearchTrack[])
    .map((t) => ({
      ...t,
      albumArt: t.albumArt ?? t.album?.images?.[0]?.url ?? null,
      preview: t.preview ?? t.preview_url ?? null,
    }))
    .filter((t) => t?.name);
}
