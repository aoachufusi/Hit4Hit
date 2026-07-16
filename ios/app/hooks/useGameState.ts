import { useCallback, useEffect, useState } from "react";
import type { Unsubscribe } from "firebase/database";
import {
  createGame,
  getGame,
  subscribeToGame,
  updateGame,
  castVote,
} from "../firebase/gameService";
import type { GameState } from "../types/game";

export function useGameState(code?: string | null) {
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(Boolean(code));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setGame(null);
      setLoading(false);
      return;
    }

    let unsub: Unsubscribe | null = null;
    let cancelled = false;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        unsub = await subscribeToGame(
          code,
          (next) => {
            if (!cancelled) {
              setGame(next);
              setLoading(false);
            }
          },
          (err) => {
            if (!cancelled) {
              setError(err.message);
              setLoading(false);
            }
          }
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to sync game");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [code]);

  const create = useCallback(async (initial: GameState) => {
    const created = await createGame(initial);
    setGame(created);
    return created;
  }, []);

  const fetchOnce = useCallback(async (gameCode: string) => {
    const found = await getGame(gameCode);
    setGame(found);
    return found;
  }, []);

  const patch = useCallback(
    async (patchBody: Partial<GameState> & Record<string, unknown>) => {
      if (!code) throw new Error("No game code");
      await updateGame(code, patchBody);
    },
    [code]
  );

  const vote = useCallback(
    async (judgeName: string, choice: 0 | 1) => {
      if (!code) throw new Error("No game code");
      await castVote(code, judgeName, choice);
    },
    [code]
  );

  return {
    game,
    loading,
    error,
    create,
    fetchOnce,
    patch,
    vote,
    setGame,
  };
}
