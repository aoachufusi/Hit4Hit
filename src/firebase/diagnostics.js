import { ref, get } from "firebase/database";
import { ensureAuthWithRetry } from "./auth.js";
import { db, isFirebaseConfigured } from "./config.js";
import { withTimeout } from "./promiseUtils.js";
import {
  waitForDatabaseOnline,
  nudgeDatabaseOnline,
  probeDatabaseRest,
  probeDatabaseHost,
} from "./dbConnection.js";
import { databaseBaseUrl, restGet } from "./restFallback.js";
import { isLikelyChrome } from "./browserUtils.js";

function formatErr(err) {
  const code = err?.code || "";
  const msg = String(err?.message || err || "Unknown error");
  return code && !msg.includes(code) ? `${code}: ${msg}` : msg;
}

function maskDbHost() {
  try {
    const host = new URL(databaseBaseUrl()).host;
    return host.replace(/^(.{4}).*(.{8})$/, "$1…$2");
  } catch {
    return "unknown";
  }
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
  push("config", "Firebase config", true, `DB host ${maskDbHost()}`);

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

  const hostReachable = await probeDatabaseHost(8000);
  push(
    "db-host",
    "Database host (HTTPS)",
    hostReachable,
    hostReachable
      ? "Reachable"
      : "Cannot reach Firebase — check network, VPN, or DATABASE_URL"
  );

  nudgeDatabaseOnline();

  let dbMode = null;
  try {
    const conn = await waitForDatabaseOnline(12_000, { allowRestFallback: true });
    dbMode = conn.mode;
    const modeLabel =
      conn.mode === "socket"
        ? "Connected (live socket)"
        : conn.mode === "sdk-read"
          ? "Connected (SDK read)"
          : "Connected (HTTPS fallback)";
    push("database", "Realtime Database", true, modeLabel);
  } catch (err) {
    const restOk = await probeDatabaseRest(10_000);
    if (restOk) {
      dbMode = "rest";
      const hint = isLikelyChrome()
        ? "Live socket blocked — game uses HTTPS polling. Disable extensions or try Safari."
        : "Live socket blocked — game uses HTTPS polling.";
      push("database", "Realtime Database", true, hint);
    } else if (hostReachable) {
      push(
        "database",
        "Realtime Database",
        false,
        "Host reachable but reads failed — check Firebase rules and Anonymous auth"
      );
      return { ok: false, steps, at: Date.now() };
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
        12_000,
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
  } else if (dbMode === "rest") {
    try {
      await restGet("games", 8_000);
      push("database-read", "Database read", true, "Server reachable (REST)");
    } catch (err) {
      push("database-read", "Database read", false, formatErr(err));
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
        await restGet("games", 8_000);
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
