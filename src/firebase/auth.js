import {
  getAuth,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
} from "firebase/auth";
import { app } from "./config.js";
import { withTimeout } from "./promiseUtils.js";

const auth = app ? getAuth(app) : null;
const AUTH_TIMEOUT_MS = 15_000;

let authInFlight = null;
let useInMemoryPersistence = false;

/** Chrome often blocks or corrupts IndexedDB auth storage while Safari works fine. */
export function isLikelyChrome() {
  if (typeof navigator === "undefined") return false;
  return /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
}

/** Wipe Firebase IndexedDB + localStorage (fixes stuck Chrome sessions). */
export async function clearFirebaseBrowserStorage() {
  if (typeof indexedDB !== "undefined" && indexedDB.databases) {
    try {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs
          .filter((db) => db.name && /firebase/i.test(db.name))
          .map(
            (db) =>
              new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
          )
      );
    } catch (err) {
      console.warn("Firebase IndexedDB cleanup failed", err);
    }
  }

  try {
    for (const key of Object.keys(localStorage)) {
      if (/firebase/i.test(key)) localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn("Firebase localStorage cleanup failed", err);
  }
}

/** Clear cached Firebase auth (fixes stuck anonymous sessions in browser storage). */
export async function clearAuthSession() {
  if (!auth) return;
  authInFlight = null;
  try {
    await auth.signOut();
  } catch (err) {
    console.warn("Firebase signOut failed", err);
  }
  await clearFirebaseBrowserStorage();
}

async function signInFresh() {
  const persistence = useInMemoryPersistence
    ? inMemoryPersistence
    : browserLocalPersistence;
  await setPersistence(auth, persistence);
  const result = await withTimeout(
    signInAnonymously(auth),
    AUTH_TIMEOUT_MS,
    "AUTH"
  );
  return result.user;
}

export async function ensureAuth({ forceRefresh = false } = {}) {
  if (!auth) {
    throw new Error(
      "Firebase is not configured. Check VITE_FIREBASE_* in .env and restart the dev server."
    );
  }

  if (forceRefresh) {
    await clearAuthSession();
  }

  if (auth.currentUser && !forceRefresh) {
    try {
      await withTimeout(auth.currentUser.getIdToken(false), AUTH_TIMEOUT_MS, "TOKEN");
      return auth.currentUser;
    } catch (err) {
      console.warn("Stale Firebase session, signing in again", err);
      await clearAuthSession();
    }
  }

  if (!authInFlight) {
    authInFlight = signInFresh().finally(() => {
      authInFlight = null;
    });
  }

  return authInFlight;
}

/** Sign in with timeout; on failure, clear storage and retry with in-memory fallback. */
export async function ensureAuthWithRetry() {
  try {
    return await ensureAuth();
  } catch (first) {
    console.warn("Firebase auth failed, retrying after sign-out", first);
    try {
      return await ensureAuth({ forceRefresh: true });
    } catch (second) {
      console.warn("Firebase auth failed, trying in-memory persistence", second);
      useInMemoryPersistence = true;
      authInFlight = null;
      return ensureAuth({ forceRefresh: true });
    }
  }
}

/** User-facing hint when Firebase auth or RTDB connection fails. */
export function formatFirebaseConnectError(err) {
  const code = err?.code || "";
  const msg = String(err?.message || err || "");

  if (msg.includes("TIMEOUT") || code === "auth/network-request-failed") {
    if (isLikelyChrome()) {
      return "Chrome blocked Firebase — disable extensions for this site or clear site data (lock icon → Site settings → Clear data)";
    }
    return "Connection timed out — try another browser or network";
  }
  if (code === "auth/unauthorized-domain") {
    return "This site isn't authorized in Firebase — add your domain under Authentication → Settings";
  }
  if (code === "auth/operation-not-allowed") {
    return "Enable Anonymous sign-in in Firebase Authentication";
  }
  if (/permission_denied|Permission denied/i.test(msg)) {
    return "Could not reach the game server — try again";
  }
  if (isLikelyChrome()) {
    return "Chrome couldn't connect — try Safari, or clear site data for this site in Chrome";
  }
  return "Failed to connect — try again or use another browser";
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}
