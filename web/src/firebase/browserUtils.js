export function isLikelyChrome() {
  if (typeof navigator === "undefined") return false;
  return /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
}
