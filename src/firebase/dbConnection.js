import { ref, onValue, get, goOnline, goOffline } from "firebase/database";
import { db } from "./config.js";
import { restGet } from "./restFallback.js";

/** Kick the RTDB client to reconnect (safe to call before waiting on .info/connected). */
export function nudgeDatabaseOnline() {
  if (!db) return;
  try {
    goOnline(db);
  } catch (err) {
    console.warn("[Hit4Hit sync] goOnline failed", err);
  }
}

/** Cycle offline/online — helps Chrome recover a stuck socket session. */
export function reconnectDatabase() {
  if (!db) return;
  try {
    goOffline(db);
    goOnline(db);
  } catch (err) {
    console.warn("[Hit4Hit sync] reconnectDatabase failed", err);
  }
}

async function probeSdkRead(timeoutMs = 6000) {
  if (!db) return false;
  try {
    await Promise.race([
      get(ref(db, ".info/serverTimeOffset")),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SDK_READ_PROBE_TIMEOUT")), timeoutMs)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function probeRestRead(timeoutMs = 8000) {
  try {
    await restGet(".info/serverTimeOffset", timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until Firebase RTDB is usable.
 * @param {number} timeoutMs
 * @param {{ allowRestFallback?: boolean }} [options]
 * @returns {Promise<{ mode: "socket" | "sdk-read" | "rest" }>}
 */
export function waitForDatabaseOnline(timeoutMs = 15_000, options = {}) {
  const { allowRestFallback = true } = options;

  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }

    nudgeDatabaseOnline();

    const connectedRef = ref(db, ".info/connected");
    let settled = false;
    let unsub = () => {};

    const finish = (err, mode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      if (err) reject(err);
      else resolve({ mode });
    };

    const timer = setTimeout(async () => {
      unsub();

      if (await probeSdkRead(Math.min(6000, timeoutMs))) {
        finish(null, "sdk-read");
        return;
      }

      if (allowRestFallback && (await probeRestRead(Math.min(8000, timeoutMs)))) {
        finish(null, "rest");
        return;
      }

      finish(new Error("DB_CONNECTED_TIMEOUT"), null);
    }, timeoutMs);

    unsub = onValue(
      connectedRef,
      (snap) => {
        if (snap.val() === true) {
          finish(null, "socket");
        }
      },
      (err) => finish(err, null)
    );
  });
}

/** Diagnostics helper — is HTTPS REST reachable when the live socket is not? */
export async function probeDatabaseRest(timeoutMs = 10_000) {
  return probeRestRead(timeoutMs);
}
