/**
 * Firebase RTDB stores arrays as { "0": …, "1": … }. Coerce to real arrays.
 */
export function toArray(val) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") {
    return Object.keys(val)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => val[k]);
  }
  return [];
}

/** Normalize Firebase game snapshots for React rendering. */
export function normalizeGameState(g) {
  if (!g) return g;
  try {
    const hostName = g.hostName || g.player1 || "";
    let members = toArray(g.members);
    if (members.length === 0) {
      members = [
        ...new Set(
          [hostName, g.player2, ...toArray(g.judges)].filter(Boolean)
        ),
      ];
    }
    const scores = toArray(g.scores);
    let judges = toArray(g.judges);
    if (g.player1 && g.player2 && members.length > 0) {
      judges = members.filter(
        (m) =>
          m &&
          normalizeName(m) !== normalizeName(g.player1) &&
          normalizeName(m) !== normalizeName(g.player2)
      );
    }
    return {
      ...g,
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

export function playerLabel(name, fallback = "Player") {
  return (name && String(name).trim()) || fallback;
}

/** Everyone in the lobby who is not one of the two music players. */
export function getActiveJudges(gs) {
  if (!gs) return [];
  return toArray(gs.judges);
}

function normalizeName(name) {
  return String(name || "").trim();
}

export function namesMatch(a, b) {
  return normalizeName(a) === normalizeName(b);
}

export function isGameJudge(gs, myName) {
  if (!gs || !myName) return false;
  const me = normalizeName(myName);
  return getActiveJudges(gs).some((j) => normalizeName(j) === me);
}

/** Max points one player can earn in a single round (majority win). */
export const MAX_POINTS_PER_ROUND = 2;

/** Split vote → +1 each; majority → winner +2, loser +0. */
export function computeRoundPoints(votesForP0, votesForP1) {
  if (votesForP0 === votesForP1) {
    return { points: [1, 1], winner: null, tied: true };
  }
  const winner = votesForP0 > votesForP1 ? 0 : 1;
  return {
    points: winner === 0 ? [2, 0] : [0, 2],
    winner,
    tied: false,
  };
}

export function roundPointsLabel(entry) {
  if (!entry) return "";
  if (entry.tied || entry.winner == null) return "+1 / +1";
  const pts = entry.points || (entry.winner === 0 ? [2, 0] : [0, 2]);
  return `+${pts[0]} / +${pts[1]}`;
}
