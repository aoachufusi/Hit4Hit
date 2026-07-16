/** Pull a readable message from MusicKit / fetch errors (often nested objects). */
export function extractErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;

  const parts = [];
  const seen = new Set();
  const push = (val) => {
    if (val == null || val === "") return;
    const s = String(val).trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    parts.push(s);
  };

  push(err.message);
  push(err.description);
  push(err.errorMessage);
  push(err.reason);
  push(err.name);
  push(err.code);

  if (err.error && typeof err.error === "object") {
    push(err.error.message);
    push(err.error.description);
    push(err.error.name);
  }

  if (parts.length) return parts.join(" — ");

  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}") return json;
  } catch {
    /* ignore */
  }

  return String(err);
}

/** Remove cached MusicKit user tokens so authorize() opens a fresh sign-in. */
export function clearMusicKitStoredAuth() {
  if (typeof window === "undefined") return;
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith("music.")) keys.push(key);
      }
      keys.forEach((k) => storage.removeItem(k));
    } catch {
      /* private mode */
    }
  }
}
