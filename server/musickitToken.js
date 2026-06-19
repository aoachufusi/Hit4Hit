import {
  createAppleMusicDeveloperToken,
  getAppleMusicConfig,
} from "./appleMusicToken.js";

const MUSIC_KIT_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;

export function getMusicKitCredentials() {
  return getAppleMusicConfig();
}

export function createMusicKitToken() {
  return createAppleMusicDeveloperToken({
    expSeconds: MUSIC_KIT_TOKEN_TTL_SECONDS,
  }).developerToken;
}

export function sendMusicKitTokenJson(res, sendJson) {
  if (!getAppleMusicConfig()) {
    sendJson(res, 500, {
      error:
        "Missing credentials. Set APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY in .env",
    });
    return;
  }

  try {
    const { developerToken, expiresAt } = createAppleMusicDeveloperToken({
      expSeconds: MUSIC_KIT_TOKEN_TTL_SECONDS,
    });
    res.setHeader("Cache-Control", "private, max-age=300");
    sendJson(res, 200, {
      token: developerToken,
      developerToken,
      expiresAt,
    });
  } catch (error) {
    console.error("Token generation failed:", error);
    sendJson(res, 500, {
      error: "Failed to generate token. Check APPLE_PRIVATE_KEY PEM format in .env",
    });
  }
}
