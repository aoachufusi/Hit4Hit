export type MusicProvider = "spotify" | "apple";

export type GamePhase =
  | "lobby"
  | "playing"
  | "listening"
  | "judging"
  | "result"
  | "final";

export type TrackMeta = {
  id?: string | null;
  uri?: string | null;
  preview?: string | null;
  albumArt?: string | null;
  provider?: MusicProvider;
};

export type HostPlaybackStatus = "idle" | "playing" | "paused" | "stopped";

/** Synced from host device so other players can show Now Playing + countdown. */
export type HostPlaybackState = {
  status: HostPlaybackStatus;
  trackIndex?: 0 | 1;
  title?: string;
  artist?: string;
  albumArt?: string | null;
  startedAt?: number;
  endsAt?: number;
  limitSec?: number;
  pausedRemainingMs?: number;
};

export type GameState = {
  code: string;
  hostName?: string;
  player1?: string;
  player2?: string;
  members?: string[] | Record<string, string>;
  judges?: string[] | Record<string, string>;
  scores?: number[] | Record<string, number>;
  phase?: GamePhase;
  currentRound?: number;
  rounds?: number;
  maxJudges?: number;
  musicProvider?: MusicProvider;
  /** Clip length in seconds: 15 | 30 | 45 | 60 | 90 | 120 */
  playbackLimitSec?: number;
  hostPlayback?: HostPlaybackState | null;
  artist1?: string;
  artist2?: string;
  song1?: string;
  song2?: string;
  song1Meta?: TrackMeta | null;
  song2Meta?: TrackMeta | null;
  p1Ready?: boolean;
  p2Ready?: boolean;
  playbackIndex?: number;
  judgeVotes?: Record<string, 0 | 1 | "0" | "1">;
  roundPunishment?: string;
  finalPunishment?: string;
  roundWinner?: number | null;
  roundHistory?: unknown[];
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
};
