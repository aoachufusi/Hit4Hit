import { MUSIC_PROVIDERS, normalizeMusicProvider } from "./musicConstants.js";
import {
  searchTracks as searchAppleTracks,
  playPreview,
  stopPreview,
  playAppleMusicTrack,
  stopAppleMusicPlayback,
  resetAppleMusicPlayback,
  unlockPreviewAudio,
  isPreviewActivelyPlaying,
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

async function tryPlayPreview(trackMeta, limitSec = 30, primedAudio = null) {
  if (!trackMeta?.preview && !primedAudio) return null;

  const waitForPreviewStart = (audio, timeoutMs = 4000) =>
    new Promise((resolve) => {
      if (isPreviewActivelyPlaying(audio)) {
        resolve(true);
        return;
      }
      const done = (ok) => {
        clearTimeout(timer);
        audio.removeEventListener("playing", onPlaying);
        audio.removeEventListener("canplay", onPlaying);
        resolve(ok);
      };
      const onPlaying = () => done(isPreviewActivelyPlaying(audio));
      audio.addEventListener("playing", onPlaying, { once: true });
      audio.addEventListener("canplay", onPlaying, { once: true });
      const timer = setTimeout(() => done(isPreviewActivelyPlaying(audio)), timeoutMs);
    });

  try {
    if (primedAudio) {
      if (!isPreviewActivelyPlaying(primedAudio)) {
        await waitForPreviewStart(primedAudio);
      }
      if (isPreviewActivelyPlaying(primedAudio)) {
        playRoundTrack.activeAudio = primedAudio;
        return { type: "preview", audio: primedAudio };
      }
      try {
        await primedAudio.play();
        await waitForPreviewStart(primedAudio, 2500);
        if (isPreviewActivelyPlaying(primedAudio)) {
          playRoundTrack.activeAudio = primedAudio;
          return { type: "preview", audio: primedAudio };
        }
      } catch {
        /* fall through to reload */
      }
    }
    if (!trackMeta?.preview) return null;
    unlockPreviewAudio();
    const audio = await playPreview(trackMeta.preview, {
      songId: trackMeta.id ?? trackMeta.uri ?? trackMeta.preview,
      limitSec,
    });
    playRoundTrack.activeAudio = audio;
    return { type: "preview", audio };
  } catch (e) {
    if (e?.name === "NotAllowedError") {
      return { type: "autoplay-blocked" };
    }
    if (e?.message !== "Preview superseded while buffering") {
      console.warn("Preview playback failed", e);
    }
    return null;
  }
}

async function tryPlayAppleFull(trackMeta, activeProvider, gestureMusic = null) {
  const provider = trackMeta?.provider ?? activeProvider;
  if (!trackMeta?.uri || provider !== MUSIC_PROVIDERS.APPLE) {
    return null;
  }
  try {
    const music = await playAppleMusicTrack(trackMeta.uri, { gestureMusic });
    playRoundTrack.activeMusic = music;
    return { type: "apple-music", music };
  } catch (e) {
    console.warn("Apple Music full playback failed", e);
    throw e;
  }
}

async function tryPlaySpotifyFull(trackMeta, playSpotifyUri, activeProvider) {
  const provider = trackMeta?.provider ?? activeProvider;
  if (
    !trackMeta?.uri ||
    provider !== MUSIC_PROVIDERS.SPOTIFY ||
    !playSpotifyUri
  ) {
    return null;
  }
  try {
    await playSpotifyUri(trackMeta.uri);
    return { type: "spotify" };
  } catch (e) {
    console.warn("Spotify full playback failed", e);
    throw e;
  }
}

export async function playRoundTrack(
  trackMeta,
  {
    playSpotifyUri,
    pauseSpotify,
    preferFullTrack = false,
    previewLimitSec = 30,
    activeProvider,
    appleGestureMusic = null,
    primedPreviewAudio = null,
    preferGesturePreview = false,
  } = {}
) {
  const keepPlaying = Boolean(appleGestureMusic || primedPreviewAudio);
  if (keepPlaying) {
    await stopPreview(null, { keepAudioContext: true, keepPlaying: true });
  } else {
    await stopPreview();
  }
  if (!keepPlaying) {
    playRoundTrack.activeAudio = null;
  }
  if (pauseSpotify) {
    try {
      await pauseSpotify();
    } catch (e) {
      console.warn("Spotify pause failed", e);
    }
  }

  const meta = trackMeta
    ? { ...trackMeta, provider: trackMeta.provider ?? activeProvider }
    : null;

  if (preferGesturePreview && primedPreviewAudio) {
    if (appleGestureMusic) {
      try {
        appleGestureMusic.stop?.();
      } catch {
        /* ignore */
      }
    }
    const preview = await tryPlayPreview(
      meta,
      previewLimitSec,
      primedPreviewAudio
    );
    if (preview?.type === "preview" || preview?.type === "autoplay-blocked") {
      return preview;
    }
  }

  const tryFull = async () => {
    try {
      const apple = await tryPlayAppleFull(
        meta,
        activeProvider,
        appleGestureMusic
      );
      if (apple) return apple;
      return await tryPlaySpotifyFull(meta, playSpotifyUri, activeProvider);
    } catch (e) {
      return { type: "error", error: e };
    }
  };

  if (preferFullTrack) {
    const full = await tryFull();
    if (full && full.type !== "error") return full;
    const preview = await tryPlayPreview(meta, previewLimitSec, primedPreviewAudio);
    if (preview?.type === "autoplay-blocked") return preview;
    if (preview) return preview;
    if (full?.type === "error") return full;
  } else {
    const preview = await tryPlayPreview(meta, previewLimitSec, primedPreviewAudio);
    if (preview && preview.type !== "autoplay-blocked") return preview;
    const full = await tryFull();
    if (full?.type === "error") return full;
    if (full) return full;
    if (preview?.type === "autoplay-blocked") return preview;
  }

  return { type: "none" };
}

playRoundTrack.activeAudio = null;
playRoundTrack.activeMusic = null;

export async function stopRoundPlayback({ pauseSpotify, resetApple = true } = {}) {
  await stopPreview();
  playRoundTrack.activeAudio = null;
  if (resetApple) {
    resetAppleMusicPlayback();
  } else {
    stopAppleMusicPlayback();
  }
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
    const fallback = setTimeout(finish, 34_000);
    return () => {
      done = true;
      clearTimeout(fallback);
      audio.removeEventListener("ended", finish);
    };
  }

  if (result?.type === "spotify") {
    const durationMs = result.durationMs ?? 8 * 60 * 1000;
    const timer = setTimeout(onDone, Math.min(durationMs + 5000, 12 * 60 * 1000));
    return () => clearTimeout(timer);
  }

  if (result?.type === "apple-music" && result.music) {
    const music = result.music;
    const PS = window.MusicKit?.PlaybackStates;
    let done = false;
    let sawPlaying = Boolean(music.isPlaying);

    const finish = () => {
      if (done) return;
      done = true;
      music.removeEventListener("playbackStateDidChange", onStateChange);
      clearTimeout(fallback);
      onDone();
    };

    const onStateChange = () => {
      if (music.isPlaying || music.playbackState === PS?.playing) {
        sawPlaying = true;
        return;
      }
      if (!sawPlaying) return;
      if (
        music.playbackState === PS?.ended ||
        music.playbackState === PS?.completed
      ) {
        finish();
      }
    };

    music.addEventListener("playbackStateDidChange", onStateChange);

    const item = music.nowPlayingItem;
    const durationMs =
      item?.attributes?.durationInMillis ??
      (music.currentPlaybackDuration > 0
        ? music.currentPlaybackDuration * 1000
        : 0);
    const fallbackMs =
      durationMs > 0
        ? Math.min(durationMs + 8000, 12 * 60 * 1000)
        : 8 * 60 * 1000;
    const fallback = setTimeout(finish, fallbackMs);

    return () => {
      done = true;
      clearTimeout(fallback);
      music.removeEventListener("playbackStateDidChange", onStateChange);
    };
  }

  const timer = setTimeout(onDone, 4_000);
  return () => clearTimeout(timer);
}
