import { getAuth } from "firebase/auth";
import { app, isFirebaseConfigured } from "./config.js";
import { ensureAuthWithRetry } from "./auth.js";
import { withTimeout } from "./promiseUtils.js";

const auth = app ? getAuth(app) : null;

function databaseBaseUrl() {
  const url = String(import.meta.env.VITE_FIREBASE_DATABASE_URL || "").replace(
    /\/$/,
    ""
  );
  if (!url) throw new Error("VITE_FIREBASE_DATABASE_URL missing");
  return url;
}

async function restAuthParam() {
  await ensureAuthWithRetry();
  const user = auth?.currentUser;
  if (!user) throw new Error("Not signed in");
  return encodeURIComponent(await user.getIdToken());
}

/** HTTPS read when the Firebase SDK WebSocket/long-poll path is blocked. */
export async function restGet(path, timeoutMs = 15_000) {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured");
  }
  const token = await restAuthParam();
  const url = `${databaseBaseUrl()}/${path}.json?auth=${token}`;
  const res = await withTimeout(fetch(url), timeoutMs, "REST_GET");
  if (res.status === 401 || res.status === 403) {
    throw new Error("Permission denied");
  }
  if (!res.ok) {
    throw new Error(`REST_GET_${res.status}`);
  }
  return res.json();
}

/** HTTPS write when the Firebase SDK path is blocked. */
export async function restSet(path, value, timeoutMs = 15_000) {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured");
  }
  const token = await restAuthParam();
  const url = `${databaseBaseUrl()}/${path}.json?auth=${token}`;
  const res = await withTimeout(
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
    timeoutMs,
    "REST_SET"
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error("Permission denied");
  }
  if (!res.ok) {
    throw new Error(`REST_SET_${res.status}`);
  }
  return res.json();
}

/** Partial update via REST PATCH. */
export async function restPatch(path, patch, timeoutMs = 15_000) {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured");
  }
  const token = await restAuthParam();
  const url = `${databaseBaseUrl()}/${path}.json?auth=${token}`;
  const res = await withTimeout(
    fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    timeoutMs,
    "REST_PATCH"
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error("Permission denied");
  }
  if (!res.ok) {
    throw new Error(`REST_PATCH_${res.status}`);
  }
  return res.json();
}
