// ── Fetch developer token from your Vercel serverless function
import {
  appleTrackByArtist,
  normalizeArtistName,
  pickBestArtistMatch,
} from "../musicSearchUtils.js";
import { clearMusicKitStoredAuth, extractErrorMessage } from "./musickitErrors.js";

export async function getDeveloperToken() {
  const res = await fetch("/api/musickit-token");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `MusicKit token request failed (${res.status})`);
  }
  if (!data.token && !data.developerToken) {
    throw new Error("MusicKit token response missing token");
  }
  return data.token || data.developerToken;
}

function waitForMusicKitGlobal() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MusicKit requires a browser"));
  }
  if (window.MusicKit) {
    return Promise.resolve(window.MusicKit);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("MusicKit JS did not load"));
    }, 15_000);
    document.addEventListener(
      "musickitloaded",
      () => {
        clearTimeout(timeout);
        if (window.MusicKit) resolve(window.MusicKit);
        else reject(new Error("MusicKit loaded but window.MusicKit is missing"));
      },
      { once: true }
    );
  });
}

function musicKitAppConfig() {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return {
    name: "Hit 4 Hit",
    build: "1.0.0",
    version: "1.0.0",
    ...(origin ? { icon: `${origin}/favicon.svg` } : {}),
  };
}

// ── Configure MusicKit — call once when the app loads
export async function configureMusicKit(developerToken) {
  const MusicKit = await waitForMusicKitGlobal();
  await MusicKit.configure({
    developerToken,
    suppressErrorDialog: true,
    app: musicKitAppConfig(),
  });
  patchMusicKitAudioForMobile();
  return MusicKit.getInstance();
}

/** Re-configure MusicKit with a fresh developer token (connect / token refresh). */
export async function refreshMusicKitDeveloperToken() {
  const developerToken = await getDeveloperToken();
  return configureMusicKit(developerToken);
}

async function ensureConfiguredMusicKit() {
  const MusicKit = await waitForMusicKitGlobal();
  try {
    return MusicKit.getInstance();
  } catch {
    const developerToken = await getDeveloperToken();
    return configureMusicKit(developerToken);
  }
}

// ── Authorize the host — must run synchronously from a click (Safari blocks delayed popups)
export function authorizeHostFromUserGesture() {
  if (typeof window === "undefined" || !window.MusicKit) {
    return Promise.reject(
      new Error("MusicKit not loaded — wait a moment and try again")
    );
  }

  clearMusicKitStoredAuth();

  let music;
  try {
    music = window.MusicKit.getInstance();
  } catch {
    return Promise.reject(
      new Error("MusicKit not ready — wait for Apple Music to finish loading")
    );
  }

  return music.authorize().then((userToken) => {
    if (!userToken) {
      throw new Error("Apple sign-in returned no user token");
    }
    return userToken;
  }).catch((err) => {
    const detail = extractErrorMessage(err) || "Apple Music authorization failed";
    const wrapped = new Error(detail);
    wrapped.code = err?.code || err?.name;
    throw wrapped;
  });
}

/** Full authorize with token refresh — only for retries, not button clicks. */
export async function authorizeHost() {
  clearMusicKitStoredAuth();
  const music = await refreshMusicKitDeveloperToken();
  try {
    const userToken = await music.authorize();
    if (!userToken) {
      throw new Error("Apple sign-in returned no user token");
    }
    return userToken;
  } catch (err) {
    const detail = extractErrorMessage(err) || "Apple Music authorization failed";
    const wrapped = new Error(detail);
    wrapped.code = err?.code || err?.name;
    throw wrapped;
  }
}

// ── Unauthorize — signs the host out
export async function unauthorizeHost() {
  const MusicKit = await waitForMusicKitGlobal();
  const music = MusicKit.getInstance();
  await music.unauthorize();
  clearMusicKitStoredAuth();
}

// ── Internal helper — Apple artwork URLs use {w}x{h} placeholders
function formatArtworkUrl(artwork, size) {
  return artwork.url
    .replace("{w}", size)
    .replace("{h}", size);
}

