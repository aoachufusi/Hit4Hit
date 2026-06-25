import { ref, get } from "firebase/database";
import { ensureAuthWithRetry } from "./auth.js";
import { db, isFirebaseConfigured } from "./config.js";
import { withTimeout } from "./promiseUtils.js";
import { waitForDatabaseOnline } from "./dbConnection.js";

function formatErr(err) {
  const code = err?.code || "";
  const msg = String(err?.message || err || "Unknown error");
  return code && !msg.includes(code) ? `${code}: ${msg}` : msg;
}

/**
 * Step-by-step Firebase connectivity check.
 * @param {{ gameCode?: string }} [options]
 * @returns {Promise<{ ok: boolean, steps: Array<{ id: string, label: string, ok: boolean, detail: string }>, at: number }>}
 */
export async function runFirebaseDiagnostics({ gameCode } = {}) {
  const steps = [];
  const push = (id, label, ok, detail) => {
    const step = { id, label, ok, detail };
    steps.push(step);
    console.log(`[Hit4Hit sync] ${ok ? "✓" : "✗"} ${label}: ${detail}`);
  };

  const host =
    typeof window !== "undefined" ? window.location.hostname : "unknown";
  push("host", "Site", true, host);

  if (!isFirebaseConfigured || !db) {
    push(
      "config",
      "Firebase config",
      false,
      "VITE_FIREBASE_* missing in this build"
    );
    return { ok: false, steps, at: Date.now() };
  }
  push("config", "Firebase config", true, "Build has Firebase env vars");

  try {
    const user = await withTimeout(ensureAuthWithRetry(), 15_000, "AUTH_DIAG");
    push(
      "auth",
      "Anonymous sign-in",
      true,
      `Signed in (…${user.uid.slice(-6)})`
    );
  } catch (err) {
    push("auth", "Anonymous sign-in", false, formatErr(err));
    return { ok: false, steps, at: Date.now() };
  }

  try {
    await waitForDatabaseOnline(12_000);
    push("database", "Realtime Database", true, "Connected");
  } catch (err) {
    push("database", "Realtime Database", false, formatErr(err));
    return { ok: false, steps, at: Date.now() };
  }

  const code = String(gameCode || "").trim().toUpperCase();
  if (code) {
    try {
      const snap = await withTimeout(
        get(ref(db, `games/${code}`)),
        15_000,
        "READ_GAME"
      );
      push(
        "game",
        `Game ${code}`,
        true,
        snap.exists() ? "Found" : "Not found — check the code"
      );
    } catch (err) {
      push("game", `Game ${code}`, false, formatErr(err));
    }
  } else {
    try {
      await withTimeout(
        get(ref(db, ".info/serverTimeOffset")),
        8_000,
        "READ_INFO"
      );
      push("database-read", "Database read", true, "Server reachable");
    } catch (err) {
      push("database-read", "Database read", false, formatErr(err));
    }
  }

  const ok = steps.every((s) => s.ok);
  console.log(`[Hit4Hit sync] Diagnostics ${ok ? "passed" : "failed"}`);
  return { ok, steps, at: Date.now() };
}

export function formatDiagnosticsText(result) {
  if (!result?.steps?.length) return "No diagnostics";
  const lines = result.steps.map(
    (s) => `${s.ok ? "OK" : "FAIL"}  ${s.label}: ${s.detail}`
  );
  lines.push(`Time: ${new Date(result.at).toISOString()}`);
  return lines.join("\n");
}

export async function copyDiagnostics(result) {
  const text = formatDiagnosticsText(result);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
