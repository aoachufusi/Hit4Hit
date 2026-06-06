import {
  createAppleMusicDeveloperToken,
  getAppleMusicConfig,
} from "../../server/appleMusicToken.js";

export default function handler(req, res) {
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

  try {
    const { developerToken, expiresAt } = createAppleMusicDeveloperToken();
    res.setHeader("Cache-Control", "private, max-age=1800");
    res.status(200).json({ developerToken, expiresAt });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
