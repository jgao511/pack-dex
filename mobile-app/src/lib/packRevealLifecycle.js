export function claimPackPersistence(currentSaveKey, nextSaveKey) {
  if (!nextSaveKey || currentSaveKey === nextSaveKey) {
    return { shouldPersist: false, saveKey: currentSaveKey || "" };
  }

  return { shouldPersist: true, saveKey: nextSaveKey };
}
