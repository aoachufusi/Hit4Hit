import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { HostPlaybackState } from "../types/game";

type Props = {
  hostPlayback?: HostPlaybackState | null;
  /** Fallback title/artist when hostPlayback is sparse */
  title?: string;
  artist?: string;
  albumArt?: string | null;
  visible?: boolean;
};

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, "0")}` : `${r}s`;
}

/**
 * Shown on non-host devices while the host is playing.
 * Song name, artist, album art, countdown to clip end.
 */
export default function NowPlayingBanner({
  hostPlayback,
  title,
  artist,
  albumArt,
  visible = true,
}: Props) {
  const [remainingMs, setRemainingMs] = useState(0);

  const status = hostPlayback?.status;
  const show =
    visible &&
    hostPlayback &&
    (status === "playing" || status === "paused");

  useEffect(() => {
    if (!show || !hostPlayback) {
      setRemainingMs(0);
      return;
    }
    if (status === "paused") {
      setRemainingMs(hostPlayback.pausedRemainingMs ?? 0);
      return;
    }
    const tick = () => {
      const ends = hostPlayback.endsAt ?? 0;
      setRemainingMs(Math.max(0, ends - Date.now()));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [show, status, hostPlayback?.endsAt, hostPlayback?.pausedRemainingMs, hostPlayback]);

  if (!show) return null;

  const displayTitle = hostPlayback?.title || title || "Now playing";
  const displayArtist = hostPlayback?.artist || artist || "";
  const art = hostPlayback?.albumArt || albumArt;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>
        {status === "paused" ? "Paused on host" : "Now playing on host"}
      </Text>
      <View style={styles.row}>
        {art ? (
          <Image source={{ uri: art }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Text style={styles.artPlaceholderText}>♪</Text>
          </View>
        )}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>
            {displayTitle}
          </Text>
          {displayArtist ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {displayArtist}
            </Text>
          ) : null}
        </View>
        <View style={styles.timerBox}>
          <Text style={styles.timer}>{formatCountdown(remainingMs)}</Text>
          <Text style={styles.timerLabel}>left</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#160f25",
    borderColor: "#A855F744",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  eyebrow: {
    color: "#7a5fa8",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "700",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  art: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#130d22",
  },
  artPlaceholder: { alignItems: "center", justifyContent: "center" },
  artPlaceholderText: { color: "#A855F7", fontSize: 22 },
  meta: { flex: 1, gap: 2 },
  title: { color: "#F0EBFF", fontSize: 15, fontWeight: "700" },
  subtitle: { color: "#aa88d0", fontSize: 12 },
  timerBox: { alignItems: "center", minWidth: 48 },
  timer: { color: "#A855F7", fontSize: 20, fontWeight: "800" },
  timerLabel: { color: "#4a3370", fontSize: 10, textTransform: "uppercase" },
});
