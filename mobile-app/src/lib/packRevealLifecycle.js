export function isPackSkipReady({
  stage,
  assetsReady,
  tutorialMode = false,
  skipStarted = false,
} = {}) {
  return stage === "revealing" && assetsReady === true && !tutorialMode && !skipStarted;
}

export function claimPackPersistence(currentSaveKey, nextSaveKey) {
  if (!nextSaveKey || currentSaveKey === nextSaveKey) {
    return { shouldPersist: false, saveKey: currentSaveKey || "" };
  }

  return { shouldPersist: true, saveKey: nextSaveKey };
}

export function runPackSkipTransition({
  canSkip,
  clearTimers,
  finishCycle,
  revealAll,
  showSummary,
} = {}) {
  if (!canSkip) return false;

  clearTimers?.();
  finishCycle?.();
  revealAll?.();
  showSummary?.();
  return true;
}
