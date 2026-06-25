import { ref, get } from "firebase/database";
import { ensureAuthWithRetry } from "./auth.js";
import { db, isFirebaseConfigured } from "./config.js";
import { withTimeout } from "./promiseUtils.js";
import {
  waitForDatabaseOnline,
  nudgeDatabaseOnline,
  reconnectDatabase,
  probeDatabaseRest,
} from "./dbConnection.js";
import { restGet } from "./restFallback.js";
import { isLikelyChrome } from "./browserUtils.js";

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
    reconnectDatabase();
    nudgeDatabaseOnline();
    const conn = await waitForDatabaseOnline(18_000, { allowRestFallback: false });
    const modeLabel =
      conn.mode === "socket"
        ? "Connected (live socket)"
        : conn.mode === "sdk-read"
          ? "Connected (SDK read)"
          : "Connected";
    push("database", "Realtime Database", true, modeLabel);
  } catch (err) {
    const restOk = await probeDatabaseRest(10_000);
    if (restOk) {
      const hint = isLikelyChrome()
        ? "Live socket blocked — disable ad blockers/extensions for this site, or try Safari. HTTPS reads OK."
        : "Live socket blocked — check network/VPN. HTTPS reads OK.";
      push("database", "Realtime Database", false, hint);
    } else {
      push("database", "Realtime Database", false, formatErr(err));
      return { ok: false, steps, at: Date.now() };
    }
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
      try {
        const data = await restGet(`games/${code}`, 12_000);
        push(
          "game",
          `Game ${code}`,
          true,
          data ? "Found (REST)" : "Not found — check the code"
        );
      } catch {
        push("game", `Game ${code}`, false, formatErr(err));
      }
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
      try {
        await restGet(".info/serverTimeOffset", 8_000);
        push("database-read", "Database read", true, "Server reachable (REST)");
      } catch {
        push("database-read", "Database read", false, formatErr(err));
      }
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
