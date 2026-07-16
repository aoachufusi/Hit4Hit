const CLIENT_ID =
  process.env.SPOTIFY_CLIENT_ID || process.env.VITE_SPOTIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";

/** @type {{ token: string, expiresAt: number } | null} */
let cached = null;

export function getSpotifyAppCredentials() {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
}

export async function getSpotifyAppAccessToken() {
  const creds = getSpotifyAppCredentials();
  if (!creds) {
    throw new Error("Spotify app credentials not configured");
  }

  const now = Date.now();
  if (cached && now < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify app token failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  cached = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cached.token;
}
