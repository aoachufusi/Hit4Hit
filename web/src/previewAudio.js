/** Singleton preview player — avoids echo/overlap from multiple Audio elements. */

let audioRef = null;
let currentSongIdRef = null;
let preparedPreviewUrl = null;
let audioContextRef = null;
let limitTimerRef = null;

const BUFFER_MS = 80;
const DEFAULT_LIMIT_SEC = 30;

function applyMobileAudioAttrs(audio) {
  audio.preload = "auto";
  audio.volume = 1;
  audio.muted = false;
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  try {
    audio.playsInline = true;
    audio.crossOrigin = "anonymous";
  } catch {
    /* ignore */
  }
}

export function isPreviewActivelyPlaying(audio) {
  if (!audio || audio.paused || audio.ended || audio.error) return false;
  return audio.readyState >= 2 || audio.currentTime > 0.01;
}

function attachPreviewLimitTimer(audio, songId, limitSec = DEFAULT_LIMIT_SEC) {
  if (limitTimerRef) {
    clearTimeout(limitTimerRef);
    limitTimerRef = null;
  }

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
    void stopPreviewAudio();
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
}

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

/** Load preview during LISTENING so play() can run synchronously on tap (iOS). */
export async function preparePreviewAudio(previewUrl) {
  const url = String(previewUrl || "").trim();
  if (!url || typeof window === "undefined") {
    preparedPreviewUrl = null;
    return false;
  }

  if (preparedPreviewUrl === url && audioRef && audioRef.readyState >= 3) {
    return true;
  }

  if (limitTimerRef) {
    clearTimeout(limitTimerRef);
    limitTimerRef = null;
  }

  if (audioRef) {
    try {
      audioRef.pause();
    } catch {
      /* ignore */
    }
  }

  const audio = new Audio();
  applyMobileAudioAttrs(audio);
  audio.src = url;
  preparedPreviewUrl = url;
  currentSongIdRef = url;
  audioRef = audio;

  await new Promise((resolve) => {
    const done = () => resolve();
    audio.addEventListener("canplaythrough", done, { once: true });
    audio.addEventListener("canplay", done, { once: true });
    audio.addEventListener("loadeddata", done, { once: true });
    audio.addEventListener("error", done, { once: true });
    setTimeout(done, 8000);
    audio.load();
  });

  if (preparedPreviewUrl !== url || audioRef !== audio) {
    return false;
  }

  if (audio.error) {
    console.warn("Preview load error", audio.error);
    return false;
  }

  return audio.readyState >= 2 && !audio.error;
}

export function isPreviewPrepared(previewUrl) {
  const url = String(previewUrl || "").trim();
  return (
    Boolean(url) &&
    preparedPreviewUrl === url &&
    Boolean(audioRef) &&
    audioRef.readyState >= 2 &&
    !audioRef.error
  );
}

/** Start preview synchronously inside a tap/click handler (iOS). */
export function playPreviewFromUserGesture(previewUrl, limitSec = DEFAULT_LIMIT_SEC) {
  const url = String(previewUrl || "").trim();
  if (!url || typeof window === "undefined") return null;

  unlockPreviewAudio();

  if (!isPreviewPrepared(url)) {
    if (audioRef) {
      try {
        audioRef.pause();
      } catch {
        /* ignore */
      }
    }
    const audio = new Audio();
    applyMobileAudioAttrs(audio);
    audio.src = url;
    preparedPreviewUrl = url;
    currentSongIdRef = url;
    audioRef = audio;
    audio.load();
  }

  try {
    applyMobileAudioAttrs(audioRef);
    if (audioRef.currentTime > 0.05) {
      audioRef.currentTime = 0;
    }
    currentSongIdRef = url;
    const playPromise = audioRef.play();
    if (playPromise?.catch) {
      playPromise.catch((e) => console.warn("Preview play rejected", e));
    }
    attachPreviewLimitTimer(audioRef, url, limitSec);
    return audioRef;
  } catch (e) {
    console.warn("Preview gesture play failed", e);
    return null;
  }
}

export function playPreparedPreviewFromUserGesture(previewUrl, limitSec) {
  return playPreviewFromUserGesture(previewUrl, limitSec);
}

export function primePreviewFromUserGesture(previewUrl) {
  return playPreviewFromUserGesture(previewUrl);
}

export function clearPreparedPreview() {
  preparedPreviewUrl = null;
}

export async function stopPreviewAudio({
  keepAudioContext = false,
  keepPlaying = false,
} = {}) {
  if (limitTimerRef) {
    clearTimeout(limitTimerRef);
    limitTimerRef = null;
  }

  if (audioRef && !keepPlaying) {
    try {
      audioRef.pause();
      audioRef.src = "";
      audioRef.load();
    } catch {
      /* ignore */
    }
    audioRef = null;
    preparedPreviewUrl = null;
  }

  if (!keepAudioContext && audioContextRef) {
    try {
      await audioContextRef.close();
    } catch {
      /* ignore */
    }
    audioContextRef = null;
  }

  if (!keepPlaying) {
    currentSongIdRef = null;
  }
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

  if (currentSongIdRef === songId && audioRef && !audioRef.paused) {
    return audioRef;
  }

  const prepared = await preparePreviewAudio(url);
  if (!prepared || !audioRef) {
    throw new Error("Preview failed to load");
  }

  if (currentSongIdRef !== songId) {
    throw new Error("Preview superseded while buffering");
  }

  try {
    await audioRef.play();
    attachPreviewLimitTimer(audioRef, songId, limitSec);
    return audioRef;
  } catch (e) {
    currentSongIdRef = null;
    audioRef = null;
    preparedPreviewUrl = null;
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
