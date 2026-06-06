import { MUSIC_PROVIDERS, normalizeMusicProvider } from "./musicConstants.js";
import { searchTracks as searchAppleTracks, playPreview, stopPreview } from "./musickit/musickitService.js";

export function extractSongTitle(label) {
  const s = String(label || "").trim();
  const idx = s.indexOf(" — ");
  return idx >= 0 ? s.slice(0, idx).trim() : s;
}

export function buildTrackMeta(track, provider) {
  if (!track) return null;
  const normalized = normalizeMusicProvider(provider);
  const id = track.id ?? null;
  const uri =
    track.uri ??
    (normalized === MUSIC_PROVIDERS.SPOTIFY && id ? `spotify:track:${id}` : id);
  const preview = track.preview ?? track.preview_url ?? null;
  if (!uri && !preview) return null;
  return { id, uri, preview, provider: normalized };
}

export async function resolveTrackForPlayback(meta, label, artist, deps) {
  if (meta?.preview || meta?.uri) return meta;

  const query = extractSongTitle(label);
  if (!query || !artist) return meta ?? null;

  try {
    if (deps.iUseAppleMusic) {
      const tracks = await searchAppleTracks(query, artist);
      return buildTrackMeta(tracks[0], MUSIC_PROVIDERS.APPLE) ?? meta ?? null;
    }
    if (deps.searchSpotifyTracks) {
      const tracks = await deps.searchSpotifyTracks(query, artist);
      return buildTrackMeta(tracks[0], MUSIC_PROVIDERS.SPOTIFY) ?? meta ?? null;
    }
  } catch {
    /* fall through */
  }
  return meta ?? null;
}

export async function playRoundTrack(trackMeta, { playSpotifyUri } = {}) {
  stopPreview(playRoundTrack.activeAudio);
  playRoundTrack.activeAudio = null;

  if (trackMeta?.preview) {
    const audio = await playPreview(trackMeta.preview);
    playRoundTrack.activeAudio = audio;
    return { type: "preview", audio };
  }

  if (
    trackMeta?.uri &&
    trackMeta.provider === MUSIC_PROVIDERS.SPOTIFY &&
    playSpotifyUri
  ) {
    await playSpotifyUri(trackMeta.uri);
    return { type: "spotify" };
  }

  return { type: "none" };
}

playRoundTrack.activeAudio = null;

export function stopRoundPlayback() {
  stopPreview(playRoundTrack.activeAudio);
  playRoundTrack.activeAudio = null;
}

export function waitForPlaybackEnd(result, onDone) {
  if (!onDone) return () => {};

  if (result?.type === "preview" && result.audio) {
    const audio = result.audio;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      onDone();
    };
    audio.addEventListener("ended", finish, { once: true });
    const fallback = setTimeout(finish, 32_000);
    return () => {
      done = true;
      clearTimeout(fallback);
      audio.removeEventListener("ended", finish);
    };
  }

  if (result?.type === "spotify") {
    const timer = setTimeout(onDone, 3 * 60 * 1000);
    return () => clearTimeout(timer);
  }

  const timer = setTimeout(onDone, 4_000);
  return () => clearTimeout(timer);
}
