import { useState, useEffect, useRef, useCallback } from "react";
import {
  sanitizeName,
  sanitizeSong,
  isValidCode,
  isValidName,
} from "./utils/sanitize.js";
import {
  normalizeGameState,
  toArray,
  playerLabel,
  getActiveJudges,
  isGameJudge,
  namesMatch,
  computeRoundPoints,
  roundPointsLabel,
  normalizeSongKey,
  getPlayerUsedSongKeys,
  isSongAlreadyUsed,
  artistsMatch,
  isArtistBlocked,
} from "./gameStateUtils.js";
import {
  createGame as firebaseCreateGame,
  getGame,
  updateGame,
  subscribeToGame,
  castVote as firebaseCastVote,
  deleteGame,
} from "./firebase/gameService.js";
import { isFirebaseConfigured } from "./firebase/config.js";
import { ensureAuth } from "./firebase/auth.js";
import { useSpotify } from "./useSpotify.js";
import SongSearch from "./musickit/SongSearch.jsx";
import { getInviteUrl } from "./appUrl.js";
import { getStoredSession } from "./spotifyAuth.js";
import {
  isSharedSpotifyTokenValid,
  searchArtistsWithToken,
  searchTracksWithToken,
} from "./spotifyApi.js";
import {
  MUSIC_PROVIDERS,
  musicProviderLabel,
  normalizeMusicProvider,
} from "./musicConstants.js";
import {
  buildTrackMeta,
  resolveTrackForPlayback,
  playRoundTrack,
  stopRoundPlayback,
  waitForPlaybackEnd,
} from "./roundPlayback.js";
import ArtistSearch from "./musickit/ArtistSearch.jsx";
import MusicProviderPicker from "./musickit/MusicProviderPicker.jsx";
import {
  authorizeHost,
  configureMusicKit,
  getDeveloperToken,
  unauthorizeHost,
} from "./musickit/musickitService.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const FINAL_PUNISHMENTS = [
  "Loser finishes their entire drink in one go",
  "Loser takes a shot for every round they lost",
  "Loser drinks while the winner gives a 60-second victory speech",
  "Loser posts on social media declaring the winner the GOAT",
  "Loser buys the next round for the entire group",
  "Loser must defend their artist for 60 more seconds — judges revote",
  "Loser serenades the room with their artist's biggest hit (acapella)",
  "Loser names 10 more songs by the winner's artist or takes a shot",
  "Loser picks the next game for the group",
  "Loser gives a 30-second apology speech to the winner's artist",
  "Loser chugs for 10 seconds straight",
  "Loser has to text someone their artist lost to the winner's artist",
];

const ROUND_PUNISHMENTS = [
  "Loser takes 2 sips 🍺",
  "Loser drinks for 3 seconds 🥂",
  "Loser takes a big sip 🍻",
  "Loser gives their drink away for 1 sip, then takes 2 themselves 😬",
  "Both players drink 1 sip — respect the battle 🤝",
  "Loser drinks, winner picks who else drinks with them 👑",
  "Loser takes 3 sips 🍺🍺🍺",
  "Loser chugs for 4 seconds ⏱️",
  "Loser takes a sip and compliments the winning song 🎤",
  "Everyone drinks 1 sip in honor of the winning track 🎶",
];

const PHASES = {
  LOBBY:   "lobby",
  PLAYING: "playing",
  LISTENING: "listening",
  JUDGING: "judging",
  RESULT:  "result",
  FINAL:   "final",
};

const COLORS     = ["#A855F7", "#C4B5FD"];
const COLORS_DIM = ["#a855f725", "#c4b5fd18"];
const CONFETTI_PALETTE = [
  COLORS[0],
  COLORS[1],
  "#e879f9",
  "#818cf8",
  "#f472b6",
  "#facc15",
];
const BG         = "#0D0A14";
const SURFACE    = "#130d22";
const SURFACE2   = "#160f25";
const BORDER     = "#2e1f4a";
const BORDER2    = "#3d2566";
const TEXT       = "#F0EBFF";
const MUTED1     = "#aa88d0";
const MUTED2     = "#7a5fa8";
const MUTED3     = "#4a3370";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Game state synced via Firebase Realtime Database (games/{code})

const APP_RESTORE_KEY = "h4h:app_restore";

