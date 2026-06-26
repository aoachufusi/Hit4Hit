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
  nudgeSpotifyApp,
  pausePlayback as pauseSpotifyDevice,
  pickExternalSpotifyDevice,
  playTrackUris,
  transferPlaybackToDevice,
} from "./spotifyPlayer.js";
import {
  searchArtistsWithToken,
  searchTracksWithToken,
} from "./spotifyApi.js";
import { logClientError, formatSpotifyConnectError } from "./utils/userError.js";

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
  const deviceTypeRef = useRef(null);
  const connectPromiseRef = useRef(null);

  const setPlaybackDevice = useCallback((id, type) => {
    deviceIdRef.current = id;
    deviceTypeRef.current = type;
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
        deviceTypeRef.current = null;
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
    if (isMobileSpotifyClient()) {
      setPlayerStatus("Looking for Spotify app — open it if prompted…");
      nudgeSpotifyApp();
    }
    const device = await pickExternalSpotifyDevice(token, {
      retries: 6,
      delayMs: 900,
    });
    if (!device?.id) {
      throw new Error(
        "Spotify app not detected — open Spotify, play any song briefly, return here and tap Connect player"
      );
    }
    setPlaybackDevice(device.id, "external");
    setPlayerStatus("");
    return device.id;
  }, [getAccessToken, setPlaybackDevice]);

  const finishWebPlayer = useCallback(
    async ({ player, device_id }) => {
      playerRef.current = player;
      const token = await getAccessToken();
      try {
        await transferPlaybackToDevice(token, device_id);
      } catch (e) {
        console.warn("Spotify transfer to web player failed (non-fatal)", e);
      }
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
    },
    [getAccessToken, setPlaybackDevice]
  );

  const connectWebPlayer = useCallback(async () => {
    if (!window.Spotify?.Player) {
      throw new Error("Spotify player still loading — wait a moment and tap again");
    }

    if (playerRef.current) {
      try {
        playerRef.current.disconnect?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    }

    const { player, device_id } = await createSpotifyPlayerSync(getAccessToken);
    return finishWebPlayer({ player, device_id });
  }, [getAccessToken, finishWebPlayer]);

  /**
   * Start inside a click/tap — web player must be constructed synchronously (Safari).
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

    // Must start in the same turn as the tap — do not await before this.
    let webPlayerPromise = null;
    if (window.Spotify?.Player) {
      if (playerRef.current) {
        try {
          playerRef.current.disconnect?.();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
      }
      webPlayerPromise = createSpotifyPlayerSync(getAccessToken).then(finishWebPlayer);
    }

    const run = async () => {
      if (webPlayerPromise) {
        try {
          return await webPlayerPromise;
        } catch (e) {
          logClientError("Spotify web player failed:", e);
          if (!isMobileSpotifyClient()) {
            const detail = formatSpotifyConnectError(e);
            setPlayerStatus(detail);
            throw e;
          }
        }
      } else if (!isMobileSpotifyClient()) {
        const err = new Error(
          "Spotify player still loading — wait for Loading Spotify… to finish, then tap again"
        );
        setPlayerStatus(err.message);
        throw err;
      }

      if (isMobileSpotifyClient()) {
        try {
          return await connectExternalDevice();
        } catch (e) {
          logClientError("Spotify external device failed:", e);
          const detail =
            formatSpotifyConnectError(e) ||
            "Spotify playback unavailable — open the Spotify app and try again";
          setPlayerStatus(detail);
          throw e;
        }
      }

      const err = new Error("Spotify web player failed — log out and log in again");
      setPlayerStatus(formatSpotifyConnectError(err));
      throw err;
    };

    connectPromiseRef.current = run().finally(() => {
      connectPromiseRef.current = null;
    });

    return connectPromiseRef.current;
  }, [
    session?.access_token,
    getAccessToken,
    finishWebPlayer,
    connectExternalDevice,
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
    deviceTypeRef.current = null;
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

      const player = playerRef.current;
      if (deviceTypeRef.current === "web" && player) {
        if (typeof player.activateElement === "function") {
          try {
            await player.activateElement();
          } catch {
            /* ignore */
          }
        }
      }

      await playTrackUris(token, id, [uri]);

      if (deviceTypeRef.current === "web" && player) {
        try {
          const state = await player.getCurrentState?.();
          if (!state || state.paused) {
            await player.resume?.();
          }
        } catch {
          try {
            await player.resume?.();
          } catch {
            /* ignore */
          }
        }
      }
    },
    [getAccessToken]
  );

  const pausePlayback = useCallback(async () => {
    const id = deviceIdRef.current;
    if (deviceTypeRef.current === "web") {
      try {
        playerRef.current?.pause?.();
      } catch {
        /* ignore */
      }
    }
    if (!id) return;
    const token = await getAccessToken();
    await pauseSpotifyDevice(token, id);
  }, [getAccessToken]);

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
