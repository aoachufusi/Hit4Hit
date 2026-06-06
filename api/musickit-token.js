import { getMusicKitCredentials, createMusicKitToken } from "../server/musickitToken.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!getMusicKitCredentials()) {
    return res.status(500).json({ error: "Missing credentials" });
  }

  try {
    const token = createMusicKitToken();
    res.setHeader("Cache-Control", "s-maxage=3600");
    res.status(200).json({ token, developerToken: token });
  } catch (error) {
    console.error("Token generation failed:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
}
