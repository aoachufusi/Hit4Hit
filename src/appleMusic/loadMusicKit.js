const MUSICKIT_SCRIPT = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

let loadPromise = null;

export function loadMusicKit() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MusicKit requires a browser"));
  }

  if (window.MusicKit) {
    return Promise.resolve(window.MusicKit);
  }

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MUSICKIT_SCRIPT}"]`);
    if (existing) {
      document.addEventListener(
        "musickitloaded",
        () => resolve(window.MusicKit),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = MUSICKIT_SCRIPT;
    script.async = true;
    script.onload = () => {
      document.addEventListener(
        "musickitloaded",
        () => resolve(window.MusicKit),
        { once: true }
      );
    };
    script.onerror = () => reject(new Error("Failed to load MusicKit JS"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
