const CLIENT_ID = (import.meta.env.VITE_SPOTIFY_CLIENT_ID || "").trim();
const REDIRECT_URI = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI || "").trim();

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

const PKCE_VERIFIER_KEY = "spotify_pkce_verifier";
const PKCE_REDIRECT_KEY = "spotify_pkce_redirect";

/** Redirect URI must match the tab you're on (host + port). */
export function getRedirectUri() {
  if (typeof window !== "undefined") {
    const runtime = `${window.location.origin}/callback`;
    // Dev: always match the running Vite URL (5173 vs 5174, etc.)
    if (import.meta.env.DEV) return runtime;
    return REDIRECT_URI || runtime;
  }
  return REDIRECT_URI;
}

function randomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

function base64UrlEncode(bytes) {
  let str = "";
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

export async function buildAuthorizeUrl() {
  if (!CLIENT_ID) {
    throw new Error("Set VITE_SPOTIFY_CLIENT_ID in .env");
  }

  const redirectUri = getRedirectUri();
  if (!redirectUri) {
    throw new Error("Could not determine Spotify redirect URI");
  }

  const codeVerifier = randomString(64);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(PKCE_REDIRECT_KEY, redirectUri);

  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = randomString(16);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    throw new Error("Missing PKCE verifier — try logging in again");
  }

  const redirectUri =
    sessionStorage.getItem(PKCE_REDIRECT_KEY) || getRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_REDIRECT_KEY);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${text}`);
  }

  return res.json();
}

const SESSION_KEY = "spotify_session";

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
}
