import { useEffect, useRef, useState } from "react";
import { searchTracks as searchAppleTracks } from "./musickitService.js";
import {
  SEARCH_INPUT_IOS_STYLE,
  SEARCH_RESULT_BUTTON_STYLE,
  useSearchDropdown,
} from "./searchDropdownUtils.js";
import { logClientError, GENERIC_USER_ERROR } from "../utils/userError.js";

const BORDER = "#2e1f4a";
const SURFACE2 = "#160f25";
const MUTED2 = "#7a5fa8";
const MUTED3 = "#4a3370";

function formatTrackLabel(track) {
  const artists = track.artists?.map((a) => a.name).join(", ") || "Unknown artist";
  return `${track.name} — ${artists}`;
}

export default function SongSearch({
  value = "",
  onChange,
  onSelectTrack,
  placeholder = "Search songs…",
  disabled = false,
  searchReady = false,
  usesAppleMusic = false,
  musicKitReady = false,
  musicLabel = "Spotify",
  roundArtist,
  onToast,
  searchSpotifyTracks,
  onEnter,
  usedSongKeys,
  songKeyForTrack,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const searchEpochRef = useRef(0);
  const { handleInputBlur, pickFromDropdown } = useSearchDropdown();

  const canSearch = searchReady && Boolean(roundArtist?.trim());
  const trimmed = value.trim();

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
          items = await searchAppleTracks(trimmed, roundArtist);
        } else if (searchSpotifyTracks) {
          items = await searchSpotifyTracks(trimmed, roundArtist);
        }
        if (searchEpochRef.current !== epoch) return;
        setResults(Array.isArray(items) ? items.filter((t) => t?.name) : []);
      } catch (e) {
        if (searchEpochRef.current === epoch) {
          setResults([]);
          logClientError("Song search failed:", e);
          onToast?.(GENERIC_USER_ERROR);
        }
      } finally {
        if (searchEpochRef.current === epoch) setLoading(false);
      }
    }, 400);

    return () => {
      clearTimeout(tid);
      searchEpochRef.current += 1;
    };
  }, [trimmed, canSearch, usesAppleMusic, roundArtist, searchSpotifyTracks, onToast]);

  const showDropdown =
    open &&
    (loading ||
      results.length > 0 ||
      (canSearch && trimmed.length >= 2) ||
      (!canSearch && trimmed.length > 0));

  function isTrackUsed(track) {
    if (!usedSongKeys?.size || !songKeyForTrack) return false;
    const key = songKeyForTrack(track);
    return key ? usedSongKeys.has(key) : false;
  }

  function pickTrack(track) {
    if (isTrackUsed(track)) {
      onToast?.("You already played that song in an earlier round — pick something else");
      return;
    }
    const label = formatTrackLabel(track);
    onChange?.(label);
    onSelectTrack?.(track);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", zIndex: open ? 20 : undefined }}>
      <input
        className="inp"
        style={{
          ...SEARCH_INPUT_IOS_STYLE,
          padding: "8px 10px",
          opacity: disabled ? 0.45 : 1,
        }}
        placeholder={
          canSearch
            ? roundArtist
              ? `${musicLabel} — search ${roundArtist} songs…`
              : `${musicLabel} search…`
            : placeholder
        }
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => handleInputBlur(setOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && trimmed) onEnter?.();
        }}
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
            maxHeight: 200,
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
              No songs by {roundArtist} found
            </div>
          )}

          {canSearch &&
            !loading &&
            results.map((track) => {
              const used = isTrackUsed(track);
              return (
              <button
                key={track.id || `${track.name}-${track.artists?.[0]?.name}`}
                type="button"
                className="sug"
                disabled={used}
                onPointerDown={(e) => {
                  if (used) {
                    e.preventDefault();
                    onToast?.("You already played that song in an earlier round — pick something else");
                    return;
                  }
                  pickFromDropdown(e, () => pickTrack(track));
                }}
                style={{
                  ...SEARCH_RESULT_BUTTON_STYLE,
                  textAlign: "left",
                  width: "100%",
                  opacity: used ? 0.45 : 1,
                  cursor: used ? "not-allowed" : "pointer",
                }}
              >
                <span className="bf" style={{ color: used ? MUTED3 : "#e9d5ff", fontWeight: 600 }}>
                  {track.name}
                </span>
                <span className="bf" style={{ color: MUTED2, fontSize: 11 }}>
                  {" "}
                  — {track.artists?.map((a) => a.name).join(", ") || "Unknown artist"}
                  {used ? " · already played" : ""}
                </span>
              </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
