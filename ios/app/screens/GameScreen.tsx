import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StackScreenProps } from "@react-navigation/stack";
import { PHASES } from "@shared/constants/gameConfig.js";
import {
  FINAL_PUNISHMENTS,
  ROUND_PUNISHMENTS,
} from "@shared/constants/punishments.js";
import { sanitizeSong } from "@shared/utils/sanitize.js";
import type { RootStackParamList } from "../navigation/types";
import type { GamePhase, TrackMeta } from "../types/game";
import { useGameState } from "../hooks/useGameState";
import { useHostPlayback } from "../hooks/useHostPlayback";
import ScoreBoard from "../components/ScoreBoard";
import JudgeVoting from "../components/JudgeVoting";
import NowPlayingBanner from "../components/NowPlayingBanner";
import HostPlaybackControls from "../components/HostPlaybackControls";
import UpgradeModal from "../components/UpgradeModal";
import SongSearch from "../components/SongSearch";
import { MusicService } from "../services/MusicService";
import {
  buildTrackMeta,
  formatTrackLabel,
  type SearchTrack,
} from "../utils/trackMeta";
import {
  computeRoundPoints,
  countAnonymousVotes,
  getActiveJudges,
  getPlayerUsedSongKeys,
  getRandom,
  hiddenSongLabel,
  isGameJudge,
  isSongAlreadyUsed,
  isSongRevealed,
  looksLikeBallotVotes,
  namesMatch,
  normalizeGameState,
  normalizeSongKey,
  playerLabel,
  songDisplayTitle,
  toArray,
} from "../utils/gameState";

type Props = StackScreenProps<RootStackParamList, "Game">;

const COLORS = ["#A855F7", "#C4B5FD"] as const;
const COLORS_DIM = ["#a855f725", "#c4b5fd18"] as const;

