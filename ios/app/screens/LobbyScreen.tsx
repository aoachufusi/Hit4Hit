import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { StackScreenProps } from "@react-navigation/stack";
import { PHASES } from "@shared/constants/gameConfig.js";
import {
  MUSIC_PROVIDERS,
  PLAYBACK_LIMIT_OPTIONS,
  musicProviderLabel,
  normalizeMusicProvider,
  normalizePlaybackLimitSec,
} from "@shared/constants/musicConstants.js";
import { sanitizeName, isValidName } from "@shared/utils/sanitize.js";
import type { RootStackParamList } from "../navigation/types";
import type { GamePhase, MusicProvider } from "../types/game";
import { useGameState } from "../hooks/useGameState";
import { MusicService } from "../services/MusicService";
import ArtistSearch from "../components/ArtistSearch";
import {
  artistsMatch,
  getActiveJudges,
  namesMatch,
  normalizeGameState,
  toArray,
} from "../utils/gameState";

type Props = StackScreenProps<RootStackParamList, "Lobby">;

const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || "https://hit4hit.app").replace(
  /\/$/,
  ""
);

function getInviteUrl(code: string): string {
  return `${APP_URL}/?join=${encodeURIComponent(code)}`;
}

/**
 * Lobby — mirrors web `screen === "lobby"`:
 * code + share, member list, host assigns 2 players, artists, start battle.
 */
