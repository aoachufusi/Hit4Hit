import { useCallback, useEffect, useRef, useState } from "react";
import {
  MusicService,
  SubscriptionRequiredError,
  type PlayableTrack,
} from "../services/MusicService";
import type {
  GameState,
  HostPlaybackState,
  MusicProvider,
  TrackMeta,
} from "../types/game";
import {
  DEFAULT_PLAYBACK_LIMIT_SEC,
  normalizeMusicProvider,
  normalizePlaybackLimitSec,
} from "@shared/constants/musicConstants.js";

type PatchFn = (
  patch: Partial<GameState> & Record<string, unknown>
) => Promise<void>;

function trackFromGame(
  game: GameState,
  index: 0 | 1
): PlayableTrack {
  const title = (index === 0 ? game.song1 : game.song2) || "Unknown";
  const artist = (index === 0 ? game.artist1 : game.artist2) || "";
  const meta = (index === 0 ? game.song1Meta : game.song2Meta) as
    | TrackMeta
    | null
    | undefined;
  return {
    title,
    artist,
    albumArt: meta?.albumArt ?? null,
    meta,
    uri: meta?.uri,
    id: meta?.id,
  };
}

/**
 * Host-only playback controller. Syncs `hostPlayback` to Firebase so
 * guests render the Now Playing banner + countdown.
 */
export function useHostPlayback(
  game: GameState | null,
  isHost: boolean,
  patch: PatchFn
) {
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [upgradeProvider, setUpgradeProvider] = useState<MusicProvider>("spotify");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limitCbRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!game || !isHost) return;
    MusicService.setProvider(game.musicProvider);
    MusicService.setLimitSec(game.playbackLimitSec);
  }, [game?.musicProvider, game?.playbackLimitSec, isHost, game]);

  useEffect(() => {
    MusicService.setOnLimitReached(() => {
      limitCbRef.current?.();
    });
    return () => {
      MusicService.setOnLimitReached(null);
    };
  }, []);

  const syncPlayback = useCallback(
    async (partial: Partial<HostPlaybackState> & { trackIndex?: 0 | 1 }) => {
      if (!game || !isHost) return;
      const prev = game.hostPlayback || { status: "idle" as const };
      const next: HostPlaybackState = {
        ...prev,
        ...partial,
      };
      await patch({ hostPlayback: next });
    },
    [game, isHost, patch]
  );

  const handleSubscriptionError = (e: unknown) => {
    if (e instanceof SubscriptionRequiredError) {
      setUpgradeProvider(e.provider);
      setUpgradeVisible(true);
      return true;
    }
    return false;
  };

  const playIndex = useCallback(
    async (index: 0 | 1) => {
      if (!game || !isHost) return;
      setBusy(true);
      setError(null);
      try {
        const track = trackFromGame(game, index);
        if (!track.id && !track.uri && !track.meta?.preview) {
          // Allow play attempt; MusicService will throw a clear error
        }
        // Prefer full SDK play; if only preview URL exists and no id, fall through error
        const state = await MusicService.play(track);
        await syncPlayback({
          ...state,
          trackIndex: index,
          title: track.title,
          artist: track.artist,
          albumArt: track.albumArt,
        });
      } catch (e) {
        if (!handleSubscriptionError(e)) {
          setError(e instanceof Error ? e.message : "Playback failed");
        }
      } finally {
        setBusy(false);
      }
    },
    [game, isHost, syncPlayback]
  );

  const pause = useCallback(async () => {
    if (!game || !isHost) return;
    setBusy(true);
    try {
      const hp = game.hostPlayback;
      const remaining =
        hp?.endsAt != null ? Math.max(0, hp.endsAt - Date.now()) : undefined;
      await MusicService.pause();
      await syncPlayback({
        status: "paused",
        pausedRemainingMs: remaining,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pause failed");
    } finally {
      setBusy(false);
    }
  }, [game, isHost, syncPlayback]);

  const resume = useCallback(async () => {
    if (!game || !isHost) return;
    setBusy(true);
    try {
      const remaining = game.hostPlayback?.pausedRemainingMs;
      const state = await MusicService.resume(remaining);
      await syncPlayback({
        ...state,
        pausedRemainingMs: undefined,
      });
    } catch (e) {
      if (!handleSubscriptionError(e)) {
        setError(e instanceof Error ? e.message : "Resume failed");
      }
    } finally {
      setBusy(false);
    }
  }, [game, isHost, syncPlayback]);

  const stop = useCallback(async () => {
    if (!game || !isHost) return;
    setBusy(true);
    try {
      const state = await MusicService.stop();
      await syncPlayback(state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setBusy(false);
    }
  }, [game, isHost, syncPlayback]);

  const skip = useCallback(async () => {
    if (!game || !isHost) return;
    setBusy(true);
    try {
      const state = await MusicService.skip();
      await syncPlayback(state);
      limitCbRef.current?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skip failed");
    } finally {
      setBusy(false);
    }
  }, [game, isHost, syncPlayback]);

  /** Register what happens when the clip duration limit fires (e.g. advance). */
  const setOnClipEnded = useCallback((cb: (() => void) | null) => {
    limitCbRef.current = cb;
  }, []);

  const connect = useCallback(async () => {
    if (!isHost) return;
    setBusy(true);
    setError(null);
    try {
      if (game?.musicProvider) MusicService.setProvider(game.musicProvider);
      if (game?.playbackLimitSec != null) {
        MusicService.setLimitSec(game.playbackLimitSec);
      }
      await MusicService.connect();
    } catch (e) {
      if (!handleSubscriptionError(e)) {
        setError(e instanceof Error ? e.message : "Connect failed");
      }
    } finally {
      setBusy(false);
    }
  }, [game?.musicProvider, game?.playbackLimitSec, isHost]);

  return {
    playIndex,
    pause,
    resume,
    stop,
    skip,
    connect,
    setOnClipEnded,
    busy,
    error,
    upgradeVisible,
    upgradeProvider,
    setUpgradeVisible,
    limitSec: normalizePlaybackLimitSec(
      game?.playbackLimitSec ?? DEFAULT_PLAYBACK_LIMIT_SEC
    ),
    provider: normalizeMusicProvider(game?.musicProvider) as MusicProvider,
  };
}
