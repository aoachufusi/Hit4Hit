import {
  MUSIC_PROVIDERS,
  normalizeMusicProvider,
} from "@shared/constants/musicConstants.js";
import type { MusicProvider, TrackMeta } from "../types/game";

export type SearchArtist = {
  id?: string;
  name: string;
  image?: string | null;
};

export type SearchTrack = {
  id: string;
  name: string;
  uri?: string;
  preview?: string | null;
  preview_url?: string | null;
  artists?: { id?: string; name?: string }[];
  albumArt?: string | null;
  album?: { images?: { url?: string }[] };
};

/** Port of web `buildTrackMeta` — also maps album art when present. */
export function buildTrackMeta(
  track: SearchTrack | null | undefined,
  provider: string | MusicProvider
): TrackMeta | null {
  if (!track) return null;
  const normalized = normalizeMusicProvider(provider) as MusicProvider;
  const id = track.id ?? null;
  const uri =
    track.uri ??
    (normalized === MUSIC_PROVIDERS.SPOTIFY && id
      ? `spotify:track:${id}`
      : id);
  const preview = track.preview ?? track.preview_url ?? null;
  const albumArt =
    track.albumArt ??
    track.album?.images?.[0]?.url ??
    null;
  if (!uri && !preview) return null;
  return { id, uri, preview, albumArt, provider: normalized };
}

export function formatTrackLabel(track: SearchTrack): string {
  const artists =
    track.artists?.map((a) => a.name).filter(Boolean).join(", ") ||
    "Unknown artist";
  return `${track.name} — ${artists}`;
}