async function proxyCatalogSearch(term, types, limit) {
  const params = new URLSearchParams({
    term: String(term).trim(),
    types,
    limit: String(limit),
  });
  const res = await fetch(`/api/apple-music/search?${params.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Apple Music search failed (${res.status})`);
  }
  return body;
}

function musicKitConfigured() {
  try {
    return Boolean(typeof window !== "undefined" && window.MusicKit?.getInstance());
  } catch {
    return false;
  }
}

async function searchArtistsWithMusicKit(query) {
  const music = MusicKit.getInstance();
  const results = await music.api.music(`/v1/catalog/us/search`, {
    term: query,
    types: "artists",
    limit: 8,
  });
  return (
    results.data.results.artists?.data.map((a) => ({
      id: a.id,
      name: a.attributes.name,
      image: a.attributes.artwork
        ? formatArtworkUrl(a.attributes.artwork, 200)
        : null,
      genres: a.attributes.genreNames,
    })) || []
  );
}

async function searchArtistsViaProxy(query) {
  const body = await proxyCatalogSearch(query, "artists", 8);
  return (
    body.results?.artists?.data?.map((a) => ({
      id: a.id,
      name: a.attributes.name,
      image: a.attributes.artwork
        ? formatArtworkUrl(a.attributes.artwork, 200)
        : null,
      genres: a.attributes.genreNames,
    })) || []
  );
}

const appleArtistCache = new Map();

async function loadArtistsForName(artistName) {
  if (musicKitConfigured()) {
    try {
      return await searchArtistsWithMusicKit(artistName);
    } catch (e) {
      console.warn("MusicKit artist lookup failed, using proxy", e);
    }
  }
  return searchArtistsViaProxy(artistName);
}

export async function findArtistByName(artistName) {
  const key = normalizeArtistName(artistName);
  if (!key) return null;
  if (appleArtistCache.has(key)) return appleArtistCache.get(key);

  const artists = await loadArtistsForName(artistName);
  const match = pickBestArtistMatch(artists, artistName);
  if (match) appleArtistCache.set(key, match);
  return match || null;
}

// ── Search artists by name (MusicKit with server proxy fallback)
export async function searchArtists(query) {
  if (musicKitConfigured()) {
    try {
      return await searchArtistsWithMusicKit(query);
    } catch (e) {
      console.warn("MusicKit artist search failed, using proxy", e);
    }
  }
  return searchArtistsViaProxy(query);
}

async function searchTracksViaProxy(query, artistName) {
  const artist = await findArtistByName(artistName);
  if (!artist) return [];

  const term = `${String(query).trim()} ${artist.name}`;
  const body = await proxyCatalogSearch(term, "songs", 25);
  return (
    body.results?.songs?.data
      ?.filter((t) => appleTrackByArtist(t.attributes.artistName, artist.name))
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        name: t.attributes.name,
        uri: t.id,
        preview: t.attributes.previews?.[0]?.url,
        artists: [{ name: t.attributes.artistName || artist.name }],
      })) || []
  );
}

// ── Search songs by name — results limited to the given artist
export async function searchTracks(query, artistName) {
  const artist = await findArtistByName(artistName);
  if (!artist) return [];

  if (musicKitConfigured()) {
    try {
      const music = MusicKit.getInstance();
      const term = String(query).trim();
      const results = await music.api.music(`/v1/catalog/us/search`, {
        term: `${term} ${artist.name}`,
        types: "songs",
        limit: 25,
      });
      return (
        results.data.results.songs?.data
          .filter((t) =>
            appleTrackByArtist(t.attributes.artistName, artist.name)
          )
          .slice(0, 8)
          .map((t) => ({
            id: t.id,
            name: t.attributes.name,
            uri: t.id,
            preview: t.attributes.previews?.[0]?.url,
            artists: [{ name: t.attributes.artistName || artist.name }],
          })) || []
      );
    } catch (e) {
      console.warn("MusicKit track search failed, using proxy", e);
    }
  }

  return searchTracksViaProxy(query, artistName);
}

