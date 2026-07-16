import {
  ref,
  set,
  get,
  update,
  onValue,
  type Unsubscribe,
} from "firebase/database";
import { db, isFirebaseConfigured } from "./config";
import type { GameState } from "../types/game";

async function requireDb() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(
      "Firebase is not configured. Add EXPO_PUBLIC_FIREBASE_* to ios/.env and restart Expo."
    );
  }
  return db;
}

export async function createGame(gameState: GameState): Promise<GameState> {
  const database = await requireDb();
  const payload = {
    ...gameState,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await set(ref(database, `games/${gameState.code}`), payload);
  return gameState;
}

export async function getGame(code: string): Promise<GameState | null> {
  const database = await requireDb();
  const snap = await get(ref(database, `games/${code}`));
  return snap.exists() ? (snap.val() as GameState) : null;
}

export async function setGame(state: GameState): Promise<GameState> {
  const database = await requireDb();
  const payload = { ...state, updatedAt: Date.now() };
  await set(ref(database, `games/${state.code}`), payload);
  return state;
}

export async function updateGame(
  code: string,
  patch: Partial<GameState> & Record<string, unknown>
): Promise<void> {
  const database = await requireDb();
  await update(ref(database, `games/${code}`), {
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function castVote(
  code: string,
  judgeName: string,
  vote: 0 | 1
): Promise<void> {
  const database = await requireDb();
  await set(ref(database, `games/${code}/judgeVotes/${judgeName}`), vote);
}

export async function subscribeToGame(
  code: string,
  onChange: (game: GameState) => void,
  onError?: (err: Error) => void
): Promise<Unsubscribe> {
  const database = await requireDb();
  const gameRef = ref(database, `games/${code}`);
  return onValue(
    gameRef,
    (snap) => {
      if (snap.exists()) onChange(snap.val() as GameState);
    },
    (err) => {
      console.error("subscribeToGame error", err);
      onError?.(err);
    }
  );
}

export async function deleteGame(code: string): Promise<void> {
  const database = await requireDb();
  await set(ref(database, `games/${code}`), null);
}
