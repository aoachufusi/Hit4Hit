import crypto from "node:crypto";

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Normalize PEM pasted into .env (quoted strings, \\n, missing newlines). */
export function normalizeApplePrivateKey(raw) {
  if (!raw) return "";

  let key = String(raw).trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  key = key.replace(/\\n/g, "\n");

  // Common typo: -----BEGIN PRIVATE KEY-----\MIGT... (missing "n" in \n)
  key = key.replace(
    /-----BEGIN PRIVATE KEY-----\\(?!n)([A-Za-z0-9+/=])/,
    "-----BEGIN PRIVATE KEY-----\n$1"
  );
  key = key.replace(
    /-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=])/,
    "-----BEGIN PRIVATE KEY-----\n$1"
  );
  key = key.replace(
    /([A-Za-z0-9+/=])\\n-----END PRIVATE KEY-----/,
    "$1\n-----END PRIVATE KEY-----"
  );
  key = key.replace(
    /([A-Za-z0-9+/=])-----END PRIVATE KEY-----/,
    "$1\n-----END PRIVATE KEY-----"
  );

  return key.trim();
}

/** @returns {{ teamId: string, keyId: string, privateKey: string, origin?: string } | null} */
export function getAppleMusicConfig() {
  const teamId = (
    process.env.APPLE_TEAM_ID ||
    process.env.APPLE_MUSIC_TEAM_ID ||
    ""
  ).trim();
  const keyId = (
    process.env.APPLE_KEY_ID ||
    process.env.APPLE_MUSIC_KEY_ID ||
    ""
  ).trim();
  const privateKey = normalizeApplePrivateKey(
    process.env.APPLE_PRIVATE_KEY ||
      process.env.APPLE_MUSIC_PRIVATE_KEY ||
      ""
  );
  const originRaw = process.env.APPLE_MUSIC_ORIGIN?.trim();

  if (!teamId || !keyId || !privateKey) return null;

  return { teamId, keyId, privateKey, origin: originRaw || undefined };
}

/** Apple expects origin as a string array; supports comma-separated env values. */
export function parseAppleMusicOrigins(originRaw) {
  if (!originRaw) return undefined;
  const origins = originRaw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (origins.length === 0) return undefined;

  const expanded = new Set(origins);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.hostname.startsWith("www.")) {
        expanded.add(`${url.protocol}//${url.hostname.slice(4)}`);
      } else {
        expanded.add(`${url.protocol}//www.${url.hostname}`);
      }
    } catch {
      /* keep literal values only */
    }
  }
  return [...expanded];
}

/** @returns {{ developerToken: string, expiresAt: number }} */
export function createAppleMusicDeveloperToken(options = {}) {
  const config = getAppleMusicConfig();
  if (!config) {
    throw new Error("Apple Music credentials not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const expSeconds = options.expSeconds ?? 6 * 60 * 60;

  const header = { alg: "ES256", kid: config.keyId };
  const payload = {
    iss: config.teamId,
    iat: now,
    exp: now + expSeconds,
  };
  const origins = parseAppleMusicOrigins(config.origin);
  if (origins?.length) payload.origin = origins;

  const unsigned = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return {
    developerToken: `${unsigned}.${signature.toString("base64url")}`,
    expiresAt: (now + expSeconds) * 1000,
  };
}
