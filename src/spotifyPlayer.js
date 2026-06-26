export function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve();
  if (window.__spotify_sdk_loading) return window.__spotify_sdk_loading;

  window.__spotify_sdk_loading = new Promise((resolve, reject) => {
    const done = () => {
      if (window.Spotify?.Player) resolve();
      else reject(new Error("Spotify SDK loaded but Player is missing"));
    };

    const timeout = setTimeout(() => {
      if (window.Spotify?.Player) finish();
      else reject(new Error("Spotify SDK load timed out"));
    }, 25_000);

    const finish = () => {
      clearTimeout(timeout);
      done();
    };

    const prevReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prevReady?.();
      finish();
    };

    if (window.Spotify?.Player) {
      finish();
      return;
    }

    const existing = document.querySelector(
      'script[src*="spotify-player.js"], #spotify-player-sdk'
    );
    if (existing) {
      if (window.Spotify?.Player) {
        finish();
        return;
      }
      existing.addEventListener("load", () => {
        if (window.Spotify?.Player) finish();
      });
      existing.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Spotify SDK load error"));
      });
      return;
    }

    const script = document.createElement("script");
    script.id = "spotify-player-sdk";
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onload = () => {
      if (window.Spotify?.Player) {
        finish();
        return;
      }
      let polls = 0;
      const poll = setInterval(() => {
        polls += 1;
        if (window.Spotify?.Player) {
          clearInterval(poll);
          finish();
        } else if (polls >= 50) {
          clearInterval(poll);
        }
      }, 100);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Failed to load Spotify SDK"));
    };
    document.body.appendChild(script);
  });

  return window.__spotify_sdk_loading;
}

export function normalizeSpotifyUri(uriOrId) {
  const s = String(uriOrId || "").trim();
  if (!s) return s;
  if (s.startsWith("spotify:")) return s;
  return `spotify:track:${s}`;
}

export async function createSpotifyPlayer(getAccessToken) {
  await loadSpotifySdk();
  return createSpotifyPlayerSync(getAccessToken);
}

/** Must run synchronously from a click/tap — Safari blocks player creation after await. */
export function createSpotifyPlayerSync(getAccessToken) {
  if (!window.Spotify?.Player) {
    return Promise.reject(new Error("Spotify SDK not loaded yet"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Spotify player connection timed out"));
    }, 20_000);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };

    const player = new window.Spotify.Player({
      name: "Hit 4 Hit",
      getOAuthToken: (cb) => {
        Promise.resolve(getAccessToken())
          .then((token) => cb(token))
          .catch((err) => finish(reject, err));
      },
      volume: 0.85,
    });

    player.addListener("initialization_error", ({ message }) =>
      finish(reject, new Error(message))
    );
    player.addListener("authentication_error", ({ message }) =>
      finish(reject, new Error(message))
    );
    player.addListener("account_error", ({ message }) =>
      finish(reject, new Error(message))
    );
    player.addListener("playback_error", ({ message }) => {
      console.warn("Spotify playback_error", message);
    });

    player.addListener("ready", ({ device_id }) =>
      finish(resolve, { player, device_id })
    );

    player.connect();
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

/** Nudge the Spotify app on mobile — does not leave the page. */
export function nudgeSpotifyApp() {
  if (typeof window === "undefined" || !isMobileSpotifyClient()) return;
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

/** True phone/tablet — not Mac/Windows desktop Chrome (iPad desktop UA excluded). */
export function isMobileSpotifyClient() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  return false;
}

/** iPad on iOS 13+ may report Macintosh — only treat as mobile when clearly touch-first. */
export function isSpotifyAppFallbackClient() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  if (
    /Macintosh/i.test(ua) &&
    navigator.maxTouchPoints > 1 &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: none)")?.matches
  ) {
    return true;
  }
  return false;
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
