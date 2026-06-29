import { getSoundUrl } from "../../../src/utils/assetUrls.js";
import { getHitSoundType } from "../../../src/utils/foil.js";
import achievementUnlockSoundUrl from "../assets/sounds/achievement-badge-pop-sound.mp3";

const SOUND_PATHS = {
  hit: getSoundUrl("hit.mp3"),
  bigHit: getSoundUrl("big-hit.mp3"),
  achievementUnlock: achievementUnlockSoundUrl,
};

const audioCache = new Map();
const lastPlayedAt = new Map();
let audioContext = null;

function canPlay(key, minGapMs = 70) {
  const now = Date.now();
  const previous = lastPlayedAt.get(key) || 0;

  if (now - previous < minGapMs) return false;

  lastPlayedAt.set(key, now);
  return true;
}

function getAudio(type) {
  if (typeof Audio === "undefined" || !SOUND_PATHS[type]) return null;

  if (!audioCache.has(type)) {
    const audio = new Audio(SOUND_PATHS[type]);

    audio.preload = "auto";
    audioCache.set(type, audio);
  }

  return audioCache.get(type);
}

function playAudio(type) {
  const audio = getAudio(type);

  if (!audio || !canPlay(type, 180)) return;

  try {
    audio.pause();
    audio.currentTime = 0;
    const result = audio.play();

    if (result?.catch) result.catch(() => {});
  } catch {
    // Mobile browsers can block audio; visuals should continue.
  }
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();

  return audioContext;
}

function playTone(key, frequency, durationMs, gainValue = 0.035, type = "sine") {
  if (typeof window === "undefined" || !canPlay(key)) return;

  try {
    const context = getAudioContext();

    if (!context) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000 + 0.02);
  } catch {
    // Sound is a bonus layer; never interrupt the pack flow.
  }
}

export function preloadMobileSounds() {
  getAudio("hit");
  getAudio("bigHit");
  getAudio("achievementUnlock");
}

export function playPackOpenSound(enabled = true) {
  if (!enabled) return;

  playTone("pack-open", 196, 120, 0.045, "triangle");
}

export function playDealSound(enabled = true) {
  if (!enabled) return;

  playTone("deal", 260, 42, 0.022, "square");
}

export function playFlipSound(enabled = true) {
  if (!enabled) return;

  playTone("flip", 430, 58, 0.025, "triangle");
}

export function playFinalRevealSound(enabled = true) {
  if (!enabled) return;

  playTone("final", 520, 120, 0.04, "sine");
}

export function playHitRevealSound(card, set, enabled = true) {
  if (!enabled) return;

  const soundType = getHitSoundType(card, set);

  if (soundType === "bigHit") {
    playAudio("bigHit");
  } else if (soundType === "hit") {
    playAudio("hit");
  }
}

export function playAchievementUnlockSound(enabled = true) {
  if (!enabled) return;

  playAudio("achievementUnlock");
}
