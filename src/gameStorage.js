/**
 * Game state persistence.
 * Priority: VITE_GAME_API (multiplayer server) → window.storage (Cursor host) → localStorage (same browser only).
 */

const KEY_PREFIX = "h4h:";

function apiBase() {
  const base = (import.meta.env.VITE_GAME_API || "").trim().replace(/\/$/, "");
  return base || null;
}

function hasHostStorage() {
  return (
    typeof window !== "undefined" &&
    window.storage &&
    typeof window.storage.get === "function" &&
    typeof window.storage.set === "function"
  );
}

/** @returns {"api"|"host"|"local"} */
export function getStorageBackend() {
  if (apiBase()) return "api";
  if (hasHostStorage()) return "host";
  return "local";
}

async function storageGet(code) {
  const key = `${KEY_PREFIX}${code}`;

  const api = apiBase();
  if (api) {
    const res = await fetch(`${api}/api/games/${encodeURIComponent(code)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Game fetch failed: ${res.status}`);
    const data = await res.json();
    return data?.value ?? null;
  }

  if (hasHostStorage()) {
    const r = await window.storage.get(key, true);
    return r?.value ?? null;
  }

  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function storageSet(state) {
  const key = `${KEY_PREFIX}${state.code}`;
  const serialized = JSON.stringify(state);

  const api = apiBase();
  if (api) {
    const res = await fetch(`${api}/api/games/${encodeURIComponent(state.code)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Game save failed: ${res.status} ${text}`);
    }
    return await res.json();
  }

  if (hasHostStorage()) {
    await window.storage.set(key, serialized, true);
    return state;
  }

  try {
    localStorage.setItem(key, serialized);
    return state;
  } catch (e) {
    if (e?.name === "QuotaExceededError") {
      const err = new Error("Storage full — clear browser data and try again.");
      err.cause = e;
      throw err;
    }
    throw e;
  }
}

export async function dbGet(code) {
  try {
    const raw = await storageGet(code);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.error("dbGet failed", e);
    return null;
  }
}

export async function dbSet(state) {
  try {
    state.updatedAt = Date.now();
    const saved = await storageSet(state);
    return saved ?? state;
  } catch (e) {
    console.error("dbSet failed", e);
    return null;
  }
}

export async function dbUpdate(code, patch) {
  const current = await dbGet(code);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  return dbSet(next);
}
