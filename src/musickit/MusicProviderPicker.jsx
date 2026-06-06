import { MUSIC_PROVIDERS, musicProviderLabel } from "../musicConstants.js";

const C = "#A855F7";
const BORDER = "#2e1f4a";
const SURFACE = "#130d22";
const SURFACE2 = "#160f25";
const MUTED1 = "#aa88d0";
const MUTED2 = "#7a5fa8";

function ServiceButtons({ value, onChange, appleEnabled, fullLabels = true }) {
  const options = [
    [MUSIC_PROVIDERS.SPOTIFY, "Spotify"],
    [MUSIC_PROVIDERS.APPLE, "Apple Music"],
  ];

  return (
    <div style={{ display: "flex", gap: 8, flex: 1 }}>
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
              flex: 1,
              background: selected ? C : SURFACE2,
              border: `1px solid ${selected ? C : BORDER}`,
              borderRadius: 8,
              color: selected ? "#fff" : MUTED1,
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: fullLabels ? 13 : 11,
              fontWeight: 600,
              padding: fullLabels ? "10px 12px" : "6px 10px",
              opacity: disabled ? 0.45 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function MusicProviderPicker({
  value,
  onChange,
  appleEnabled = true,
  sectioned = false,
  hint,
}) {
  if (sectioned) {
    return (
      <div
        style={{
          background: SURFACE,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            maxWidth: 500,
            margin: "0 auto",
            padding: "0.85rem 1rem",
          }}
        >
          <div
            className="hd"
            style={{
              fontSize: 13,
              letterSpacing: ".07em",
              color: MUTED2,
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Select Service
          </div>
          <ServiceButtons
            value={value}
            onChange={onChange}
            appleEnabled={appleEnabled}
          />
          {hint ? (
            <div
              className="bf"
              style={{
                color: MUTED2,
                fontSize: 11,
                marginTop: 8,
                lineHeight: 1.45,
              }}
            >
              {hint}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        className="hd"
        style={{
          fontSize: 13,
          letterSpacing: ".07em",
          color: MUTED2,
          textTransform: "uppercase",
        }}
      >
        Select Service
      </div>
      <ServiceButtons
        value={value}
        onChange={onChange}
        appleEnabled={appleEnabled}
      />
      {hint ? (
        <div
          className="bf"
          style={{ color: MUTED2, fontSize: 11, lineHeight: 1.45 }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}
