import { useState } from "react";
import { copyDiagnostics } from "./diagnostics.js";

const MUTED2 = "#8B849E";
const MUTED3 = "#5C5668";
const BORDER = "#2A2535";
const SURFACE = "#1A1625";

/**
 * Shows step-by-step Firebase sync diagnostics.
 */
export default function SyncDiagnosticsPanel({
  result,
  loading = false,
  onRunTest,
  compact = false,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!result) return;
    const ok = await copyDiagnostics(result);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        marginTop: compact ? 8 : 12,
        textAlign: "left",
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: compact ? "0.75rem 0.85rem" : "0.85rem 1rem",
      }}
    >
      <div
        className="bf"
        style={{
          fontSize: 11,
          color: MUTED2,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Connection test
      </div>

      {loading && (
        <div className="bf" style={{ fontSize: 12, color: MUTED2, marginBottom: 8 }}>
          Running tests…
        </div>
      )}

      {result?.steps?.map((step) => (
        <div
          key={step.id}
          className="bf"
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            marginBottom: 5,
            color: step.ok ? "#4ade80" : "#f87171",
          }}
        >
          {step.ok ? "✓" : "✗"} {step.label}: {step.detail}
        </div>
      ))}

      {!loading && !result?.steps?.length && (
        <div className="bf" style={{ fontSize: 12, color: MUTED3, marginBottom: 8 }}>
          Tap below to see which step fails (auth, database, or game read).
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {onRunTest && (
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: "6px 12px", fontSize: 11 }}
            onClick={onRunTest}
            disabled={loading}
          >
            {loading ? "Testing…" : "Run connection test"}
          </button>
        )}
        {result?.steps?.length > 0 && (
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: "6px 12px", fontSize: 11 }}
            onClick={handleCopy}
          >
            {copied ? "Copied!" : "Copy results"}
          </button>
        )}
      </div>

      <div className="bf" style={{ fontSize: 10, color: MUTED3, marginTop: 8, lineHeight: 1.45 }}>
        Also check Safari/Chrome DevTools → Console, filter for{" "}
        <code style={{ fontSize: 10 }}>Hit4Hit sync</code>
      </div>
    </div>
  );
}
