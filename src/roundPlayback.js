import { MUSIC_PROVIDERS, normalizeMusicProvider } from "./musicConstants.js";
import {
  searchTracks as searchAppleTracks,
  playPreview,
  stopPreview,
  playAppleMusicTrack,
  stopAppleMusicPlayback,
} from "./musickit/musickitService.js";

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
    if (deps.usesAppleMusic) {
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

export async function playRoundTrack(trackMeta, { playSpotifyUri, pauseSpotify } = {}) {
  await stopRoundPlayback({ pauseSpotify });

  if (trackMeta?.preview) {
    try {
      const audio = await playPreview(trackMeta.preview);
      playRoundTrack.activeAudio = audio;
      return { type: "preview", audio };
    } catch (e) {
      console.warn("Preview playback failed, trying full track", e);
    }
  }

  if (
    trackMeta?.uri &&
    trackMeta.provider === MUSIC_PROVIDERS.APPLE
  ) {
    try {
      const music = await playAppleMusicTrack(trackMeta.uri);
      playRoundTrack.activeMusic = music;
      return { type: "apple-music", music };
    } catch (e) {
      console.warn("Apple Music full playback failed", e);
    }
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
playRoundTrack.activeMusic = null;

export async function stopRoundPlayback({ pauseSpotify } = {}) {
  stopPreview(playRoundTrack.activeAudio);
  playRoundTrack.activeAudio = null;
  stopAppleMusicPlayback();
  playRoundTrack.activeMusic = null;
  if (pauseSpotify) {
    try {
      await pauseSpotify();
    } catch (e) {
      console.warn("Spotify pause failed", e);
    }
  }
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

  if (result?.type === "apple-music" && result.music) {
    const music = result.music;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      music.removeEventListener("playbackStateDidChange", onStateChange);
      clearTimeout(fallback);
      onDone();
    };
    const onStateChange = () => {
      const PS = window.MusicKit?.PlaybackStates;
      if (
        music.playbackState === PS?.ended ||
        music.playbackState === PS?.stopped
      ) {
        finish();
      }
    };
    music.addEventListener("playbackStateDidChange", onStateChange);
    const fallback = setTimeout(finish, 3 * 60 * 1000);
    return () => {
      done = true;
      clearTimeout(fallback);
      music.removeEventListener("playbackStateDidChange", onStateChange);
    };
  }

  const timer = setTimeout(onDone, 4_000);
  return () => clearTimeout(timer);
}
