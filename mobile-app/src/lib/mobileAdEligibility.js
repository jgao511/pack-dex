export const MOBILE_AD_SAFE_PACK_STAGE = "sets";
export const MOBILE_AD_SAFE_PACK_READY_STAGE = "ready";

function hasUnsafeMobileAdState({
  startupPhase,
  authValidationState,
  onboardingStep,
  loadingMessage,
  isPackSavePending,
  revealAnimationRunning,
  isAuthSubmitting,
  isAuthPanelOpen,
  isDeleteAccountOpen,
  isSignupVerificationOpen,
  isWelcomeDisclaimerOpen,
  isWelcomeRewardModalOpen,
  isClaimingWelcomeReward,
  inspectedCard,
  cardDestinationOverlay,
} = {}) {
  return Boolean(
    startupPhase !== "complete" ||
      authValidationState === "validating" ||
      onboardingStep ||
      loadingMessage ||
      isPackSavePending ||
      revealAnimationRunning ||
      isAuthSubmitting ||
      isAuthPanelOpen ||
      isDeleteAccountOpen ||
      isSignupVerificationOpen ||
      isWelcomeDisclaimerOpen ||
      isWelcomeRewardModalOpen ||
      isClaimingWelcomeReward ||
      inspectedCard ||
      cardDestinationOverlay
  );
}

export function isMobileSetAdContextAllowed({
  activeTab,
  startupPhase,
  packStage,
  authValidationState,
  onboardingStep,
  loadingMessage,
  isPackSavePending,
  revealAnimationRunning,
  isAuthSubmitting,
  isAuthPanelOpen,
  isDeleteAccountOpen,
  isSignupVerificationOpen,
  isWelcomeDisclaimerOpen,
  isWelcomeRewardModalOpen,
  isClaimingWelcomeReward,
  inspectedCard,
  cardDestinationOverlay,
} = {}) {
  return Boolean(
    activeTab === "explore" &&
      packStage === MOBILE_AD_SAFE_PACK_STAGE &&
      !hasUnsafeMobileAdState({
        startupPhase,
        authValidationState,
        onboardingStep,
        loadingMessage,
        isPackSavePending,
        revealAnimationRunning,
        isAuthSubmitting,
        isAuthPanelOpen,
        isDeleteAccountOpen,
        isSignupVerificationOpen,
        isWelcomeDisclaimerOpen,
        isWelcomeRewardModalOpen,
        isClaimingWelcomeReward,
        inspectedCard,
        cardDestinationOverlay,
      })
  );
}

export function isMobilePackReadyAdContextAllowed({
  activeTab,
  packStage,
  viewportHeight,
  isNative,
  ...state
} = {}) {
  const height = Number(viewportHeight);

  return Boolean(
    activeTab === "open" &&
      packStage === MOBILE_AD_SAFE_PACK_READY_STAGE &&
      isNative !== true &&
      Number.isFinite(height) &&
      height >= 720 &&
      !hasUnsafeMobileAdState(state)
  );
}
