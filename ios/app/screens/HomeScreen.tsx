import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import type { StackScreenProps } from "@react-navigation/stack";
import type { RootStackParamList } from "../navigation/types";
import { colors, spacing } from "../constants/theme";
import { useAuth } from "../hooks/useAuth";
import { isFirebaseConfigured } from "../firebase/config";

type Props = StackScreenProps<RootStackParamList, "Home">;

const HOW_IT_WORKS: ReadonlyArray<readonly [string, string]> = [
  ["🎮", "Host creates a room, picks Spotify or Apple Music, & shares the code"],
  ["👥", "Host picks exactly two music players (can include themself)"],
  ["🎤", "Those two each pick an artist; everyone else is a judge"],
  ["🎵", "Up to 12 rounds: players pick a hit each round; judges vote anonymously"],
  ["🔒", "Votes stay hidden until everyone has voted — then the reveal"],
  ["🍺", "Round loser drinks. Game loser faces the FINAL punishment"],
];

/**
 * Home screen — mirrors web `hit-for-hit-v2.jsx` screen === "home"
 */
export default function HomeScreen({ navigation }: Props) {
  const { loading, error, ensureAnonymous } = useAuth();
  const [busy, setBusy] = useState(false);

  const go = async (route: "CreateGame" | "JoinGame") => {
    if (busy) return;
    setBusy(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (isFirebaseConfigured) {
        await ensureAnonymous();
      }
      navigation.navigate(route);
    } catch (e) {
      console.error("Home navigation failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.brand}>
            HIT <Text style={styles.brandAccent}>4</Text> HIT
          </Text>
          <Text style={styles.tagline}>
            The ultimate artist battle drinking game
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btnPrimary, (loading || busy) && styles.btnDisabled]}
            onPress={() => go("CreateGame")}
            disabled={loading || busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>🎤 Create a Game</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnSecondary, (loading || busy) && styles.btnDisabled]}
            onPress={() => go("JoinGame")}
            disabled={loading || busy}
            activeOpacity={0.85}
          >
            <Text style={styles.btnSecondaryText}>🔑 Join with Code</Text>
          </TouchableOpacity>
        </View>

        {!isFirebaseConfigured ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnText}>
              Firebase is not configured. Add EXPO_PUBLIC_FIREBASE_* to ios/.env,
              save the file, and restart Expo.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.howCard}>
          <Text style={styles.howTitle}>HOW IT WORKS</Text>
          {HOW_IT_WORKS.map(([icon, rule]) => (
            <View key={rule} style={styles.howRow}>
              <Text style={styles.howIcon}>{icon}</Text>
              <Text style={styles.howRule}>{rule}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0D0A14",
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 48,
    paddingBottom: spacing.xl,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 24,
    marginBottom: 8,
  },
  brand: {
    fontSize: 56,
    fontWeight: "800",
    color: "#F0EBFF",
    letterSpacing: 2,
    lineHeight: 60,
    marginBottom: 8,
  },
  brandAccent: {
    color: "#A855F7",
  },
  tagline: {
    color: "#7a5fa8",
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    textAlign: "center",
  },
  actions: {
    gap: 10,
    marginBottom: 28,
  },
  btnPrimary: {
    backgroundColor: "#A855F7",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  btnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  btnSecondary: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  btnSecondaryText: {
    color: "#aa88d0",
    fontSize: 17,
    fontWeight: "700",
  },
  btnDisabled: {
    opacity: 0.55,
  },
  warnCard: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#f8717144",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  warnText: {
    color: "#f87171",
    fontSize: 13,
    lineHeight: 20,
  },
  howCard: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  howTitle: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: "#7a5fa8",
    marginBottom: 10,
  },
  howRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 6,
  },
  howIcon: {
    flexShrink: 0,
    fontSize: 13,
    lineHeight: 20,
  },
  howRule: {
    flex: 1,
    color: "#aa88d0",
    fontSize: 13,
    lineHeight: 20,
  },
});
