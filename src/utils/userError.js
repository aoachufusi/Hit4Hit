import { extractErrorMessage } from "../musickit/musickitErrors.js";

/** Safe message for toasts, UI, and API responses — never expose internals. */
export const GENERIC_USER_ERROR = "Something went wrong — please try again";

export function logClientError(context, error) {
  console.error(context, error);
}

/** User-facing hint when Apple Music Connect / authorize fails. */
export function formatAppleMusicConnectError(err) {
  const code = err?.code || err?.name || "";
  const msg = extractErrorMessage(err);

  if (/not configured|503|credentials|Service unavailable/i.test(msg)) {
    return "Apple Music is not configured on the server — check Vercel env vars";
  }
  if (/429|Too many requests/i.test(msg)) {
    return "Too many Apple Music requests — wait a minute and try again";
  }
  if (/MusicKit JS did not load|window\.MusicKit is missing/i.test(msg)) {
    return "Apple Music failed to load — disable ad blockers and refresh";
  }
  if (/AUTHORIZATION_ERROR|Unauthorized|403/i.test(msg)) {
    return "Apple denied authorization — allow popups, use Safari/Chrome, and confirm you have Apple Music";
  }
  if (/expired|invalid.*token|OAuth/i.test(msg)) {
    return "Apple Music session expired — try Connect again";
  }
  if (/popup|blocked|user activation|user cancel|denied|abort/i.test(msg)) {
    return "Safari blocked the Apple sign-in window — tap Connect again (don't switch tabs first). Or Safari → Settings → Websites → Pop-up Windows → Allow for hit4hit.app";
  }
  if (/network|fetch|failed to load/i.test(msg)) {
    return "Could not reach Apple Music — check your connection or ad blockers";
  }
  if (code === "USER_DENIED" || /USER_DENIED/i.test(msg)) {
    return "Apple sign-in was cancelled";
  }
  if (msg && msg.length <= 120 && !/^\[object Object\]/i.test(msg)) {
    return msg;
  }
  return "Apple Music connect failed — allow popups, confirm Apple Music subscription, try incognito";
}

/** User-facing hint when Spotify login / connect / playback fails. */
export function formatSpotifyConnectError(err) {
  const msg = extractErrorMessage(err);

  if (/not registered for this application/i.test(msg)) {
    return "This Spotify account isn't allowlisted — add it in the Spotify Developer Dashboard (User Management), or set the app to public";
  }
  if (/Spotify app not detected|No Spotify device found/i.test(msg)) {
    return "Open the Spotify app, play any song for a few seconds, return to Hit4Hit and tap Connect player again";
  }
  if (/Premium|account_error|subscription/i.test(msg)) {
    return "Spotify Premium is required for in-browser playback";
  }
  if (/initialization_error|Browser not supported|EME/i.test(msg)) {
    return "This browser can't run Spotify's web player — try Chrome or host on desktop";
  }
  if (/authentication_error|Invalid token scopes/i.test(msg)) {
    return "Spotify login expired or missing permissions — log out and log in again";
  }
  if (/timed out|connection timed out/i.test(msg)) {
    return "Spotify player timed out — disable ad blockers, then tap Connect player again";
  }
  if (/No Spotify device found|open the Spotify app/i.test(msg)) {
    return msg;
  }
  if (/not loaded|still loading/i.test(msg)) {
    return "Spotify player still loading — wait a moment and tap Connect player again";
  }
  if (/not connected|Connect player/i.test(msg)) {
    return msg;
  }
  if (msg && msg.length <= 140 && !/^\[object Object\]/i.test(msg)) {
    return msg;
  }
  return "Spotify connect failed — open the Spotify app and try again";
}
