// src/utils/sanitize.js

// Clean player and judge names
export function sanitizeName(input) {
  return String(input ?? "")
    .trim()
    .replace(/<[^>]*>/g, "")       // remove HTML tags
    .replace(/[<>'"&]/g, "")       // remove special characters
    .slice(0, 30);                  // max 30 characters
}

// Clean song names
export function sanitizeSong(input) {
  return String(input ?? "")
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[<>'"&]/g, "")
    .slice(0, 100);                 // max 100 characters
}

// Validate game code is exactly 6 uppercase alphanumeric chars
export function isValidCode(code) {
  return /^[A-Z2-9]{6}$/.test(code);
}

// Check name isn't empty after sanitizing
export function isValidName(input) {
  return sanitizeName(input).length > 0;
}
