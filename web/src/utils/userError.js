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
export function formatSpotifyConnectError(err, { desktop = false } = {}) {
  const msg = extractErrorMessage(err);

  if (/not registered for this application/i.test(msg)) {
    return "This Spotify account isn't allowlisted — add it in the Spotify Developer Dashboard (User Management), or set the app to public";
  }
  if (/Spotify app not detected|No Spotify device found/i.test(msg)) {
    if (desktop) {
      return "In-browser Spotify player failed — disable ad blockers, confirm Premium, then log out and log in again";
    }
    return "Couldn't find the Spotify app — open it, play a song briefly, then tap Connect player";
  }
  if (/Premium|account_error|subscription|current plan: free/i.test(msg)) {
    return "Spotify Premium is required for in-browser playback";
  }
  if (/missing streaming permission|missing streaming|login needs an update/i.test(msg)) {
    return "Spotify login missing streaming — log out, log in again, and approve all permissions";
  }
  if (
    /protected content|Playback of protected content|Widevine|EMEError|keysystem|no supported keysystem/i.test(
      msg
    )
  ) {
    return "Chrome blocked Spotify DRM — open chrome://settings/content/protectedContent → Sites can play protected content → Allow, then refresh hit4hit.app";
  }
  if (/Spotify DRM unavailable|Spotify playback requires HTTPS/i.test(msg)) {
    return msg;
  }
  if (/authentication_error|Invalid token scopes|denied browser player/i.test(msg)) {
    return "Spotify login expired or missing permissions — log out and log in again";
  }
  if (/timed out|connection timed out|SDK load timed out/i.test(msg)) {
    if (/Protected content|DRM/i.test(msg)) {
      return "Allow Protected content (DRM) for hit4hit.app in Chrome site settings, then refresh";
    }
    return desktop
      ? "Spotify player timed out — allow Protected content (DRM) in Chrome site settings, disable ad blockers, log out/in"
      : "Spotify player timed out — disable ad blockers, then tap Connect player again";
  }
  if (/not loaded|still loading/i.test(msg)) {
    return "Spotify player still loading — refresh the page, then tap Connect player";
  }
  if (/not connected|Connect player/i.test(msg)) {
    return msg;
  }
  if (msg && msg.length <= 160 && !/^\[object Object\]/i.test(msg)) {
    return msg;
  }
  return desktop
    ? "Spotify connect failed — log out, log in again, then tap Connect player"
    : "Spotify connect failed — try Connect player again";
}
