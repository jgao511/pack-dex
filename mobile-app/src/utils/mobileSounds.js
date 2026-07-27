import achievementUnlockSoundUrl from "../assets/sounds/achievement-badge-pop-sound.mp3";

const audioCache = new Map();
const activePlaybackHandles = new Set();
let lastAchievementPlayedAt = 0;

function getAchievementAudio() {
  if (typeof Audio === "undefined") return null;
  if (!audioCache.has("achievementUnlock")) {
    const audio = new Audio(achievementUnlockSoundUrl);
    audio.preload = "auto";
    audioCache.set("achievementUnlock", audio);
  }
  return audioCache.get("achievementUnlock");
}

function playAchievementAudio() {
  const cachedAudio = getAchievementAudio();
  const now = Date.now();
  if (!cachedAudio || now - lastAchievementPlayedAt < 180) return null;
  lastAchievementPlayedAt = now;

  try {
    const audio = cachedAudio.cloneNode?.(true) || new Audio(achievementUnlockSoundUrl);
    let state = "starting";
    let resolveFinished = null;
    const finished = new Promise((resolve) => { resolveFinished = resolve; });
    const finish = (nextState) => {
      if (["ended", "stopped", "failed"].includes(state)) return;
      state = nextState;
      activePlaybackHandles.delete(handle);
      resolveFinished?.(nextState);
    };
    const handle = {
      get state() {
        return state;
      },
      finished,
      stop() {
        if (["ended", "stopped", "failed"].includes(state)) return false;
        audio.pause();
        audio.currentTime = 0;
        finish("stopped");
        return true;
      },
    };

    activePlaybackHandles.add(handle);
    audio.preload = "auto";
    audio.currentTime = 0;
    audio.addEventListener?.("ended", () => finish("ended"), { once: true });
    const result = audio.play();
    if (result?.then) {
      result.then(() => {
        if (state === "starting") state = "playing";
      }).catch(() => finish("failed"));
    } else {
      state = "playing";
    }
    return handle;
  } catch {
    return null;
  }
}

export function preloadMobileSounds() {
  getAchievementAudio();
}

export function stopAllMobileSounds() {
  [...activePlaybackHandles].forEach((handle) => handle.stop?.());
}

export function playAchievementUnlockSound(enabled = true) {
  if (!enabled) return null;
  return playAchievementAudio();
}
