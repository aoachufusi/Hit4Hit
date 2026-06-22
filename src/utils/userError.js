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
  if (/popup|blocked|user cancel|denied|abort/i.test(msg)) {
    return "Apple sign-in was blocked or cancelled — allow popups for this site";
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
