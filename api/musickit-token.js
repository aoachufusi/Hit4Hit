import { getMusicKitCredentials, createMusicKitToken } from "../server/musickitToken.js";

const rateLimit = new Map();

export default function handler(req, res) {
  // Basic IP-based rate limiting
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxReqs = 10; // max 10 requests per minute per IP

  const record = rateLimit.get(ip) || { count: 0, start: now };

  // Reset window if expired
  if (now - record.start > windowMs) {
    record.count = 0;
    record.start = now;
  }

  record.count++;
  rateLimit.set(ip, record);

  if (record.count > maxReqs) {
    return res.status(429).json({ error: "Too many requests" });
  }

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
