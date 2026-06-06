import { useEffect, useRef, useState } from "react";
import { searchArtists as searchAppleArtists } from "./musickitService.js";

const BORDER = "#2e1f4a";
const SURFACE2 = "#160f25";
const MUTED2 = "#7a5fa8";
const MUTED3 = "#4a3370";

export default function ArtistSearch({
  placeholder = "Search artists…",
  disabled = false,
  searchReady = false,
  usesAppleMusic = false,
  musicKitReady = false,
  musicLabel = "Spotify",
  onSelect,
  onToast,
  searchSpotifyArtists,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const searchEpochRef = useRef(0);

  const canSearch = usesAppleMusic ? musicKitReady : searchReady;
  const trimmed = query.trim();

  useEffect(() => {
    if (!canSearch || trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const tid = setTimeout(async () => {
      const epoch = ++searchEpochRef.current;
      setLoading(true);
      try {
        let items = [];
        if (usesAppleMusic) {
          items = await searchAppleArtists(trimmed);
        } else if (searchSpotifyArtists) {
          items = await searchSpotifyArtists(trimmed);
        }
        if (searchEpochRef.current !== epoch) return;
        setResults(Array.isArray(items) ? items.filter((a) => a?.name) : []);
      } catch (e) {
        if (searchEpochRef.current === epoch) {
          setResults([]);
          onToast?.(String(e?.message || e));
        }
      } finally {
        if (searchEpochRef.current === epoch) setLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(tid);
      searchEpochRef.current += 1;
    };
  }, [trimmed, canSearch, usesAppleMusic, searchSpotifyArtists, onToast]);

  const showDropdown =
    open &&
    (loading ||
      results.length > 0 ||
      (canSearch && trimmed.length >= 2) ||
      (!canSearch && trimmed.length > 0));

  return (
    <div style={{ marginTop: 6, position: "relative" }}>
      <input
        className="inp"
        style={{ fontSize: 12, padding: "6px 10px", opacity: disabled ? 0.45 : 1 }}
        placeholder={canSearch ? `${musicLabel} search…` : placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
      />

      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: SURFACE2,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            overflow: "hidden",
            zIndex: 10,
            maxHeight: 180,
            overflowY: "auto",
          }}
        >
          {!canSearch && (
            <div className="bf" style={{ padding: "8px 12px", color: MUTED3, fontSize: 11 }}>
              {usesAppleMusic
                ? "Waiting for Apple Music to connect…"
                : `Waiting for host to log in to ${musicLabel}…`}
            </div>
          )}

          {canSearch && trimmed.length < 2 && (
            <div className="bf" style={{ padding: "8px 12px", color: MUTED3, fontSize: 11 }}>
              Type at least 2 characters to search
            </div>
          )}

          {canSearch && trimmed.length >= 2 && loading && (
            <div className="bf" style={{ padding: "8px 12px", color: MUTED2, fontSize: 11 }}>
              Searching {musicLabel}…
            </div>
          )}

          {canSearch && trimmed.length >= 2 && !loading && results.length === 0 && (
            <div className="bf" style={{ padding: "8px 12px", color: MUTED3, fontSize: 11 }}>
              No artists found
            </div>
          )}

          {canSearch &&
            !loading &&
            results.map((artist) => (
              <button
                key={artist.id || artist.name}
                type="button"
                className="sug"
                onMouseDown={() => {
                  setQuery(artist.name);
                  onSelect?.(artist.name);
                  setOpen(false);
                }}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                {artist.image ? (
                  <img
                    src={artist.image}
                    alt=""
                    width={28}
                    height={28}
                    style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                  />
                ) : null}
                <span>{artist.name}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
