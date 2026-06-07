import {
  ref, set, get, update, onValue,
} from "firebase/database";
import { db, isFirebaseConfigured } from "./config.js";
import { ensureAuth } from "./auth.js";

async function requireDb() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(
      "Firebase is not configured. Check VITE_FIREBASE_* in .env and restart the dev server."
    );
  }
  await ensureAuth();
  return db;
}

// ── Create a new game
export async function createGame(gameState) {
  const gameRef = ref(await requireDb(), `games/${gameState.code}`);
  await set(gameRef, {
    ...gameState,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return gameState;
}

// ── Read a game once (for joining)
export async function getGame(code) {
  const snap = await get(ref(await requireDb(), `games/${code}`));
  return snap.exists() ? snap.val() : null;
}

// ── Full state overwrite
export async function setGame(state) {
  await set(ref(await requireDb(), `games/${state.code}`), {
    ...state,
    updatedAt: Date.now(),
  });
  return state;
}

// ── Partial update — for single-field changes
export async function updateGame(code, patch) {
  await update(ref(await requireDb(), `games/${code}`), {
    ...patch,
    updatedAt: Date.now(),
  });
}

// ── Single judge vote — avoids overwriting concurrent votes on judgeVotes
export async function castVote(code, judgeName, vote) {
  await set(ref(await requireDb(), `games/${code}/judgeVotes/${judgeName}`), vote);
}

// ── Real-time listener — call this when joining a game
// Returns an unsubscribe function — call it on component unmount
export async function subscribeToGame(code, onChange, onError) {
  const gameRef = ref(await requireDb(), `games/${code}`);
  return onValue(
    gameRef,
    (snap) => {
      if (snap.exists()) onChange(snap.val());
    },
    (err) => {
      console.error("subscribeToGame error", err);
      onError?.(err);
    }
  );
}

// ── Delete game when finished (keep DB clean)
export async function deleteGame(code) {
  await set(ref(await requireDb(), `games/${code}`), null);
}