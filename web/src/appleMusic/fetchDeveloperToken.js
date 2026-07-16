export async function fetchAppleMusicDeveloperToken() {
  const res = await fetch("/api/apple-music/developer-token");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Apple Music token request failed (${res.status})`);
  }
  if (!body.developerToken) {
    throw new Error("Apple Music token response missing developerToken");
  }
  return {
    developerToken: body.developerToken,
    expiresAt: Number(body.expiresAt) || Date.now() + 6 * 60 * 60 * 1000,
  };
}
