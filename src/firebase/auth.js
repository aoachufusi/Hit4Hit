import {
  getAuth,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
} from "firebase/auth";
import { app } from "./config.js";
import { withTimeout } from "./promiseUtils.js";
import { isLikelyChrome } from "./browserUtils.js";

const auth = app ? getAuth(app) : null;
const AUTH_TIMEOUT_MS = 15_000;

let authInFlight = null;
let useInMemoryPersistence = false;
let persistenceConfigured = false;

export { isLikelyChrome };

/** Wipe Firebase IndexedDB + localStorage (Chrome stuck sessions only — avoid on Safari). */
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

async function configurePersistence() {
  if (!auth || persistenceConfigured) return;
  const mode = useInMemoryPersistence
    ? inMemoryPersistence
    : browserLocalPersistence;
  await setPersistence(auth, mode);
  persistenceConfigured = true;
}

/** Sign out only — does not wipe browser storage (safe for Safari retries). */
export async function clearAuthSession() {
  if (!auth) return;
  authInFlight = null;
  try {
    await auth.signOut();
  } catch (err) {
    console.warn("Firebase signOut failed", err);
  }
}

/** Full reset for manual retry — wipes cached auth storage. */
export async function hardResetAuthSession() {
  if (!auth) return;
  authInFlight = null;
  persistenceConfigured = false;
  try {
    await auth.signOut();
  } catch (err) {
    console.warn("Firebase signOut failed", err);
  }
  await clearFirebaseBrowserStorage();
}

async function signInFresh() {
  await configurePersistence();
  const result = await withTimeout(
    signInAnonymously(auth),
    AUTH_TIMEOUT_MS,
    "AUTH"
  );
  return result.user;
}

export async function ensureAuth({ forceRefresh = false, wipeStorage = false } = {}) {
  if (!auth) {
    throw new Error(
      "Firebase is not configured. Check VITE_FIREBASE_* in .env and restart the dev server."
    );
  }

  if (forceRefresh) {
    authInFlight = null;
    persistenceConfigured = false;
    try {
      await auth.signOut();
    } catch (err) {
      console.warn("Firebase signOut failed", err);
    }
    if (wipeStorage) {
      await clearFirebaseBrowserStorage();
    }
  }

  if (auth.currentUser && !forceRefresh) {
    try {
      await withTimeout(auth.currentUser.getIdToken(false), AUTH_TIMEOUT_MS, "TOKEN");
      return auth.currentUser;
    } catch (err) {
      console.warn("Stale Firebase session, signing in again", err);
      await clearAuthSession();
      persistenceConfigured = false;
    }
  }

  if (!authInFlight) {
    authInFlight = signInFresh().finally(() => {
      authInFlight = null;
    });
  }

  return authInFlight;
}

/** Sign in with timeout; only wipes storage after repeated failures (Chrome). */
export async function ensureAuthWithRetry() {
  try {
    return await ensureAuth();
  } catch (first) {
    console.warn("Firebase auth failed, retrying after sign-out", first);
    try {
      return await ensureAuth({ forceRefresh: true });
    } catch (second) {
      if (!isLikelyChrome()) {
        throw second;
      }
      console.warn("Firebase auth failed, hard reset (Chrome)", second);
      useInMemoryPersistence = true;
      persistenceConfigured = false;
      authInFlight = null;
      return ensureAuth({ forceRefresh: true, wipeStorage: true });
    }
  }
}

/** User-facing hint when Firebase auth or RTDB connection fails. */
export function formatFirebaseConnectError(err) {
  const code = err?.code || "";
  const msg = String(err?.message || err || "");

  if (msg.includes("TIMEOUT") || code === "auth/network-request-failed") {
    if (isLikelyChrome()) {
      return "Chrome blocked Firebase — disable extensions for this site or clear site data";
    }
    return "Connection timed out — check your network and try again";
  }
  if (code === "auth/unauthorized-domain") {
    return "This site isn't authorized in Firebase — add your domain under Authentication → Settings";
  }
  if (code === "auth/operation-not-allowed") {
    return "Enable Anonymous sign-in in Firebase Authentication";
  }
  if (/permission_denied|Permission denied/i.test(msg)) {
    return "Game server rejected the connection — tap Retry or refresh the page";
  }
  if (isLikelyChrome()) {
    return "Chrome couldn't connect — try Safari, or clear site data for this site";
  }
  return "Failed to connect — try again or refresh the page";
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}
