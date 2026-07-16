export function normalizeArtistName(name) {
  return String(name || "").trim().toLowerCase();
}

export function pickBestArtistMatch(candidates, targetName) {
  const target = normalizeArtistName(targetName);
  if (!target || !Array.isArray(candidates) || candidates.length === 0) return null;
  return (
    candidates.find((a) => normalizeArtistName(a.name) === target) ||
    candidates.find((a) => normalizeArtistName(a.name).includes(target)) ||
    candidates.find((a) => target.includes(normalizeArtistName(a.name))) ||
    candidates[0]
  );
}

export function spotifyTrackByArtist(track, artistId) {
  return track.artists?.some((a) => a.id === artistId);
}

export function appleTrackByArtist(trackArtistName, canonicalArtistName) {
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
