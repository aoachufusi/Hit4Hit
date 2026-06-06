import { useEffect, useRef, useState } from "react";
import { isArtistBlocked } from "../gameStateUtils.js";
import { searchArtists as searchAppleArtists } from "./musickitService.js";
import {
  SEARCH_INPUT_IOS_STYLE,
  SEARCH_RESULT_BUTTON_STYLE,
  useSearchDropdown,
} from "./searchDropdownUtils.js";

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
  blockedArtists = [],
  onSelect,
  onToast,
  searchSpotifyArtists,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const searchEpochRef = useRef(0);
  const { handleInputBlur, pickFromDropdown } = useSearchDropdown();

  const canSearch = searchReady;
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

  function selectArtist(artist) {
    if (isArtistBlocked(artist.name, blockedArtists)) {
      onToast?.("That artist is already taken — pick someone else");
      return;
    }
    setQuery(artist.name);
    onSelect?.(artist.name);
    setOpen(false);
  }

  return (
    <div style={{ marginTop: 6, position: "relative", zIndex: open ? 20 : undefined }}>
      <input
        className="inp"
        style={{
          ...SEARCH_INPUT_IOS_STYLE,
          padding: "6px 10px",
          opacity: disabled ? 0.45 : 1,
        }}
        placeholder={canSearch ? `${musicLabel} search…` : placeholder}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => handleInputBlur(setOpen)}
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
            zIndex: 1000,
            maxHeight: 180,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            marginTop: 4,
          }}
        >
          {!canSearch && (
            <div className="bf" style={{ padding: "8px 12px", color: MUTED3, fontSize: 11 }}>
              {usesAppleMusic
                ? musicKitReady
                  ? "Waiting for Apple Music to connect…"
                  : "Waiting for Apple Music search…"
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
            results.map((artist) => {
              const taken = isArtistBlocked(artist.name, blockedArtists);
              return (
              <button
                key={artist.id || artist.name}
                type="button"
                className="sug"
                disabled={taken}
                onPointerDown={(e) => {
                  if (taken) {
                    e.preventDefault();
                    onToast?.("That artist is already taken — pick someone else");
                    return;
                  }
                  pickFromDropdown(e, () => selectArtist(artist));
                }}
                style={{
                  ...SEARCH_RESULT_BUTTON_STYLE,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  opacity: taken ? 0.45 : 1,
                  cursor: taken ? "not-allowed" : "pointer",
                }}
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
                <span style={{ flex: 1 }}>{artist.name}</span>
                {taken && (
                  <span className="bf" style={{ color: MUTED3, fontSize: 10 }}>taken</span>
                )}
              </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
