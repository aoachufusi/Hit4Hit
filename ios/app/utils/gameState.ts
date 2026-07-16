/**
 * Port of web/src/gameStateUtils.js helpers used by join + lobby.
 * Keep behavior identical to the web version.
 */

import type { GameState } from "../types/game";

export function toArray<T = unknown>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === "object") {
    return Object.keys(val as object)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (val as Record<string, T>)[k]);
  }
  return [];
}

function normalizeName(name: unknown): string {
  return String(name || "").trim();
}

export function namesMatch(a: unknown, b: unknown): boolean {
  return normalizeName(a) === normalizeName(b);
}

export function artistsMatch(a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

export function isArtistBlocked(
  name: unknown,
  blockedArtists: unknown
): boolean {
  if (!name) return false;
  return toArray<string>(blockedArtists).some((blocked) =>
    artistsMatch(name, blocked)
  );
}

/** Everyone in the lobby who is not one of the two music players. */
export function getActiveJudges(gs: GameState | null | undefined): string[] {
  if (!gs) return [];
  return toArray<string>(gs.judges);
}

export function isGameJudge(
  gs: GameState | null | undefined,
  myName: string | null | undefined
): boolean {
  if (!gs || !myName) return false;
  const me = normalizeName(myName);
  return getActiveJudges(gs).some((j) => normalizeName(j) === me);
}

export function playerLabel(name: unknown, fallback = "Player"): string {
  const label = String(name ?? "").trim();
  return label || fallback;
}

export function getRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Split vote → +1 each; majority → winner +2, loser +0. */
export function computeRoundPoints(votesForP0: number, votesForP1: number) {
  if (votesForP0 === votesForP1) {
    return { points: [1, 1] as [number, number], winner: null as number | null, tied: true };
  }
  const winner = votesForP0 > votesForP1 ? 0 : 1;
  return {
    points: (winner === 0 ? [2, 0] : [0, 2]) as [number, number],
    winner,
    tied: false,
  };
}

export type RoundHistoryEntry = {
  round?: number;
  song1?: string;
  song2?: string;
  song1Meta?: unknown;
  song2Meta?: unknown;
  winner?: number | null;
  tied?: boolean;
  points?: number[] | Record<string, number>;
  v1?: number;
  v2?: number;
};

export function roundPointsLabel(entry: RoundHistoryEntry | null | undefined): string {
  if (!entry) return "";
  if (entry.tied || entry.winner == null) return "+1 / +1";
  const pts = toArray<number>(entry.points);
  if (pts.length >= 2) return `+${pts[0]} / +${pts[1]}`;
  return entry.winner === 0 ? "+2 / +0" : "+0 / +2";
}

export function countAnonymousVotes(votes: Record<string, unknown> | null | undefined) {
  if (!votes || typeof votes !== "object") return { v0: 0, v1: 0, total: 0 };
  let v0 = 0;
  let v1 = 0;
  for (const k of Object.keys(votes)) {
    const val = votes[k];
    if (val === 0 || val === "0") v0++;
    else if (val === 1 || val === "1") v1++;
  }
  return { v0, v1, total: v0 + v1 };
}

export function looksLikeBallotVotes(votes: Record<string, unknown>): boolean {
  const keys = Object.keys(votes);
  if (keys.length === 0) return false;
  return keys[0].length > 18 || /[0-9a-f]{8}-[0-9a-f-]{4,}/i.test(keys[0]);
}

/** Song title stays hidden until that pick's turn to play (or after). */
export function isSongRevealed(gs: GameState | null | undefined, index: number): boolean {
  if (!gs) return false;
  const idx = gs.playbackIndex ?? 0;
  if (gs.phase === "playing" || gs.phase === "lobby") return false;
  if (gs.phase === "listening") return idx >= index;
  if (
    gs.phase === "judging" ||
    gs.phase === "result" ||
    gs.phase === "final"
  ) {
    return idx >= 2 || idx > index;
  }
  return false;
}

export function hiddenSongLabel(name: unknown): string {
  return `${playerLabel(name)}'s Pick Is In!`;
}

export function songDisplayTitle(
  gs: GameState,
  index: number,
  players: [string, string]
): string {
  const title = index === 0 ? gs.song1 : gs.song2;
  if (isSongRevealed(gs, index)) return title || "—";
  return hiddenSongLabel(players[index]);
}

function extractSongTitle(label: unknown): string {
  const s = String(label || "").trim();
  const idx = s.indexOf(" — ");
  return idx >= 0 ? s.slice(0, idx).trim() : s;
}

export function normalizeSongKey(label: unknown, meta?: { id?: string | null; provider?: string } | null): string {
  if (meta?.id) {
    return `id:${meta.provider || ""}:${meta.id}`;
  }
  const title = extractSongTitle(label).toLowerCase().replace(/\s+/g, " ").trim();
  return title ? `title:${title}` : "";
}

export function getPlayerUsedSongKeys(
  roundHistory: unknown,
  playerIndex: number
): Set<string> {
  const keys = new Set<string>();
  for (const entry of toArray<RoundHistoryEntry>(roundHistory)) {
    const label = playerIndex === 0 ? entry.song1 : entry.song2;
    const meta = (playerIndex === 0 ? entry.song1Meta : entry.song2Meta) as
      | { id?: string | null; provider?: string }
      | null
      | undefined;
    const key = normalizeSongKey(label, meta);
    if (key) keys.add(key);
  }
  return keys;
}

export function isSongAlreadyUsed(
  label: unknown,
  meta: { id?: string | null; provider?: string } | null | undefined,
  roundHistory: unknown,
  playerIndex: number
): boolean {
  const key = normalizeSongKey(label, meta);
  if (!key) return false;
  return getPlayerUsedSongKeys(roundHistory, playerIndex).has(key);
}

/** Normalize Firebase game snapshots for React rendering. */
export function normalizeGameState(g: GameState | null | undefined): GameState | null {
  if (!g) return null;
  try {
    const hostName = g.hostName || g.player1 || "";
    let members = toArray<string>(g.members);
    if (members.length === 0) {
      members = [
        ...new Set(
          [hostName, g.player2, ...toArray<string>(g.judges)].filter(Boolean) as string[]
        ),
      ];
    }
    const scores = toArray<number>(g.scores);
    let judges = toArray<string>(g.judges);
    if (g.player1 && g.player2 && members.length > 0) {
      judges = members.filter(
        (m) =>
          m &&
          normalizeName(m) !== normalizeName(g.player1) &&
          normalizeName(m) !== normalizeName(g.player2)
      );
    }
    const {
      spotifyAccessToken: _spotifyAccessToken,
      spotifyTokenObtainedAt: _spotifyTokenObtainedAt,
      spotifyTokenExpiresIn: _spotifyTokenExpiresIn,
      ...rest
    } = g as GameState & Record<string, unknown>;
    return {
      ...rest,
      hostName,
      members,
      judges,
      scores: scores.length >= 2 ? scores : [scores[0] ?? 0, scores[1] ?? 0],
      roundHistory: toArray(g.roundHistory),
    };
  } catch (e) {
    console.error("normalizeGameState failed", e, g);
    return {
      ...g,
      members: toArray(g.members),
      judges: toArray(g.judges),
      scores: [0, 0],
      roundHistory: [],
    };
  }
}
