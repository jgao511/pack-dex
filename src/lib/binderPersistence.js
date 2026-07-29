import { loadBinders, saveBinders } from "../utils/binderStorage.js";
import { loadCloudBinders, saveCloudBinders, upsertCloudBinder } from "./cloudBinders.js";

export function loadLocalBinders() {
  return loadBinders();
}

export async function loadPersistedBinders(userId) {
  return userId ? loadCloudBinders(userId) : loadBinders();
}

export function persistBindersForUser({ userId, binders, changedBinderId = "" }) {
  if (!userId) {
    saveBinders(binders);
    return Promise.resolve(binders);
  }

  const changedBinder = changedBinderId
    ? binders.find((binder) => binder.id === changedBinderId)
    : null;

  return changedBinder
    ? upsertCloudBinder(userId, changedBinder)
    : saveCloudBinders(userId, binders);
}
