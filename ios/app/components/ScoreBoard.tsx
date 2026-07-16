import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  playerLabel,
  roundPointsLabel,
  toArray,
  type RoundHistoryEntry,
} from "../utils/gameState";

type Props = {
  player1?: string;
  player2?: string;
  artist1?: string;
  artist2?: string;
  score1?: number;
  score2?: number;
  roundHistory?: unknown;
};

const C = "#A855F7";
const C2 = "#C4B5FD";

export default function ScoreBoard({
  player1,
  player2,
  artist1,
  artist2,
  score1 = 0,
  score2 = 0,
  roundHistory,
}: Props) {
  const [showScoring, setShowScoring] = useState(false);
  const players = [
    playerLabel(player1, "Player 1"),
    playerLabel(player2, "Player 2"),
  ];
  const history = toArray<RoundHistoryEntry>(roundHistory);
  const total = score1 + score2;
  const p0 = total > 0 ? (score1 / total) * 100 : 50;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>SCOREBOARD</Text>

      <View style={styles.matchup}>
        <View style={[styles.side, styles.sideLeft]}>
          <Text style={[styles.name, { color: C }]} numberOfLines={1}>
            {players[0].toUpperCase()}
          </Text>
          {artist1 ? (
            <Text style={styles.artist} numberOfLines={1}>
              {artist1}
            </Text>
          ) : null}
          <Text style={[styles.score, { color: C }]}>{score1}</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.side, styles.sideRight]}>
          <Text style={[styles.name, { color: C2 }]} numberOfLines={1}>
            {players[1].toUpperCase()}
          </Text>
          {artist2 ? (
            <Text style={styles.artist} numberOfLines={1}>
              {artist2}
            </Text>
          ) : null}
          <Text style={[styles.score, { color: C2 }]}>{score2}</Text>
        </View>
      </View>

      <View style={styles.bar}>
        <View style={[styles.barFill, { backgroundColor: C, width: `${p0}%` }]} />
        <View
          style={[styles.barFill, { backgroundColor: C2, width: `${100 - p0}%` }]}
        />
      </View>

      <Pressable onPress={() => setShowScoring((v) => !v)}>
        <Text style={styles.scoringToggle}>
          {showScoring ? "▾" : "▸"} Scoring System
        </Text>
      </Pressable>
      {showScoring ? (
        <View style={styles.scoringBody}>
          <Text style={styles.scoringText}>
            <Text style={styles.scoringStrong}>Split vote: </Text>
            Judges tie → both players get +1.
          </Text>
          <Text style={styles.scoringText}>
            <Text style={styles.scoringStrong}>Majority wins: </Text>
            Most judges pick one player → winner +2, loser +0.
          </Text>
        </View>
      ) : null}

      {history.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.historyLabel}>Round results</Text>
          {history.map((r, i) => (
            <View key={i} style={styles.hrow}>
              <Text style={styles.hRound}>R{r.round}</Text>
              <Text style={[styles.hSong, { color: C }]} numberOfLines={1}>
                {r.song1}
              </Text>
              <Text style={styles.hVs}>vs</Text>
              <Text
                style={[styles.hSong, styles.hSongRight, { color: C2 }]}
                numberOfLines={1}
              >
                {r.song2}
              </Text>
              {r.tied || r.winner == null ? (
                <Text style={styles.tagTie}>TIE</Text>
              ) : (
                <Text
                  style={[
                    styles.tagWin,
                    {
                      color: r.winner === 0 ? C : C2,
                      backgroundColor: r.winner === 0 ? "#a855f725" : "#c4b5fd18",
                    },
                  ]}
                >
                  {players[r.winner]}
                </Text>
              )}
              <Text style={styles.hPts}>{roundPointsLabel(r)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  heading: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#7a5fa8",
    marginBottom: 10,
  },
  matchup: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  side: { flex: 1 },
  sideLeft: { alignItems: "flex-start" },
  sideRight: { alignItems: "flex-end" },
  name: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  artist: { color: "#4a3370", fontSize: 10, marginTop: 2 },
  score: { fontSize: 40, fontWeight: "800", lineHeight: 44 },
  vs: {
    color: "#7a5fa8",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 1,
    paddingHorizontal: 8,
  },
  bar: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 12,
    gap: 3,
  },
  barFill: { height: "100%", borderRadius: 2 },
  scoringToggle: {
    color: "#7a5fa8",
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  scoringBody: {
    borderTopWidth: 1,
    borderTopColor: "#2e1f4a",
    paddingTop: 8,
    marginTop: 4,
    marginBottom: 8,
    gap: 6,
  },
  scoringText: { color: "#aa88d0", fontSize: 11, lineHeight: 16 },
  scoringStrong: { color: "#F0EBFF", fontWeight: "700" },
  history: { marginTop: 8 },
  historyLabel: {
    color: "#4a3370",
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  hrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  hRound: { color: "#4a3370", fontSize: 11, minWidth: 22 },
  hSong: { flex: 1, fontSize: 11 },
  hSongRight: { textAlign: "right" },
  hVs: { color: "#4a3370", fontSize: 9 },
  tagTie: {
    backgroundColor: "#160f25",
    color: "#aa88d0",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    overflow: "hidden",
  },
  tagWin: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: "600",
    overflow: "hidden",
  },
  hPts: { color: "#7a5fa8", fontSize: 10, minWidth: 44, textAlign: "right" },
});
