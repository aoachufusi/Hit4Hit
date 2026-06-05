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
    return {
      ...g,
      hostName,
      members,
      judges: toArray(g.judges),
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
