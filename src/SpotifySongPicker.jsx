import { useState } from "react";

const BORDER = "#2e1f4a";
const SURFACE2 = "#160f25";
const MUTED1 = "#aa88d0";
const MUTED2 = "#7a5fa8";
const MUTED3 = "#4a3370";

export default function SpotifySongPicker({
  setMySong,
  accent,
  disabled,
  onToast,
  /** When set, track search is biased to this artist (your battle artist). */
  roundArtist,
  searchEnabled = false,
  searchTracks,
  canPlay = false,
  playUri,
  playerStatus = "",
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function runSearch(e) {
    e.preventDefault();
    if (!q.trim() || disabled || !searchEnabled || !searchTracks) return;
    setBusy(true);
    setResults([]);
    try {
      const items = await searchTracks(q.trim(), 8, {
        artistName: roundArtist,
      });
      setResults(items);
    } catch (err) {
      onToast?.(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function pickTrack(track) {
    const label = `${track.name} — ${track.artists.map((a) => a.name).join(", ")}`;
    setMySong(label);
    if (!canPlay || !playUri) return;
    try {
      await playUri(track.uri);
    } catch (err) {
      onToast?.(String(err?.message || err));
    }
  }

  if (!searchEnabled) {
    return (
      <div
        className="bf"
        style={{
          marginTop: 10,
          fontSize: 11,
          color: MUTED3,
          lineHeight: 1.45,
        }}
      >
        Waiting for the host to log in to Spotify so everyone can search tracks.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div
        className="bf"
        style={{ fontSize: 10, color: MUTED2, marginBottom: 6, letterSpacing: "0.06em" }}
      >
        SPOTIFY
      </div>
      {canPlay && playerStatus ? (
        <div className="bf" style={{ fontSize: 11, color: "#facc15", marginBottom: 8 }}>
          {playerStatus}
        </div>
      ) : null}

      <form
        onSubmit={runSearch}
        style={{ display: "flex", gap: 6, marginBottom: 8 }}
      >
        <input
          className="inp"
          style={{ fontSize: 12, padding: "8px 10px", opacity: disabled ? 0.45 : 1 }}
          placeholder={
            roundArtist
              ? `Search tracks — ${roundArtist}…`
              : "Search Spotify tracks…"
          }
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          className="btn-ghost"
          disabled={disabled || busy || !q.trim()}
          style={{
            flexShrink: 0,
            borderColor: accent + "66",
            color: MUTED1,
          }}
        >
          {busy ? "…" : "Go"}
        </button>
      </form>

      {results.length > 0 && (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            overflow: "hidden",
            maxHeight: 200,
            overflowY: "auto",
            background: SURFACE2,
          }}
        >
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              className="sug"
              disabled={disabled}
              onClick={() => pickTrack(t)}
              style={{ textAlign: "left", borderBottom: `1px solid ${BORDER}` }}
            >
              <span className="bf" style={{ color: "#e9d5ff", fontWeight: 600 }}>
                {t.name}
              </span>
              <span className="bf" style={{ color: MUTED2, fontSize: 11 }}>
                {" "}
                — {t.artists.map((a) => a.name).join(", ")}
              </span>
            </button>
          ))}
        </div>
      )}

      {canPlay && (
        <div className="bf" style={{ fontSize: 10, color: MUTED3, marginTop: 6 }}>
          Tap a result to fill your pick and start playback on the host device.
        </div>
      )}
    </div>
  );
}
