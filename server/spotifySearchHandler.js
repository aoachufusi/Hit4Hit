import { getSpotifyAppCredentials, getSpotifyAppAccessToken } from "./spotifyAppToken.js";
import {
  searchArtistsWithToken,
  searchTracksWithToken,
} from "../src/spotifyApi.js";

const rateLimit = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxReqs = 30;
  const record = rateLimit.get(ip) || { count: 0, start: now };

  if (now - record.start > windowMs) {
    record.count = 0;
    record.start = now;
  }

  record.count++;
  rateLimit.set(ip, record);
  return record.count <= maxReqs;
}

export async function handleSpotifySearch(req, query) {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    return { status: 429, body: { error: "Too many requests" } };
  }

  if (!getSpotifyAppCredentials()) {
    return { status: 503, body: { error: "Service unavailable" } };
  }

  const kind = String(query?.kind || "").trim();
  const q = String(query?.q || "").trim();

  if (!kind || !q) {
    return { status: 400, body: { error: "Missing kind or q" } };
  }

  try {
    const token = await getSpotifyAppAccessToken();

    if (kind === "artists") {
      const limit = Math.min(10, Math.max(1, Number(query?.limit) || 10));
      const items = await searchArtistsWithToken(token, q, limit);
      return {
        status: 200,
        body: { items },
        cacheControl: "private, max-age=60",
      };
    }

    if (kind === "tracks") {
      const artistName = String(query?.artistName || "").trim();
      if (!artistName) {
        return { status: 400, body: { error: "Missing artistName" } };
      }
      const limit = Math.min(10, Math.max(1, Number(query?.limit) || 8));
      const items = await searchTracksWithToken(token, q, limit, { artistName });
      return {
        status: 200,
        body: { items },
        cacheControl: "private, max-age=60",
      };
    }

    return { status: 400, body: { error: "Invalid kind" } };
  } catch (e) {
    console.error("Spotify search failed:", e);
    return { status: 500, body: { error: "Something went wrong — please try again" } };
  }
}
