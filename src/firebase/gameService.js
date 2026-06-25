import {
  ref, set, get, update, onValue,
} from "firebase/database";
import { db, isFirebaseConfigured } from "./config.js";
import { ensureAuthWithRetry } from "./auth.js";
import { withTimeout } from "./promiseUtils.js";
import { waitForDatabaseOnline } from "./dbConnection.js";
import { restGet, restSet, restPatch } from "./restFallback.js";

const DB_TIMEOUT_MS = 20_000;

let dbReadyPromise = null;

function resetDbReady() {
  dbReadyPromise = null;
}

function isSdkTimeout(err, label) {
  return String(err?.message || err).includes(`${label}_TIMEOUT`);
}

async function ensureDbReady() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(
      "Firebase is not configured. Check VITE_FIREBASE_* in .env and restart the dev server."
    );
  }
  if (!dbReadyPromise) {
    dbReadyPromise = ensureAuthWithRetry()
      .then(() => waitForDatabaseOnline(15_000))
      .catch((err) => {
        dbReadyPromise = null;
        throw err;
      });
  }
  await dbReadyPromise;
  return db;
}

async function requireDb() {
  return ensureDbReady();
}

async function dbOp(promise, label) {
  return withTimeout(promise, DB_TIMEOUT_MS, label);
}

// ── Create a new game
export async function createGame(gameState) {
  const payload = {
    ...gameState,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    const gameRef = ref(await requireDb(), `games/${gameState.code}`);
    await dbOp(set(gameRef, payload), "CREATE_GAME");
  } catch (err) {
    if (!isSdkTimeout(err, "CREATE_GAME")) throw err;
    console.warn("SDK create timed out, trying REST fallback", err);
    await restSet(`games/${gameState.code}`, payload);
  }
  return gameState;
}

// ── Read a game once (for joining)
export async function getGame(code) {
  try {
    const snap = await dbOp(
      get(ref(await requireDb(), `games/${code}`)),
      "GET_GAME"
    );
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    if (!isSdkTimeout(err, "GET_GAME")) throw err;
    console.warn("SDK getGame timed out, trying REST fallback", err);
    const data = await restGet(`games/${code}`);
    return data ?? null;
  }
}

// ── Full state overwrite
export async function setGame(state) {
  const payload = { ...state, updatedAt: Date.now() };
  try {
    await dbOp(
      set(ref(await requireDb(), `games/${state.code}`), payload),
      "SET_GAME"
    );
  } catch (err) {
    if (!isSdkTimeout(err, "SET_GAME")) throw err;
    await restSet(`games/${state.code}`, payload);
  }
  return state;
}

// ── Partial update — for single-field changes
export async function updateGame(code, patch) {
  const payload = { ...patch, updatedAt: Date.now() };
  try {
    await dbOp(
      update(ref(await requireDb(), `games/${code}`), payload),
      "UPDATE_GAME"
    );
  } catch (err) {
    if (!isSdkTimeout(err, "UPDATE_GAME")) throw err;
    await restPatch(`games/${code}`, payload);
  }
}

// ── Single judge vote — avoids overwriting concurrent votes on judgeVotes
export async function castVote(code, judgeName, vote) {
  try {
    await dbOp(
      set(ref(await requireDb(), `games/${code}/judgeVotes/${judgeName}`), vote),
      "CAST_VOTE"
    );
  } catch (err) {
    if (!isSdkTimeout(err, "CAST_VOTE")) throw err;
    await restSet(`games/${code}/judgeVotes/${judgeName}`, vote);
  }
}

// ── Real-time listener — call this when joining a game
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
  try {
    await dbOp(set(ref(await requireDb(), `games/${code}`), null), "DELETE_GAME");
  } catch (err) {
    if (!isSdkTimeout(err, "DELETE_GAME")) throw err;
    await restSet(`games/${code}`, null);
  }
}

export { resetDbReady };
