import {
  createAppleMusicDeveloperToken,
  getAppleMusicConfig,
} from "../../server/appleMusicToken.js";

const CATALOG = "us";

async function catalogSearch(term, types, limit) {
  const { developerToken } = createAppleMusicDeveloperToken();
  const params = new URLSearchParams({
    term: String(term).trim(),
    types,
    limit: String(limit),
  });
  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${CATALOG}/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${developerToken}` } }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.errors?.[0]?.title || `Apple Music search failed (${res.status})`);
  }
  return body;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!getAppleMusicConfig()) {
    res.status(503).json({
      error: "Apple Music not configured. Set APPLE_MUSIC_* env vars on the server.",
    });
    return;
  }

  const term = String(req.query?.term || "").trim();
  const types = String(req.query?.types || "songs").trim();
  const limit = Math.min(10, Math.max(1, Number(req.query?.limit) || 8));

  if (!term) {
    res.status(400).json({ error: "Missing search term" });
    return;
  }

  try {
    const results = await catalogSearch(term, types, limit);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
