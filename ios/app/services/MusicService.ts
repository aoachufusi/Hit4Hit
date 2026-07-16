/**
 * Unified host music playback for Hit 4 Hit iOS.
 *
 * - Apple Music → local MusicKit module (`ApplicationMusicPlayer`)
 * - Spotify → `react-native-spotify-remote` (Spotify iOS SDK App Remote)
 *
 * Audio always plays on the host device through the active route
 * (built-in, Bluetooth, AirPlay). Other players only see Firebase-synced
 * Now Playing state — they never start audio locally.
 */

import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import {
  MUSIC_PROVIDERS,
  normalizeMusicProvider,
  normalizePlaybackLimitSec,
  DEFAULT_PLAYBACK_LIMIT_SEC,
} from "@shared/constants/musicConstants.js";
import type {
  HostPlaybackState,
  MusicProvider,
  TrackMeta,
} from "../types/game";
import * as MusicKit from "hit-music-kit";

export class SubscriptionRequiredError extends Error {
  provider: MusicProvider;
  constructor(provider: MusicProvider, message?: string) {
    super(
      message ||
        (provider === "apple"
          ? "Apple Music subscription required for full playback"
          : "Spotify Premium required for full playback")
    );
    this.name = "SubscriptionRequiredError";
    this.provider = provider;
  }
}

export class MusicUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicUnavailableError";
  }
}

export type PlayableTrack = {
  title: string;
  artist: string;
  albumArt?: string | null;
  meta?: TrackMeta | null;
  /** Spotify: spotify:track:…  Apple: catalog song id */
  uri?: string | null;
  id?: string | null;
};

type SpotifyRemoteModule = {
  auth: {
    authorize: (config: Record<string, unknown>) => Promise<{ accessToken: string }>;
    getSession: () => Promise<{ accessToken: string } | null>;
    endSession: () => Promise<void>;
  };
  remote: {
    connect: (token: string) => Promise<void>;
    disconnect: () => Promise<void>;
    isConnectedAsync: () => Promise<boolean>;
    playUri: (uri: string) => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    seek: (ms: number) => Promise<void>;
  };
  ApiScope: Record<string, string>;
};

let spotifyMod: SpotifyRemoteModule | null | undefined;

function loadSpotifyRemote(): SpotifyRemoteModule | null {
  if (spotifyMod !== undefined) return spotifyMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    spotifyMod = require("react-native-spotify-remote") as SpotifyRemoteModule;
    return spotifyMod;
  } catch {
    spotifyMod = null;
    return null;
  }
}

function spotifyConfig() {
  const clientID =
    process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ||
    process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID_IOS ||
    "";
  const redirectURL =
    process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URL || "hit4hit://spotify-callback";
  const tokenSwapURL = process.env.EXPO_PUBLIC_SPOTIFY_TOKEN_SWAP_URL || "";
  const tokenRefreshURL =
    process.env.EXPO_PUBLIC_SPOTIFY_TOKEN_REFRESH_URL || "";
  return { clientID, redirectURL, tokenSwapURL, tokenRefreshURL };
}

type LimitTimer = ReturnType<typeof setTimeout> | null;

class MusicServiceImpl {
  private provider: MusicProvider = MUSIC_PROVIDERS.SPOTIFY as MusicProvider;
  private limitSec = DEFAULT_PLAYBACK_LIMIT_SEC;
  private limitTimer: LimitTimer = null;
  private onLimitReached: (() => void) | null = null;
  private connected = false;
  private spotifyReady = false;

  setProvider(provider: string | undefined | null) {
    this.provider = normalizeMusicProvider(provider) as MusicProvider;
  }

  getProvider(): MusicProvider {
    return this.provider;
  }

  setLimitSec(sec: number | undefined | null) {
    this.limitSec = normalizePlaybackLimitSec(sec);
  }

  getLimitSec(): number {
    return this.limitSec;
  }

  setOnLimitReached(cb: (() => void) | null) {
    this.onLimitReached = cb;
  }

  private clearLimitTimer() {
    if (this.limitTimer) {
      clearTimeout(this.limitTimer);
      this.limitTimer = null;
    }
  }

