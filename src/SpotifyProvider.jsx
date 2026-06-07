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
import {
  searchArtistsWithToken,
  searchTracksWithToken,
} from "./spotifyApi.js";
import { logClientError } from "./utils/userError.js";

function parseCallbackUrl() {
  const url = new URL(window.location.href);
  return {
    pathname: url.pathname,
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
  };
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
      logClientError("Spotify OAuth callback error:", error);
      queueMicrotask(() => setPlayerStatus("Spotify login failed — please try again"));
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
        if (!cancelled) {
          logClientError("Spotify token exchange failed:", e);
          setPlayerStatus("Spotify login failed — please try again");
        }
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
        if (!cancelled) {
          logClientError("Spotify player init failed:", e);
          setPlayerStatus("Spotify playback unavailable — try logging in again");
        }
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
      return searchTracksWithToken(token, q, limit, opts);
    },
    [getAccessToken]
  );

  const searchArtists = useCallback(
    async (q, limit = 10) => {
      const token = await getAccessToken();
      return searchArtistsWithToken(token, q, limit);
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
