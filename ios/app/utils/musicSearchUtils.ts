/** Port of web/src/musicSearchUtils.js */

export function normalizeArtistName(name: unknown): string {
  return String(name || "")
    .trim()
    .toLowerCase();
}

export function pickBestArtistMatch<T extends { name?: string }>(
  candidates: T[] | null | undefined,
  targetName: string
): T | null {
  const target = normalizeArtistName(targetName);
  if (!target || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  return (
    candidates.find((a) => normalizeArtistName(a.name) === target) ||
    candidates.find((a) => normalizeArtistName(a.name).includes(target)) ||
    candidates.find((a) => target.includes(normalizeArtistName(a.name))) ||
    candidates[0] ||
    null
  );
}

export function spotifyTrackByArtist(
  track: { artists?: { id?: string }[] },
  artistId: string
): boolean {
  return Boolean(track.artists?.some((a) => a.id === artistId));
}

export function appleTrackByArtist(
  trackArtistName: unknown,
  canonicalArtistName: unknown
): boolean {
  const track = normalizeArtistName(trackArtistName);
  const canon = normalizeArtistName(canonicalArtistName);
  if (!track || !canon) return false;
  if (track === canon) return true;
  return (
    track.startsWith(`${canon} `) ||
    track.startsWith(`${canon},`) ||
    track.startsWith(`${canon} &`) ||
    track.startsWith(`${canon} feat`) ||
    track.startsWith(`${canon} ft`)
  );
}
