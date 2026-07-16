import { useContext } from "react";
import { AppleMusicContext } from "./appleMusicContext.js";

export function useAppleMusic() {
  const ctx = useContext(AppleMusicContext);
  if (!ctx) {
    throw new Error("useAppleMusic must be used within AppleMusicProvider");
  }
  return ctx;
}
