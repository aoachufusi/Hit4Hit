import { useContext } from "react";
import { SpotifyContext } from "./spotifyContext.js";

export function useSpotify() {
  const ctx = useContext(SpotifyContext);
  if (!ctx) {
    throw new Error("useSpotify must be used within SpotifyProvider");
  }
  return ctx;
}
