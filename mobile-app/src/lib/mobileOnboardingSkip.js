export async function runMobileOnboardingSkip({
  inProgressRef,
  step,
  userId = "",
  onBegin = () => {},
  saveAuthenticatedSkip = () => {},
  finishAuthenticatedSkip = async () => {},
  finishGuestSkip = () => {},
  onSettled = () => {},
} = {}) {
  if (!inProgressRef || inProgressRef.current || step === "pack") return false;

  inProgressRef.current = true;
  try {
    onBegin();
    if (userId) {
      saveAuthenticatedSkip();
      await finishAuthenticatedSkip();
    } else {
      finishGuestSkip();
    }
    return true;
  } catch (error) {
    // A genuine failure remains retryable, while duplicate events from the
    // accepted gesture stay blocked for the lifetime of the successful flow.
    inProgressRef.current = false;
    throw error;
  } finally {
    onSettled();
  }
}