async function getJudgeBallotId(code: string): Promise<string> {
  const k = `h4h:ballot:${code}`;
  try {
    let id = await AsyncStorage.getItem(k);
    if (!id) {
      id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
      await AsyncStorage.setItem(k, id);
    }
    return id;
  } catch {
    return `b_${code}_${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Full in-game screen — mirrors web `screen === "game"` phases:
 * PLAYING → LISTENING → JUDGING → RESULT → FINAL.
 */
export default function GameScreen({ navigation, route }: Props) {
  const { code, myName } = route.params;
  const { game: rawGame, loading, error, patch, vote } = useGameState(code);

  const game = useMemo(() => normalizeGameState(rawGame), [rawGame]);

  const [mySong, setMySong] = useState("");
  const [myTrackMeta, setMyTrackMeta] = useState<TrackMeta | null>(null);
  const [songSubmitted, setSongSubmitted] = useState(false);
  const [ballotId, setBallotId] = useState("");
  const [busy, setBusy] = useState(false);
  const listeningKickoffRef = useRef(false);

  const isHost = Boolean(game && myName && namesMatch(myName, game.hostName));
  const isPlayer1 = Boolean(game && myName && namesMatch(myName, game.player1));
  const isPlayer2 = Boolean(game && myName && namesMatch(myName, game.player2));
  const isPlayer = isPlayer1 || isPlayer2;
  const isJudge = Boolean(game && isGameJudge(game, myName));

  const hostMusic = useHostPlayback(game, isHost, patch);
  const hostPlaying =
    game?.hostPlayback?.status === "playing" ||
    game?.hostPlayback?.status === "paused";

  const players: [string, string] = [
    playerLabel(game?.player1, "Player 1"),
    playerLabel(game?.player2, "Player 2"),
  ];
  const scores = game ? toArray<number>(game.scores) : [0, 0];
  const score1 = scores[0] ?? 0;
  const score2 = scores[1] ?? 0;
  const roundHistory = game ? toArray(game.roundHistory) : [];
  const judges = game ? getActiveJudges(game) : [];

  const votes = (game?.judgeVotes || {}) as Record<string, unknown>;
  const looksBallot = looksLikeBallotVotes(votes);
  const votesCast = looksBallot
    ? Object.keys(votes).length
    : judges.filter((j) => votes[j] !== undefined).length;
  const votesTotal = judges.length;
  const allVotesIn =
    votesTotal > 0 &&
    (looksBallot ? votesCast === votesTotal : votesCast === votesTotal);
  const myVote = looksBallot ? votes[ballotId] : votes[myName];
  const myHasVoted = myVote !== undefined;

  const gameWinner =
    score1 > score2 ? 0 : score2 > score1 ? 1 : -1;
  const gameLoser = gameWinner === 0 ? 1 : gameWinner === 1 ? 0 : -1;

  const myUsedSongKeys = useMemo(() => {
    if (isPlayer1) return getPlayerUsedSongKeys(roundHistory, 0);
    if (isPlayer2) return getPlayerUsedSongKeys(roundHistory, 1);
    return new Set<string>();
  }, [isPlayer1, isPlayer2, roundHistory]);

  // Load anonymous ballot id once we have a code
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await getJudgeBallotId(code);
      if (!cancelled) setBallotId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Reset local song UI when a new round starts
  useEffect(() => {
    if (game?.phase === PHASES.PLAYING) {
      setMySong("");
      setMyTrackMeta(null);
      setSongSubmitted(false);
      listeningKickoffRef.current = false;
    }
  }, [game?.phase, game?.currentRound]);

  // If we reconnect mid-round and our song is already locked
  useEffect(() => {
    if (!game || game.phase !== PHASES.PLAYING) return;
    if (isPlayer1 && game.p1Ready && game.song1) {
      setMySong(game.song1);
      setSongSubmitted(true);
    }
    if (isPlayer2 && game.p2Ready && game.song2) {
      setMySong(game.song2);
      setSongSubmitted(true);
    }
  }, [game?.phase, game?.p1Ready, game?.p2Ready, game?.song1, game?.song2, isPlayer1, isPlayer2]);

  // Host: when both songs locked → LISTENING
  useEffect(() => {
    if (!game || !isHost || game.phase !== PHASES.PLAYING) return;
    if (!(game.p1Ready && game.p2Ready && game.song1 && game.song2)) return;
    if (listeningKickoffRef.current) return;
    listeningKickoffRef.current = true;
    (async () => {
      const punishment = getRandom(ROUND_PUNISHMENTS);
      try {
        await patch({
          phase: PHASES.LISTENING as GamePhase,
          playbackIndex: 0,
          judgeVotes: {},
          roundPunishment: punishment,
          hostPlayback: { status: "idle" },
        });
      } catch {
        listeningKickoffRef.current = false;
        Alert.alert("Hit 4 Hit", "Failed to start playback — try again");
      }
    })();
  }, [
    game?.p1Ready,
    game?.p2Ready,
    game?.phase,
    game?.song1,
    game?.song2,
    isHost,
    patch,
  ]);

  // Stop native audio when leaving listening
  useEffect(() => {
    if (game?.phase !== PHASES.LISTENING && isHost) {
      MusicService.stop({ haptic: false }).catch(() => {});
    }
  }, [game?.phase, isHost]);

  // Reset host playback marker when index advances (host only)
  const prevIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isHost || game?.phase !== PHASES.LISTENING) return;
    const idx = game.playbackIndex ?? 0;
    if (prevIndexRef.current === idx) return;
    const prev = prevIndexRef.current;
    prevIndexRef.current = idx;
    if (prev == null) return;
    MusicService.stop({ haptic: false }).catch(() => {});
    patch({
      hostPlayback: { status: "idle", trackIndex: idx as 0 | 1 },
    }).catch(() => {});
  }, [game?.playbackIndex, game?.phase, isHost, patch]);

  const showError = (msg: string) => Alert.alert("Hit 4 Hit", msg);

  const submitSong = async () => {
    if (!game) return;
    const song = sanitizeSong(mySong);
    if (!song) return;
    const playerIdx = isPlayer1 ? 0 : 1;
    if (isSongAlreadyUsed(song, myTrackMeta, roundHistory, playerIdx)) {
      showError("You already played that song in an earlier round — pick something else");
      return;
    }
    if (!myTrackMeta?.id && !myTrackMeta?.uri && !myTrackMeta?.preview) {
      showError("Pick a song from the search results so we can play it");
      return;
    }
    const patchBody = isPlayer1
      ? { song1: song, p1Ready: true, song1Meta: myTrackMeta }
      : { song2: song, p2Ready: true, song2Meta: myTrackMeta };

    setSongSubmitted(true);
    setMySong(song);
    setBusy(true);
    try {
      await patch(patchBody);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setSongSubmitted(false);
      showError("Failed to submit — try again");
    } finally {
      setBusy(false);
    }
  };

  const advancePlayback = async () => {
    if (!game?.code || !isHost || game.phase !== PHASES.LISTENING) return;
    const idx = game.playbackIndex ?? 0;
    const next = idx + 1;
    await hostMusic.stop();
    setBusy(true);
    try {
      if (next >= 2) {
        await patch({
          phase: PHASES.JUDGING as GamePhase,
          playbackIndex: 2,
          hostPlayback: { status: "stopped" },
        });
      } else {
        await patch({
          playbackIndex: next,
          hostPlayback: { status: "idle", trackIndex: next as 0 | 1 },
        });
      }
    } catch {
      showError("Failed to advance playback — try again");
    } finally {
      setBusy(false);
    }
  };

  // When clip duration limit hits, advance to next song / voting
  useEffect(() => {
    hostMusic.setOnClipEnded(() => {
      advancePlayback();
    });
    return () => hostMusic.setOnClipEnded(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.playbackIndex, game?.phase, isHost]);

  const openVoting = async () => {
    if (!game?.code || game.phase !== PHASES.LISTENING) return;
    if (!isHost && !isGameJudge(game, myName)) return;
    if (isHost) await hostMusic.stop();
    setBusy(true);
    try {
      await patch({
        phase: PHASES.JUDGING as GamePhase,
        playbackIndex: 2,
        hostPlayback: { status: "stopped" },
      });
    } catch {
      showError("Failed to open voting — try again");
    } finally {
      setBusy(false);
    }
  };

  const castMyVote = async (playerIdx: 0 | 1) => {
    if (!game) return;
    if (game.phase !== PHASES.JUDGING) {
      showError("Voting isn't open yet — wait for the host or tap Open voting");
      return;
    }
    if (!isGameJudge(game, myName)) {
      showError("Only judges can vote in this round");
      return;
    }
    const id = ballotId || (await getJudgeBallotId(code));
    if (votes[id] !== undefined) {
      showError("You already voted!");
      return;
    }
    setBusy(true);
    try {
      await vote(id, playerIdx);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showError("Failed to submit vote — try again");
    } finally {
      setBusy(false);
    }
  };

  const finalizeRound = async () => {
    if (!game) return;
    let v1: number;
    let v2: number;
    if (looksBallot) {
      const c = countAnonymousVotes(votes);
      v1 = c.v0;
      v2 = c.v1;
    } else {
      v1 = judges.filter((j) => votes[j] === 0 || votes[j] === "0").length;
      v2 = judges.filter((j) => votes[j] === 1 || votes[j] === "1").length;
    }
    const { points, winner, tied } = computeRoundPoints(v1, v2);
    const newScores = [...toArray<number>(game.scores)];
    newScores[0] = (newScores[0] ?? 0) + points[0];
    newScores[1] = (newScores[1] ?? 0) + points[1];
    const historyEntry = {
      round: game.currentRound,
      song1: game.song1,
      song2: game.song2,
      song1Meta: game.song1Meta || null,
      song2Meta: game.song2Meta || null,
      winner,
      tied,
      points,
      v1,
      v2,
    };
    setBusy(true);
    try {
      await patch({
        phase: PHASES.RESULT as GamePhase,
        roundWinner: winner,
        scores: newScores,
        roundHistory: [...toArray(game.roundHistory), historyEntry],
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      showError("Failed to finalize round — try again");
    } finally {
      setBusy(false);
    }
  };

  const nextRound = async () => {
    if (!game) return;
    setBusy(true);
    try {
      if ((game.currentRound ?? 1) >= (game.rounds ?? 1)) {
        const fp = getRandom(FINAL_PUNISHMENTS);
        await patch({
          phase: PHASES.FINAL as GamePhase,
          finalPunishment: fp,
        });
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );
      } else {
        await patch({
          phase: PHASES.PLAYING as GamePhase,
          currentRound: (game.currentRound ?? 1) + 1,
          song1: "",
          song2: "",
          song1Meta: null,
          song2Meta: null,
          p1Ready: false,
          p2Ready: false,
          playbackIndex: 0,
          judgeVotes: {},
          roundWinner: null,
        });
      }
    } catch {
      showError(
        (game.currentRound ?? 1) >= (game.rounds ?? 1)
          ? "Failed to end game — try again"
          : "Failed to start next round — try again"
      );
    } finally {
      setBusy(false);
    }
  };

  const playAgain = () => {
    navigation.reset({ index: 0, routes: [{ name: "Home" }] });
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

  const phase = game.phase ?? PHASES.PLAYING;
  const playbackIndex = game.playbackIndex ?? 0;

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Scoreboard — hidden on FINAL */}
      {phase !== PHASES.FINAL ? (
        <ScoreBoard
          player1={game.player1}
          player2={game.player2}
          artist1={game.artist1}
          artist2={game.artist2}
          score1={score1}
          score2={score2}
          roundHistory={roundHistory}
        />
      ) : null}

      {/* ── PLAYING ── */}
      {phase === PHASES.PLAYING ? (
        <View>
          <Text style={styles.phaseTitle}>
            ROUND {game.currentRound} — NAME YOUR HIT
          </Text>

          {isPlayer ? (
            <View style={{ marginBottom: 12 }}>
              <View
                style={[
                  styles.card,
                  {
                    borderColor: `${COLORS[isPlayer1 ? 0 : 1]}44`,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.playerTag,
                    { color: COLORS[isPlayer1 ? 0 : 1] },
                  ]}
                >
                  {(isPlayer1
                    ? playerLabel(game.player1)
                    : playerLabel(game.player2)
                  ).toUpperCase()}{" "}
                  <Text style={styles.mutedTiny}>
                    ({isPlayer1 ? game.artist1 : game.artist2}) (you)
                  </Text>
                </Text>

                {!songSubmitted ? (
                  <>
                    <SongSearch
                      value={mySong}
                      onChange={(val) => {
                        setMySong(val);
                        setMyTrackMeta(null);
                      }}
                      onSelectTrack={(track: SearchTrack) => {
                        setMyTrackMeta(
                          buildTrackMeta(
                            track,
                            game.musicProvider ?? "spotify"
                          )
                        );
                      }}
                      disabled={songSubmitted}
                      musicProvider={game.musicProvider}
                      roundArtist={
                        isPlayer1 ? game.artist1 : game.artist2
                      }
                      onToast={showError}
                      onEnter={submitSong}
                      usedSongKeys={myUsedSongKeys}
                      songKeyForTrack={(track) =>
                        normalizeSongKey(
                          formatTrackLabel(track),
                          buildTrackMeta(
                            track,
                            game.musicProvider ?? "spotify"
                          )
                        )
                      }
                      placeholder={`Best ${isPlayer1 ? game.artist1 : game.artist2} hit…`}
                    />
                    {myUsedSongKeys.size > 0 ? (
                      <Text style={styles.hint}>
                        Songs you've already played this game can't be picked
                        again.
                      </Text>
                    ) : null}
                    <TouchableOpacity
                      style={[
                        styles.lockBtn,
                        {
                          backgroundColor:
                            mySong.trim() && myTrackMeta
                              ? COLORS[isPlayer1 ? 0 : 1]
                              : "#130d22",
                        },
                      ]}
                      onPress={submitSong}
                      disabled={!mySong.trim() || !myTrackMeta || busy}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.lockBtnText,
                          {
                            color:
                              mySong.trim() && myTrackMeta
                                ? "#0D0A14"
                                : "#7a5fa8",
                          },
                        ]}
                      >
                        LOCK IT IN ✓
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.lockedIn}>
                    ✓ "{mySong}" locked in
                  </Text>
                )}
              </View>

              <View style={[styles.card, { marginTop: 10, opacity: 0.7 }]}>
                <Text
                  style={[
                    styles.playerTag,
                    { color: COLORS[isPlayer1 ? 1 : 0] },
                  ]}
                >
                  {(isPlayer1
                    ? playerLabel(game.player2)
                    : playerLabel(game.player1)
                  ).toUpperCase()}{" "}
                  <Text style={styles.mutedTiny}>
                    ({isPlayer1 ? game.artist2 : game.artist1})
                  </Text>
                </Text>
                <Text
                  style={{
                    color: (isPlayer1 ? game.p2Ready : game.p1Ready)
                      ? "#4ade80"
                      : "#4a3370",
                    fontSize: 13,
                    marginTop: 6,
                  }}
                >
                  {(isPlayer1 ? game.p2Ready : game.p1Ready)
                    ? hiddenSongLabel(isPlayer1 ? game.player2 : game.player1)
                    : "Choosing their song…"}
                </Text>
              </View>
            </View>
          ) : null}

          {isJudge ? (
            <View style={[styles.card, styles.centerCard]}>
              <Text style={styles.emoji}>🎵</Text>
              <Text style={styles.waitBody}>
                Players are choosing their songs…
              </Text>
              <Text style={styles.waitSub}>
                You'll vote soon, {myName}
              </Text>
              <View style={styles.readyRow}>
                {([0, 1] as const).map((i) => (
                  <Text
                    key={i}
                    style={{
                      fontSize: 11,
                      color: (i === 0 ? game.p1Ready : game.p2Ready)
                        ? "#4ade80"
                        : "#4a3370",
                    }}
                  >
                    {(i === 0 ? game.p1Ready : game.p2Ready)
                      ? hiddenSongLabel(players[i])
                      : `${players[i]}: picking…`}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {!isPlayer && !isJudge ? (
            <View style={[styles.card, styles.centerCard]}>
              <Text style={styles.waitBody}>
                {isHost
                  ? "You're hosting — waiting for both players to lock in their songs."
                  : "Waiting for the music players to pick their songs…"}
              </Text>
              <View style={styles.readyRow}>
                {([0, 1] as const).map((i) => (
                  <Text
                    key={i}
                    style={{
                      fontSize: 11,
                      color: (i === 0 ? game.p1Ready : game.p2Ready)
                        ? "#4ade80"
                        : "#4a3370",
                    }}
                  >
                    {(i === 0 ? game.p1Ready : game.p2Ready)
                      ? hiddenSongLabel(players[i])
                      : `${players[i]}: picking…`}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── LISTENING ── */}
      {phase === PHASES.LISTENING ? (
        <View>
          <View style={styles.centerBlock}>
            <Text style={styles.bigTitle}>LISTEN UP 🎧</Text>
            <Text style={styles.waitBody}>
              Both songs play before judges vote
            </Text>
            <Text style={styles.waitSub}>
              {playbackIndex === 0
                ? hostPlaying && game.hostPlayback?.trackIndex === 0
                  ? `Now playing: ${players[0]}'s pick`
                  : `Up next: ${players[0]}'s pick`
                : playbackIndex === 1
                  ? hostPlaying && game.hostPlayback?.trackIndex === 1
                    ? `Now playing: ${players[1]}'s pick`
                    : `Up next: ${players[1]}'s pick`
                  : "Get ready to vote…"}
            </Text>
            <Text style={[styles.waitSub, { marginTop: 6 }]}>
              {isHost
                ? `You control ${hostMusic.provider === "apple" ? "Apple Music" : "Spotify"} on this device · ${hostMusic.limitSec}s clips`
                : "Audio plays on the host's device only."}
            </Text>
          </View>

          {!isHost ? (
            <NowPlayingBanner
              hostPlayback={game.hostPlayback}
              title={
                (playbackIndex === 0 ? game.song1 : game.song2) || undefined
              }
              artist={
                (playbackIndex === 0 ? game.artist1 : game.artist2) || undefined
              }
              albumArt={
                (playbackIndex === 0
                  ? game.song1Meta?.albumArt
                  : game.song2Meta?.albumArt) || null
              }
            />
          ) : null}

          <View style={styles.songGrid}>
            {([0, 1] as const).map((i) => {
              const playing =
                playbackIndex === i &&
                (game.hostPlayback?.status === "playing" ||
                  game.hostPlayback?.status === "paused");
              const done = playbackIndex > i;
              const revealed = isSongRevealed(game, i);
              return (
                <View
                  key={i}
                  style={[
                    styles.songCard,
                    {
                      backgroundColor: playing ? COLORS_DIM[i] : "#160f25",
                      borderColor: playing
                        ? COLORS[i]
                        : done
                          ? `${COLORS[i]}44`
                          : "#2e1f4a",
                      opacity: done && !playing ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={styles.songArtist}>
                    {(i === 0 ? game.artist1 : game.artist2) || ""}
                  </Text>
                  <Text
                    style={[
                      styles.songTitle,
                      {
                        color: revealed ? COLORS[i] : "#7a5fa8",
                        fontSize: revealed ? 16 : 14,
                        fontStyle: revealed ? "normal" : "italic",
                      },
                    ]}
                  >
                    {songDisplayTitle(game, i, players)}
                  </Text>
                  <Text style={styles.songPlayer}>{players[i]}</Text>
                  {playing ? (
                    <Text style={[styles.nowPlaying, { color: COLORS[i] }]}>
                      {game.hostPlayback?.status === "paused"
                        ? "⏸ Paused"
                        : "▶ Now playing"}
                    </Text>
                  ) : null}
                  {!playing && playbackIndex === i ? (
                    <Text style={styles.readyHint}>Ready to play</Text>
                  ) : null}
                  {done && !playing ? (
                    <Text style={styles.playedHint}>✓ Played</Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          {isHost ? (
            <View style={{ gap: 8, marginBottom: 8 }}>
              <HostPlaybackControls
                hostPlayback={game.hostPlayback}
                busy={busy || hostMusic.busy}
                onPlay={() =>
                  hostMusic.playIndex((playbackIndex as 0 | 1) || 0)
                }
                onPause={hostMusic.pause}
                onResume={hostMusic.resume}
                onSkip={async () => {
                  await hostMusic.skip();
                  await advancePlayback();
                }}
                onStop={hostMusic.stop}
              />
              {hostMusic.error ? (
                <Text style={styles.error}>{hostMusic.error}</Text>
              ) : null}
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={advancePlayback}
                disabled={busy || hostMusic.busy}
                activeOpacity={0.85}
              >
                <Text style={styles.ghostBtnText}>
                  Skip to {playbackIndex >= 1 ? "voting" : "next song"} →
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.purpleBtn}
                onPress={openVoting}
                disabled={busy || hostMusic.busy}
                activeOpacity={0.85}
              >
                <Text style={styles.purpleBtnText}>Open voting now</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isJudge && !isHost ? (
            <View style={{ gap: 8, marginBottom: 8 }}>
              <Text style={[styles.waitBody, { textAlign: "center" }]}>
                Both songs should play first — or skip ahead when you're ready
                to vote.
              </Text>
              <TouchableOpacity
                style={styles.purpleBtn}
                onPress={openVoting}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Text style={styles.purpleBtnText}>Open voting now</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isJudge && isHost ? (
            <Text style={[styles.waitBody, { textAlign: "center", paddingVertical: 8 }]}>
              Tap "Open voting now" above when both songs have played.
            </Text>
          ) : null}

          {isPlayer && !isHost ? (
            <Text style={[styles.waitBody, { textAlign: "center", paddingVertical: 8 }]}>
              Sit tight — everyone is listening to your picks…
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── JUDGING ── */}
      {phase === PHASES.JUDGING ? (
        <View>
          <View style={styles.centerBlock}>
            <Text style={styles.bigTitle}>JUDGES VOTE</Text>
            <Text style={styles.waitBody}>
              {allVotesIn
                ? "All votes in — tally below"
                : votesTotal > 0
                  ? `${votesCast} / ${votesTotal} votes received`
                  : "No judges in this room"}
            </Text>
            {!allVotesIn && votesTotal > 0 ? (
              <Text style={[styles.waitSub, { marginTop: 8 }]}>
                Who voted for whom stays hidden until all ballots are in.
              </Text>
            ) : null}
          </View>

          <View style={styles.songGrid}>
            {([0, 1] as const).map((i) => {
              const revealed = isSongRevealed(game, i);
              return (
                <View
                  key={i}
                  style={[
                    styles.songCard,
                    {
                      backgroundColor: COLORS_DIM[i],
                      borderColor: `${COLORS[i]}44`,
                    },
                  ]}
                >
                  <Text style={styles.songArtist}>
                    {(i === 0 ? game.artist1 : game.artist2) || ""}
                  </Text>
                  <Text
                    style={[
                      styles.songTitle,
                      {
                        color: revealed ? COLORS[i] : "#7a5fa8",
                        fontSize: revealed ? 17 : 14,
                        fontStyle: revealed ? "normal" : "italic",
                      },
                    ]}
                  >
                    {songDisplayTitle(game, i, players)}
                  </Text>
                  <Text style={styles.songPlayer}>{players[i]}</Text>
                </View>
              );
            })}
          </View>

          {isJudge && !myHasVoted ? (
            <JudgeVoting
              option0Label={players[0]}
              option1Label={players[1]}
              disabled={busy}
              onVote={castMyVote}
            />
          ) : null}

          {!isJudge && !isPlayer && votesTotal === 0 ? (
            <Text style={[styles.waitBody, { textAlign: "center", padding: 16 }]}>
              No judges in this room — you need at least one person who isn't a
              music player to vote.
            </Text>
          ) : null}

          {isJudge && myHasVoted ? (
            <Text style={styles.votedOk}>
              ✓ Your vote is in — waiting for others…
            </Text>
          ) : null}

          {isPlayer ? (
            <Text style={[styles.waitBody, { textAlign: "center", padding: 16 }]}>
              Judges are voting…
            </Text>
          ) : null}

          {allVotesIn ? (
            <View style={[styles.card, { marginTop: 12 }]}>
              <Text style={styles.cardTitle}>VOTE TALLY (REVEALED)</Text>
              {([0, 1] as const).map((i) => {
                const v = looksBallot
                  ? i === 0
                    ? countAnonymousVotes(votes).v0
                    : countAnonymousVotes(votes).v1
                  : judges.filter(
                      (j) =>
                        votes[j] === i ||
                        votes[j] === String(i)
                    ).length;
                const pct = votesTotal > 0 ? (v / votesTotal) * 100 : 0;
                return (
                  <View key={i} style={styles.tallyRow}>
                    <Text style={[styles.tallyName, { color: COLORS[i] }]}>
                      {players[i]}
                    </Text>
                    <View style={styles.tallyBarBg}>
                      <View
                        style={[
                          styles.tallyBarFill,
                          { backgroundColor: COLORS[i], width: `${pct}%` },
                        ]}
                      />
                    </View>
                    <Text style={[styles.tallyCount, { color: COLORS[i] }]}>
                      {v}
                    </Text>
                  </View>
                );
              })}
              {isHost ? (
                <TouchableOpacity
                  style={[styles.purpleBtn, { marginTop: 8 }]}
                  onPress={finalizeRound}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  <Text style={styles.purpleBtnText}>REVEAL WINNER 🥁</Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.waitSub, { textAlign: "center", marginTop: 8 }]}>
                  Waiting for host to reveal…
                </Text>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── RESULT ── */}
      {phase === PHASES.RESULT ? (
        <View style={{ alignItems: "center" }}>
          {game.roundWinner == null ? (
            <>
              <Text style={styles.resultEyebrow}>
                Round {game.currentRound}
              </Text>
              <Text style={styles.resultTie}>SPLIT VOTE 🤝</Text>
              <Text style={styles.waitBody}>+1 point each</Text>
            </>
          ) : (
            <>
              <Text style={styles.resultEyebrow}>
                Round {game.currentRound} Winner
              </Text>
              <Text
                style={[
                  styles.resultWinner,
                  { color: COLORS[game.roundWinner as 0 | 1] },
                ]}
              >
                {players[game.roundWinner as 0 | 1].toUpperCase()}
              </Text>
              <Text style={styles.waitBody}>
                with "
                {game.roundWinner === 0 ? game.song1 : game.song2}" · +2 points
              </Text>
            </>
          )}
          <Text style={[styles.waitSub, { marginBottom: 28 }]}>
            {looksBallot
              ? (() => {
                  const c = countAnonymousVotes(votes);
                  return `${c.v0}–${c.v1} anonymous votes`;
                })()
              : `${judges.filter((j) => votes[j] === 0 || votes[j] === "0").length}–${judges.filter((j) => votes[j] === 1 || votes[j] === "1").length} judges`}
          </Text>

          <View style={styles.punishmentBox}>
            <Text style={styles.punishmentHeading}>🔥 ROUND PUNISHMENT</Text>
            <Text style={styles.punishmentBody}>{game.roundPunishment}</Text>
            <Text style={styles.punishmentWho}>
              {game.roundWinner == null
                ? "Split vote — both players drink 👇"
                : `${players[game.roundWinner === 0 ? 1 : 0]} drinks 👇`}
            </Text>
          </View>

          <View style={styles.scoreCards}>
            {([0, 1] as const).map((i) => {
              const highlight =
                game.roundWinner == null || game.roundWinner === i;
              return (
                <View
                  key={i}
                  style={[
                    styles.scoreCard,
                    {
                      backgroundColor: highlight ? COLORS_DIM[i] : "#130d22",
                      borderColor: highlight
                        ? `${COLORS[i]}55`
                        : "#2e1f4a",
                    },
                  ]}
                >
                  <Text style={[styles.scoreCardName, { color: COLORS[i] }]}>
                    {players[i].toUpperCase()}
                  </Text>
                  <Text style={[styles.scoreCardPts, { color: COLORS[i] }]}>
                    {i === 0 ? score1 : score2}
                  </Text>
                  <Text style={styles.scoreCardLabel}>points</Text>
                </View>
              );
            })}
          </View>

          {isHost ? (
            <TouchableOpacity
              style={[
                styles.nextRoundBtn,
                {
                  backgroundColor:
                    (game.currentRound ?? 1) >= (game.rounds ?? 1)
                      ? "#d8b4fe"
                      : COLORS[1],
                },
              ]}
              onPress={nextRound}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Text style={styles.nextRoundText}>
                {(game.currentRound ?? 1) >= (game.rounds ?? 1)
                  ? "🏆 END GAME"
                  : `ROUND ${(game.currentRound ?? 1) + 1} →`}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.waitBody}>Waiting for host…</Text>
          )}
        </View>
      ) : null}

      {/* ── FINAL ── */}
      {phase === PHASES.FINAL ? (
        <View style={{ alignItems: "center" }}>
          <Text style={styles.resultEyebrow}>Game Over</Text>

          {gameWinner !== -1 ? (
            <>
              <Text style={[styles.resultEyebrow, { color: "#aa88d0" }]}>
                WINNER
              </Text>
              <Text
                style={[
                  styles.finalWinner,
                  { color: COLORS[gameWinner as 0 | 1] },
                ]}
              >
                {players[gameWinner as 0 | 1].toUpperCase()}
              </Text>
              <Text
                style={{
                  color: COLORS[gameWinner as 0 | 1],
                  fontSize: 13,
                  marginBottom: 2,
                }}
              >
                {(
                  (gameWinner === 0 ? game.artist1 : game.artist2) || ""
                ).toUpperCase()}{" "}
                STAN
              </Text>
              <Text style={[styles.waitSub, { marginBottom: 32 }]}>
                {(gameWinner === 0 ? score1 : score2)}–
                {(gameWinner === 0 ? score2 : score1)} points
              </Text>
            </>
          ) : (
            <Text style={[styles.resultTie, { fontSize: 36, marginBottom: 32 }]}>
              IT'S A TIE 🤝
            </Text>
          )}

          <View style={styles.finalPunishmentBox}>
            <Text style={styles.punishmentHeading}>🔥 FINAL PUNISHMENT</Text>
            <Text style={[styles.punishmentBody, { marginBottom: 8 }]}>
              {game.finalPunishment}
            </Text>
            {gameLoser !== -1 ? (
              <Text style={styles.punishmentWho}>
                {players[gameLoser as 0 | 1]} takes the L 😬
              </Text>
            ) : null}
          </View>

          <View style={[styles.card, { width: "100%", marginBottom: 24 }]}>
            <Text style={styles.cardTitle}>SCORECARD</Text>
            {roundHistory.map((r: any, i: number) => (
              <View key={i} style={styles.scorecardRow}>
                <Text style={styles.hRound}>R{r.round}</Text>
                <Text style={[styles.hSong, { color: COLORS[0] }]} numberOfLines={1}>
                  {r.song1}
                </Text>
                <Text style={styles.hVs}>vs</Text>
                <Text
                  style={[styles.hSong, { color: COLORS[1], textAlign: "right" }]}
                  numberOfLines={1}
                >
                  {r.song2}
                </Text>
                {r.tied || r.winner == null ? (
                  <Text style={styles.tagTie}>TIE</Text>
                ) : (
                  <Text
                    style={{
                      color: COLORS[r.winner as 0 | 1],
                      fontSize: 10,
                      fontWeight: "600",
                    }}
                  >
                    {players[r.winner as 0 | 1]}
                  </Text>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.purpleBtn}
            onPress={playAgain}
            activeOpacity={0.85}
          >
            <Text style={styles.purpleBtnText}>PLAY AGAIN</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
    <UpgradeModal
      visible={hostMusic.upgradeVisible}
      provider={hostMusic.upgradeProvider}
      onClose={() => hostMusic.setUpgradeVisible(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D0A14" },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  centered: {
    flex: 1,
    backgroundColor: "#0D0A14",
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: "#f87171", textAlign: "center", fontSize: 14 },
  phaseTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#aa88d0",
    marginBottom: 16,
    textAlign: "center",
  },
  bigTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#F0EBFF",
    marginBottom: 4,
    textAlign: "center",
  },
  centerBlock: { alignItems: "center", marginBottom: 20 },
  card: {
    backgroundColor: "#130d22",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 12,
    padding: 16,
  },
  centerCard: { alignItems: "center", paddingVertical: 32 },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#7a5fa8",
    marginBottom: 10,
  },
  playerTag: { fontSize: 14, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 },
  mutedTiny: { color: "#7a5fa8", fontSize: 11, fontWeight: "400" },
  songInput: {
    backgroundColor: "#160f25",
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 8,
    color: "#F0EBFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  hint: { color: "#4a3370", fontSize: 11, marginTop: 8, lineHeight: 16 },
  lockBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  lockBtnText: { fontSize: 16, fontWeight: "800" },
  lockedIn: { color: "#4ade80", fontSize: 13 },
  emoji: { fontSize: 28, marginBottom: 10 },
  waitBody: { color: "#aa88d0", fontSize: 14 },
  waitSub: { color: "#4a3370", fontSize: 12, marginTop: 4, textAlign: "center" },
  readyRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    marginTop: 14,
  },
  songGrid: { flexDirection: "row", gap: 10, marginBottom: 20 },
  songCard: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  songArtist: {
    color: "#7a5fa8",
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  songTitle: {
    fontWeight: "700",
    letterSpacing: 0.4,
    lineHeight: 20,
    textAlign: "center",
  },
  songPlayer: { color: "#7a5fa8", fontSize: 11, marginTop: 4 },
  nowPlaying: { fontSize: 11, marginTop: 8, fontWeight: "600" },
  readyHint: { color: "#7a5fa8", fontSize: 11, marginTop: 8 },
  playedHint: { color: "#4ade80", fontSize: 11, marginTop: 8 },
  tapPlayBtn: {
    backgroundColor: "#A855F7",
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  tapPlayText: {
    color: "#0D0A14",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "#2e1f4a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  ghostBtnText: { color: "#aa88d0", fontSize: 14, fontWeight: "600" },
  purpleBtn: {
    backgroundColor: "#A855F7",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
  },
  purpleBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  votedOk: {
    color: "#4ade80",
    fontSize: 13,
    textAlign: "center",
    padding: 16,
  },
  tallyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  tallyName: { minWidth: 75, fontSize: 13, fontWeight: "600" },
  tallyBarBg: {
    flex: 1,
    backgroundColor: "#160f25",
    borderRadius: 4,
    height: 8,
    overflow: "hidden",
  },
  tallyBarFill: { height: "100%" },
  tallyCount: { fontSize: 14, fontWeight: "700", minWidth: 18 },
  resultEyebrow: {
    fontSize: 12,
    letterSpacing: 1.5,
    color: "#7a5fa8",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  resultTie: {
    fontSize: 48,
    fontWeight: "800",
    color: "#aa88d0",
    marginBottom: 4,
  },
  resultWinner: {
    fontSize: 54,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  finalWinner: {
    fontSize: 58,
    fontWeight: "800",
    lineHeight: 62,
    marginBottom: 4,
  },
  punishmentBox: {
    backgroundColor: "#180a30",
    borderWidth: 1,
    borderColor: "#A855F744",
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
    width: "100%",
  },
  finalPunishmentBox: {
    backgroundColor: "#1a0a2e",
    borderWidth: 2,
    borderColor: "#A855F755",
    borderRadius: 14,
    padding: 20,
    marginBottom: 24,
    width: "100%",
  },
  punishmentHeading: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#A855F7",
    marginBottom: 6,
  },
  punishmentBody: { color: "#F0EBFF", fontSize: 15, lineHeight: 22 },
  punishmentWho: { color: "#7a5fa8", fontSize: 12, marginTop: 6 },
  scoreCards: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
    width: "100%",
  },
  scoreCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  scoreCardName: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 2 },
  scoreCardPts: { fontSize: 42, fontWeight: "800", lineHeight: 46 },
  scoreCardLabel: { color: "#7a5fa8", fontSize: 11 },
  nextRoundBtn: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
  },
  nextRoundText: { color: "#0D0A14", fontSize: 16, fontWeight: "800" },
  scorecardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  hRound: { color: "#4a3370", fontSize: 12, minWidth: 22 },
  hSong: { flex: 1, fontSize: 12 },
  hVs: { color: "#4a3370", fontSize: 10 },
  tagTie: {
    backgroundColor: "#160f25",
    color: "#aa88d0",
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
    borderRadius: 4,
  },
});
