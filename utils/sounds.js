import { getHitSoundType } from "./foil.js";
import { getSoundUrl } from "./assetUrls.js";

const SOUND_PATHS = {
  hit: getSoundUrl("hit.mp3"),
  bigHit: getSoundUrl("big-hit.mp3"),
};

const soundCache = new Map();

function getAudio(type) {
  if (typeof Audio === "undefined" || !SOUND_PATHS[type]) return null;

  if (!soundCache.has(type)) {
    const audio = new Audio(SOUND_PATHS[type]);

    audio.preload = "auto";
    soundCache.set(type, audio);
  }

  return soundCache.get(type);
}

export function preloadHitSounds() {
  getAudio("hit");
  getAudio("bigHit");
}

function playAudio(audio) {
  if (!audio) return;

  try {
    audio.pause();
    audio.currentTime = 0;
    const result = audio.play();

    if (result?.catch) result.catch(() => {});
  } catch {
    // Audio playback can be blocked by the browser; reveal flow should continue silently.
  }
}

export function playHitSound(type) {
  playAudio(getAudio(type));
}

export function getPackRevealSoundCue(cards = [], set = {}) {
  if (cards.isGodPack && cards.length > 0) {
    return {
      card: cards[0],
      index: 0,
      soundType: "bigHit",
    };
  }

  const hits = cards
    .map((card, index) => ({
      card,
      index,
      soundType: getHitSoundType(card, set),
    }))
    .filter(({ soundType }) => soundType !== "none");

  return hits.find(({ soundType }) => soundType === "bigHit") || hits[0] || null;
}

export function playCardRevealSound(card, set = {}) {
  const soundType = getHitSoundType(card, set);

  if (soundType === "none") return;

  playHitSound(soundType);
}
