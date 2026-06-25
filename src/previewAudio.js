/** Singleton preview player — avoids echo/overlap from multiple Audio elements. */

let audioRef = null;
let currentSongIdRef = null;
let audioContextRef = null;
let limitTimerRef = null;

const BUFFER_MS = 80;
const DEFAULT_LIMIT_SEC = 30;

/** Call synchronously from a click/tap — unlocks Safari audio for later preview playback. */
export function unlockPreviewAudio() {
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !audioContextRef) {
      audioContextRef = new Ctx();
    }
    if (audioContextRef?.state === "suspended") {
      void audioContextRef.resume();
    }
  } catch {
    /* ignore */
  }
  try {
    const el = new Audio();
    el.volume = 0.001;
    el.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    const p = el.play();
    if (p?.then) {
      p.then(() => el.pause()).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/** Start preview playback synchronously inside a tap/click handler (iOS). */
export function primePreviewFromUserGesture(previewUrl) {
  const url = String(previewUrl || "").trim();
  if (!url || typeof window === "undefined") return null;

  unlockPreviewAudio();

  try {
    if (audioRef) {
      try {
        audioRef.pause();
      } catch {
        /* ignore */
      }
    }

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = 0.75;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    try {
      audio.playsInline = true;
    } catch {
      /* ignore */
    }
    audio.src = url;
    currentSongIdRef = url;
    audioRef = audio;
    audio.play();
    return audio;
  } catch (e) {
    console.warn("Preview gesture play failed", e);
    return null;
  }
}

export async function stopPreviewAudio({ keepAudioContext = false } = {}) {
  if (limitTimerRef) {
    clearTimeout(limitTimerRef);
    limitTimerRef = null;
  }

  if (audioRef) {
    try {
      audioRef.pause();
      audioRef.src = "";
      audioRef.load();
    } catch {
      /* ignore */
    }
    audioRef = null;
  }

  if (!keepAudioContext && audioContextRef) {
    try {
      await audioContextRef.close();
    } catch {
      /* ignore */
    }
    audioContextRef = null;
  }

  currentSongIdRef = null;
}

/**
 * @param {string} previewUrl
 * @param {{ songId?: string, limitSec?: number }} [options]
 * @returns {Promise<HTMLAudioElement>}
 */
export async function playPreviewAudio(previewUrl, options = {}) {
  const url = String(previewUrl || "").trim();
  if (!url) {
    throw new Error("No preview URL");
  }

  const songId = options.songId ?? url;
  const limitSec = options.limitSec ?? DEFAULT_LIMIT_SEC;

  if (currentSongIdRef === songId && audioRef) {
    return audioRef;
  }

  await stopPreviewAudio();
  await new Promise((r) => setTimeout(r, BUFFER_MS));

  currentSongIdRef = songId;

  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = 0.75;
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  try {
    audio.playsInline = true;
  } catch {
    /* ignore */
  }
  audio.src = url;

  await new Promise((resolve) => {
    audio.addEventListener("canplaythrough", resolve, { once: true });
    audio.addEventListener("error", resolve, { once: true });
    setTimeout(resolve, 4000);
    audio.load();
  });

  if (currentSongIdRef !== songId) {
    throw new Error("Preview superseded while buffering");
  }

  try {
    await audio.play();
    audioRef = audio;

    const limitMs = Math.max(5, limitSec) * 1000;
    limitTimerRef = setTimeout(() => {
      if (currentSongIdRef !== songId) return;
      const el = audioRef;
      if (el) {
        try {
          el.dispatchEvent(new Event("ended"));
        } catch {
          /* ignore */
        }
      }
      stopPreviewAudio();
    }, limitMs);

    audio.addEventListener(
      "ended",
      () => {
        if (currentSongIdRef === songId) {
          if (limitTimerRef) {
            clearTimeout(limitTimerRef);
            limitTimerRef = null;
          }
          currentSongIdRef = null;
          audioRef = null;
        }
      },
      { once: true }
    );

    return audio;
  } catch (e) {
    currentSongIdRef = null;
    audioRef = null;
    if (e?.name === "NotAllowedError") {
      const err = new Error("Autoplay blocked — tap the page to enable audio");
      err.name = "NotAllowedError";
      throw err;
    }
    throw e;
  }
}

/** @deprecated Pass no args — cleans up the singleton preview player. */
export async function stopPreview(_legacyAudio, options) {
  await stopPreviewAudio(options);
}

/** @deprecated Use playPreviewAudio — kept for existing imports. */
export async function playPreview(previewUrl, options) {
  return playPreviewAudio(previewUrl, options);
}