function saveAppRestore(snapshot) {
  try {
    sessionStorage.setItem(APP_RESTORE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore quota / private mode */
  }
}

function consumeAppRestore() {
  try {
    const raw = sessionStorage.getItem(APP_RESTORE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(APP_RESTORE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getJudgeBallotId(code) {
  const k = `h4h:ballot:${code}`;
  try {
    let id = sessionStorage.getItem(k);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `b_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return `b_${code}_${Math.random().toString(36).slice(2)}`;
  }
}

function countAnonymousVotes(votes) {
  if (!votes || typeof votes !== "object") return { v0: 0, v1: 0, total: 0 };
  let v0 = 0;
  let v1 = 0;
  for (const k of Object.keys(votes)) {
    const val = votes[k];
    if (val === 0 || val === "0") v0++;
    else if (val === 1 || val === "1") v1++;
  }
  return { v0, v1, total: v0 + v1 };
}

/** Song title stays hidden until that pick's turn to play (or after). */
function isSongRevealed(gs, index) {
  if (!gs) return false;
  const idx = gs.playbackIndex ?? 0;
  if (gs.phase === PHASES.PLAYING || gs.phase === PHASES.LOBBY) return false;
  if (gs.phase === PHASES.LISTENING) return idx >= index;
  if (
    gs.phase === PHASES.JUDGING ||
    gs.phase === PHASES.RESULT ||
    gs.phase === PHASES.FINAL
  ) {
    return idx >= 2 || idx > index;
  }
  return false;
}

function hiddenSongLabel(name) {
  return `${playerLabel(name)}'s Pick Is In!`;
}

function songDisplayTitle(gs, index, players) {
  const title = index === 0 ? gs.song1 : gs.song2;
  if (isSongRevealed(gs, index)) return title;
  return hiddenSongLabel(players[index]);
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

const MicIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
const FlameIcon = ({ s=16 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c0 0-5 4-5 10a5 5 0 0 0 10 0c0-3-2-6-2-6s-1 2-2 2c-1 0-1-2-1-6z" opacity="0.85"/><path d="M12 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>;
const CopyIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const ShareIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
const UserIcon  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const CheckIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function HitForHit() {
  const spotify = useSpotify();

  // ── Local identity
  const [screen, setScreen]     = useState("home");
  const [myName, setMyName]     = useState("");
  const [myRole, setMyRole]     = useState(null); // "host"|"player2"|"judge"
  const [userId, setUserId]     = useState(null);

  // ── Remote game state (polled)
  const [gs, setGs]             = useState(null);

  // ── UI helpers
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [copied, setCopied]     = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiItems, setConfettiItems] = useState(null);
  const [connStatus, setConnStatus] = useState("ok"); // "ok"|"error"|"syncing" (Firebase sync, not Spotify)
  const [toast, setToast]       = useState(null);

  const showToast = useCallback((msg, dur = 2500) => {
    setToast(msg);
    setTimeout(() => setToast(null), dur);
  }, []);

  // ── Create form
  const [player1Name, setPlayer1Name] = useState("");
  const [rounds, setRounds]     = useState(5);
  const [musicProvider, setMusicProvider] = useState(MUSIC_PROVIDERS.SPOTIFY);
  const [musicKitReady, setMusicKitReady] = useState(false);
  const [appleSearchReady, setAppleSearchReady] = useState(false);
  const [appleMusicConnected, setAppleMusicConnected] = useState(false);
  const [musicKitStatus, setMusicKitStatus] = useState("");
  const [hostPickP1, setHostPickP1] = useState("");
  const [hostPickP2, setHostPickP2] = useState("");

  // ── Per-player song input (local only, submitted to DB on confirm)
  const [mySong, setMySong]     = useState("");
  const [myTrackMeta, setMyTrackMeta] = useState(null);
  const [songSubmitted, setSongSubmitted] = useState(false);

  const unsubRef = useRef(null);

  const startListening = useCallback((code) => {
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = null;

    subscribeToGame(
      code,
      (fresh) => {
        try {
          setGs(normalizeGameState(fresh));
          setConnStatus("ok");
        } catch (e) {
          console.error("Game state sync failed", e);
          setConnStatus("error");
        }
      },
      () => setConnStatus("error")
    )
      .then((unsub) => {
        unsubRef.current = unsub;
      })
      .catch((err) => {
        console.error("subscribeToGame failed", err);
        setConnStatus("error");
      });
  }, []);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  useEffect(() => {
    ensureAuth().then((user) => {
      setUserId(user.uid);
    }).catch((err) => {
      console.error("Firebase anonymous auth failed", err);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("join")?.trim().toUpperCase();
    if (!code || code.length !== 6) return;

    setJoinCode(code);
    setScreen("join");

    params.delete("join");
    const next = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${next ? `?${next}` : ""}`
    );
  }, []);

  // Restore lobby/game after Spotify OAuth (full page reload wipes React state)
  useEffect(() => {
    const saved = consumeAppRestore();
    if (!saved) return;

    if (saved.myName) setMyName(saved.myName);
    if (saved.myRole) setMyRole(saved.myRole);
    if (saved.joinCode) setJoinCode(saved.joinCode);
    if (saved.player1Name) setPlayer1Name(saved.player1Name);
    if (saved.screen) setScreen(saved.screen);

    if (saved.gameCode) startListening(saved.gameCode);
  }, [startListening]);

  // Auto-advance screen when game phase changes
  useEffect(() => {
    if (!gs) return;
    if (gs.phase !== PHASES.LOBBY && screen === "lobby") {
      queueMicrotask(() => setScreen("game"));
    }
    // Reset song input between rounds
    if (gs.phase === PHASES.PLAYING) {
      queueMicrotask(() => {
        setSongSubmitted(false);
        setMySong("");
        setMyTrackMeta(null);
      });
    }
  }, [gs?.phase, gs?.currentRound]);

  // ── Confetti
  const fireConfetti = () => {
    setConfettiItems(
      Array.from({ length: 50 }, (_, i) => ({
        left: Math.random() * 100,
        background: CONFETTI_PALETTE[i % CONFETTI_PALETTE.length],
        width: 6 + Math.random() * 9,
        height: 6 + Math.random() * 9,
        borderRadius: Math.random() > 0.5 ? "50%" : "2px",
        duration: 2.2 + Math.random() * 2,
        delay: Math.random() * 1.5,
      }))
    );
    setShowConfetti(true);
    setTimeout(() => {
      setShowConfetti(false);
      setConfettiItems(null);
    }, 3500);
  };

  // ── CREATE GAME ──────────────────────────────────────────────────────────
  const createGame = async () => {
    const hn = sanitizeName(player1Name);
    if (!isValidName(hn)) return;
    setConnStatus("syncing");
    const code = generateCode();
    const r = Math.min(12, Math.max(1, Number(rounds) || 5));
    const newGame = {
      code,
      hostName: hn,
      members: [hn],
      player1: "",
      player2: "",
      artist1: "",
      artist2: "",
      judges: [],
      phase: PHASES.LOBBY,
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
      musicProvider: normalizeMusicProvider(musicProvider),
      updatedAt: Date.now(),
    };
    try {
      await firebaseCreateGame(newGame);
    } catch (e) {
      setConnStatus("error");
      const msg = String(e?.message || e);
      if (/permission_denied|Permission denied/i.test(msg)) {
        showToast("Firebase denied write access — enable Anonymous Auth and deploy database rules for /games.");
      } else {
        showToast(msg.includes("Firebase") ? msg : "Failed to create game. Try again.");
      }
      return;
    }
    setMyName(hn);
    setPlayer1Name(hn);
    setMyRole("host");
    setHostPickP1("");
    setHostPickP2("");
    setScreen("lobby");
    startListening(code);
    setConnStatus("ok");
  };

  // ── JOIN GAME ────────────────────────────────────────────────────────────
  const joinGame = async () => {
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

    setConnStatus("syncing");
    let raw;
    try {
      raw = await getGame(code);
    } catch {
      setJoinError("Failed to load game — try again");
      setConnStatus("error");
      return;
    }
    const found = normalizeGameState(raw);
    if (!found) { setJoinError("Game not found — check the code"); setConnStatus("ok"); return; }
    if (found.phase !== PHASES.LOBBY) { setJoinError("This game already started"); setConnStatus("ok"); return; }

    const maxPeople = 2 + found.maxJudges;
    const members = [...(found.members || [])];
    if (members.includes(name)) {
      setJoinError("That name is already in this lobby — pick another");
      setConnStatus("ok");
      return;
    }
    if (members.length >= maxPeople) {
      setJoinError("Lobby is full (2 players + up to 12 others)");
      setConnStatus("ok");
      return;
    }

    let patch;
    let role = "member";

    // Legacy: old games waiting for a second player (no hostName / members on disk)
    const isLegacyAwaitingP2 =
      !raw?.hostName && raw?.player1 && !raw?.player2 && raw?.members == null;
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
        patch.judges = nextMembers.filter((n) => n !== found.player1 && n !== found.player2);
      }
      if (name === found.hostName) role = "host";
    }

    try {
      await updateGame(code, patch);
    } catch {
      setJoinError("Failed to join — try again");
      setConnStatus("ok");
      return;
    }

    setMyRole(role);
    setMyName(name);
    setScreen("lobby");
    startListening(code);
    setConnStatus("ok");
  };

  // ── SET ARTISTS (in lobby) ───────────────────────────────────────────────
  const submitArtist1 = async (val) => {
    if (!gs) return;
    if (gs.artist2 && artistsMatch(val, gs.artist2)) {
      showToast("Pick a different artist — Player 2 already chose that one");
      return;
    }
    try { await updateGame(gs.code, { artist1: val }); } catch { showToast("Failed to save artist — try again"); }
  };

  const submitArtist2 = async (val) => {
    if (!gs) return;
    if (gs.artist1 && artistsMatch(val, gs.artist1)) {
      showToast("Pick a different artist — Player 1 already chose that one");
      return;
    }
    try { await updateGame(gs.code, { artist2: val }); } catch { showToast("Failed to save artist — try again"); }
  };

  // ── HOST: pick two music players from everyone in the lobby ─────────────
  const updatePlayer2 = (rawName) => {
    const p2 = sanitizeName(rawName);
    if (!isValidName(p2)) {
      showToast("Pick a valid Player 2 from the lobby.");
      return null;
    }
    return p2;
  };

  const assignPlayersFromLobby = async () => {
    if (!gs || myName !== gs.hostName) return;
    const p1 = hostPickP1.trim();
    const p2 = updatePlayer2(hostPickP2);
    if (!p2) return;
    if (!p1 || !p2 || p1 === p2) {
      showToast("Pick two different people for Player 1 and Player 2.");
      return;
    }
    if (!toArray(gs.members).includes(p1) || !toArray(gs.members).includes(p2)) {
      showToast("Both players must be people already in the lobby.");
      return;
    }
    const lobbyMembers = toArray(gs.members);
    const nextJudges = lobbyMembers.filter((n) => n !== p1 && n !== p2);
    if (lobbyMembers.length < 3 || nextJudges.length < 1) {
      showToast("Need at least 3 people in the lobby: 2 music players + 1 judge.");
      return;
    }
    setConnStatus("syncing");
    try {
      await updateGame(gs.code, {
        player1: p1,
        player2: p2,
        judges: nextJudges,
        artist1: "",
        artist2: "",
      });
      setConnStatus("ok");
    } catch {
      setConnStatus("error");
      showToast("Could not assign players — try again.");
    }
  };

  // ── Role helpers (needed before song submit / playback handlers) ─────────
  const isHost =
    Boolean(gs && myName && namesMatch(myName, gs.hostName)) ||
    (myRole === "host" && Boolean(gs) && namesMatch(myName, gs.player1) && !gs.hostName);
  const isPlayer1 = Boolean(gs && myName && namesMatch(myName, gs.player1));
  const isPlayer2 = Boolean(gs && myName && namesMatch(myName, gs.player2));
  const isJudge   = Boolean(gs && myName && isGameJudge(gs, myName));
  const isPlayer  = isPlayer1 || isPlayer2;

  // ── START GAME (host only) ───────────────────────────────────────────────
  const startGame = async () => {
    if (!gs?.player1 || !gs?.player2 || !gs.artist1 || !gs.artist2) return;
    if (artistsMatch(gs.artist1, gs.artist2)) {
      showToast("Both players need different artists — update picks in the lobby");
      return;
    }
    try {
      await updateGame(gs.code, { phase: PHASES.PLAYING });
    } catch {
      showToast("Failed to start game — try again");
    }
  };

  // ── SUBMIT MY SONG ───────────────────────────────────────────────────────
  const submitSong = async () => {
    if (!gs) return;
    const song = sanitizeSong(mySong);
    if (!song) return;
    const isP1 = myName === gs.player1;
    const playerIdx = isP1 ? 0 : 1;
    if (isSongAlreadyUsed(song, myTrackMeta, gs.roundHistory, playerIdx)) {
      showToast("You already played that song in an earlier round — pick something else");
      return;
    }
    const patch = isP1
      ? { song1: song, p1Ready: true, song1Meta: myTrackMeta || null }
      : { song2: song, p2Ready: true, song2Meta: myTrackMeta || null };

    setSongSubmitted(true);
    setMySong(song);
    const merged = { ...gs, ...patch };
    try {
      await updateGame(gs.code, patch);
    } catch {
      setSongSubmitted(false);
      showToast("Failed to submit — try again");
      return;
    }

    if (merged.p1Ready && merged.p2Ready && isHost) {
      const punishment = getRandom(ROUND_PUNISHMENTS);
      try {
        await updateGame(gs.code, {
          phase: PHASES.LISTENING,
          playbackIndex: 0,
          judgeVotes: {},
          roundPunishment: punishment,
        });
      } catch {
        showToast("Failed to start playback — try again");
      }
    }
  };

  const advancePlayback = useCallback(async () => {
    if (!gs?.code || !isHost || gs.phase !== PHASES.LISTENING) return;
    const idx = gs.playbackIndex ?? 0;
    const next = idx + 1;
    try {
      if (next >= 2) {
        await updateGame(gs.code, { phase: PHASES.JUDGING, playbackIndex: 2 });
      } else {
        await updateGame(gs.code, { playbackIndex: next });
      }
    } catch {
      showToast("Failed to advance playback — try again");
    }
  }, [gs?.code, gs?.phase, gs?.playbackIndex, isHost, showToast]);

  const openVoting = useCallback(async () => {
    if (!gs?.code || gs.phase !== PHASES.LISTENING) return;
    if (!isHost && !isGameJudge(gs, myName)) return;
    try {
      stopRoundPlayback();
      await updateGame(gs.code, { phase: PHASES.JUDGING, playbackIndex: 2 });
    } catch {
      showToast("Failed to open voting — try again");
    }
  }, [gs, isHost, myName, showToast]);

  // Host device moves PLAYING → LISTENING once both songs are locked in
  useEffect(() => {
    if (!gs || !isHost || gs.phase !== PHASES.PLAYING) return;
    if (gs.p1Ready && gs.p2Ready && gs.song1 && gs.song2) {
      (async () => {
        const punishment = getRandom(ROUND_PUNISHMENTS);
        try {
          await updateGame(gs.code, {
            phase: PHASES.LISTENING,
            playbackIndex: 0,
            judgeVotes: {},
            roundPunishment: punishment,
          });
        } catch {
          showToast("Failed to start playback — try again");
        }
      })();
    }
  }, [gs?.p1Ready, gs?.p2Ready, gs?.phase, gs?.song1, gs?.song2, isHost, showToast]);

  // ── CAST VOTE (judges only, anonymous ballot id) ────────────────────────
  const castVote = async (playerIdx) => {
    if (!gs) return;
    if (gs.phase !== PHASES.JUDGING) {
      showToast("Voting isn't open yet — wait for the host or tap Open voting");
      return;
    }
    if (!isGameJudge(gs, myName)) {
      showToast("Only judges can vote in this round");
      return;
    }
    const votes = gs.judgeVotes || {};
    const ballotId = getJudgeBallotId(gs.code);
    if (votes[ballotId] !== undefined) { showToast("You already voted!"); return; }

    try {
      await firebaseCastVote(gs.code, ballotId, playerIdx);
      showToast("Vote recorded ✓");
    } catch {
      showToast("Failed to submit vote — try again");
    }
  };

  // ── FINALIZE ROUND (host only, after all votes in) ───────────────────────
  const finalizeRound = async () => {
    if (!gs) return;
    const votes = gs.judgeVotes || {};
    const judgeNames = getActiveJudges(gs);
    const keys = Object.keys(votes);
    const looksBallot =
      keys.length > 0 &&
      (keys[0].length > 18 || /[0-9a-f]{8}-[0-9a-f-]{4,}/i.test(keys[0]));
    let v1;
    let v2;
    if (looksBallot) {
      const c = countAnonymousVotes(votes);
      v1 = c.v0;
      v2 = c.v1;
    } else {
      v1 = judgeNames.filter((j) => votes[j] === 0).length;
      v2 = judgeNames.filter((j) => votes[j] === 1).length;
    }
    const { points, winner, tied } = computeRoundPoints(v1, v2);

    const newScores = [...toArray(gs.scores)];
    newScores[0] = (newScores[0] ?? 0) + points[0];
    newScores[1] = (newScores[1] ?? 0) + points[1];
    const historyEntry = {
      round: gs.currentRound,
      song1: gs.song1,
      song2: gs.song2,
      song1Meta: gs.song1Meta || null,
      song2Meta: gs.song2Meta || null,
      winner,
      tied,
      points,
      v1,
      v2,
    };

    try {
      await updateGame(gs.code, {
        phase: PHASES.RESULT,
        roundWinner: winner,
        scores: newScores,
        roundHistory: [...toArray(gs.roundHistory), historyEntry],
      });
    } catch {
      showToast("Failed to finalize round — try again");
    }
  };

  // ── NEXT ROUND / END GAME (host only) ────────────────────────────────────
  const nextRound = async () => {
    if (!gs) return;
    if (gs.currentRound >= gs.rounds) {
      const fp = getRandom(FINAL_PUNISHMENTS);
      try {
        await updateGame(gs.code, {
          phase: PHASES.FINAL,
          finalPunishment: fp,
        });
        fireConfetti();
      } catch {
        showToast("Failed to end game — try again");
      }
    } else {
      try {
        await updateGame(gs.code, {
          phase: PHASES.PLAYING,
          currentRound: gs.currentRound + 1,
          song1: "", song2: "",
          song1Meta: null, song2Meta: null,
          p1Ready: false, p2Ready: false,
          playbackIndex: 0,
          judgeVotes: {},
          roundWinner: null,
        });
      } catch {
        showToast("Failed to start next round — try again");
      }
    }
  };

  // ── COPY / SHARE ─────────────────────────────────────────────────────────
  const copyCode = () => {
    if (!gs?.code) return;
    navigator.clipboard?.writeText(gs.code).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
    showToast("Code copied!");
  };

  const shareInvite = () => {
    if (!gs?.code) return;
    const url = getInviteUrl(gs.code);
    const text = `🎤 Join my Hit 4 Hit game! Code: ${gs.code}\n${url}`;
    if (navigator.share) {
      navigator.share({ title: "Hit 4 Hit", text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
      showToast("Invite link copied!");
    }
  };

  const resetAll = async () => {
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = null;
    if (gs?.code) {
      try {
        await deleteGame(gs.code);
      } catch (e) {
        console.error("deleteGame failed", e);
      }
    }
    setGs(null); setMyRole(null); setMyName(""); setMySong("");
    setMyTrackMeta(null);
    setSongSubmitted(false);
    setPlayer1Name("");
    setJoinCode(""); setJoinError("");
    setHostPickP1(""); setHostPickP2("");
    setScreen("home");
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeMusicProvider = normalizeMusicProvider(gs?.musicProvider ?? musicProvider);
  const usesAppleMusic = activeMusicProvider === MUSIC_PROVIDERS.APPLE;
  const musicLabel = musicProviderLabel(activeMusicProvider);
  const musicServiceHint = usesAppleMusic
    ? "Everyone searches artists and songs via Apple Music."
    : "Host logs in to Spotify once so everyone can search artists and songs.";

  const setGameMusicProvider = useCallback(
    async (provider) => {
      if (!isHost) return;
      const next = normalizeMusicProvider(provider);
      if (next === MUSIC_PROVIDERS.APPLE && !musicKitReady) {
        showToast("Apple Music is not available right now");
        return;
      }
      if (gs?.code) {
        if (gs.phase !== PHASES.LOBBY) return;
        try {
          await updateGame(gs.code, { musicProvider: next });
        } catch {
          showToast("Could not update music service — try again");
        }
      } else {
        setMusicProvider(next);
      }
    },
    [isHost, gs?.code, gs?.phase, musicKitReady, showToast]
  );

  const canManageSpotify = isHost && !usesAppleMusic;
  const canManageAppleMusic = isHost && usesAppleMusic;
  const musicSearchReady = usesAppleMusic
    ? musicKitReady || appleSearchReady
    : (isHost && spotify.loggedIn) || isSharedSpotifyTokenValid(gs);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setMusicKitStatus("Loading Apple Music…");
        const token = await getDeveloperToken();
        if (cancelled) return;
        setAppleSearchReady(true);
        try {
          const music = await configureMusicKit(token);
          if (cancelled) return;
          setMusicKitReady(true);
          setAppleMusicConnected(Boolean(music?.isAuthorized));
        } catch (e) {
          console.warn("MusicKit JS unavailable, using server search fallback", e);
          setMusicKitReady(false);
        }
        setMusicKitStatus("");
      } catch (e) {
        if (!cancelled) {
          setMusicKitReady(false);
          setAppleSearchReady(false);
          setAppleMusicConnected(false);
          setMusicKitStatus(String(e?.message || e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const connectAppleMusic = useCallback(async () => {
    try {
      saveAppRestore({
        screen,
        myName,
        myRole,
        joinCode,
        player1Name,
        gameCode: gs?.code || null,
      });
      await authorizeHost();
      setAppleMusicConnected(true);
      setMusicKitReady(true);
      showToast("Apple Music connected");
    } catch (e) {
      showToast(String(e?.message || e));
    }
  }, [screen, myName, myRole, joinCode, player1Name, gs?.code, showToast]);

  const disconnectAppleMusic = useCallback(async () => {
    try {
      await unauthorizeHost();
      setAppleMusicConnected(false);
      showToast("Apple Music disconnected");
    } catch (e) {
      showToast(String(e?.message || e));
    }
  }, [showToast]);

  const getSpotifySearchToken = useCallback(async () => {
    if (isHost && spotify.loggedIn) {
      return spotify.getAccessToken();
    }
    if (isSharedSpotifyTokenValid(gs)) {
      return gs.spotifyAccessToken;
    }
    throw new Error("Host must log in to Spotify for search");
  }, [gs, isHost, spotify]);

  const searchSpotifyArtists = useCallback(
    async (q) => {
      const token = await getSpotifySearchToken();
      return searchArtistsWithToken(token, q, 10);
    },
    [getSpotifySearchToken]
  );

  const searchSpotifyTracks = useCallback(
    async (q, artistName) => {
      const token = await getSpotifySearchToken();
      return searchTracksWithToken(token, q, 8, { artistName });
    },
    [getSpotifySearchToken]
  );

  const playbackEpochRef = useRef(0);

  useEffect(() => {
    if (gs?.phase !== PHASES.LISTENING) {
      stopRoundPlayback();
      return;
    }

    const index = gs.playbackIndex ?? 0;
    if (index >= 2) {
      if (isHost) advancePlayback();
      else if (isGameJudge(gs, myName)) openVoting();
      return;
    }

    let cancelled = false;
    const epoch = ++playbackEpochRef.current;
    let cleanupWait = () => {};

    (async () => {
      const meta = index === 0 ? gs.song1Meta : gs.song2Meta;
      const label = index === 0 ? gs.song1 : gs.song2;
      const artist = index === 0 ? gs.artist1 : gs.artist2;

      if (!isHost) return;

      const resolved = await resolveTrackForPlayback(meta, label, artist, {
        usesAppleMusic,
        searchSpotifyTracks,
      });
      if (cancelled || playbackEpochRef.current !== epoch) return;

      try {
        const result = await playRoundTrack(resolved, {
          playSpotifyUri:
            !usesAppleMusic && spotify.loggedIn && spotify.deviceId
              ? spotify.playUri
              : null,
        });
        if (cancelled || playbackEpochRef.current !== epoch) return;

        if (isHost) {
          cleanupWait = waitForPlaybackEnd(result, () => {
            if (!cancelled && playbackEpochRef.current === epoch) {
              advancePlayback();
            }
          });
        }
      } catch (e) {
        console.error("Round playback failed", e);
        if (isHost && !cancelled) {
          cleanupWait = waitForPlaybackEnd(null, advancePlayback);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupWait();
      stopRoundPlayback();
    };
  }, [
    gs?.phase,
    gs?.playbackIndex,
    gs?.song1,
    gs?.song2,
    gs?.song1Meta,
    gs?.song2Meta,
    gs?.artist1,
    gs?.artist2,
    isHost,
    myName,
    usesAppleMusic,
    searchSpotifyTracks,
    spotify.loggedIn,
    spotify.deviceId,
    spotify.playUri,
    advancePlayback,
    openVoting,
  ]);

  // Safety net: host auto-advances if playback stalls
  useEffect(() => {
    if (!isHost || gs?.phase !== PHASES.LISTENING) return;
    const timer = setTimeout(() => advancePlayback(), 45_000);
    return () => clearTimeout(timer);
  }, [isHost, gs?.phase, gs?.playbackIndex, advancePlayback]);

  // Judges can open voting if the host never advances past listening
  useEffect(() => {
    if (!gs || gs.phase !== PHASES.LISTENING || !isJudge) return;
    const timer = setTimeout(() => openVoting(), 75_000);
    return () => clearTimeout(timer);
  }, [gs?.phase, gs?.code, gs?.playbackIndex, isJudge, openVoting]);

  const hostSpotifyLogout = useCallback(async () => {
    spotify.logout();
    if (gs?.code && isHost) {
      try {
        await updateGame(gs.code, {
          spotifyAccessToken: null,
          spotifyTokenObtainedAt: null,
          spotifyTokenExpiresIn: null,
        });
      } catch {
        showToast("Could not clear shared Spotify access — try again.");
      }
    }
  }, [gs?.code, isHost, spotify, showToast]);

  useEffect(() => {
    if (!isHost || !gs?.code || !spotify.loggedIn) return;

    let cancelled = false;

    const syncHostSpotifyToken = async () => {
      try {
        const token = await spotify.getAccessToken();
        const session = getStoredSession();
        if (!token || !session || cancelled) return;
        await updateGame(gs.code, {
          spotifyAccessToken: token,
          spotifyTokenObtainedAt: session.obtained_at,
          spotifyTokenExpiresIn: session.expires_in,
        });
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to sync host Spotify token", e);
        }
      }
    };

    syncHostSpotifyToken();
    const interval = setInterval(syncHostSpotifyToken, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isHost, gs?.code, spotify.loggedIn, spotify]);

  const members = gs ? toArray(gs.members) : [];
  const judges = gs ? getActiveJudges(gs) : [];
  const roundHistory = gs ? toArray(gs.roundHistory) : [];
  const scores = gs ? toArray(gs.scores) : [0, 0];
  const myUsedSongKeys = isPlayer1
    ? getPlayerUsedSongKeys(roundHistory, 0)
    : isPlayer2
      ? getPlayerUsedSongKeys(roundHistory, 1)
      : new Set();

  const votes       = gs?.judgeVotes || {};
  const judgeNames  = gs ? getActiveJudges(gs) : [];
  const ballotId    = gs?.code ? getJudgeBallotId(gs.code) : "";
  const voteKeys    = Object.keys(votes);
  const looksBallot =
    voteKeys.length > 0 &&
    (voteKeys[0].length > 18 || /[0-9a-f]{8}-[0-9a-f-]{4,}/i.test(voteKeys[0]));
  const votesCast = looksBallot
    ? voteKeys.length
    : judgeNames.filter((j) => votes[j] !== undefined).length;
  const votesTotal  = judgeNames.length;
  const allVotesIn =
    votesTotal > 0 &&
    (looksBallot ? votesCast === votesTotal : votesCast === votesTotal);
  const myVote      = looksBallot ? votes[ballotId] : votes[myName];
  const myHasVoted  = myVote !== undefined;

  const gameWinner  = !gs ? -1 : (scores[0] ?? 0) > (scores[1] ?? 0) ? 0 : (scores[1] ?? 0) > (scores[0] ?? 0) ? 1 : -1;
  const gameLoser   = gameWinner === 0 ? 1 : gameWinner === 1 ? 0 : -1;

  const p1name = playerLabel(gs?.player1, "Player 1");
  const p2name = playerLabel(gs?.player2, "Player 2");
  const players = [p1name, p2name];

  // ── STYLES ────────────────────────────────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Manrope:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:${BG};}
    .bf{font-family:'Manrope',sans-serif;}
    .hd{font-family:'Bebas Neue',sans-serif;}
    input.inp{background:${SURFACE2};border:1px solid ${BORDER};border-radius:8px;color:${TEXT};font-family:'Manrope',sans-serif;font-size:14px;padding:11px 14px;width:100%;outline:none;transition:border-color .15s;}
    input.inp:focus{border-color:#7c3aed;}
    input.inp::placeholder{color:${MUTED3};}
    .btn{border:none;border-radius:7px;cursor:pointer;font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:.05em;padding:13px 28px;transition:all .15s;width:100%;}
    .btn:hover{opacity:.87;}
    .btn:disabled{opacity:.22;cursor:not-allowed;}
    .btn-ghost{background:${SURFACE2};border:1px solid ${BORDER};border-radius:7px;color:${MUTED1};cursor:pointer;font-family:'Manrope',sans-serif;font-size:13px;font-weight:500;padding:9px 16px;transition:all .15s;display:flex;align-items:center;gap:6px;}
    .btn-ghost:hover{border-color:#7c3aed;color:#d4b8ff;}
    .vote-btn{border:2px solid;border-radius:10px;cursor:pointer;font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:.04em;padding:16px 12px;transition:all .2s;width:100%;}
    .vote-btn:hover:not(:disabled){transform:scale(1.02);}
    .vote-btn:disabled{opacity:.4;cursor:not-allowed;}
    .sug{background:${SURFACE2};border:none;border-bottom:1px solid ${BORDER};color:#c4a8f0;cursor:pointer;font-family:'Manrope',sans-serif;font-size:13px;padding:10px 14px;text-align:left;transition:background .1s;width:100%;}
    .sug:hover{background:#1e1435;}
    .slide-up{animation:slideUp .3s ease;}
    @keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    .pulse{animation:pulse 1.8s infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .confetti{position:fixed;pointer-events:none;z-index:9999;}
    @keyframes fall{0%{transform:translateY(-30px) rotate(0deg);opacity:1}100%{transform:translateY(105vh) rotate(800deg);opacity:0}}
    .card{background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;}
    .pill{border-radius:20px;display:inline-flex;align-items:center;gap:5px;font-family:'Manrope',sans-serif;font-size:11px;padding:3px 9px;}
    .tag{border-radius:4px;display:inline-block;font-family:'Manrope',sans-serif;font-size:11px;font-weight:600;letter-spacing:.05em;padding:2px 7px;text-transform:uppercase;}
    .hrow{border-bottom:1px solid #1e1435;display:flex;justify-content:space-between;align-items:center;padding:6px 0;}
    .conn-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2a1750;border:1px solid #5b21b6;border-radius:8px;color:#e9d5ff;font-family:'Manrope',sans-serif;font-size:13px;padding:10px 20px;z-index:1000;white-space:nowrap;box-shadow:0 4px 24px #0007;}
  `;

  const C  = COLORS[0]; // player 1 purple
  const C2 = COLORS[1]; // player 2 lavender

  return (
    <div style={{ fontFamily:"'Bebas Neue',sans-serif", minHeight:"100vh", background:BG, color:TEXT }}>
      <style>{css}</style>

      {/* Confetti */}
      {showConfetti &&
        confettiItems?.map((spec, i) => (
          <div
            key={i}
            className="confetti"
            style={{
              left: `${spec.left}%`,
              top: -20,
              background: spec.background,
              width: `${spec.width}px`,
              height: `${spec.height}px`,
              borderRadius: spec.borderRadius,
              animation: `fall ${spec.duration}s ease-in ${spec.delay}s forwards`,
            }}
          />
        ))}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <div style={{background:"#110a1e",borderBottom:`1px solid ${BORDER}`,padding:"0 1.25rem",height:50,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div className="hd" style={{fontSize:22,letterSpacing:".06em",cursor:"pointer"}} onClick={resetAll}>
          HIT <span style={{color:C}}>4</span> HIT
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {gs?.code && screen!=="home" && (
            <div onClick={copyCode} style={{background:SURFACE2,border:`1px solid ${BORDER2}`,borderRadius:6,cursor:"pointer",display:"flex",alignItems:"center",gap:6,padding:"4px 10px"}}>
              <span className="hd" style={{fontSize:16,letterSpacing:".12em",color:C}}>{gs.code}</span>
              <span style={{color:MUTED2}}><CopyIcon/></span>
            </div>
          )}
          {gs?.currentRound && gs.phase!==PHASES.LOBBY && (
            <span className="bf" style={{background:SURFACE2,border:`1px solid ${BORDER}`,borderRadius:4,color:MUTED1,fontSize:11,padding:"3px 9px",letterSpacing:".06em"}}>
              R{gs.currentRound}/{gs.rounds}
            </span>
          )}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {usesAppleMusic ? (
              !musicKitReady ? (
                <span
                  className="bf"
                  style={{ fontSize: 10, color: MUTED3 }}
                  title={musicKitStatus || "Apple Music loading…"}
                >
                  {musicLabel}
                </span>
              ) : canManageAppleMusic && !appleMusicConnected ? (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() => connectAppleMusic()}
                >
                  Connect {musicLabel}
                </button>
              ) : canManageAppleMusic && appleMusicConnected ? (
                <>
                  <span className="bf" style={{ fontSize: 10, color: MUTED1 }}>{musicLabel}</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={() => disconnectAppleMusic()}
                  >
                    Log out
                  </button>
                </>
              ) : (
                <span className="bf" style={{ fontSize: 10, color: MUTED1 }}>{musicLabel} ✓</span>
              )
            ) : canManageSpotify ? (
              spotify.loggedIn ? (
                <>
                  <span className="bf" style={{fontSize:10,color:MUTED1}}>{musicLabel}</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={() => hostSpotifyLogout()}
                  >
                    Log out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={async () => {
                    try {
                      saveAppRestore({
                        screen,
                        myName,
                        myRole,
                        joinCode,
                        player1Name,
                        gameCode: gs?.code || null,
                      });
                      await spotify.login();
                    } catch (e) {
                      showToast(String(e?.message || e));
                    }
                  }}
                >
                  {musicLabel}
                </button>
              )
            ) : musicSearchReady ? (
              <span className="bf" style={{fontSize:10,color:MUTED1}}>{musicLabel} ✓</span>
            ) : (
              <span className="bf" style={{fontSize:10,color:MUTED3}} title="Host logs in to Spotify for everyone">{musicLabel}</span>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4}} title="Game sync via Firebase Realtime Database">
            <div className="conn-dot" style={{background: connStatus==="ok"?"#4ade80": connStatus==="syncing"?"#facc15":"#f87171"}}/>
            <span className="bf" style={{color:MUTED2,fontSize:10}}>
              {connStatus==="ok" ? "synced" : connStatus==="syncing" ? "syncing…" : "no sync"}
            </span>
          </div>
        </div>
      </div>

      {screen === "lobby" && gs && (
        isHost ? (
          <MusicProviderPicker
            sectioned
            value={activeMusicProvider}
            onChange={setGameMusicProvider}
            appleEnabled={musicKitReady}
            hint={musicServiceHint}
          />
        ) : (
          <div style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ maxWidth: 500, margin: "0 auto", padding: "0.85rem 1rem" }}>
              <div
                className="hd"
                style={{
                  fontSize: 13,
                  letterSpacing: ".07em",
                  color: MUTED2,
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                Music service
              </div>
              <div className="bf" style={{ color: MUTED1, fontSize: 13, fontWeight: 600 }}>
                {musicLabel}
              </div>
              <div className="bf" style={{ color: MUTED3, fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
                Host chose {musicLabel} for this game — everyone searches and plays through it.
              </div>
            </div>
          </div>
        )
      )}

      <main style={{maxWidth:500,margin:"0 auto",padding:"1.25rem 1rem 3rem"}}>

        {(screen==="lobby" || screen==="game") && !gs && (
          <div className="card slide-up" style={{padding:"2rem",textAlign:"center"}}>
            <div className="pulse bf" style={{color:MUTED1,fontSize:14}}>Syncing game…</div>
          </div>
        )}

        {/* ════════════════════════ HOME ════════════════════════ */}
        {screen==="home" && (
          <div className="slide-up">
            <div style={{textAlign:"center",padding:"1.5rem 0 2rem"}}>
              <div className="hd" style={{fontSize:60,letterSpacing:".04em",lineHeight:1,marginBottom:8}}>
                HIT <span style={{color:C}}>4</span> HIT
              </div>
              <div className="bf" style={{color:MUTED2,fontSize:12,letterSpacing:".08em",textTransform:"uppercase"}}>The ultimate artist battle drinking game</div>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:"1.75rem"}}>
              <button className="btn" style={{background:C,color:"#fff"}} onClick={()=>setScreen("create")}>
                🎤 Create a Game
              </button>
              <button className="btn" style={{background:SURFACE,color:MUTED1,border:`1px solid ${BORDER}`,fontSize:17}} onClick={()=>setScreen("join")}>
                🔑 Join with Code
              </button>
            </div>

            {!isFirebaseConfigured && (
              <div className="card" style={{padding:"1rem 1.25rem",marginBottom:"1rem",borderColor:"#f8717144",textAlign:"left"}}>
                <div className="bf" style={{color:"#f87171",fontSize:13,lineHeight:1.5}}>
                  Firebase is not configured. Add <code>VITE_FIREBASE_*</code> to <code>.env</code>, save the file, and restart <code>npm run dev</code>.
                </div>
              </div>
            )}

            <div className="card" style={{padding:"1rem 1.25rem"}}>
              <div className="hd" style={{fontSize:15,letterSpacing:".07em",color:MUTED2,marginBottom:10}}>HOW IT WORKS</div>
              {[
                ["🎮","Host creates a room, picks Spotify or Apple Music, & shares the code"],
                ["👥","Host picks exactly two music players (can include themself)"],
                ["🎤","Those two each pick an artist; everyone else is a judge"],
                ["🎵","Up to 12 rounds: players pick a hit each round; judges vote anonymously"],
                ["🔒","Votes stay hidden until everyone has voted — then the reveal"],
                ["🍺","Round loser drinks. Game loser faces the FINAL punishment"],
              ].map(([icon,rule],i)=>(
                <div key={i} className="bf" style={{display:"flex",gap:10,fontSize:13,color:MUTED1,lineHeight:1.55,marginBottom:6}}>
                  <span style={{flexShrink:0}}>{icon}</span>{rule}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════ CREATE ════════════════════════ */}
        {screen==="create" && (
          <div className="slide-up">
            <div className="hd" style={{fontSize:30,letterSpacing:".05em",marginBottom:"1.5rem"}}>CREATE GAME</div>

            <div style={{marginBottom:12}}>
              <div className="bf" style={{fontSize:11,color:MUTED2,letterSpacing:".07em",textTransform:"uppercase",marginBottom:6}}>Your name (you’ll be the host)</div>
              <input className="inp" placeholder="Host name" value={player1Name} onChange={e=>setPlayer1Name(e.target.value)}/>
            </div>

            <div style={{marginBottom:"1.5rem"}}>
              <div className="bf" style={{fontSize:11,color:MUTED2,letterSpacing:".07em",textTransform:"uppercase",marginBottom:8}}>Rounds (max 12)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map((r)=>(
                  <button key={r} type="button" onClick={()=>setRounds(r)} className="bf"
                    style={{background:rounds===r?C:SURFACE2,border:`1px solid ${rounds===r?C:BORDER}`,borderRadius:6,color:rounds===r?"#fff":MUTED1,cursor:"pointer",fontSize:14,fontWeight:600,padding:"8px 12px",transition:"all .15s",minWidth:40}}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn" disabled={!player1Name.trim()} onClick={createGame}
              style={{background:player1Name.trim()?C:SURFACE,color:player1Name.trim()?"#fff":MUTED2,marginBottom:10}}>
              CREATE & GET CODE
            </button>
            <button className="btn-ghost" style={{justifyContent:"center",width:"100%"}} onClick={()=>setScreen("home")}>← Back</button>
          </div>
        )}

        {/* ════════════════════════ JOIN ════════════════════════ */}
        {screen==="join" && (
          <div className="slide-up">
            <div className="hd" style={{fontSize:30,letterSpacing:".05em",marginBottom:"1.5rem"}}>JOIN A GAME</div>

            <div style={{marginBottom:12}}>
              <div className="bf" style={{fontSize:11,color:MUTED2,letterSpacing:".07em",textTransform:"uppercase",marginBottom:6}}>Your name</div>
              <input className="inp" placeholder="What should we call you?" value={myName} onChange={e=>setMyName(e.target.value)}/>
            </div>

            <div style={{marginBottom:"1.5rem"}}>
              <div className="bf" style={{fontSize:11,color:MUTED2,letterSpacing:".07em",textTransform:"uppercase",marginBottom:6}}>Game code</div>
              <input className="inp"
                placeholder="e.g. HX7K2R"
                value={joinCode}
                onChange={e=>setJoinCode(e.target.value.toUpperCase().slice(0,6))}
                style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:".18em",textAlign:"center",borderColor:joinError?"#f87171":BORDER}}/>
              {joinError && <div className="bf" style={{color:"#f87171",fontSize:12,marginTop:6}}>{joinError}</div>}
            </div>

            <button className="btn" disabled={!myName.trim()||joinCode.length<6} onClick={joinGame}
              style={{background:myName.trim()&&joinCode.length===6?C2:SURFACE,color:myName.trim()&&joinCode.length===6?"#0D0A14":MUTED2,marginBottom:10}}>
              JOIN GAME
            </button>
            <button className="btn-ghost" style={{justifyContent:"center",width:"100%"}} onClick={()=>setScreen("home")}>← Back</button>
          </div>
        )}

        {/* ════════════════════════ LOBBY ════════════════════════ */}
        {screen==="lobby" && gs && (
          <div className="slide-up">
            <div className="hd" style={{fontSize:28,letterSpacing:".05em",marginBottom:"1.25rem"}}>GAME LOBBY</div>

            {/* Code card */}
            <div style={{background:SURFACE2,border:`2px dashed ${BORDER2}`,borderRadius:12,padding:"1.25rem",textAlign:"center",marginBottom:"1.25rem"}}>
              <div className="bf" style={{color:MUTED2,fontSize:11,letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Share invite link or code</div>
              <div className="hd" style={{fontSize:56,letterSpacing:".18em",color:C,marginBottom:12}}>{gs.code}</div>
              <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                <button className="btn-ghost" onClick={copyCode}>{copied?<><CheckIcon/> Copied!</>:<><CopyIcon/> Copy code</>}</button>
                <button className="btn-ghost" onClick={shareInvite}><ShareIcon/> Share invite</button>
              </div>
            </div>

            {isHost && !usesAppleMusic && !spotify.loggedIn && (
              <div className="card" style={{padding:"0.85rem 1rem",marginBottom:10,borderColor:"#5b21b6"}}>
                <div className="bf" style={{color:"#d8b4fe",fontSize:12,lineHeight:1.5}}>
                  Log in with Spotify above so everyone in the lobby can search artists and songs.
                </div>
              </div>
            )}

            {isHost && usesAppleMusic && musicKitReady && !appleMusicConnected && (
              <div className="card" style={{padding:"0.85rem 1rem",marginBottom:10,borderColor:"#5b21b6"}}>
                <div className="bf" style={{color:"#d8b4fe",fontSize:12,lineHeight:1.5}}>
                  Connect Apple Music above for previews and playback on the host device.
                </div>
              </div>
            )}

            {!isHost && !musicSearchReady && (
              <div className="card" style={{padding:"0.85rem 1rem",marginBottom:10,borderColor:"#5b21b6"}}>
                <div className="bf" style={{color:"#d8b4fe",fontSize:12,lineHeight:1.5}}>
                  {usesAppleMusic
                    ? appleSearchReady
                      ? "Apple Music search is ready."
                      : "Waiting for Apple Music to load…"
                    : "Waiting for the host to log in to Spotify…"}
                </div>
              </div>
            )}

            {usesAppleMusic && !appleSearchReady && musicKitStatus && (
              <div className="card" style={{padding:"0.85rem 1rem",marginBottom:10,borderColor:"#f8717144"}}>
                <div className="bf" style={{color:"#f87171",fontSize:12,lineHeight:1.5}}>
                  Apple Music unavailable: {musicKitStatus}
                </div>
              </div>
            )}

            <div className="card" style={{padding:"1rem 1.25rem",marginBottom:10}}>
              <div className="hd" style={{fontSize:14,letterSpacing:".07em",color:MUTED2,marginBottom:8}}>IN THE LOBBY</div>
              <div className="bf" style={{color:MUTED1,fontSize:12,lineHeight:1.5,marginBottom:8}}>
                {members.length} / {2+gs.maxJudges} people · Host picks two music players; everyone else judges.
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {members.map((m,i)=>(
                  <span key={i} className="pill" style={{background:`${C}18`,border:`1px solid ${C}44`,color:"#c084fc"}}>
                    <UserIcon/> {m} {m===myName&&<span style={{color:C,fontSize:9}}>you</span>}
                  </span>
                ))}
              </div>
            </div>

            {isHost && (!gs.player1 || !gs.player2) && (
              <div className="card" style={{padding:"1rem 1.25rem",marginBottom:10}}>
                <div className="hd" style={{fontSize:14,letterSpacing:".07em",color:MUTED2,marginBottom:8}}>PICK TWO MUSIC PLAYERS</div>
                <div className="bf" style={{color:MUTED3,fontSize:12,marginBottom:10,lineHeight:1.45}}>
                  Choose who battles (you can include yourself). You need at least 3 people total so there is at least one judge.
                </div>
                <div style={{marginBottom:8}}>
                  <div className="bf" style={{fontSize:10,color:MUTED2,marginBottom:4}}>Player 1 (purple side)</div>
                  <select className="inp" style={{fontSize:13,cursor:"pointer"}} value={hostPickP1} onChange={(e)=>setHostPickP1(e.target.value)}>
                    <option value="">—</option>
                    {members.map((m)=>(<option key={m} value={m}>{m}</option>))}
                  </select>
                </div>
                <div style={{marginBottom:12}}>
                  <div className="bf" style={{fontSize:10,color:MUTED2,marginBottom:4}}>Player 2 (lavender side)</div>
                  <select className="inp" style={{fontSize:13,cursor:"pointer"}} value={hostPickP2} onChange={(e)=>setHostPickP2(e.target.value)}>
                    <option value="">—</option>
                    {members.map((m)=>(<option key={`p2-${m}`} value={m}>{m}</option>))}
                  </select>
                </div>
                <button type="button" className="btn" style={{background:C,color:"#fff",fontSize:16}} onClick={assignPlayersFromLobby}>
                  LOCK IN PLAYERS & JUDGES
                </button>
              </div>
            )}

            {/* Players */}
            <div className="card" style={{padding:"1rem 1.25rem",marginBottom:10}}>
              <div className="hd" style={{fontSize:14,letterSpacing:".07em",color:MUTED2,marginBottom:10}}>MUSIC PLAYERS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[0,1].map((i)=>{
                  const name  = i===0?gs.player1:gs.player2;
                  const art   = i===0?gs.artist1:gs.artist2;
                  const col   = COLORS[i];
                  const isMe  = (i===0&&isPlayer1)||(i===1&&isPlayer2);
                  const showPicker = name && isMe && gs.phase === PHASES.LOBBY;
                  return (
                    <div key={i} style={{background:name?COLORS_DIM[i]:SURFACE2,border:`1px solid ${name?col+"44":BORDER}`,borderRadius:8,padding:"0.75rem"}}>
                      <div className="hd" style={{color:col,fontSize:12,letterSpacing:".05em",marginBottom:4}}>
                        P{i+1} {isMe&&<span className="bf" style={{fontSize:9,opacity:.7}}>(you)</span>}
                      </div>
                      {name ? (
                        <>
                          <div className="bf" style={{color:TEXT,fontSize:13,fontWeight:600}}>{name}</div>
                          {showPicker ? (
                            <>
                              {art && (
                                <div className="bf" style={{color:"#4ade80",fontSize:11,marginTop:4,marginBottom:2}}>
                                  Current: {art}
                                </div>
                              )}
                              <ArtistSearch
                                value={art || ""}
                                placeholder={art ? "Search to change artist…" : "Pick your artist"}
                                searchReady={musicSearchReady}
                                usesAppleMusic={usesAppleMusic}
                                musicKitReady={musicKitReady}
                                musicLabel={musicLabel}
                                blockedArtists={i === 0 ? (gs.artist2 ? [gs.artist2] : []) : (gs.artist1 ? [gs.artist1] : [])}
                                onSelect={i === 0 ? submitArtist1 : submitArtist2}
                                onToast={showToast}
                                searchSpotifyArtists={
                                  usesAppleMusic ? undefined : searchSpotifyArtists
                                }
                              />
                              {art && (
                                <div className="bf" style={{color:MUTED3,fontSize:10,marginTop:4}}>
                                  You can change your artist until the host starts the game.
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="bf" style={{color:MUTED2,fontSize:11,marginTop:2}}>{art || "—"}</div>
                          )}
                        </>
                      ) : (
                        <div className="bf" style={{color:MUTED3,fontSize:12}}>Waiting for host…</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Judges */}
            <div className="card" style={{padding:"1rem 1.25rem",marginBottom:"1.25rem"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div className="hd" style={{fontSize:14,letterSpacing:".07em",color:MUTED2}}>JUDGES</div>
                <span className="bf" style={{color:MUTED3,fontSize:11}}>{judges.length}/{gs.maxJudges}</span>
              </div>
              {(!gs.player1 || !gs.player2)
                ? <div className="bf" style={{color:MUTED3,fontSize:13}}>Everyone who is not a music player will judge once the host locks in the two players.</div>
                : judges.length === 0
                  ? <div className="bf" style={{color:MUTED3,fontSize:13}}>No judges (only the two players in the room).</div>
                  : <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {judges.map((j,i)=>(
                        <span key={i} className="pill" style={{background:`${C}18`,border:`1px solid ${C}44`,color:"#c084fc"}}>
                          <UserIcon/> {j} {j===myName&&<span style={{color:C,fontSize:9}}>you</span>}
                        </span>
                      ))}
                    </div>
              }
            </div>

            {isHost && (
              <button className="btn" disabled={!gs.player1||!gs.player2||!gs.artist1||!gs.artist2} onClick={startGame}
                style={{background:(gs.player1&&gs.player2&&gs.artist1&&gs.artist2)?"#d8b4fe":SURFACE,color:(gs.player1&&gs.player2&&gs.artist1&&gs.artist2)?"#0D0A14":MUTED2}}>
                {(gs.player1&&gs.player2&&gs.artist1&&gs.artist2)?"⚡ START THE BATTLE →":"WAITING FOR PLAYERS & ARTISTS…"}
              </button>
            )}
            {!isHost && (
              <div className="bf" style={{textAlign:"center",color:MUTED2,fontSize:13,padding:".75rem"}}>
                {(!gs.player1||!gs.player2)?"Waiting for host to pick the two music players…":
                 isPlayer&&(isPlayer1?!gs.artist1:!gs.artist2)?"← Pick your artist above":
                 isPlayer?"Ready when the host starts…":
                 isJudge?"You’re on the jury — hang tight!":
                 "Waiting for host to start…"}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════ GAME ════════════════════════ */}
        {screen==="game" && gs && (
          <>
            {/* Scoreboard — visible throughout the game until final */}
            {gs.phase!==PHASES.FINAL && (
              <div className="card" style={{padding:"1rem 1.25rem",marginBottom:"1.25rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div className="hd" style={{fontSize:13,letterSpacing:".08em",color:MUTED2}}>SCOREBOARD</div>
                  <span className="bf" style={{fontSize:10,color:MUTED3}}>
                    Split +1 each · Majority +2 / +0
                  </span>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",marginBottom:10,gap:8}}>
                  <div style={{flex:"1 1 0",minWidth:0,textAlign:"left"}}>
                    <div className="hd" style={{fontSize:11,letterSpacing:".06em",color:COLORS[0]}}>{players[0].toUpperCase()}</div>
                    <div className="bf" style={{color:MUTED3,fontSize:10}}>{gs.artist1}</div>
                    <div className="hd" style={{fontSize:40,color:COLORS[0],lineHeight:1}}>{scores[0] ?? 0}</div>
                  </div>
                  <div className="hd" style={{color:MUTED3,fontSize:16,flexShrink:0,textAlign:"center",padding:"0 4px"}}>VS</div>
                  <div style={{flex:"1 1 0",minWidth:0,textAlign:"right"}}>
                    <div className="hd" style={{fontSize:11,letterSpacing:".06em",color:COLORS[1]}}>{players[1].toUpperCase()}</div>
                    <div className="bf" style={{color:MUTED3,fontSize:10}}>{gs.artist2}</div>
                    <div className="hd" style={{fontSize:40,color:COLORS[1],lineHeight:1}}>{scores[1] ?? 0}</div>
                  </div>
                </div>
                {(() => {
                  const s0 = scores[0] ?? 0;
                  const total = s0 + (scores[1] ?? 0);
                  const p0 = total > 0 ? (s0 / total) * 100 : 50;
                  return (
                    <div style={{display:"flex",gap:3,height:6,borderRadius:3,overflow:"hidden",marginBottom:roundHistory.length > 0 ? 12 : 0}}>
                      <div style={{background:C,width:`${p0}%`,transition:"width .5s"}}/>
                      <div style={{background:C2,width:`${100 - p0}%`,transition:"width .5s"}}/>
                    </div>
                  );
                })()}
                {roundHistory.length > 0 && (
                  <div>
                    <div className="bf" style={{fontSize:10,color:MUTED3,letterSpacing:".06em",textTransform:"uppercase",marginBottom:6}}>
                      Round results
                    </div>
                    {roundHistory.map((r,i)=>(
                      <div key={i} className="hrow bf" style={{fontSize:11,marginBottom:4}}>
                        <span style={{color:MUTED3,minWidth:22}}>R{r.round}</span>
                        <span style={{color:C,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.song1}</span>
                        <span style={{color:MUTED3,fontSize:9}}>vs</span>
                        <span style={{color:C2,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right"}}>{r.song2}</span>
                        {r.tied || r.winner == null ? (
                          <span className="tag" style={{background:SURFACE2,color:MUTED1,border:`1px solid ${BORDER}`}}>TIE</span>
                        ) : (
                          <span className="tag" style={{background:COLORS_DIM[r.winner],color:COLORS[r.winner]}}>{players[r.winner]}</span>
                        )}
                        <span className="bf" style={{color:MUTED2,fontSize:10,minWidth:52,textAlign:"right"}}>{roundPointsLabel(r)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── PLAYING ── */}
            {gs.phase===PHASES.PLAYING && (
              <div className="slide-up">
                <div className="hd" style={{fontSize:20,letterSpacing:".06em",color:MUTED1,marginBottom:"1rem",textAlign:"center"}}>
                  ROUND {gs.currentRound} — NAME YOUR HIT
                </div>

                {/* Each player submits their own song */}
                {isPlayer && (
                  <div style={{marginBottom:12}}>
                    <div className="card" style={{padding:"1rem 1.25rem",borderColor:`${COLORS[isPlayer1?0:1]}44`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <MicIcon/>
                        <span className="hd" style={{color:COLORS[isPlayer1?0:1],fontSize:14,letterSpacing:".05em"}}>
                          {(isPlayer1?playerLabel(gs.player1):playerLabel(gs.player2)).toUpperCase()}
                        </span>
                        <span className="bf" style={{color:MUTED2,fontSize:11}}>({isPlayer1?gs.artist1:gs.artist2})</span>
                        <span className="bf" style={{color:MUTED3,fontSize:10}}>(you)</span>
                      </div>
                      {!songSubmitted ? (
                        <>
                          <SongSearch
                            value={mySong}
                            onChange={(val) => {
                              setMySong(val);
                              setMyTrackMeta(null);
                            }}
                            onSelectTrack={(track) =>
                              setMyTrackMeta(
                                buildTrackMeta(track, activeMusicProvider)
                              )
                            }
                            disabled={songSubmitted}
                            searchReady={musicSearchReady}
                            usesAppleMusic={usesAppleMusic}
                            musicKitReady={musicKitReady}
                            musicLabel={musicLabel}
                            roundArtist={isPlayer1 ? gs.artist1 : gs.artist2}
                            searchSpotifyTracks={searchSpotifyTracks}
                            onToast={showToast}
                            onEnter={submitSong}
                            usedSongKeys={myUsedSongKeys}
                            songKeyForTrack={(track) =>
                              normalizeSongKey(
                                `${track.name} — ${track.artists?.map((a) => a.name).join(", ") || ""}`,
                                buildTrackMeta(track, activeMusicProvider)
                              )
                            }
                            placeholder={`Best ${isPlayer1 ? gs.artist1 : gs.artist2} hit…`}
                          />
                          {myUsedSongKeys.size > 0 && (
                            <div className="bf" style={{color:MUTED3,fontSize:11,marginTop:8,lineHeight:1.4}}>
                              Songs you&apos;ve already played this game can&apos;t be picked again.
                            </div>
                          )}
                          <button className="btn" disabled={!mySong.trim()} onClick={submitSong}
                            style={{background:mySong.trim()?COLORS[isPlayer1?0:1]:SURFACE,color:mySong.trim()?"#0D0A14":MUTED2,marginTop:8,fontSize:16}}>
                            LOCK IT IN ✓
                          </button>
                        </>
                      ) : (
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <CheckIcon/>
                          <span className="bf" style={{color:"#4ade80",fontSize:13}}>"{mySong}" locked in</span>
                        </div>
                      )}
                    </div>

                    {/* Opponent status */}
                    <div className="card" style={{padding:"1rem 1.25rem",marginTop:10,opacity:.7}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <MicIcon/>
                        <span className="hd" style={{color:COLORS[isPlayer1?1:0],fontSize:14}}>
                          {(isPlayer1?playerLabel(gs.player2):playerLabel(gs.player1)).toUpperCase()}
                        </span>
                        <span className="bf" style={{color:MUTED2,fontSize:11}}>({isPlayer1?gs.artist2:gs.artist1})</span>
                      </div>
                      <div className="bf" style={{color: (isPlayer1?gs.p2Ready:gs.p1Ready)?"#4ade80":MUTED3, fontSize:13,marginTop:6}}>
                        {(isPlayer1?gs.p2Ready:gs.p1Ready)
                          ? hiddenSongLabel(isPlayer1 ? gs.player2 : gs.player1)
                          : "Choosing their song…"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Judge waiting view */}
                {isJudge && (
                  <div className="card" style={{padding:"2rem",textAlign:"center"}}>
                    <div className="pulse" style={{fontSize:28,marginBottom:10}}>🎵</div>
                    <div className="bf" style={{color:MUTED1,fontSize:14}}>Players are choosing their songs…</div>
                    <div className="bf" style={{color:MUTED3,fontSize:12,marginTop:4}}>You'll vote soon, {myName}</div>
                    <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:14}}>
                      {[0,1].map(i=>(
                        <div key={i} className="bf" style={{fontSize:11,color: (i===0?gs.p1Ready:gs.p2Ready)?"#4ade80":MUTED3}}>
                          {(i===0?gs.p1Ready:gs.p2Ready) ? hiddenSongLabel(players[i]) : `${players[i]}: picking…`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Round history */}
                {!isPlayer && !isJudge && (
                  <div className="card" style={{padding:"1.5rem",textAlign:"center"}}>
                    <div className="bf" style={{color:MUTED1,fontSize:14,marginBottom:8}}>
                      {isHost ? "You’re hosting — waiting for both players to lock in their songs." : "Waiting for the music players to pick their songs…"}
                    </div>
                    <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:8}}>
                      {[0,1].map(i=>(
                        <div key={i} className="bf" style={{fontSize:11,color: (i===0?gs.p1Ready:gs.p2Ready)?"#4ade80":MUTED3}}>
                          {(i===0?gs.p1Ready:gs.p2Ready) ? hiddenSongLabel(players[i]) : `${players[i]}: picking…`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ── LISTENING ── */}
            {gs.phase===PHASES.LISTENING && (
              <div className="slide-up">
                <div style={{textAlign:"center",marginBottom:"1.25rem"}}>
                  <div className="hd" style={{fontSize:28,letterSpacing:".06em",marginBottom:4}}>LISTEN UP 🎧</div>
                  <div className="bf" style={{color:MUTED1,fontSize:13}}>
                    Both songs play before judges vote
                  </div>
                  <div className="bf" style={{color:MUTED3,fontSize:12,marginTop:8}}>
                    {(gs.playbackIndex ?? 0) === 0
                      ? `Now playing: ${players[0]}'s pick`
                      : (gs.playbackIndex ?? 0) === 1
                        ? `Now playing: ${players[1]}'s pick`
                        : "Get ready to vote…"}
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:"1.25rem"}}>
                  {[0,1].map(i=>{
                    const playing = (gs.playbackIndex ?? 0) === i;
                    const done = (gs.playbackIndex ?? 0) > i;
                    const revealed = isSongRevealed(gs, i);
                    return (
                      <div key={i} style={{
                        background: playing ? COLORS_DIM[i] : SURFACE2,
                        border:`2px solid ${playing ? COLORS[i] : done ? COLORS[i] + "44" : BORDER}`,
                        borderRadius:12,padding:"1rem",textAlign:"center",
                        opacity: done && !playing ? 0.75 : 1,
                      }}>
                        <div className="bf" style={{color:MUTED2,fontSize:10,letterSpacing:".06em",marginBottom:4,textTransform:"uppercase"}}>
                          {i===0?gs.artist1:gs.artist2}
                        </div>
                        <div className="hd" style={{
                          color: revealed ? COLORS[i] : MUTED2,
                          fontSize: revealed ? 16 : 14,
                          letterSpacing:".04em",
                          lineHeight:1.25,
                          fontStyle: revealed ? "normal" : "italic",
                        }}>
                          {songDisplayTitle(gs, i, players)}
                        </div>
                        <div className="bf" style={{color:MUTED2,fontSize:11,marginTop:4}}>{players[i]}</div>
                        {playing && (
                          <div className="pulse bf" style={{color:COLORS[i],fontSize:11,marginTop:8}}>
                            ▶ Now playing
                          </div>
                        )}
                        {done && !playing && (
                          <div className="bf" style={{color:"#4ade80",fontSize:11,marginTop:8}}>✓ Played</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isHost && (
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:8}}>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{width:"100%",justifyContent:"center"}}
                      onClick={() => advancePlayback()}
                    >
                      Skip to {(gs.playbackIndex ?? 0) >= 1 ? "voting" : "next song"} →
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{width:"100%",background:C,color:"#fff",fontSize:15}}
                      onClick={() => openVoting()}
                    >
                      Open voting now
                    </button>
                  </div>
                )}

                {isJudge && !isHost && (
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:8}}>
                    <div className="bf" style={{textAlign:"center",color:MUTED2,fontSize:13}}>
                      Both songs should play first — or skip ahead when you&apos;re ready to vote.
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{width:"100%",background:C,color:"#fff",fontSize:15}}
                      onPointerDown={(e) => { e.preventDefault(); openVoting(); }}
                    >
                      Open voting now
                    </button>
                  </div>
                )}

                {isJudge && isHost && (
                  <div className="bf" style={{textAlign:"center",color:MUTED2,fontSize:13,padding:"0.5rem 0 1rem"}}>
                    Tap &quot;Open voting now&quot; above when both songs have played.
                  </div>
                )}

                {isPlayer && (
                  <div className="bf" style={{textAlign:"center",color:MUTED2,fontSize:13,padding:"0.5rem 0 1rem"}}>
                    Sit tight — everyone is listening to your picks…
                  </div>
                )}
              </div>
            )}

            {/* ── JUDGING ── */}
            {gs.phase===PHASES.JUDGING && (
              <div className="slide-up">
                <div style={{textAlign:"center",marginBottom:"1.25rem"}}>
                  <div className="hd" style={{fontSize:28,letterSpacing:".06em",marginBottom:4}}>JUDGES VOTE</div>
                  <div className="bf" style={{color:MUTED1,fontSize:13}}>
                    {allVotesIn
                      ? "All votes in — tally below"
                      : votesTotal > 0
                        ? `${votesCast} / ${votesTotal} votes received`
                        : "No judges in this room"}
                  </div>
                  {!allVotesIn && votesTotal > 0 && (
                    <div className="bf" style={{color:MUTED3,fontSize:12,marginTop:8,lineHeight:1.45,maxWidth:320,marginLeft:"auto",marginRight:"auto"}}>
                      Who voted for whom stays hidden until all ballots are in.
                    </div>
                  )}
                </div>

                {/* Songs on display — titles reveal as each plays */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:"1.25rem"}}>
                  {[0,1].map(i=>{
                    const revealed = isSongRevealed(gs, i);
                    return (
                    <div key={i} style={{background:COLORS_DIM[i],border:`1px solid ${COLORS[i]}44`,borderRadius:12,padding:"1rem",textAlign:"center"}}>
                      <div className="bf" style={{color:MUTED2,fontSize:10,letterSpacing:".06em",marginBottom:4,textTransform:"uppercase"}}>{i===0?gs.artist1:gs.artist2}</div>
                      <div className="hd" style={{
                        color: revealed ? COLORS[i] : MUTED2,
                        fontSize: revealed ? 17 : 14,
                        letterSpacing:".04em",
                        lineHeight:1.25,
                        fontStyle: revealed ? "normal" : "italic",
                      }}>{songDisplayTitle(gs, i, players)}</div>
                      <div className="bf" style={{color:MUTED2,fontSize:11,marginTop:4}}>{players[i]}</div>
                    </div>
                    );
                  })}
                </div>

                {/* Vote buttons — judges only */}
                {isJudge && !myHasVoted && (
                  <>
                    <div className="bf" style={{color:MUTED1,fontSize:12,marginBottom:8,textAlign:"center"}}>Your anonymous pick:</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      {[0,1].map(i=>(
                        <button
                          key={i}
                          type="button"
                          className="vote-btn"
                          onPointerDown={(e) => { e.preventDefault(); castVote(i); }}
                          style={{background:COLORS_DIM[i],borderColor:COLORS[i],color:COLORS[i],touchAction:"manipulation"}}
                        >
                          🏆 {players[i].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {!isJudge && !isPlayer && votesTotal === 0 && (
                  <div className="bf" style={{textAlign:"center",color:MUTED3,fontSize:13,padding:"1rem",lineHeight:1.5}}>
                    No judges in this room — you need at least one person who isn&apos;t a music player to vote.
                  </div>
                )}

                {isJudge && myHasVoted && (
                  <div className="bf" style={{textAlign:"center",color:"#4ade80",fontSize:13,padding:"1rem"}}>
                    ✓ Your vote is in — waiting for others…
                  </div>
                )}

                {isPlayer && (
                  <div className="bf" style={{textAlign:"center",color:MUTED2,fontSize:13,padding:"1rem"}}>
                    Judges are voting…
                  </div>
                )}

                {/* Vote tally + reveal (host after all in) */}
                {allVotesIn && (
                  <div className="card" style={{padding:"1rem 1.25rem",marginTop:12}}>
                    <div className="hd" style={{fontSize:14,letterSpacing:".06em",color:MUTED2,marginBottom:10}}>VOTE TALLY (REVEALED)</div>
                    {[0,1].map(i=>{
                      const v = looksBallot
                        ? (i === 0 ? countAnonymousVotes(votes).v0 : countAnonymousVotes(votes).v1)
                        : judgeNames.filter((j)=>votes[j]===i).length;
                      return (
                        <div key={i} className="bf" style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                          <span style={{color:COLORS[i],minWidth:75,fontSize:13,fontWeight:600}}>{players[i]}</span>
                          <div style={{flex:1,background:SURFACE2,borderRadius:4,height:8,overflow:"hidden"}}>
                            <div style={{background:COLORS[i],height:"100%",width:`${votesTotal>0?(v/votesTotal)*100:0}%`,transition:"width .4s ease"}}/>
                          </div>
                          <span style={{color:COLORS[i],fontSize:14,fontWeight:700,minWidth:18}}>{v}</span>
                        </div>
                      );
                    })}
                    {isHost && <button className="btn" onClick={finalizeRound} style={{background:C,color:"#fff",marginTop:8,fontSize:17}}>REVEAL WINNER 🥁</button>}
                    {!isHost && <div className="bf" style={{color:MUTED2,fontSize:12,textAlign:"center",marginTop:8}}>Waiting for host to reveal…</div>}
                  </div>
                )}
              </div>
            )}

            {/* ── RESULT ── */}
            {gs.phase===PHASES.RESULT && (
              <div className="slide-up" style={{textAlign:"center"}}>
                {gs.roundWinner == null ? (
                  <>
                    <div className="bf" style={{fontSize:12,letterSpacing:".1em",color:MUTED2,textTransform:"uppercase",marginBottom:4}}>Round {gs.currentRound}</div>
                    <div className="hd" style={{fontSize:48,letterSpacing:".04em",color:MUTED1,marginBottom:4}}>SPLIT VOTE 🤝</div>
                    <div className="bf" style={{color:MUTED1,fontSize:13,marginBottom:4}}>+1 point each</div>
                  </>
                ) : (
                  <>
                    <div className="bf" style={{fontSize:12,letterSpacing:".1em",color:MUTED2,textTransform:"uppercase",marginBottom:4}}>Round {gs.currentRound} Winner</div>
                    <div className="hd" style={{fontSize:54,letterSpacing:".04em",color:COLORS[gs.roundWinner],marginBottom:4}}>
                      {players[gs.roundWinner].toUpperCase()}
                    </div>
                    <div className="bf" style={{color:MUTED1,fontSize:13,marginBottom:4}}>
                      with "{gs.roundWinner===0?gs.song1:gs.song2}" · +2 points
                    </div>
                  </>
                )}
                <div className="bf" style={{color:MUTED3,fontSize:12,marginBottom:"1.75rem"}}>
                  {looksBallot
                    ? (() => {
                        const c = countAnonymousVotes(votes);
                        return `${c.v0}–${c.v1} anonymous votes`;
                      })()
                    : `${judgeNames.filter((j) => votes[j] === 0).length}–${judgeNames.filter((j) => votes[j] === 1).length} judges`}
                </div>

                {/* Punishment */}
                <div style={{background:"#180a30",border:`1px solid ${C}44`,borderRadius:10,padding:"1rem 1.25rem",marginBottom:"1.25rem",textAlign:"left"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                    <FlameIcon/><span className="hd" style={{fontSize:14,letterSpacing:".06em",color:C}}>ROUND PUNISHMENT</span>
                  </div>
                  <div className="bf" style={{color:TEXT,fontSize:15,lineHeight:1.5}}>{gs.roundPunishment}</div>
                  <div className="bf" style={{color:MUTED2,fontSize:12,marginTop:6}}>
                    {gs.roundWinner == null
                      ? "Split vote — both players drink 👇"
                      : `${players[gs.roundWinner===0?1:0]} drinks 👇`}
                  </div>
                </div>

                {/* Score cards */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:"1.25rem"}}>
                  {[0,1].map(i=>(
                    <div key={i} style={{
                      background: gs.roundWinner == null ? COLORS_DIM[i] : gs.roundWinner===i ? COLORS_DIM[i] : SURFACE,
                      border:`1px solid ${gs.roundWinner == null ? COLORS[i]+"44" : gs.roundWinner===i ? COLORS[i]+"55" : BORDER}`,
                      borderRadius:10,padding:"1rem",
                    }}>
                      <div className="hd" style={{fontSize:11,letterSpacing:".06em",color:COLORS[i],marginBottom:2}}>{players[i].toUpperCase()}</div>
                      <div className="hd" style={{fontSize:42,color:COLORS[i],lineHeight:1}}>{scores[i] ?? 0}</div>
                      <div className="bf" style={{color:MUTED2,fontSize:11}}>points</div>
                    </div>
                  ))}
                </div>

                {isHost && (
                  <button className="btn" onClick={nextRound}
                    style={{background:gs.currentRound>=gs.rounds?"#d8b4fe":C2,color:"#0D0A14"}}>
                    {gs.currentRound>=gs.rounds?"🏆 END GAME":`ROUND ${gs.currentRound+1} →`}
                  </button>
                )}
                {!isHost&&<div className="bf" style={{color:MUTED2,fontSize:13}}>Waiting for host…</div>}
              </div>
            )}

            {/* ── FINAL ── */}
            {gs.phase===PHASES.FINAL && (
              <div className="slide-up" style={{textAlign:"center"}}>
                <div className="bf" style={{fontSize:11,letterSpacing:".1em",color:MUTED2,textTransform:"uppercase",marginBottom:6}}>Game Over</div>

                {gameWinner!==-1 ? (
                  <>
                    <div className="bf" style={{fontSize:11,letterSpacing:".1em",color:MUTED1,textTransform:"uppercase",marginBottom:4}}>WINNER</div>
                    <div className="hd" style={{fontSize:58,letterSpacing:".04em",color:COLORS[gameWinner],lineHeight:1,marginBottom:4}}>
                      {players[gameWinner].toUpperCase()}
                    </div>
                    <div className="bf" style={{color:COLORS[gameWinner],fontSize:13,marginBottom:2}}>{(gameWinner===0?gs.artist1:gs.artist2).toUpperCase()} STAN</div>
                    <div className="bf" style={{color:MUTED2,fontSize:12,marginBottom:"2rem"}}>
                      {scores[gameWinner] ?? 0}–{scores[gameWinner===0?1:0] ?? 0} points
                    </div>
                  </>
                ) : (
                  <div className="hd" style={{fontSize:36,color:MUTED1,marginBottom:"2rem"}}>IT'S A TIE 🤝</div>
                )}

                {/* Final punishment */}
                <div style={{background:"#1a0a2e",border:`2px solid ${C}55`,borderRadius:14,padding:"1.25rem 1.5rem",marginBottom:"1.5rem",textAlign:"left"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <FlameIcon s={20}/><span className="hd" style={{fontSize:18,letterSpacing:".06em",color:C}}>FINAL PUNISHMENT</span>
                  </div>
                  <div className="bf" style={{color:TEXT,fontSize:15,lineHeight:1.65,marginBottom:8}}>{gs.finalPunishment}</div>
                  {gameLoser!==-1&&<div className="bf" style={{color:MUTED2,fontSize:12}}>{players[gameLoser]} takes the L 😬</div>}
                </div>

                {/* Scorecard */}
                <div className="card" style={{padding:"1rem",marginBottom:"1.5rem",textAlign:"left"}}>
                  <div className="hd" style={{fontSize:13,letterSpacing:".08em",color:MUTED2,marginBottom:8}}>SCORECARD</div>
                  {roundHistory.map((r,i)=>(
                    <div key={i} className="hrow bf" style={{fontSize:12}}>
                      <span style={{color:MUTED3}}>R{r.round}</span>
                      <span style={{color:C,maxWidth:95,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.song1}</span>
                      <span style={{color:MUTED3,fontSize:10}}>vs</span>
                      <span style={{color:C2,maxWidth:95,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.song2}</span>
                      {r.tied || r.winner == null ? (
                        <span className="tag" style={{background:SURFACE2,color:MUTED1}}>TIE</span>
                      ) : (
                        <span className="tag" style={{background:COLORS_DIM[r.winner],color:COLORS[r.winner]}}>{players[r.winner]}</span>
                      )}
                      <span className="bf" style={{color:MUTED2,fontSize:10}}>{roundPointsLabel(r)}</span>
                    </div>
                  ))}
                </div>

                <button className="btn" style={{background:C,color:"#fff"}} onClick={resetAll}>
                  PLAY AGAIN
                </button>
              </div>
            )}
          </>
        )}

      </main>
    </div>
  );
}
