import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { HostPlaybackState } from "../types/game";

type Props = {
  hostPlayback?: HostPlaybackState | null;
  busy?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onStop: () => void;
};

/** Host transport controls — play / pause / skip / stop. */
export default function HostPlaybackControls({
  hostPlayback,
  busy,
  onPlay,
  onPause,
  onResume,
  onSkip,
  onStop,
}: Props) {
  const status = hostPlayback?.status;
  const isPlaying = status === "playing";
  const isPaused = status === "paused";

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>HOST CONTROLS</Text>
      <View style={styles.row}>
        {!isPlaying && !isPaused ? (
          <TouchableOpacity
            style={[styles.btn, styles.primary]}
            onPress={onPlay}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>▶ PLAY</Text>
          </TouchableOpacity>
        ) : null}

        {isPlaying ? (
          <TouchableOpacity
            style={[styles.btn, styles.primary]}
            onPress={onPause}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>⏸ PAUSE</Text>
          </TouchableOpacity>
        ) : null}

        {isPaused ? (
          <TouchableOpacity
            style={[styles.btn, styles.primary]}
            onPress={onResume}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>▶ RESUME</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.btn}
          onPress={onSkip}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>SKIP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btn}
          onPress={onStop}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>STOP</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12, gap: 8 },
  label: {
    color: "#7a5fa8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#130d22",
  },
  primary: {
    backgroundColor: "#A855F7",
    borderColor: "#A855F7",
    flexGrow: 1,
  },
  primaryText: { color: "#0D0A14", fontWeight: "800", fontSize: 14 },
  btnText: { color: "#aa88d0", fontWeight: "700", fontSize: 13 },
});
