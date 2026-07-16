import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StackScreenProps } from "@react-navigation/stack";
import { PHASES } from "@shared/constants/gameConfig.js";
import {
  DEFAULT_PLAYBACK_LIMIT_SEC,
  MUSIC_PROVIDERS,
  normalizeMusicProvider,
} from "@shared/constants/musicConstants.js";
import { sanitizeName, isValidName } from "@shared/utils/sanitize.js";
import type { RootStackParamList } from "../navigation/types";
import type { GamePhase, GameState, MusicProvider } from "../types/game";
import { useAuth } from "../hooks/useAuth";
import { createGame as firebaseCreateGame } from "../firebase/gameService";
import { isFirebaseConfigured } from "../firebase/config";

type Props = StackScreenProps<RootStackParamList, "CreateGame">;

const ROUND_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const APP_RESTORE_KEY = "h4h:app_restore";

/** Same code alphabet as web `generateCode()` in hit-for-hit-v2.jsx */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]!
  ).join("");
}

/**
 * Create Game screen — mirrors web `screen === "create"` + `createGame()`.
 */
export default function CreateGameScreen({ navigation }: Props) {
  const { ensureAnonymous } = useAuth();
  const [player1Name, setPlayer1Name] = useState("");
  const [rounds, setRounds] = useState(5);
  const [busy, setBusy] = useState(false);

  const canCreate = isValidName(player1Name) && !busy;

  const onCreate = async () => {
    const hn = sanitizeName(player1Name);
    if (!isValidName(hn)) return;

    if (!isFirebaseConfigured) {
      Alert.alert(
        "Firebase not configured",
        "Add EXPO_PUBLIC_FIREBASE_* to ios/.env and restart Expo."
      );
      return;
    }

    setBusy(true);
    try {
      await ensureAnonymous();

      const code = generateCode();
      const r = Math.min(12, Math.max(1, Number(rounds) || 5));

      // Identical shape to web `newGame` in hit-for-hit-v2.jsx
      const newGame: GameState = {
        code,
        hostName: hn,
        members: [hn],
        player1: "",
        player2: "",
        artist1: "",
        artist2: "",
        judges: [],
        phase: PHASES.LOBBY as GamePhase,
        rounds: r,
        currentRound: 1,
        maxJudges: 12,
        scores: [0, 0],
        roundHistory: [],
        song1: "",
        song2: "",
        p1Ready: false,
        p2Ready: false,
        judgeVotes: {},
        roundPunishment: "",
        finalPunishment: "",
        roundWinner: null,
        musicProvider: normalizeMusicProvider(
          MUSIC_PROVIDERS.SPOTIFY
        ) as MusicProvider,
        playbackLimitSec: DEFAULT_PLAYBACK_LIMIT_SEC,
        hostPlayback: { status: "idle" },
        playbackIndex: 0,
      };

      await firebaseCreateGame(newGame);

      await AsyncStorage.setItem(
        APP_RESTORE_KEY,
        JSON.stringify({
          screen: "lobby",
          myName: hn,
          myRole: "host",
          gameCode: code,
          player1Name: hn,
        })
      );

      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );

      navigation.replace("Lobby", {
        code,
        myName: hn,
        isHost: true,
      });
    } catch (e) {
      console.error("Game creation failed:", e);
      const msg = String(e instanceof Error ? e.message : e);
      if (/permission_denied|Permission denied/i.test(msg)) {
        Alert.alert("Couldn't create game", "Please try again.");
      } else {
        Alert.alert(
          "Couldn't create game",
          e instanceof Error ? e.message : "Something went wrong — please try again"
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>CREATE GAME</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Your name (you’ll be the host)</Text>
          <TextInput
            style={styles.input}
            placeholder="Host name"
            placeholderTextColor="#4a3370"
            value={player1Name}
            onChangeText={setPlayer1Name}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={30}
            editable={!busy}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Rounds (max 12)</Text>
          <View style={styles.roundRow}>
            {ROUND_OPTIONS.map((r) => {
              const selected = rounds === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.roundChip,
                    selected ? styles.roundChipSelected : null,
                  ]}
                  onPress={() => {
                    setRounds(r);
                    Haptics.selectionAsync();
                  }}
                  activeOpacity={0.85}
                  disabled={busy}
                >
                  <Text
                    style={[
                      styles.roundChipText,
                      selected ? styles.roundChipTextSelected : null,
                    ]}
                  >
                    {r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.btnPrimary,
            canCreate ? styles.btnPrimaryEnabled : styles.btnPrimaryDisabled,
          ]}
          onPress={onCreate}
          disabled={!canCreate}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.btnPrimaryText,
                canCreate
                  ? styles.btnPrimaryTextEnabled
                  : styles.btnPrimaryTextDisabled,
              ]}
            >
              CREATE & GET CODE
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnGhost}
          onPress={() => navigation.goBack()}
          disabled={busy}
          activeOpacity={0.85}
        >
          <Text style={styles.btnGhostText}>← Back</Text>
        </TouchableOpacity>
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#F0EBFF",
    marginBottom: 24,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 11,
    color: "#7a5fa8",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 10,
    color: "#F0EBFF",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  roundRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  roundChip: {
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 40,
    alignItems: "center",
  },
  roundChipSelected: {
    backgroundColor: "#A855F7",
    borderColor: "#A855F7",
  },
  roundChipText: {
    color: "#aa88d0",
    fontSize: 14,
    fontWeight: "600",
  },
  roundChipTextSelected: {
    color: "#FFFFFF",
  },
  btnPrimary: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
    marginBottom: 10,
  },
  btnPrimaryEnabled: {
    backgroundColor: "#A855F7",
  },
  btnPrimaryDisabled: {
    backgroundColor: "#130d22",
  },
  btnPrimaryText: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  btnPrimaryTextEnabled: {
    color: "#FFFFFF",
  },
  btnPrimaryTextDisabled: {
    color: "#7a5fa8",
  },
  btnGhost: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  btnGhostText: {
    color: "#aa88d0",
    fontSize: 15,
    fontWeight: "600",
  },
});