  private armLimitTimer(remainingMs?: number) {
    this.clearLimitTimer();
    const ms =
      remainingMs != null && remainingMs > 0
        ? remainingMs
        : this.limitSec * 1000;
    this.limitTimer = setTimeout(async () => {
      this.limitTimer = null;
      try {
        await this.stop({ haptic: true });
      } finally {
        this.onLimitReached?.();
      }
    }, ms);
  }

  /** Connect / authorize for the active provider. Throws SubscriptionRequiredError. */
  async connect(): Promise<void> {
    if (Platform.OS !== "ios") {
      throw new MusicUnavailableError("Full playback is only available on iOS");
    }

    if (this.provider === MUSIC_PROVIDERS.APPLE) {
      if (!MusicKit.isMusicKitAvailable()) {
        throw new MusicUnavailableError(
          "Apple MusicKit requires a native dev build (npx expo prebuild && expo run:ios)"
        );
      }
      const status = await MusicKit.authorize();
      if (status !== "authorized") {
        throw new MusicUnavailableError(
          "Apple Music access was denied — enable it in Settings"
        );
      }
      const sub = await MusicKit.checkSubscription();
      if (!sub.canPlayCatalogContent) {
        throw new SubscriptionRequiredError("apple");
      }
      this.connected = true;
      return;
    }

    // Spotify
    const spotify = loadSpotifyRemote();
    if (!spotify) {
      throw new MusicUnavailableError(
        "Spotify SDK unavailable — use a native dev build with react-native-spotify-remote"
      );
    }
    const cfg = spotifyConfig();
    if (!cfg.clientID) {
      throw new MusicUnavailableError(
        "Set EXPO_PUBLIC_SPOTIFY_CLIENT_ID in ios/.env"
      );
    }
    const scopes = [
      spotify.ApiScope?.AppRemoteControlScope,
      spotify.ApiScope?.StreamingScope,
      spotify.ApiScope?.UserReadPlaybackStateScope,
    ].filter(Boolean);

    let session: { accessToken: string } | null = null;
    try {
      session = await spotify.auth.getSession();
    } catch {
      session = null;
    }
    if (!session?.accessToken) {
      session = await spotify.auth.authorize({
        clientID: cfg.clientID,
        redirectURL: cfg.redirectURL,
        tokenSwapURL: cfg.tokenSwapURL || undefined,
        tokenRefreshURL: cfg.tokenRefreshURL || undefined,
        scopes,
        showDialog: false,
      });
    }
    await spotify.remote.connect(session.accessToken);
    this.spotifyReady = true;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.clearLimitTimer();
    try {
      if (this.provider === MUSIC_PROVIDERS.APPLE) {
        await MusicKit.stop();
      } else {
        const spotify = loadSpotifyRemote();
        if (spotify && this.spotifyReady) {
          await spotify.remote.disconnect();
        }
      }
    } catch {
      /* ignore */
    }
    this.connected = false;
    this.spotifyReady = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private resolveUri(track: PlayableTrack): string {
    if (this.provider === MUSIC_PROVIDERS.APPLE) {
      const id = track.id || track.meta?.id || track.uri;
      if (!id) throw new Error("Missing Apple Music song id");
      return String(id).replace(/^apple:song:/, "");
    }
    const uri =
      track.uri ||
      track.meta?.uri ||
      (track.id || track.meta?.id
        ? `spotify:track:${track.id || track.meta?.id}`
        : null);
    if (!uri) throw new Error("Missing Spotify track URI");
    return String(uri);
  }

  async play(
    track: PlayableTrack,
    options?: { remainingMs?: number }
  ): Promise<HostPlaybackState> {
    if (!this.connected) await this.connect();

    const limitSec = this.limitSec;
    const now = Date.now();
    const remaining =
      options?.remainingMs != null && options.remainingMs > 0
        ? options.remainingMs
        : limitSec * 1000;

    try {
      if (this.provider === MUSIC_PROVIDERS.APPLE) {
        await MusicKit.playSong(this.resolveUri(track));
      } else {
        const spotify = loadSpotifyRemote();
        if (!spotify) throw new MusicUnavailableError("Spotify SDK unavailable");
        await spotify.remote.playUri(this.resolveUri(track));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        /premium|subscription|catalog|403|not available/i.test(msg) ||
        e instanceof SubscriptionRequiredError
      ) {
        throw new SubscriptionRequiredError(this.provider, msg);
      }
      throw e;
    }

    this.armLimitTimer(remaining);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    return {
      status: "playing",
      title: track.title,
      artist: track.artist,
      albumArt: track.albumArt ?? track.meta?.albumArt ?? null,
      startedAt: now,
      endsAt: now + remaining,
      limitSec,
    };
  }

  async pause(): Promise<Partial<HostPlaybackState>> {
    this.clearLimitTimer();
    if (this.provider === MUSIC_PROVIDERS.APPLE) {
      await MusicKit.pause();
    } else {
      const spotify = loadSpotifyRemote();
      await spotify?.remote.pause();
    }
    await Haptics.selectionAsync();
    return { status: "paused" };
  }

  async resume(pausedRemainingMs?: number): Promise<HostPlaybackState> {
    const now = Date.now();
    const remaining =
      pausedRemainingMs != null && pausedRemainingMs > 0
        ? pausedRemainingMs
        : this.limitSec * 1000;

    if (this.provider === MUSIC_PROVIDERS.APPLE) {
      await MusicKit.resume();
    } else {
      const spotify = loadSpotifyRemote();
      await spotify?.remote.resume();
    }
    this.armLimitTimer(remaining);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    return {
      status: "playing",
      startedAt: now,
      endsAt: now + remaining,
      limitSec: this.limitSec,
      pausedRemainingMs: undefined,
    };
  }

  async stop(options?: { haptic?: boolean }): Promise<Partial<HostPlaybackState>> {
    this.clearLimitTimer();
    try {
      if (this.provider === MUSIC_PROVIDERS.APPLE) {
        await MusicKit.stop();
      } else {
        const spotify = loadSpotifyRemote();
        await spotify?.remote.pause();
      }
    } catch {
      /* ignore */
    }
    if (options?.haptic !== false) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    return { status: "stopped", endsAt: Date.now(), pausedRemainingMs: undefined };
  }

  /** Stop current track (used as skip-to-end of clip). */
  async skip(): Promise<Partial<HostPlaybackState>> {
    this.clearLimitTimer();
    try {
      if (this.provider === MUSIC_PROVIDERS.APPLE) {
        await MusicKit.skip();
      } else {
        const spotify = loadSpotifyRemote();
        await spotify?.remote.pause();
      }
    } catch {
      /* ignore */
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    return { status: "stopped", endsAt: Date.now() };
  }

  /** Capability probe for lobby UI. */
  async probe(): Promise<{
    provider: MusicProvider;
    available: boolean;
    needsSubscription: boolean;
    message?: string;
  }> {
    try {
      if (this.provider === MUSIC_PROVIDERS.APPLE) {
        if (!MusicKit.isMusicKitAvailable()) {
          return {
            provider: this.provider,
            available: false,
            needsSubscription: false,
            message: "Build a native iOS app to enable Apple Music",
          };
        }
        const sub = await MusicKit.checkSubscription();
        return {
          provider: this.provider,
          available: true,
          needsSubscription: !sub.canPlayCatalogContent,
          message: sub.canPlayCatalogContent
            ? undefined
            : "Apple Music subscription required",
        };
      }
      const spotify = loadSpotifyRemote();
      if (!spotify) {
        return {
          provider: this.provider,
          available: false,
          needsSubscription: false,
          message: "Build a native iOS app to enable Spotify",
        };
      }
      return {
        provider: this.provider,
        available: Boolean(spotifyConfig().clientID),
        needsSubscription: false,
        message: spotifyConfig().clientID
          ? undefined
          : "Add EXPO_PUBLIC_SPOTIFY_CLIENT_ID",
      };
    } catch (e) {
      return {
        provider: this.provider,
        available: false,
        needsSubscription: false,
        message: e instanceof Error ? e.message : "Unavailable",
      };
    }
  }
}

export const MusicService = new MusicServiceImpl();
