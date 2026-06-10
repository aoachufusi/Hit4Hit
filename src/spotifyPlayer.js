export function loadSpotifySdk() {
  if (window.Spotify) return Promise.resolve();
  if (window.__spotify_sdk_loading) return window.__spotify_sdk_loading;

  window.__spotify_sdk_loading = new Promise((resolve, reject) => {
    const existing = document.getElementById("spotify-player-sdk");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Spotify SDK load error"))
      );
      return;
    }

    const script = document.createElement("script");
    script.id = "spotify-player-sdk";
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Spotify SDK"));
    document.body.appendChild(script);
  });

  return window.__spotify_sdk_loading;
}

export async function createSpotifyPlayer(getAccessToken) {
  await loadSpotifySdk();

  return new Promise((resolve, reject) => {
    const player = new window.Spotify.Player({
      name: "Hit 4 Hit",
      getOAuthToken: (cb) => {
        Promise.resolve(getAccessToken())
          .then((token) => cb(token))
          .catch(reject);
      },
      volume: 0.85,
    });

    player.addListener("initialization_error", ({ message }) =>
      reject(new Error(message))
    );
    player.addListener("authentication_error", ({ message }) =>
      reject(new Error(message))
    );
    player.addListener("account_error", ({ message }) =>
      reject(new Error(message))
    );
    player.addListener("playback_error", ({ message }) =>
      reject(new Error(message))
    );

    player.addListener("ready", ({ device_id }) =>
      resolve({ player, device_id })
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
  await spotifyApi("/me/player", accessToken, {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  });
}

export async function playTrackUris(accessToken, deviceId, uris) {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  await spotifyApi(`/me/player/play${qs}`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ uris }),
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