export default function LobbyScreen({ navigation, route }: Props) {
  const { code, myName } = route.params;
  const { game: rawGame, loading, error, patch } = useGameState(code);

  const game = useMemo(() => normalizeGameState(rawGame), [rawGame]);

  const [hostPickP1, setHostPickP1] = useState("");
  const [hostPickP2, setHostPickP2] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const members = useMemo(() => toArray<string>(game?.members), [game?.members]);
  const judges = useMemo(() => getActiveJudges(game), [game]);

  const isHost = Boolean(game && myName && namesMatch(myName, game.hostName));
  const isPlayer1 = Boolean(game && myName && namesMatch(myName, game.player1));
  const isPlayer2 = Boolean(game && myName && namesMatch(myName, game.player2));
  const isPlayer = isPlayer1 || isPlayer2;
  const isJudge = judges.some((j) => namesMatch(j, myName));

  const usesAppleMusic =
    normalizeMusicProvider(game?.musicProvider) === MUSIC_PROVIDERS.APPLE;

  const limitSec = normalizePlaybackLimitSec(game?.playbackLimitSec);

  // Advance to Game when host starts (works for all devices via listener)
  useEffect(() => {
    if (game?.phase && game.phase !== PHASES.LOBBY) {
      navigation.replace("Game", { code, myName, isHost });
    }
  }, [game?.phase, navigation, code, myName, isHost]);

  const showError = (msg: string) => Alert.alert("Hit 4 Hit", msg);

  const setMusicProvider = async (provider: MusicProvider) => {
    if (!isHost || !game) return;
    try {
      await patch({ musicProvider: provider });
      MusicService.setProvider(provider);
      await Haptics.selectionAsync();
    } catch {
      showError("Couldn't update music service");
    }
  };

  const setPlaybackLimit = async (sec: number) => {
    if (!isHost || !game) return;
    try {
      await patch({ playbackLimitSec: normalizePlaybackLimitSec(sec) });
      MusicService.setLimitSec(sec);
      await Haptics.selectionAsync();
    } catch {
      showError("Couldn't update clip length");
    }
  };

  const connectHostMusic = async () => {
    if (!isHost) return;
    setBusy(true);
    try {
      MusicService.setProvider(game?.musicProvider);
      MusicService.setLimitSec(game?.playbackLimitSec);
      await MusicService.connect();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Connected",
        `${musicProviderLabel(game?.musicProvider)} is ready. Audio will play on this device.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection failed";
      if (/subscription|premium/i.test(msg)) {
        Alert.alert(
          "Subscription needed",
          msg + "\n\nOpen the music app to upgrade, then try again."
        );
      } else {
        showError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    Clipboard.setString(code);
    setCopied(true);
    await Haptics.selectionAsync();
    setTimeout(() => setCopied(false), 2000);
  };

  const shareInvite = async () => {
    const url = getInviteUrl(code);
    try {
      await Share.share({
        title: "Hit 4 Hit",
        message: `🎤 Join my Hit 4 Hit game! Code: ${code}\n${url}`,
        url,
      });
    } catch {
      /* user cancelled */
    }
  };

  const assignPlayersFromLobby = async () => {
    if (!game || !namesMatch(myName, game.hostName)) return;
    const p1 = hostPickP1.trim();
    const p2 = sanitizeName(hostPickP2);
    if (!isValidName(p2)) {
      showError("Pick a valid Player 2 from the lobby.");
      return;
    }
    if (!p1 || !p2 || p1 === p2) {
      showError("Pick two different people for Player 1 and Player 2.");
      return;
    }
    if (!members.includes(p1) || !members.includes(p2)) {
      showError("Both players must be people already in the lobby.");
      return;
    }
    const nextJudges = members.filter((n) => n !== p1 && n !== p2);
    if (members.length < 3 || nextJudges.length < 1) {
      showError(
        "Need at least 3 people in the lobby: 2 music players + 1 judge."
      );
      return;
    }
    setBusy(true);
    try {
      await patch({
        player1: p1,
        player2: p2,
        judges: nextJudges,
        artist1: "",
        artist2: "",
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showError("Could not assign players — try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitArtist = async (index: 0 | 1, value: string) => {
    if (!game) return;
    const other = index === 0 ? game.artist2 : game.artist1;
    if (other && artistsMatch(value, other)) {
      showError(
        `Pick a different artist — Player ${index === 0 ? 2 : 1} already chose that one`
      );
      return;
    }
    try {
      await patch(index === 0 ? { artist1: value } : { artist2: value });
      await Haptics.selectionAsync();
    } catch {
      showError("Failed to save artist — try again");
    }
  };

  const startGame = async () => {
    if (!game?.player1 || !game?.player2 || !game.artist1 || !game.artist2) {
      return;
    }
    if (artistsMatch(game.artist1, game.artist2)) {
      showError(
        "Both players need different artists — update picks in the lobby"
      );
      return;
    }
    setBusy(true);
    try {
      await patch({ phase: PHASES.PLAYING as GamePhase });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      showError("Failed to start game — try again");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !game) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#A855F7" />
      </View>
    );
  }

  if (!game) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error || "Game not found"}</Text>
      </View>
    );
  }

  const maxJudges = game.maxJudges ?? 12;
  const playersAssigned = Boolean(game.player1 && game.player2);
  const canStart = Boolean(
    game.player1 && game.player2 && game.artist1 && game.artist2
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>GAME LOBBY</Text>

      {/* Code card */}
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Share invite link or code</Text>
        <Text style={styles.codeValue}>{game.code}</Text>
        <View style={styles.codeActions}>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={copyCode}
            activeOpacity={0.85}
          >
            <Text style={styles.ghostBtnText}>
              {copied ? "✓ Copied!" : "Copy code"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={shareInvite}
            activeOpacity={0.85}
          >
            <Text style={styles.ghostBtnText}>Share invite</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isHost ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>HOST MUSIC</Text>
          <Text style={styles.cardSubtle}>
            Songs play on your phone only (Bluetooth / AirPlay / speaker). Guests
            see a Now Playing banner — they don't need a subscription.
          </Text>

          <Text style={styles.miniLabel}>Music service</Text>
          <View style={styles.chipWrap}>
            {(
              [
                [MUSIC_PROVIDERS.SPOTIFY, "Spotify"],
                [MUSIC_PROVIDERS.APPLE, "Apple Music"],
              ] as const
            ).map(([provider, label]) => {
              const selected =
                normalizeMusicProvider(game.musicProvider) === provider;
              return (
                <TouchableOpacity
                  key={provider}
                  style={[styles.selectChip, selected && styles.selectChipP1]}
                  onPress={() => setMusicProvider(provider as MusicProvider)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.selectChipText,
                      selected && styles.selectChipTextSelected,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.miniLabel}>Clip length</Text>
          <View style={styles.chipWrap}>
            {PLAYBACK_LIMIT_OPTIONS.map((sec) => {
              const selected = limitSec === sec;
              return (
                <TouchableOpacity
                  key={sec}
                  style={[styles.selectChip, selected && styles.selectChipP2]}
                  onPress={() => setPlaybackLimit(sec)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.selectChipText,
                      selected && styles.selectChipTextSelected,
                    ]}
                  >
                    {sec}s
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.disabled]}
            onPress={connectHostMusic}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>
              CONNECT {musicProviderLabel(game.musicProvider).toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            Host is using {musicProviderLabel(game.musicProvider)} · {limitSec}s
            clips. Audio plays on the host device only.
          </Text>
        </View>
      )}

      {isHost && usesAppleMusic ? (
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            Apple Music full tracks play through MusicKit on this device. An
            active Apple Music subscription is required.
          </Text>
        </View>
      ) : null}

      {isHost && !usesAppleMusic ? (
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            Spotify full tracks play via the Spotify app on this device (Premium
            required). Connect above before starting the battle.
          </Text>
        </View>
      ) : null}

      {/* In the lobby */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>IN THE LOBBY</Text>
        <Text style={styles.cardSubtle}>
          {members.length} / {2 + maxJudges} people · Host picks two music
          players; everyone else judges.
        </Text>
        <View style={styles.pillWrap}>
          {members.map((m) => (
            <View key={m} style={styles.pill}>
              <Text style={styles.pillText}>
                {m}
                {namesMatch(m, myName) ? " (you)" : ""}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Host: pick two players */}
      {isHost && !playersAssigned ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PICK TWO MUSIC PLAYERS</Text>
          <Text style={styles.cardSubtle}>
            Choose who battles (you can include yourself). You need at least 3
            people total so there is at least one judge.
          </Text>

          <Text style={styles.miniLabel}>Player 1 (purple side)</Text>
          <View style={styles.chipWrap}>
            {members.map((m) => {
              const selected = hostPickP1 === m;
              return (
                <TouchableOpacity
                  key={`p1-${m}`}
                  style={[styles.selectChip, selected && styles.selectChipP1]}
                  onPress={() => setHostPickP1(m)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.selectChipText,
                      selected && styles.selectChipTextSelected,
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.miniLabel}>Player 2 (lavender side)</Text>
          <View style={styles.chipWrap}>
            {members.map((m) => {
              const selected = hostPickP2 === m;
              return (
                <TouchableOpacity
                  key={`p2-${m}`}
                  style={[styles.selectChip, selected && styles.selectChipP2]}
                  onPress={() => setHostPickP2(m)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.selectChipText,
                      selected && styles.selectChipTextSelected,
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.disabled]}
            onPress={assignPlayersFromLobby}
            disabled={busy}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>LOCK IN PLAYERS & JUDGES</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Music players */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>MUSIC PLAYERS</Text>
        <View style={styles.playerGrid}>
          {([0, 1] as const).map((i) => {
            const name = i === 0 ? game.player1 : game.player2;
            const art = i === 0 ? game.artist1 : game.artist2;
            const isMe = (i === 0 && isPlayer1) || (i === 1 && isPlayer2);
            const showPicker = Boolean(name) && isMe && game.phase === PHASES.LOBBY;
            const blocked =
              i === 0
                ? game.artist2
                  ? [game.artist2]
                  : []
                : game.artist1
                  ? [game.artist1]
                  : [];

            return (
              <View
                key={i}
                style={[
                  styles.playerCard,
                  name ? styles[`playerCard${i}` as const] : null,
                ]}
              >
                <Text
                  style={[
                    styles.playerTag,
                    { color: i === 0 ? "#A855F7" : "#C4B5FD" },
                  ]}
                >
                  P{i + 1}
                  {isMe ? " (you)" : ""}
                </Text>

                {name ? (
                  <>
                    <Text style={styles.playerName}>{name}</Text>
                    {showPicker ? (
                      <>
                        {art ? (
                          <Text style={styles.currentArtist}>Current: {art}</Text>
                        ) : null}
                        <ArtistSearch
                          value={art || ""}
                          musicProvider={game.musicProvider}
                          blockedArtists={blocked}
                          onSelect={(artistName) => submitArtist(i, artistName)}
                          onToast={showError}
                        />
                        <Text style={styles.playerHint}>
                          You can change your artist until the host starts.
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.playerArtist}>{art || "—"}</Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.playerWaiting}>Waiting for host…</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* Judges */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>JUDGES</Text>
          <Text style={styles.countText}>
            {judges.length}/{maxJudges}
          </Text>
        </View>
        {!playersAssigned ? (
          <Text style={styles.cardSubtle}>
            Everyone who is not a music player will judge once the host locks in
            the two players.
          </Text>
        ) : judges.length === 0 ? (
          <Text style={styles.cardSubtle}>
            No judges (only the two players in the room).
          </Text>
        ) : (
          <View style={styles.pillWrap}>
            {judges.map((j) => (
              <View key={j} style={styles.pill}>
                <Text style={styles.pillText}>
                  {j}
                  {namesMatch(j, myName) ? " (you)" : ""}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {isHost ? (
        <TouchableOpacity
          style={[
            styles.startBtn,
            canStart ? styles.startBtnEnabled : styles.startBtnDisabled,
          ]}
          onPress={startGame}
          disabled={!canStart || busy}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.startBtnText,
              canStart
                ? styles.startBtnTextEnabled
                : styles.startBtnTextDisabled,
            ]}
          >
            {canStart ? "⚡ START THE BATTLE →" : "WAITING FOR PLAYERS & ARTISTS…"}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.waitText}>
          {!playersAssigned
            ? "Waiting for host to pick the two music players…"
            : isPlayer && (isPlayer1 ? !game.artist1 : !game.artist2)
              ? "↑ Pick your artist above"
              : isPlayer
                ? "Ready when the host starts…"
                : isJudge
                  ? "You’re on the jury — hang tight!"
                  : "Waiting for host to start…"}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D0A14" },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  centered: {
    flex: 1,
    backgroundColor: "#0D0A14",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#F0EBFF",
    marginBottom: 20,
  },
  codeCard: {
    backgroundColor: "#160f25",
    borderWidth: 2,
    borderColor: "#3d2566",
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    marginBottom: 20,
  },
  codeLabel: {
    color: "#7a5fa8",
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  codeValue: {
    color: "#A855F7",
    fontSize: 52,
    fontWeight: "800",
    letterSpacing: 8,
    marginBottom: 12,
  },
  codeActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ghostBtnText: { color: "#aa88d0", fontSize: 13, fontWeight: "600" },
  hintCard: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#5b21b6",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  hintText: { color: "#d8b4fe", fontSize: 12, lineHeight: 18 },
  card: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#7a5fa8",
    marginBottom: 8,
  },
  cardSubtle: {
    color: "#aa88d0",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },
  miniLabel: {
    color: "#7a5fa8",
    fontSize: 10,
    marginBottom: 4,
    marginTop: 4,
  },
  pillWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  pill: {
    backgroundColor: "#A855F718",
    borderWidth: 1,
    borderColor: "#A855F744",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: { color: "#c084fc", fontSize: 12, fontWeight: "600" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  selectChip: {
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectChipP1: { backgroundColor: "#A855F7", borderColor: "#A855F7" },
  selectChipP2: { backgroundColor: "#C4B5FD", borderColor: "#C4B5FD" },
  selectChipText: { color: "#aa88d0", fontSize: 13, fontWeight: "600" },
  selectChipTextSelected: { color: "#0D0A14" },
  playerGrid: { flexDirection: "row", gap: 10 },
  playerCard: {
    flex: 1,
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 8,
    padding: 12,
  },
  playerCard0: { backgroundColor: "#a855f725", borderColor: "#A855F744" },
  playerCard1: { backgroundColor: "#c4b5fd18", borderColor: "#C4B5FD44" },
  playerTag: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  playerName: { color: "#F0EBFF", fontSize: 13, fontWeight: "600" },
  playerArtist: { color: "#7a5fa8", fontSize: 11, marginTop: 2 },
  playerWaiting: { color: "#4a3370", fontSize: 12 },
  currentArtist: { color: "#4ade80", fontSize: 11, marginTop: 4, marginBottom: 2 },
  artistInput: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 8,
    color: "#F0EBFF",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginTop: 4,
  },
  playerHint: { color: "#4a3370", fontSize: 10, marginTop: 4 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  countText: { color: "#4a3370", fontSize: 11 },
  primaryBtn: {
    backgroundColor: "#A855F7",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  startBtn: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 6,
    minHeight: 54,
    justifyContent: "center",
  },
  startBtnEnabled: { backgroundColor: "#d8b4fe" },
  startBtnDisabled: { backgroundColor: "#130d22" },
  startBtnText: { fontSize: 16, fontWeight: "800", letterSpacing: 0.5 },
  startBtnTextEnabled: { color: "#0D0A14" },
  startBtnTextDisabled: { color: "#7a5fa8" },
  waitText: {
    textAlign: "center",
    color: "#7a5fa8",
    fontSize: 13,
    paddingVertical: 12,
  },
  disabled: { opacity: 0.6 },
  error: { color: "#f87171", textAlign: "center", fontSize: 14 },
});
