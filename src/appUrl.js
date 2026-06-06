export function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** Public site origin for invite links and Spotify redirect (production). */
export function getAppOrigin() {
  const configured = (import.meta.env.VITE_APP_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getInviteUrl(code) {
  const url = new URL(getAppOrigin() || "http://localhost");
  url.searchParams.set("join", code);
  return url.toString();
}