// ── Get top 10 songs for a given artist ID
export async function getArtistTopSongs(artistId) {
  const music   = MusicKit.getInstance();
  const results = await music.api.music(
    `/v1/catalog/us/artists/${artistId}/view/top-songs`,
    { limit: 10 }
  );
  return results.data.data.map(t => ({
    id:       t.id,
    name:     t.attributes.name,
    album:    t.attributes.albumName,
    preview:  t.attributes.previews?.[0]?.url,
    image:    t.attributes.artwork
                ? formatArtworkUrl(t.attributes.artwork, 300)
                : null,
    duration: t.attributes.durationInMillis,
  }));
}

export {
  playPreviewAudio,
  playPreview,
  stopPreviewAudio,
  stopPreview,
  unlockPreviewAudio,
  preparePreviewAudio,
  playPreviewFromUserGesture,
  playPreparedPreviewFromUserGesture,
  isPreviewPrepared,
  isPreviewActivelyPlaying,
  clearPreparedPreview,
  primePreviewFromUserGesture,
} from "../previewAudio.js";

function musicKitInstance() {
  try {
    return typeof window !== "undefined" && window.MusicKit?.getInstance?.();
  } catch {
    return null;
  }
}

let preparedQueueSongId = null;

export function isMobileLikeDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent))
  );
}

