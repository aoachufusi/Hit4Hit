/**
 * Provider-aware music search used by ArtistSearch / SongSearch.
 */

import {
  MUSIC_PROVIDERS,
  musicProviderLabel,
  normalizeMusicProvider,
} from "@shared/constants/musicConstants.js";
import type { MusicProvider } from "../types/game";
import { searchAppleArtists, searchAppleTracks } from "./appleMusicSearch";
import { searchSpotifyArtists, searchSpotifyTracks } from "./spotifySearch";
import type { SearchArtist, SearchTrack } from "../utils/trackMeta";

export function providerLabel(provider?: string | null): string {
  return musicProviderLabel(normalizeMusicProvider(provider));
}

export function usesApple(provider?: string | null): boolean {
  return normalizeMusicProvider(provider) === MUSIC_PROVIDERS.APPLE;
}

/** Search is always "ready" when the API base is configured (proxy handles tokens). */
export function isSearchReady(_provider?: string | null): boolean {
  return true;
}

export async function searchArtists(
  query: string,
  provider?: string | MusicProvider | null
): Promise<SearchArtist[]> {
  if (usesApple(provider)) return searchAppleArtists(query);
  return searchSpotifyArtists(query);
}

export async function searchTracks(
  query: string,
  artistName: string,
  provider?: string | MusicProvider | null
): Promise<SearchTrack[]> {
  if (usesApple(provider)) return searchAppleTracks(query, artistName);
  return searchSpotifyTracks(query, artistName);
}
