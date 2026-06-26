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
  createSpotifyPlayerSync,
  loadSpotifySdk,
  pausePlayback as pauseSpotifyDevice,
  pickExternalSpotifyDevice,
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
  const [deviceType, setDeviceType] = useState(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [playerStatus, setPlayerStatus] = useState("");
  const playerRef = useRef(null);
  const connectPromiseRef = useRef(null);

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
        setPlayerStatus("Tap Connect player below to enable playback");
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
      queueMicrotask(() => {
        setDeviceId(null);
        setDeviceType(null);
        setSdkLoaded(false);
      });
      return;
    }

    let cancelled = false;
    setPlayerStatus((prev) =>
      prev && !/login failed/i.test(prev)
        ? prev
        : "Tap Connect player to enable playback"
    );

    loadSpotifySdk()
      .then(() => {
        if (!cancelled) setSdkLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) {
          logClientError("Spotify SDK load failed:", e);
          setPlayerStatus("Spotify player failed to load — refresh the page");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const connectExternalDevice = useCallback(async () => {
    const token = await getAccessToken();
    const device = await pickExternalSpotifyDevice(token);
    if (!device?.id) {
      throw new Error(
        "No Spotify device found — open the Spotify app on this phone"
      );
    }
    setDeviceId(device.id);
    setDeviceType("external");
    setPlayerStatus("");
    return device.id;
  }, [getAccessToken]);

  /**
   * Start synchronously inside a click/tap — required on Safari.
   * Falls back to the user's Spotify app if the in-browser player fails.
   */
  const connectPlayerFromUserGesture = useCallback(() => {
    if (!session?.access_token) {
      return Promise.reject(new Error("Not logged in to Spotify"));
    }
    if (deviceId) return Promise.resolve(deviceId);
    if (connectPromiseRef.current) return connectPromiseRef.current;

    if (!window.Spotify?.Player) {
      return Promise.reject(
        new Error("Spotify player still loading — wait a moment and tap again")
      );
    }

    setPlayerStatus("Connecting Spotify player…");

    connectPromiseRef.current = createSpotifyPlayerSync(getAccessToken)
      .then(async ({ player, device_id }) => {
        playerRef.current = player;
        const token = await getAccessToken();
        await transferPlaybackToDevice(token, device_id);
        if (typeof player.activateElement === "function") {
          try {
            await player.activateElement();
          } catch {
            /* ignore */
          }
        }
        setDeviceId(device_id);
        setDeviceType("web");
        setPlayerStatus("");
        return device_id;
      })
      .catch(async (err) => {
        logClientError("Spotify web player failed, trying Spotify app:", err);
        try {
          return await connectExternalDevice();
        } catch (externalErr) {
          const detail =
            externalErr?.message ||
            err?.message ||
            "Spotify playback unavailable";
          setPlayerStatus(detail);
          throw externalErr;
        }
      })
      .finally(() => {
        connectPromiseRef.current = null;
      });

    return connectPromiseRef.current;
  }, [session?.access_token, deviceId, getAccessToken, connectExternalDevice]);

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
    connectPromiseRef.current = null;
    clearStoredSession();
    setSession(null);
    setDeviceId(null);
    setDeviceType(null);
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
      if (!deviceId) {
        throw new Error("Spotify player not connected — tap Connect player");
      }
      await playTrackUris(token, deviceId, [uri]);
    },
    [deviceId, getAccessToken]
  );

  const pausePlayback = useCallback(async () => {
    if (deviceType === "web") {
      try {
        playerRef.current?.pause?.();
      } catch {
        /* ignore */
      }
    }
    if (!deviceId) return;
    const token = await getAccessToken();
    await pauseSpotifyDevice(token, deviceId);
  }, [deviceId, deviceType, getAccessToken]);

  const playbackReady = Boolean(deviceId);

  const value = useMemo(
    () => ({
      session,
      loggedIn: Boolean(session?.access_token),
      deviceId,
      deviceType,
      playbackReady,
      sdkLoaded,
      playerStatus,
      login,
      logout,
      connectPlayerFromUserGesture,
      getAccessToken,
      searchTracks,
      searchArtists,
      playUri,
      pausePlayback,
    }),
    [
      session,
      deviceId,
      deviceType,
      playbackReady,
      sdkLoaded,
      playerStatus,
      login,
      logout,
      connectPlayerFromUserGesture,
      getAccessToken,
      searchTracks,
      searchArtists,
      playUri,
      pausePlayback,
    ]
  );

  return (
    <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
  );
}
