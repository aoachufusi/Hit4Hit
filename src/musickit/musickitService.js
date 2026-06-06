// ── Fetch developer token from your Vercel serverless function
import {
  appleTrackByArtist,
  normalizeArtistName,
  pickBestArtistMatch,
} from "../musicSearchUtils.js";

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

// ── Configure MusicKit — call once when the app loads
export async function configureMusicKit(developerToken) {
  const MusicKit = await waitForMusicKitGlobal();
  await MusicKit.configure({
    developerToken,
    app: {
      name: "Hit 4 Hit",
      build: "1.0.0",
      version: "1.0.0",
    },
  });
  return MusicKit.getInstance();
}

// ── Authorize the host — prompts Apple Music login popup
export async function authorizeHost() {
  const music     = MusicKit.getInstance();
  const userToken = await music.authorize();
  return userToken;
}

// ── Unauthorize — signs the host out
export async function unauthorizeHost() {
  const music = MusicKit.getInstance();
  await music.unauthorize();
}

// ── Search artists by name
export async function searchArtists(query) {
  const music   = MusicKit.getInstance();
  const results = await music.api.music(
    `/v1/catalog/us/search`,
    { term: query, types: "artists", limit: 8 }
  );
  return results.data.results.artists?.data.map(a => ({
    id:     a.id,
    name:   a.attributes.name,
    image:  a.attributes.artwork
              ? formatArtworkUrl(a.attributes.artwork, 200)
              : null,
    genres: a.attributes.genreNames,
  })) || [];
}

const appleArtistCache = new Map();

export async function findArtistByName(artistName) {
  const key = normalizeArtistName(artistName);
  if (!key) return null;
  if (appleArtistCache.has(key)) return appleArtistCache.get(key);

  const artists = await searchArtists(artistName);
  const match = pickBestArtistMatch(artists, artistName);
  if (match) appleArtistCache.set(key, match);
  return match || null;
}

// ── Search songs by name — results limited to the given artist
export async function searchTracks(query, artistName) {
  const artist = await findArtistByName(artistName);
  if (!artist) return [];

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

// ── Play a 30-second preview using a plain Audio element
// Returns the Audio object so you can pause/stop it later
export async function playPreview(previewUrl) {
  const audio = new Audio(previewUrl);
  await audio.play();
  return audio;
}

// ── Stop a playing preview
export function stopPreview(audio) {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

// ── Internal helper — Apple artwork URLs use {w}x{h} placeholders
function formatArtworkUrl(artwork, size) {
  return artwork.url
    .replace("{w}", size)
    .replace("{h}", size);
}