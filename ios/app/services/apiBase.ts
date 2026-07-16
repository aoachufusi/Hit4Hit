/**
 * Base URL for Hit 4 Hit web API routes (`/api/spotify/search`, `/api/apple-music/search`).
 * Points at the same Vercel deployment the web app uses.
 */
export function getApiBaseUrl(): string {
  const configured = (
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_APP_URL ||
    "https://hit4hit.app"
  )
    .trim()
    .replace(/\/$/, "");
  return configured;
}

/**
 * Build a query string without relying on `URL.searchParams` mutation.
 * React Native's URL polyfill often drops params set via `.searchParams.set()`.
 */
function toQueryString(params?: Record<string, string>): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function apiGetJson<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, string>
): Promise<{ ok: boolean; status: number; body: T }> {
  const base = getApiBaseUrl();
  const pathname = path.startsWith("http") ? path : `${base}${path}`;
  const url = `${pathname}${toQueryString(params)}`;

  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}
