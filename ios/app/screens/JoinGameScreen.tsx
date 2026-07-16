import { useState } from "react";
import {
  ActivityIndicator,
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
  sanitizeName,
  isValidName,
  isValidCode,
} from "@shared/utils/sanitize.js";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../hooks/useAuth";
import { getGame, updateGame } from "../firebase/gameService";
import { isFirebaseConfigured } from "../firebase/config";
import {
  normalizeGameState,
  namesMatch,
  toArray,
} from "../utils/gameState";

type Props = StackScreenProps<RootStackParamList, "JoinGame">;

const APP_RESTORE_KEY = "h4h:app_restore";

/**
 * Join Game screen — mirrors web `screen === "join"` + `joinGame()`.
 */
export default function JoinGameScreen({ navigation }: Props) {
  const { ensureAnonymous } = useAuth();
  const [myName, setMyName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [busy, setBusy] = useState(false);

  const canJoin =
    isValidName(myName) &&
    joinCode.trim().length === 6 &&
    !busy;

  const onJoin = async () => {
    setJoinError("");
    const code = joinCode.trim().toUpperCase();
    if (!isValidCode(code)) {
      setJoinError("Enter a valid 6-character code");
      return;
    }
    const name = sanitizeName(myName);
    if (!isValidName(name)) {
      setJoinError("Enter your name first");
      return;
    }

    if (!isFirebaseConfigured) {
      setJoinError(
        "Firebase is not configured — add EXPO_PUBLIC_FIREBASE_* to ios/.env"
      );
      return;
    }

    setBusy(true);
    try {
      await ensureAnonymous();

      let raw;
      try {
        raw = await getGame(code);
      } catch (e) {
        console.error("Join load failed:", e);
        setJoinError(
          e instanceof Error ? e.message : "Couldn't reach Firebase"
        );
        return;
      }

      const found = normalizeGameState(raw);
      if (!found) {
        setJoinError("Game not found — check the code");
        return;
      }
      if (found.phase !== PHASES.LOBBY) {
        setJoinError("This game already started");
        return;
      }

      const gameAge = Date.now() - (found.createdAt ?? 0);
      if (found.createdAt && gameAge > 4 * 60 * 60 * 1000) {
        setJoinError("This game has expired");
        return;
      }

      if (
        namesMatch(name, found.player1) ||
        namesMatch(name, found.player2)
      ) {
        setJoinError("That name is already taken");
        return;
      }

      const judgeCount = toArray(found.judges).length;
      const maxJudges = found.maxJudges ?? 12;
      if (judgeCount >= maxJudges) {
        setJoinError("Game is full");
        return;
      }

      const maxPeople = 2 + maxJudges;
      const members = [...toArray<string>(found.members)];
      if (members.includes(name)) {
        setJoinError("That name is already in this lobby — pick another");
        return;
      }
      if (members.length >= maxPeople) {
        setJoinError("Lobby is full (2 players + up to 12 others)");
        return;
      }

      let patch: Record<string, unknown>;
      let role: "host" | "player2" | "member" = "member";

      // Legacy: old games waiting for a second player (no hostName / members on disk)
      const isLegacyAwaitingP2 =
        !raw?.hostName &&
        Boolean(raw?.player1) &&
        !raw?.player2 &&
        raw?.members == null;

      if (isLegacyAwaitingP2) {
        patch = {
          hostName: found.player1,
          members: [found.player1, name],
          player1: found.player1,
          player2: name,
          judges: [],
        };
        role = name === found.player1 ? "host" : "player2";
      } else {
        const nextMembers = [...members, name];
        patch = { members: nextMembers };
        if (found.player1 && found.player2) {
          patch.judges = nextMembers.filter(
            (n) => n !== found.player1 && n !== found.player2
          );
        }
        if (name === found.hostName) role = "host";
      }

      try {
        await updateGame(code, patch);
      } catch (e) {
        console.error("Join write failed:", e);
        setJoinError(
          e instanceof Error ? e.message : "Couldn't join — try again"
        );
        return;
      }

      await AsyncStorage.setItem(
        APP_RESTORE_KEY,
        JSON.stringify({
          screen: "lobby",
          myName: name,
          myRole: role,
          gameCode: code,
          joinCode: code,
        })
      );

      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );

      navigation.replace("Lobby", {
        code,
        myName: name,
        isHost: role === "host",
      });
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
        <Text style={styles.title}>JOIN A GAME</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            placeholder="What should we call you?"
            placeholderTextColor="#4a3370"
            value={myName}
            onChangeText={setMyName}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={30}
            editable={!busy}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Game code</Text>
          <TextInput
            style={[
              styles.input,
              styles.codeInput,
              joinError ? styles.inputError : null,
            ]}
            placeholder="e.g. HX7K2R"
            placeholderTextColor="#4a3370"
            value={joinCode}
            onChangeText={(v) => {
              setJoinError("");
              setJoinCode(v.toUpperCase().slice(0, 6));
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            editable={!busy}
          />
          {joinError ? (
            <Text style={styles.errorText}>{joinError}</Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[
            styles.btnPrimary,
            canJoin ? styles.btnPrimaryEnabled : styles.btnPrimaryDisabled,
          ]}
          onPress={onJoin}
          disabled={!canJoin}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#C4B5FD" />
          ) : (
            <Text
              style={[
                styles.btnPrimaryText,
                canJoin
                  ? styles.btnPrimaryTextEnabled
                  : styles.btnPrimaryTextDisabled,
              ]}
            >
              JOIN GAME
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
  codeInput: {
    fontSize: 28,
    letterSpacing: 6,
    textAlign: "center",
    fontWeight: "700",
  },
  inputError: {
    borderColor: "#f87171",
  },
  errorText: {
    color: "#f87171",
    fontSize: 12,
    marginTop: 6,
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
    backgroundColor: "#C4B5FD",
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
    color: "#0D0A14",
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
