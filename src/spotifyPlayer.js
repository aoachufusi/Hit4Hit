import { getStoredSession } from "./spotifyAuth.js";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
let sdkReadyHookInstalled = false;

function installSdkReadyHook() {
  if (sdkReadyHookInstalled || typeof window === "undefined") return;
  sdkReadyHookInstalled = true;
  const prev = window.onSpotifyWebPlaybackSDKReady;
  window.onSpotifyWebPlaybackSDKReady = () => {
    prev?.();
    window.__spotify_sdk_ready = true;
  };
  if (window.Spotify?.Player) {
    window.__spotify_sdk_ready = true;
  }
}

installSdkReadyHook();

export function resetSpotifySdkLoad() {
  if (typeof window === "undefined") return;
  window.__spotify_sdk_loading = null;
}

function waitForSpotifyPlayer(timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    if (window.Spotify?.Player) {
      resolve();
      return;
    }

    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (window.Spotify?.Player) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error("Spotify SDK load timed out"));
      }
    };
    const timer = setInterval(tick, 100);
    tick();
  });
}

export function loadSpotifySdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Spotify SDK requires a browser"));
  }
  if (window.Spotify?.Player) return Promise.resolve();
  if (window.__spotify_sdk_loading) return window.__spotify_sdk_loading;

  installSdkReadyHook();

  window.__spotify_sdk_loading = waitForSpotifyPlayer()
    .catch((err) => {
      resetSpotifySdkLoad();
      throw err;
    })
    .then(() => {
      if (!window.Spotify?.Player) {
        resetSpotifySdkLoad();
        throw new Error("Spotify SDK loaded but Player is missing");
      }
    });

  if (window.Spotify?.Player) {
    return Promise.resolve();
  }

  const existing = document.querySelector(`script[src="${SDK_SRC}"]`);
  if (!existing) {
    const script = document.createElement("script");
    script.id = "spotify-player-sdk";
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () => {
      resetSpotifySdkLoad();
    };
    document.head.appendChild(script);
  }

  return window.__spotify_sdk_loading;
}

export function normalizeSpotifyUri(uriOrId) {
  const s = String(uriOrId || "").trim();
  if (!s) return s;
  if (s.startsWith("spotify:")) return s;
  return `spotify:track:${s}`;
}

function cachedAccessToken() {
  const s = getStoredSession();
  if (!s?.access_token) return null;
  const expiresAt = (s.obtained_at ?? 0) + (s.expires_in ?? 0) * 1000;
  if (Date.now() >= expiresAt - 60_000) return null;
  return s.access_token;
}

/** Fail fast with a clear message before the SDK hangs on a bad token. */
export async function verifySpotifyAccessToken(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok) return true;
  const text = await res.text();
  throw new Error(`Spotify API ${res.status}: ${text}`);
}

function uniquePlayerName() {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `Hit4Hit ${id}`;
}

export async function createSpotifyPlayer(getAccessToken) {
  await loadSpotifySdk();
  const token = await getAccessToken();
  await verifySpotifyAccessToken(token);
  return createSpotifyPlayerSync(getAccessToken, token);
}

/**
 * @param {() => Promise<string>} getAccessToken
 * @param {string | null} [prefetchedToken]
 */
export function createSpotifyPlayerSync(getAccessToken, prefetchedToken = null) {
  if (!window.Spotify?.Player) {
    return Promise.reject(new Error("Spotify SDK not loaded yet"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let player = null;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        player?.disconnect?.();
      } catch {
        /* ignore */
      }
      reject(new Error("Spotify player connection timed out"));
    }, 45_000);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    const deliverToken = (cb) => {
      const cached = prefetchedToken || cachedAccessToken();
      if (cached) {
        cb(cached);
        return;
      }
      Promise.resolve(getAccessToken())
        .then((token) => cb(token))
        .catch((err) => finish(reject, err));
    };

    player = new window.Spotify.Player({
      name: uniquePlayerName(),
      getOAuthToken: deliverToken,
      volume: 0.85,
    });

    player.addListener("initialization_error", ({ message }) =>
      finish(reject, new Error(message || "Spotify initialization failed"))
    );
    player.addListener("authentication_error", ({ message }) =>
      finish(reject, new Error(message || "Spotify authentication failed"))
    );
    player.addListener("account_error", ({ message }) =>
      finish(reject, new Error(message || "Spotify account error — Premium required"))
    );
    player.addListener("playback_error", ({ message }) => {
      console.warn("Spotify playback_error", message);
    });

    player.addListener("ready", ({ device_id }) =>
      finish(resolve, { player, device_id })
    );

    player.addListener("not_ready", ({ device_id }) => {
      console.warn("Spotify player not_ready", device_id);
    });

    const connectResult = player.connect();
    if (connectResult?.then) {
      connectResult
        .then((ok) => {
          if (ok === false) {
            finish(
              reject,
              new Error("Spotify denied browser player — log out and log in again")
            );
          }
        })
        .catch((err) => finish(reject, err));
    }
  });
}

export async function spotifyApi(path, accessToken, options = {}) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export async function transferPlaybackToDevice(accessToken, deviceId) {
  try {
    await spotifyApi("/me/player", accessToken, {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Spotify API 404|NO_ACTIVE_DEVICE|Not found/i.test(msg)) return;
    throw e;
  }
}

export async function listSpotifyDevices(accessToken) {
  const data = await spotifyApi("/me/player/devices", accessToken);
  return data?.devices ?? [];
}

export async function pickExternalSpotifyDevice(accessToken, options = {}) {
  const retries = options.retries ?? 6;
  const delayMs = options.delayMs ?? 900;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    let devices = [];
    try {
      devices = await listSpotifyDevices(accessToken);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/Spotify API 401|403/.test(msg)) throw e;
      return null;
    }

    if (devices.length) {
      return (
        devices.find((d) => d.is_active) ||
        devices.find((d) => d.type === "Smartphone") ||
        devices.find((d) => d.type === "Computer") ||
        devices[0]
      );
    }

    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return null;
}

export function nudgeSpotifyApp() {
  if (typeof window === "undefined" || !isSpotifyAppFallbackClient()) return;
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = "spotify:";
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 500);
  } catch {
    /* ignore */
  }
}

export function isSpotifyAppFallbackClient() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPod|iPad/i.test(navigator.userAgent);
}

export function isDesktopSpotifyClient() {
  return !isSpotifyAppFallbackClient();
}

export async function playTrackUris(accessToken, deviceId, uris) {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  const normalized = uris.map(normalizeSpotifyUri).filter(Boolean);
  await spotifyApi(`/me/player/play${qs}`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ uris: normalized }),
  });
}

export async function pausePlayback(accessToken, deviceId) {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  const res = await fetch(`https://api.spotify.com/v1/me/player/pause${qs}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404 || res.status === 204 || res.ok) return;
  const text = await res.text();
  throw new Error(`Spotify pause failed: ${res.status} ${text}`);
}
