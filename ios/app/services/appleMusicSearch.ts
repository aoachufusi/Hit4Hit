/**
 * Apple Music catalog search via the web proxy (`GET /api/apple-music/search`).
 * Mirrors web musickitService proxy path (no MusicKit JS on native).
 */

import { apiGetJson } from "./apiBase";
import {
  appleTrackByArtist,
  pickBestArtistMatch,
} from "../utils/musicSearchUtils";
import type { SearchArtist, SearchTrack } from "../utils/trackMeta";

type AppleArtwork = { url?: string };
type AppleArtist = {
  id: string;
  attributes?: {
    name?: string;
    artwork?: AppleArtwork;
    genreNames?: string[];
  };
};
type AppleSong = {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    previews?: { url?: string }[];
    artwork?: AppleArtwork;
  };
};

type AppleSearchBody = {
  results?: {
    artists?: { data?: AppleArtist[] };
    songs?: { data?: AppleSong[] };
  };
  error?: string;
};

function formatArtworkUrl(artwork: AppleArtwork | undefined, size: number) {
  if (!artwork?.url) return null;
  return artwork.url.replace("{w}", String(size)).replace("{h}", String(size));
}

async function proxyCatalogSearch(term: string, types: string, limit: number) {
  const { ok, status, body } = await apiGetJson<AppleSearchBody>(
    "/api/apple-music/search",
    {
      term: String(term).trim(),
      types,
      limit: String(limit),
    }
  );
  if (!ok) {
    throw new Error(body.error || `Apple Music search failed (${status})`);
  }
  return body;
}

const artistCache = new Map<string, SearchArtist>();

function mapArtist(a: AppleArtist): SearchArtist {
  return {
    id: a.id,
    name: a.attributes?.name || "",
    image: formatArtworkUrl(a.attributes?.artwork, 200),
  };
}

export async function searchAppleArtists(query: string): Promise<SearchArtist[]> {
  const body = await proxyCatalogSearch(query, "artists", 8);
  return (
    body.results?.artists?.data?.map(mapArtist).filter((a) => a.name) || []
  );
}

async function findArtistByName(artistName: string): Promise<SearchArtist | null> {
  const key = String(artistName || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (artistCache.has(key)) return artistCache.get(key)!;

  const artists = await searchAppleArtists(artistName);
  const match = pickBestArtistMatch(artists, artistName);
  if (match) artistCache.set(key, match);
  return match;
}

export async function searchAppleTracks(
  query: string,
  artistName: string
): Promise<SearchTrack[]> {
  const artist = await findArtistByName(artistName);
  if (!artist) return [];

  const term = `${String(query).trim()} ${artist.name}`;
  const body = await proxyCatalogSearch(term, "songs", 25);
  return (
    body.results?.songs?.data
      ?.filter((t) =>
        appleTrackByArtist(t.attributes?.artistName, artist.name)
      )
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        name: t.attributes?.name || "",
        uri: t.id,
        preview: t.attributes?.previews?.[0]?.url ?? null,
        albumArt: formatArtworkUrl(t.attributes?.artwork, 300),
        artists: [{ name: t.attributes?.artistName || artist.name }],
      }))
      .filter((t) => t.name) || []
  );
}
