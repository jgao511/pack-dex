export const PRIVACY_CHOICES_OPEN_EVENT = "packdex:open-privacy-choices";

export function openPrivacyChoices(trigger = globalThis.document?.activeElement) {
  if (!globalThis.dispatchEvent || typeof globalThis.CustomEvent !== "function") return false;

  globalThis.dispatchEvent(
    new globalThis.CustomEvent(PRIVACY_CHOICES_OPEN_EVENT, {
      detail: { trigger },
    })
  );
  return true;
}
