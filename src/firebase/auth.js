import { getAuth, signInAnonymously } from "firebase/auth";
import { app } from "./config.js";
import { withTimeout } from "./promiseUtils.js";

const auth = app ? getAuth(app) : null;
const AUTH_TIMEOUT_MS = 15_000;

let authInFlight = null;

/** Clear cached Firebase auth (fixes stuck anonymous sessions in browser storage). */
export async function clearAuthSession() {
  if (!auth) return;
  authInFlight = null;
  try {
    await auth.signOut();
  } catch (err) {
    console.warn("Firebase signOut failed", err);
  }
}

async function signInFresh() {
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

/** Sign in with timeout; on failure, clear storage and retry once. */
export async function ensureAuthWithRetry() {
  try {
    return await ensureAuth();
  } catch (first) {
    console.warn("Firebase auth failed, retrying after sign-out", first);
    return ensureAuth({ forceRefresh: true });
  }
}

/** User-facing hint when Firebase auth or RTDB connection fails. */
export function formatFirebaseConnectError(err) {
  const code = err?.code || "";
  const msg = String(err?.message || err || "");

  if (msg.includes("TIMEOUT") || code === "auth/network-request-failed") {
    return "Connection timed out — disable ad blockers for this site or clear site data and refresh";
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
  return "Failed to connect — try again or use a private/incognito window";
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}
