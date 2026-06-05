import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SpotifyContext } from "./spotifyContext.js";
import {
  buildAuthorizeUrl,
  clearStoredSession,
  exchangeCodeForToken,
  getStoredSession,
  refreshAccessToken,
  setStoredSession,
} from "./spotifyAuth.js";
import {
  createSpotifyPlayer,
  playTrackUris,
  transferPlaybackToDevice,
} from "./spotifyPlayer.js";

function parseCallbackUrl() {
  const url = new URL(window.location.href);
  return {
    pathname: url.pathname,
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
  };
}

/** Spotify GET /v1/search only allows limit in the range 1–10 (per API docs). */
function clampSearchLimit(limit, fallback = 10) {
  const x = Math.floor(Number(limit));
  if (!Number.isFinite(x)) return Math.min(10, Math.max(1, fallback));
  return Math.min(10, Math.max(1, x));
}

export function SpotifyProvider({ children }) {
  const [session, setSession] = useState(() => getStoredSession());
  const [deviceId, setDeviceId] = useState(null);
  const [playerStatus, setPlayerStatus] = useState("");
  const playerRef = useRef(null);

  const getAccessToken = useCallback(async () => {
    const s = getStoredSession();
    if (!s?.access_token) throw new Error("Not logged in to Spotify");

    const now = Date.now();
    const expiresAt = s.obtained_at + s.expires_in * 1000;
    if (now < expiresAt - 60_000) return s.access_token;

    if (!s.refresh_token) throw new Error("No Spotify refresh token");

    const refreshed = await refreshAccessToken(s.refresh_token);
    const next = {
      ...s,
      access_token: refreshed.access_token,
      expires_in: refreshed.expires_in,
      obtained_at: Date.now(),
      refresh_token: refreshed.refresh_token ?? s.refresh_token,
    };
    setStoredSession(next);
    setSession(next);
    return next.access_token;
  }, []);

  useEffect(() => {
    const { pathname, code, error } = parseCallbackUrl();
    if (error) {
      queueMicrotask(() =>
        setPlayerStatus(`Spotify auth error: ${error}`)
      );
      return;
    }
    if (pathname !== "/callback" || !code) return;

    let cancelled = false;
    (async () => {
      try {
        setPlayerStatus("Finishing Spotify login…");
        const token = await exchangeCodeForToken(code);
        if (cancelled) return;
        const next = {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_in: token.expires_in,
          obtained_at: Date.now(),
        };
        setStoredSession(next);
        setSession(next);
        window.history.replaceState({}, "", "/");
        setPlayerStatus("");
      } catch (e) {
        if (!cancelled) setPlayerStatus(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      queueMicrotask(() => setDeviceId(null));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setPlayerStatus("Initializing Spotify player…");
        const { player, device_id } = await createSpotifyPlayer(() =>
          getAccessToken()
        );
        if (cancelled) {
          try {
            player.disconnect();
          } catch {
            /* ignore */
          }
          return;
        }
        playerRef.current = player;
        const token = await getAccessToken();
        await transferPlaybackToDevice(token, device_id);
        setDeviceId(device_id);
        setPlayerStatus("");
      } catch (e) {
        if (!cancelled) setPlayerStatus(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
      try {
        playerRef.current?.disconnect?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      queueMicrotask(() => setDeviceId(null));
    };
  }, [session?.access_token, getAccessToken]);

  const login = useCallback(async () => {
    window.location.href = await buildAuthorizeUrl();
  }, []);

  const logout = useCallback(() => {
    try {
      playerRef.current?.disconnect?.();
    } catch {
      /* ignore */
    }
    playerRef.current = null;
    clearStoredSession();
    setSession(null);
    setDeviceId(null);
    setPlayerStatus("");
  }, []);

  const searchTracks = useCallback(
    async (q, limit = 8, opts = {}) => {
      const token = await getAccessToken();
      const hint = opts.artistName?.trim();
      const queryStr = hint
        ? `${String(q).trim()} artist:${hint.replace(/"/g, "")}`
        : String(q).trim();
      const lim = clampSearchLimit(limit, 8);
      const params = new URLSearchParams({
        q: queryStr,
        type: "track",
        limit: String(lim),
      });
      const res = await fetch(
        `https://api.spotify.com/v1/search?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Search failed: ${res.status} ${text}`);
      }
      const data = await res.json();
      return data.tracks?.items ?? [];
    },
    [getAccessToken]
  );

  const searchArtists = useCallback(
    async (q, limit = 10) => {
      const token = await getAccessToken();
      const lim = clampSearchLimit(limit, 10);
      const params = new URLSearchParams({
        q: String(q).trim(),
        type: "artist",
        limit: String(lim),
        market: "US",
      });
      const res = await fetch(
        `https://api.spotify.com/v1/search?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Artist search failed: ${res.status} ${text}`);
      }
      const data = await res.json();
      return data.artists?.items ?? [];
    },
    [getAccessToken]
  );

  const playUri = useCallback(
    async (uri) => {
      const token = await getAccessToken();
      await playTrackUris(token, deviceId, [uri]);
    },
    [deviceId, getAccessToken]
  );

  const value = useMemo(
    () => ({
      session,
      loggedIn: Boolean(session?.access_token),
      deviceId,
      playerStatus,
      login,
      logout,
      getAccessToken,
      searchTracks,
      searchArtists,
      playUri,
    }),
    [
      session,
      deviceId,
      playerStatus,
      login,
      logout,
      getAccessToken,
      searchTracks,
      searchArtists,
      playUri,
    ]
  );

  return (
    <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
  );
}
