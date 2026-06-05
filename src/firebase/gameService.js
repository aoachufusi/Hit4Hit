import {
  ref, set, get, update, onValue, off,
} from "firebase/database";
import { db, isFirebaseConfigured } from "./config.js";

function requireDb() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(
      "Firebase is not configured. Check VITE_FIREBASE_* in .env and restart the dev server."
    );
  }
  return db;
}

// ── Create a new game
export async function createGame(gameState) {
  const gameRef = ref(requireDb(), `games/${gameState.code}`);
  await set(gameRef, {
    ...gameState,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return gameState;
}

// ── Read a game once (for joining)
export async function getGame(code) {
  const snap = await get(ref(requireDb(), `games/${code}`));
  return snap.exists() ? snap.val() : null;
}

// ── Full state overwrite
export async function setGame(state) {
  await set(ref(requireDb(), `games/${state.code}`), {
    ...state,
    updatedAt: Date.now(),
  });
  return state;
}

// ── Partial update — for single-field changes
export async function updateGame(code, patch) {
  await update(ref(requireDb(), `games/${code}`), {
    ...patch,
    updatedAt: Date.now(),
  });
}

// ── Single judge vote — avoids overwriting concurrent votes on judgeVotes
export async function castVote(code, judgeName, vote) {
  await set(ref(requireDb(), `games/${code}/judgeVotes/${judgeName}`), vote);
}

// ── Real-time listener — call this when joining a game
// Returns an unsubscribe function — call it on component unmount
export function subscribeToGame(code, onChange) {
  const gameRef = ref(requireDb(), `games/${code}`);
  onValue(gameRef, (snap) => {
    if (snap.exists()) onChange(snap.val());
  });
  return () => off(gameRef);
}

// ── Delete game when finished (keep DB clean)
export async function deleteGame(code) {
  await set(ref(requireDb(), `games/${code}`), null);
}