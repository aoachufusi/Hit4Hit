import { MUSIC_PROVIDERS, musicProviderLabel } from "../musicConstants.js";

const C = "#A855F7";
const BORDER = "#2e1f4a";
const SURFACE2 = "#160f25";
const MUTED1 = "#aa88d0";

export default function MusicProviderPicker({
  value,
  onChange,
  compact = false,
  appleEnabled = true,
}) {
  const options = [
    [MUSIC_PROVIDERS.SPOTIFY, "Spotify"],
    [MUSIC_PROVIDERS.APPLE, "Apple Music"],
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: compact ? "row" : "column",
        gap: compact ? 4 : 8,
        alignItems: compact ? "center" : "stretch",
      }}
    >
      {!compact && (
        <div
          className="bf"
          style={{
            fontSize: 11,
            color: MUTED1,
            letterSpacing: ".07em",
            textTransform: "uppercase",
          }}
        >
          Your music service
        </div>
      )}
      <div style={{ display: "flex", gap: compact ? 4 : 8, flex: compact ? undefined : 1 }}>
        {options.map(([provider, label]) => {
          const disabled = provider === MUSIC_PROVIDERS.APPLE && !appleEnabled;
          const selected = value === provider;
          return (
            <button
              key={provider}
              type="button"
              disabled={disabled}
              title={
                disabled
                  ? "Apple Music unavailable until MusicKit is configured"
                  : musicProviderLabel(provider)
              }
              onClick={() => onChange(provider)}
              className="bf"
              style={{
                flex: compact ? undefined : 1,
                background: selected ? C : SURFACE2,
                border: `1px solid ${selected ? C : BORDER}`,
                borderRadius: compact ? 6 : 8,
                color: selected ? "#fff" : MUTED1,
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: compact ? 10 : 13,
                fontWeight: 600,
                padding: compact ? "4px 8px" : "10px 12px",
                opacity: disabled ? 0.45 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {compact ? label.replace(" Music", "") : label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
