import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppleMusicContext } from "./appleMusicContext.js";
import {
  normalizeAppleArtists,
  normalizeAppleTracks,
} from "./musicConstants.js";

function clampSearchLimit(limit, fallback = 10) {
  const x = Math.floor(Number(limit));
  if (!Number.isFinite(x)) return Math.min(10, Math.max(1, fallback));
  return Math.min(10, Math.max(1, x));
}

async function proxySearch(term, types, limit) {
  const params = new URLSearchParams({
    term: String(term).trim(),
    types,
    limit: String(limit),
  });
  const res = await fetch(`/api/apple-music/search?${params.toString()}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Apple Music search failed (${res.status})`);
  }
  return body;
}

export function AppleMusicProvider({ children }) {
  const [searchReady, setSearchReady] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStatus("Checking Apple Music…");
        const res = await fetch("/api/apple-music/developer-token");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error || `Apple Music unavailable (${res.status})`);
        }
        if (!cancelled) {
          setSearchReady(true);
          setStatus("");
        }
      } catch (e) {
        if (!cancelled) {
          setSearchReady(false);
          setStatus(String(e?.message || e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const searchArtists = useCallback(async (q, limit = 10) => {
    const lim = clampSearchLimit(limit, 10);
    const results = await proxySearch(q, "artists", lim);
    return normalizeAppleArtists(results);
  }, []);

  const searchTracks = useCallback(
    async (q, limit = 8, opts = {}) => {
      const lim = clampSearchLimit(limit, 8);
      const term = opts.artistName?.trim()
        ? `${String(q).trim()} ${opts.artistName.trim()}`
        : String(q).trim();
      const results = await proxySearch(term, "songs", lim);
      return normalizeAppleTracks(results);
    },
    []
  );

  const value = useMemo(
    () => ({
      searchReady,
      status,
      searchArtists,
      searchTracks,
    }),
    [searchReady, status, searchArtists, searchTracks]
  );

  return (
    <AppleMusicContext.Provider value={value}>{children}</AppleMusicContext.Provider>
  );
}
