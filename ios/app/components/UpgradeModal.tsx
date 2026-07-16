import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { MusicProvider } from "../types/game";
import { musicProviderLabel } from "@shared/constants/musicConstants.js";

type Props = {
  visible: boolean;
  provider?: MusicProvider;
  onClose: () => void;
};

/**
 * Shown when the host tries full playback without an active subscription.
 */
export default function UpgradeModal({
  visible,
  provider = "spotify",
  onClose,
}: Props) {
  const label = musicProviderLabel(provider);
  const openStore = () => {
    const url =
      provider === "apple"
        ? "https://apps.apple.com/app/apple-music/id1108187390"
        : "https://apps.apple.com/app/spotify-music/id324684580";
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Subscription needed</Text>
          <Text style={styles.body}>
            Full-track playback on the host device requires an active {label}{" "}
            subscription. Upgrade in the {label} app, then come back and tap
            play again.
          </Text>
          <Text style={styles.hint}>
            Guests never need a subscription — only the host plays audio.
          </Text>
          <Pressable style={styles.btn} onPress={openStore}>
            <Text style={styles.btnText}>Open {label}</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={onClose}>
            <Text style={styles.ghostText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#130d22",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3d2566",
    padding: 20,
    gap: 12,
  },
  title: {
    color: "#F0EBFF",
    fontSize: 22,
    fontWeight: "800",
  },
  body: {
    color: "#aa88d0",
    fontSize: 14,
    lineHeight: 22,
  },
  hint: {
    color: "#7a5fa8",
    fontSize: 12,
    lineHeight: 18,
  },
  btn: {
    backgroundColor: "#A855F7",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnText: { color: "#0D0A14", fontWeight: "800", fontSize: 15 },
  ghost: { paddingVertical: 10, alignItems: "center" },
  ghostText: { color: "#aa88d0", fontWeight: "600" },
});