/** iOS needs playsinline on MusicKit's injected audio element. */
export function patchMusicKitAudioForMobile() {
  if (typeof document === "undefined") return;
  const fix = () => {
    document.querySelectorAll("audio").forEach((el) => {
      el.setAttribute("playsinline", "true");
      el.setAttribute("webkit-playsinline", "true");
      try {
        el.playsInline = true;
      } catch {
        /* ignore */
      }
      if (el.volume === 0) el.volume = 1;
    });
  };
  fix();
  if (!patchMusicKitAudioForMobile._watching) {
    patchMusicKitAudioForMobile._watching = true;
    new MutationObserver(fix).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

/** Queue a song while waiting — do not start playback until the host taps play. */
export async function prepareAppleMusicQueue(catalogSongId) {
  const songId = String(catalogSongId || "").trim();
  if (!songId) return false;

  const music = await ensureConfiguredMusicKit();
  if (!music?.isAuthorized) return false;

  try {
    await music.setQueue({ song: songId, startPlaying: false });
  } catch {
    try {
      await music.setQueue({ songs: [songId], startPlaying: false });
    } catch {
      preparedQueueSongId = null;
      return false;
    }
  }

  const item =
    music.queue?.head ??
    music.queue?.items?.[0] ??
    music.queue?.nextPlayableItem;
  if (music.player?.prepareToPlay && item) {
    try {
      await music.player.prepareToPlay(item);
    } catch (e) {
      console.warn("Apple Music prepareToPlay failed", e);
    }
  }

  preparedQueueSongId = songId;
  patchMusicKitAudioForMobile();
  return true;
}

/**
 * Call synchronously from ▶ TAP TO PLAY — iOS blocks play() unless it runs in the tap handler.
 */
export function playAppleMusicFromUserGesture() {
  const music = musicKitInstance();
  if (!music?.isAuthorized) return null;
  if (!preparedQueueSongId) {
    console.warn("Apple Music queue not prepared — tap play after track loads");
    return null;
  }

  if (typeof music.volume === "number" && music.volume < 0.05) {
    music.volume = 1;
  }

  patchMusicKitAudioForMobile();

  try {
    if (music.player?.play) {
      music.player.play();
    } else {
      music.play();
    }
  } catch (e) {
    console.warn("Apple Music gesture play failed", e);
    return null;
  }

  patchMusicKitAudioForMobile();
  return music;
}

export function clearPreparedAppleQueue() {
  preparedQueueSongId = null;
}

function domAudioIsAudible() {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll("audio")].some(
    (el) => !el.paused && el.currentTime > 0.05 && el.volume > 0 && !el.muted
  );
}

async function verifyAppleMusicAudible(music, timeoutMs = 2500) {
  const startDom = domAudioIsAudible();
  const startTime = music?.currentPlaybackTime ?? 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (domAudioIsAudible() && !startDom) return true;
    if (domAudioIsAudible() && startDom) return true;
    const now = music?.currentPlaybackTime ?? 0;
    if (now > startTime + 0.35 && domAudioIsAudible()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }

  return domAudioIsAudible();
}

/** Full Apple Music playback (host must be authorized). */
export async function playAppleMusicTrack(catalogSongId, { gestureMusic = null } = {}) {
  const songId = String(catalogSongId || "").trim();
  if (!songId) {
    throw new Error("Missing Apple Music song id — pick the track from search");
  }

  if (gestureMusic) {
    const playing = await waitUntilPlaying(gestureMusic, 10_000);
    if (!playing) {
      throw new Error(
        "Apple Music did not start — turn off silent mode and raise volume"
      );
    }
    const advanced = await waitForPlaybackAdvance(gestureMusic, 5000);
    if (!advanced) {
      throw new Error(
        "Apple Music playback stalled — turn off silent mode or try preview"
      );
    }
    patchMusicKitAudioForMobile();
    const audible = await verifyAppleMusicAudible(gestureMusic);
    if (!audible) {
      throw new Error("Apple Music playing silently — using preview instead");
    }
    return gestureMusic;
  }

  const startPlayback = async (music) => {
    if (!music?.isAuthorized) {
      throw new Error("Apple Music not authorized — tap Connect again");
    }

    if (typeof music.volume === "number" && music.volume < 0.05) {
      music.volume = 1;
    }

    const attempts = [
      () => music.setQueue({ song: songId, startPlaying: true }),
      () => music.setQueue({ songs: [songId], startPlaying: true }),
      async () => {
        await music.setQueue({ song: songId });
        const item =
          music.queue?.head ??
          music.queue?.items?.[0] ??
          music.queue?.nextPlayableItem;
        if (music.player?.prepareToPlay && item) {
          await music.player.prepareToPlay(item);
        }
        await music.play();
      },
    ];

    let lastErr;
    for (const attempt of attempts) {
      try {
        await attempt();
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;

    if (!music.isPlaying) {
      await music.play();
    }

    const playing = await waitUntilPlaying(music, 8000);
    if (!playing) {
      throw new Error(
        "Apple Music did not start — check subscription, volume, and try Connect again"
      );
    }

    const advanced = await waitForPlaybackAdvance(music, 3000);
    if (!advanced) {
      throw new Error(
        "Apple Music playback stalled — try another track or use preview"
      );
    }

    return music;
  };

  try {
    return await startPlayback(await ensureConfiguredMusicKit());
  } catch (first) {
    const msg = extractErrorMessage(first);
    if (!/token|expired|401|developer/i.test(msg)) {
      throw first;
    }
    const music = await refreshMusicKitDeveloperToken();
    return startPlayback(music);
  }
}

function waitForPlaybackAdvance(music, timeoutMs) {
  return new Promise((resolve) => {
    const start = music.currentPlaybackTime ?? 0;
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const now = music.currentPlaybackTime ?? 0;
      if (now > start + 0.25) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

function waitUntilPlaying(music, timeoutMs) {
  return new Promise((resolve) => {
    if (music?.isPlaying) {
      resolve(true);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const PS = window.MusicKit?.PlaybackStates;
    const onChange = () => {
      if (music.isPlaying || music.playbackState === PS?.playing) {
        cleanup();
        resolve(true);
      }
    };
    const timer = setInterval(() => {
      if (music.isPlaying || music.playbackState === PS?.playing) {
        cleanup();
        resolve(true);
      } else if (Date.now() >= deadline) {
        cleanup();
        resolve(false);
      }
    }, 150);
    const cleanup = () => {
      clearInterval(timer);
      music.removeEventListener("playbackStateDidChange", onChange);
    };
    music.addEventListener("playbackStateDidChange", onChange);
  });
}

export function stopAppleMusicPlayback() {
  const music = musicKitInstance();
  if (!music) return;
  try {
    if (music.isPlaying) {
      music.pause();
    }
  } catch (e) {
    console.warn("Apple Music pause failed", e);
  }
}

/** Hard stop when leaving the listening phase entirely. */
export function resetAppleMusicPlayback() {
  clearPreparedAppleQueue();
  const music = musicKitInstance();
  if (!music) return;
  try {
    if (music.isPlaying) {
      music.stop();
    }
  } catch (e) {
    console.warn("Apple Music reset failed", e);
  }
}

// ── Stop a playing preview (see previewAudio.js)