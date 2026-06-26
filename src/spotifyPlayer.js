import {
  assertSpotifyStreamingScope,
  getStoredSession,
} from "./spotifyAuth.js";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
let sdkReadyPromise = null;

if (typeof window !== "undefined") {
  const markReady = () => {
    if (window.Spotify?.Player) {
      window.__spotify_sdk_ready = true;
    }
  };
  const prev = window.onSpotifyWebPlaybackSDKReady;
  window.onSpotifyWebPlaybackSDKReady = () => {
    prev?.();
    markReady();
  };
  markReady();
}

export function resetSpotifySdkLoad() {
  if (typeof window === "undefined") return;
  sdkReadyPromise = null;
  window.__spotify_sdk_loading = null;
}

/** Spotify requires Player construction after the SDK ready callback. */
export function whenSpotifySdkReady() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Spotify SDK requires a browser"));
  }
  if (window.__spotify_sdk_ready && window.Spotify?.Player) {
    return Promise.resolve();
  }
  if (sdkReadyPromise) return sdkReadyPromise;

  sdkReadyPromise = new Promise((resolve, reject) => {
    const finishOk = () => {
      if (window.Spotify?.Player) {
        window.__spotify_sdk_ready = true;
        resolve();
      } else {
        sdkReadyPromise = null;
        reject(new Error("Spotify SDK loaded but Player is missing"));
      }
    };

    const timeout = setTimeout(() => {
      sdkReadyPromise = null;
      reject(new Error("Spotify SDK load timed out"));
    }, 30_000);

    const done = () => {
      clearTimeout(timeout);
      finishOk();
    };

    const prev = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prev?.();
      done();
    };

    if (window.Spotify?.Player) {
      done();
      return;
    }

    if (!document.querySelector(`script[src="${SDK_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SDK_SRC;
      document.head.appendChild(script);
    }

    const poll = setInterval(() => {
      if (window.Spotify?.Player) {
        clearInterval(poll);
        done();
      }
    }, 100);

    setTimeout(() => clearInterval(poll), 29_000);
  }).catch((err) => {
    sdkReadyPromise = null;
    throw err;
  });

  return sdkReadyPromise;
}

export function loadSpotifySdk() {
  return whenSpotifySdkReady();
}

export function normalizeSpotifyUri(uriOrId) {
  const s = String(uriOrId || "").trim();
  if (!s) return s;
  if (s.startsWith("spotify:")) return s;
  return `spotify:track:${s}`;
}

function disconnectGlobalPlayer() {
  try {
    window.__hit4hit_spotify_player?.disconnect?.();
  } catch {
    /* ignore */
  }
  window.__hit4hit_spotify_player = null;
}

function uniquePlayerName() {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `Hit4Hit ${id}`;
}

/** Fail fast with a clear message before the SDK hangs on a bad token. */
export async function verifySpotifyAccessToken(accessToken) {
  assertSpotifyStreamingScope();

  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }

  let profile;
  try {
    profile = JSON.parse(text);
  } catch {
    return true;
  }

  const product = String(profile?.product || "").toLowerCase();
  if (product && !/premium|open|duo|family|student/.test(product)) {
    throw new Error(
      "Spotify Premium is required for in-browser playback (current plan: free)"
    );
  }

  return true;
}

function buildPlayerWithToken(accessToken) {
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
      reject(
        new Error(
          "Spotify player connection timed out — in Chrome: lock icon → Site settings → allow Protected content (DRM)"
        )
      );
    }, 45_000);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    disconnectGlobalPlayer();

    player = new window.Spotify.Player({
      name: uniquePlayerName(),
      getOAuthToken: (cb) => {
        cb(accessToken);
      },
      volume: 0.85,
    });

    window.__hit4hit_spotify_player = player;

    player.addListener("initialization_error", ({ message }) =>
      finish(reject, new Error(message || "Spotify initialization failed"))
    );
    player.addListener("authentication_error", ({ message }) =>
      finish(reject, new Error(message || "Spotify authentication failed"))
    );
    player.addListener("account_error", ({ message }) =>
      finish(
        reject,
        new Error(message || "Spotify account error — Premium required")
      )
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

export async function createSpotifyPlayer(getAccessToken) {
  await whenSpotifySdkReady();
  const token = await getAccessToken();
  await verifySpotifyAccessToken(token);
  return buildPlayerWithToken(token);
}

/** @deprecated Use createSpotifyPlayer — kept for mobile gesture paths. */
export function createSpotifyPlayerSync(getAccessToken, prefetchedToken = null) {
  const token = prefetchedToken || getStoredSession()?.access_token;
  if (!token) {
    return Promise.reject(new Error("Not logged in to Spotify"));
  }
  if (!window.Spotify?.Player) {
    return Promise.reject(new Error("Spotify SDK not loaded yet"));
  }
  return buildPlayerWithToken(token);
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
