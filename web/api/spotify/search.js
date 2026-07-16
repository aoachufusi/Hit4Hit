import { handleSpotifySearch } from "../../server/spotifySearchHandler.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const result = await handleSpotifySearch(req, req.query);
  if (result.cacheControl) {
    res.setHeader("Cache-Control", result.cacheControl);
  }
  res.status(result.status).json(result.body);
}
