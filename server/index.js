/**
 * Hit 4 Hit game API — shared game state for multiple devices.
 *
 * GET  /api/games/:code  → { value: "<json string>" } or 404
 * PUT  /api/games/:code  → body: game state JSON object
 * POST /api/games        → body: game state JSON object (create)
 */

import http from "node:http";
import { URL } from "node:url";
import {
  createAppleMusicDeveloperToken,
  getAppleMusicConfig,
} from "./appleMusicToken.js";
import { sendMusicKitTokenJson } from "./musickitToken.js";

const PORT = Number(process.env.PORT) || 3000;
const KEY_PREFIX = "h4h:";

/** @type {Map<string, string>} code → JSON string */
const games = new Map();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const gamesMatch = url.pathname.match(/^\/api\/games\/([A-Z0-9]{6})$/i);
  const isCreate = url.pathname === "/api/games" && req.method === "POST";

  try {
    if (req.method === "GET" && gamesMatch) {
      const code = gamesMatch[1].toUpperCase();
      const value = games.get(`${KEY_PREFIX}${code}`);
      if (!value) {
        sendJson(res, 404, { error: "Game not found" });
        return;
      }
      sendJson(res, 200, { value });
      return;
    }

    if (req.method === "PUT" && gamesMatch) {
      const code = gamesMatch[1].toUpperCase();
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        sendJson(res, 400, { error: "Expected JSON game state" });
        return;
      }
      body.code = code;
      body.updatedAt = Date.now();
      const serialized = JSON.stringify(body);
      games.set(`${KEY_PREFIX}${code}`, serialized);
      sendJson(res, 200, body);
      return;
    }

    if (isCreate) {
      const body = await readBody(req);
      if (!body?.code) {
        sendJson(res, 400, { error: "Game state must include code" });
        return;
      }
      const code = String(body.code).toUpperCase();
      body.code = code;
      body.updatedAt = Date.now();
      const serialized = JSON.stringify(body);
      games.set(`${KEY_PREFIX}${code}`, serialized);
      sendJson(res, 201, body);
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, games: games.size });
      return;
    }

    if (url.pathname === "/api/musickit-token" && req.method === "GET") {
      sendMusicKitTokenJson(res, sendJson);
      return;
    }

    if (url.pathname === "/api/apple-music/developer-token" && req.method === "GET") {
      if (!getAppleMusicConfig()) {
        sendJson(res, 503, { error: "Service unavailable" });
        return;
      }
      try {
        const { developerToken, expiresAt } = createAppleMusicDeveloperToken();
        res.setHeader("Cache-Control", "private, max-age=1800");
        sendJson(res, 200, { developerToken, expiresAt });
      } catch (e) {
        console.error("Apple Music developer token failed:", e);
        sendJson(res, 500, { error: "Something went wrong — please try again" });
      }
      return;
    }

    if (url.pathname === "/api/apple-music/search" && req.method === "GET") {
      if (!getAppleMusicConfig()) {
        sendJson(res, 503, { error: "Service unavailable" });
        return;
      }
      const term = String(url.searchParams.get("term") || "").trim();
      const types = String(url.searchParams.get("types") || "songs").trim();
      const limit = Math.min(
        10,
        Math.max(1, Number(url.searchParams.get("limit")) || 8)
      );
      if (!term) {
        sendJson(res, 400, { error: "Missing search term" });
        return;
      }
      try {
        const { developerToken } = createAppleMusicDeveloperToken();
        const params = new URLSearchParams({ term, types, limit: String(limit) });
        const apiRes = await fetch(
          `https://api.music.apple.com/v1/catalog/us/search?${params.toString()}`,
          { headers: { Authorization: `Bearer ${developerToken}` } }
        );
        const body = await apiRes.json().catch(() => ({}));
        if (!apiRes.ok) {
          console.error("Apple Music search failed:", body);
          sendJson(res, apiRes.status, { error: "Something went wrong — please try again" });
          return;
        }
        res.setHeader("Cache-Control", "private, max-age=60");
        sendJson(res, 200, body);
      } catch (e) {
        console.error("Apple Music search failed:", e);
        sendJson(res, 500, { error: "Something went wrong — please try again" });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("API request failed:", e);
    sendJson(res, 500, { error: "Something went wrong — please try again" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Hit 4 Hit API listening on http://0.0.0.0:${PORT}`);
  console.log(`  Health: http://127.0.0.1:${PORT}/api/health`);
  console.log(`  MusicKit: http://127.0.0.1:${PORT}/api/musickit-token`);
});
