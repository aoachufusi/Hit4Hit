import { requireNativeModule, Platform } from "expo-modules-core";

type SubscriptionInfo = {
  canPlayCatalogContent: boolean;
  hasAnySubscriptionOffers?: boolean;
  error?: string;
};

type PlayerState = {
  status: string;
  playbackTime?: number;
  title?: string;
  artist?: string;
  albumArt?: string;
};

type HitMusicKitNative = {
  authorize(): Promise<string>;
  getAuthorizationStatus(): Promise<string>;
  checkSubscription(): Promise<SubscriptionInfo>;
  playSong(songId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  skip(): Promise<void>;
  getPlayerState(): Promise<PlayerState>;
};

let native: HitMusicKitNative | null = null;

function getNative(): HitMusicKitNative | null {
  if (Platform.OS !== "ios") return null;
  if (native) return native;
  try {
    native = requireNativeModule<HitMusicKitNative>("HitMusicKit");
    return native;
  } catch {
    return null;
  }
}

export function isMusicKitAvailable(): boolean {
  return getNative() != null;
}

export async function authorize(): Promise<string> {
  const mod = getNative();
  if (!mod) throw new Error("MusicKit native module unavailable — use a dev build");
  return mod.authorize();
}

export async function getAuthorizationStatus(): Promise<string> {
  const mod = getNative();
  if (!mod) return "unavailable";
  return mod.getAuthorizationStatus();
}

export async function checkSubscription(): Promise<SubscriptionInfo> {
  const mod = getNative();
  if (!mod) {
    return { canPlayCatalogContent: false, error: "MusicKit unavailable" };
  }
  return mod.checkSubscription();
}

export async function playSong(songId: string): Promise<void> {
  const mod = getNative();
  if (!mod) throw new Error("MusicKit native module unavailable");
  return mod.playSong(songId);
}

export async function pause(): Promise<void> {
  await getNative()?.pause();
}

export async function resume(): Promise<void> {
  await getNative()?.resume();
}

export async function stop(): Promise<void> {
  await getNative()?.stop();
}

export async function skip(): Promise<void> {
  await getNative()?.skip();
}

export async function getPlayerState(): Promise<PlayerState | null> {
  const mod = getNative();
  if (!mod) return null;
  return mod.getPlayerState();
}

export default {
  isMusicKitAvailable,
  authorize,
  getAuthorizationStatus,
  checkSubscription,
  playSong,
  pause,
  resume,
  stop,
  skip,
  getPlayerState,
};
