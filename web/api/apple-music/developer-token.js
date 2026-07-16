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
    res.status(503).json({ error: "Service unavailable" });
    return;
  }

  try {
    const { developerToken, expiresAt } = createAppleMusicDeveloperToken();
    res.setHeader("Cache-Control", "private, max-age=1800");
    res.status(200).json({ developerToken, expiresAt });
  } catch (e) {
    console.error("Apple Music developer token failed:", e);
    res.status(500).json({ error: "Something went wrong — please try again" });
  }
}
