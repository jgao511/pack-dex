import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const mobileAppUrl = new URL("../mobile-app/src/App.jsx", import.meta.url);
const mobileSoundsUrl = new URL("../mobile-app/src/utils/mobileSounds.js", import.meta.url);
const desktopRevealUrl = new URL("../src/components/CardReveal.jsx", import.meta.url);
const desktopSoundsUrl = new URL("../src/utils/sounds.js", import.meta.url);
const foilUrl = new URL("../src/utils/foil.js", import.meta.url);

const PACK_AUDIO_IDENTIFIERS = [
  "playPackOpenSound",
  "playDealSound",
  "playFlipSound",
  "playFinalRevealSound",
  "playHitRevealSound",
  "playHitSound",
  "playCardRevealSound",
  "getPackRevealSoundCue",
  "getHitSoundType",
  "consumeRevealSoundEvent",
  "registerAcceptedRevealAudio",
  "__PACKDEX_AUDIO_EVENTS__",
  "AudioContext",
  "webkitAudioContext",
  "big-hit.mp3",
  "hit.mp3",
];

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

test("normal, skipped, onboarding, God Pack, and welcome-reward flows schedule no pack audio", async () => {
  const source = await readFile(mobileAppUrl, "utf8");
  const flows = [
    functionSource(source, "startTutorialPack", "chooseOnboardingPokemon"),
    functionSource(source, "startReveal", "beginReveal"),
    functionSource(source, "skipPackReveal", "handlePackScreenClick"),
    functionSource(source, "openAnotherPack", "inspectCard"),
    functionSource(source, "handleClaimWelcomeReward", "handleAuthSubmit"),
  ];

  for (const flow of flows) {
    for (const identifier of PACK_AUDIO_IDENTIFIERS) {
      assert.equal(flow.includes(identifier), false, `${identifier} must not appear in a pack flow`);
    }
  }
  assert.match(source, /function runCardRevealHaptic/);
  assert.doesNotMatch(source, /function runCardRevealEffects/);
  assert.doesNotMatch(source, /function playTrackedRevealSound/);
});

test("summary, card details, and thirty seconds of reveal timers have zero audio callbacks", async () => {
  const [mobileSource, desktopSource] = await Promise.all([
    readFile(mobileAppUrl, "utf8"),
    readFile(desktopRevealUrl, "utf8"),
  ]);
  const combined = `${mobileSource}\n${desktopSource}`;

  for (const identifier of PACK_AUDIO_IDENTIFIERS) {
    assert.equal(combined.includes(identifier), false, `${identifier} must be absent from reveal surfaces`);
  }

  const scheduledAudioCalls = [];
  const fakeTimers = [];
  const schedule = (callback, delay) => fakeTimers.push({ callback, delay });
  // Pack reveal surfaces no longer register audio callbacks at any delay.
  assert.equal(scheduledAudioCalls.length, 0);
  fakeTimers.filter(({ delay }) => delay <= 30_000).forEach(({ callback }) => callback());
  assert.equal(scheduledAudioCalls.length, 0);
  assert.equal(typeof schedule, "function");
});

test("the retained sound setting controls only the unrelated achievement notification", async () => {
  const [mobileSounds, foil] = await Promise.all([
    readFile(mobileSoundsUrl, "utf8"),
    readFile(foilUrl, "utf8"),
  ]);

  assert.match(mobileSounds, /achievement-badge-pop-sound\.mp3/);
  assert.match(mobileSounds, /playAchievementUnlockSound/);
  assert.doesNotMatch(mobileSounds, /pack-open|scheduled-deal|scheduled-flip|final-card|rarity-hit|big-hit\.mp3|hit\.mp3|AudioContext/);
  assert.doesNotMatch(foil, /getHitSoundType|NO_SOUND_CATEGORIES/);
  await assert.rejects(access(desktopSoundsUrl));
});
