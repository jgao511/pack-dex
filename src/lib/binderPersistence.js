import { loadBinders, saveBinders } from "../utils/binderStorage.js";
import {
  deleteCloudBinder,
  loadCloudBinders,
  saveCloudBinders,
  upsertCloudBinder,
} from "./cloudBinders.js";

const binderWriteQueues = new Map();

function queueBinderWrite(key, write) {
  const previous = binderWriteQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => {}).then(write);
  binderWriteQueues.set(key, queued);
  return queued.finally(() => {
    if (binderWriteQueues.get(key) === queued) binderWriteQueues.delete(key);
  });
}

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

  const queueKey = `${userId}:${changedBinder?.id || "*"}`;
  return queueBinderWrite(queueKey, () => (
    changedBinder
      ? upsertCloudBinder(userId, changedBinder)
      : saveCloudBinders(userId, binders)
  ));
}

export async function deletePersistedBinder({ userId, binderId, binders }) {
  const remainingBinders = (Array.isArray(binders) ? binders : []).filter(
    (binder) => binder.id !== binderId
  );

  if (!userId) {
    saveBinders(remainingBinders);
    return loadBinders();
  }

  await deleteCloudBinder(userId, binderId);
  return loadCloudBinders(userId);
}
