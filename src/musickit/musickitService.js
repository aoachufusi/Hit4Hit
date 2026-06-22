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
    storefrontId: "us",
    app: musicKitAppConfig(),
  });
  return MusicKit.getInstance();
}

/** Fetch a fresh developer JWT and re-configure MusicKit (v3: developerToken is read-only on the instance). */
export async function refreshMusicKitDeveloperToken() {
  const developerToken = await getDeveloperToken();
  return configureMusicKit(developerToken);
}

// ── Authorize the host — prompts Apple Music login popup
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
} from "../previewAudio.js";

function musicKitInstance() {
  try {
    return typeof window !== "undefined" && window.MusicKit?.getInstance?.();
  } catch {
    return null;
  }
}

/** Full Apple Music playback (host must be authorized). */
export async function playAppleMusicTrack(catalogSongId) {
  const music = await refreshMusicKitDeveloperToken();
  if (!music?.isAuthorized) {
    throw new Error("Apple Music not authorized");
  }
  await music.setQueue({ song: catalogSongId });
  await music.play();
  return music;
}

export function stopAppleMusicPlayback() {
  const music = musicKitInstance();
  if (music?.isPlaying) {
    music.stop();
  }
}

// ── Stop a playing preview (see previewAudio.js)