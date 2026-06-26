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
  isMobileSpotifyClient,
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
  const deviceIdRef = useRef(null);
  const connectPromiseRef = useRef(null);

  const setPlaybackDevice = useCallback((id, type) => {
    deviceIdRef.current = id;
    setDeviceId(id);
    setDeviceType(type);
  }, []);

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
        deviceIdRef.current = null;
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
        "No Spotify device found — open the Spotify app on this phone, then tap Connect player"
      );
    }
    setPlaybackDevice(device.id, "external");
    setPlayerStatus("");
    return device.id;
  }, [getAccessToken, setPlaybackDevice]);

  const connectWebPlayer = useCallback(async () => {
    if (!window.Spotify?.Player) {
      throw new Error("Spotify player still loading — wait a moment and tap again");
    }

    const { player, device_id } = await createSpotifyPlayerSync(getAccessToken);
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
    setPlaybackDevice(device_id, "web");
    setPlayerStatus("");
    return device_id;
  }, [getAccessToken, setPlaybackDevice]);

  /**
   * Start inside a click/tap — required on Safari.
   * Mobile: try Spotify app first; desktop: in-browser player first.
   */
  const connectPlayerFromUserGesture = useCallback(() => {
    if (!session?.access_token) {
      return Promise.reject(new Error("Not logged in to Spotify"));
    }
    if (deviceIdRef.current) {
      return Promise.resolve(deviceIdRef.current);
    }
    if (connectPromiseRef.current) return connectPromiseRef.current;

    setPlayerStatus("Connecting Spotify player…");

    const run = async () => {
      const mobile = isMobileSpotifyClient();
      const attempts = mobile
        ? [connectExternalDevice, connectWebPlayer]
        : [connectWebPlayer, connectExternalDevice];

      let lastErr;
      for (const attempt of attempts) {
        try {
          return await attempt();
        } catch (e) {
          lastErr = e;
          logClientError("Spotify connect attempt failed:", e);
        }
      }

      const detail =
        lastErr?.message ||
        "Spotify playback unavailable — open the Spotify app and try again";
      setPlayerStatus(detail);
      throw lastErr || new Error(detail);
    };

    connectPromiseRef.current = run().finally(() => {
      connectPromiseRef.current = null;
    });

    return connectPromiseRef.current;
  }, [
    session?.access_token,
    connectExternalDevice,
    connectWebPlayer,
  ]);

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
    deviceIdRef.current = null;
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
    async (uri, targetDeviceId) => {
      const token = await getAccessToken();
      const id = targetDeviceId || deviceIdRef.current;
      if (!id) {
        throw new Error("Spotify player not connected — tap Connect player");
      }
      await playTrackUris(token, id, [uri]);
    },
    [getAccessToken]
  );

  const pausePlayback = useCallback(async () => {
    const id = deviceIdRef.current;
    if (deviceType === "web") {
      try {
        playerRef.current?.pause?.();
      } catch {
        /* ignore */
      }
    }
    if (!id) return;
    const token = await getAccessToken();
    await pauseSpotifyDevice(token, id);
  }, [deviceType, getAccessToken]);

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
