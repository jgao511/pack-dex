import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Turnstile } from "react-turnstile";
import MobileResetPasswordPage from "./MobileResetPasswordPage.jsx";
import DeleteAccountDialog from "./components/DeleteAccountDialog.jsx";
import PrivacyChoicesDialog from "../../src/components/PrivacyChoicesDialog.jsx";
import { LEGAL_ROUTES, PACKDEX_SUPPORT_EMAIL } from "../../src/content/legalDocuments.js";
import { buildExplorePath } from "./explore/exploreRouting.js";
import { sets } from "../../src/data/sets.js";
import { getCardBackUrl, getCardImageUrl, getPokeballLoadingUrl, getSetLogoUrl } from "../../src/utils/assetUrls.js";
import { generatePack, getDisplayCardName, getDisplayRarity, isHigherThanRare } from "../../src/utils/packGenerator.js";
import { selectFeaturedPull } from "../../src/utils/rarityRank.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
  getSetCollectionProgress,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "../../src/utils/collectionStorage.js";
import { createBinder, createMasterSetBinder, loadBinders, saveBinders } from "../../src/utils/binderStorage.js";
import { getFoilProfile } from "../../src/utils/foil.js";
import { supabase, isSupabaseConfigured, missingSupabaseEnv } from "./lib/supabaseClient.js";
import { loadCloudProfileStats } from "./lib/cloudProfileStats.js";
import { ensurePackOpenClientEventId, recordPackOpenEvent } from "../../src/lib/packOpenEvents.js";
import { cacheWelcomeRewardStatus, loadWelcomeRewardStatus } from "../../src/lib/welcomeReward.js";
import {
  loadCloudCollection,
  enqueuePendingCloudPull,
  getPendingCloudPullCount,
  getPendingCloudPulls,
  mergePendingCloudPullsIntoCollection,
  syncPendingCloudPulls,
} from "./lib/cloudCollection.js";
import { preloadImages } from "./utils/imageCache.js";
import SharePullButton from "./components/SharePullButton.jsx";
import {
  loadCurrentUserAchievementProgress,
  loadCurrentUserAchievements,
  mergeUserAchievementRows,
  requestServerAchievementAward,
} from "../../src/lib/userAchievements.js";
import { getSiteOrigin } from "../../src/utils/authRedirects.js";
import { getTcgplayerCardUrl } from "../../src/utils/tcgplayerSearch.js";
import {
  formatUsd,
  getCardDisplayPrice,
  getCollectionValueCoverage,
  loadCardPricesForCollection,
  loadCardPricesForCards,
  loadCardPricesForSet,
} from "../../src/lib/cardPrices.js";
import { countDevRequest } from "./utils/requestDiagnostics.js";
import { getCardActionLayoutClass, getCardDetailActionVisibility } from "./utils/cardDetailActions.js";
import { clearCachedSupabaseUser } from "../../src/lib/sessionUserCache.js";
import { isSupabaseAuthStorageKey, validateSupabaseIdentity } from "../../src/lib/authIdentityValidation.js";
import { clearDeletedAccountLocalState, deleteCurrentAccount } from "../../src/lib/accountDeletion.js";
import { openPrivacyChoices } from "../../src/lib/privacyChoices.js";
import {
  playAchievementUnlockSound,
  playDealSound,
  playFinalRevealSound,
  playFlipSound,
  playHitRevealSound,
  playPackOpenSound,
  preloadMobileSounds,
} from "./utils/mobileSounds.js";
import { getRarityVisualClass, isRarePlusVisual } from "./utils/rarityPresentation.js";
import { loadHapticsEnabled, saveHapticsEnabled, triggerRevealHaptic } from "./utils/mobileHaptics.js";
import { addWishlistCard, getWishlistKey, loadWishlist, removeWishlistCard, resolveCatalogWishlistItem } from "./lib/wishlist.js";
import { addScannedCardOnce, loadScannerCardActionState } from "./lib/scannerCardActions.js";

const ExploreScreen = lazy(() => import("./explore/ExploreScreen.jsx"));
const MobileScannerPage = __PACKDEX_SCANNER_TEST__ ? lazy(() => import("./MobileScannerPage.jsx")) : null;

const tabs = [
  { id: "open", label: "Open", title: "Open a Pack", icon: "open" },
  { id: "collection", label: "Collection", title: "Collection", icon: "collection" },
  __PACKDEX_SCANNER_TEST__
    ? { id: "scanner", label: "Scanner", title: "Scanner", icon: "scanner" }
    : { id: "explore", label: "Explore", title: "Explore", icon: "explore" },
  { id: "profile", label: "Profile", title: "Profile", icon: "profile" },
];

const eraOrder = ["Pokemon 30th Anniversary", "Mega Evolution", "Scarlet & Violet", "Sword & Shield", "Sun & Moon", "XY", "Vintage"];
const COLLECTION_ERA_FILTER_KEY = "packdex-mobile-collection-era-filter";
const EMPTY_STATS = { packsOpened: 0, totalCardsPulled: 0 };
const CARD_DEAL_STAGGER_MS = 180;
const CARD_DEAL_ANIMATION_MS = 280;
const WAIT_AFTER_DEAL_MS = 500;
const CARD_FLIP_STAGGER_MS = 330;
const LAST_CARD_EXTRA_DELAY_MS = 850;
const CARD_FLIP_ANIMATION_MS = 620;
const SUMMARY_AFTER_LAST_CARD_MS = 250;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SUPPORT_EMAIL = PACKDEX_SUPPORT_EMAIL;
const MOBILE_DISCLAIMER_SEEN_KEY = "packdex-mobile-intro-seen";
const SETS_WITHOUT_MARKET_PRICE_DATA = new Set(["ascended-heroes", "perfect-order", "chaos-rising", "pitch-black"]);
const PRELOAD_SET_LIMIT = 3;
const PRELOAD_CARD_LIMIT_PER_SET = 45;
const ACHIEVEMENT_TOAST_AUTO_DISMISS_MS = 3400;
const ACCOUNT_STATE_FRESH_MS = 5 * 60 * 1000;
const MOBILE_ACHIEVEMENTS = [
  {
    id: "account_created",
    title: "Welcome to PackDex",
    description: "Create or sign in to a PackDex account.",
    trust: "trusted",
    category: "special",
    icon_key: "chase",
    progress_target: 1,
  },
  {
    id: "first_pack_opened",
    title: "First Rip",
    description: "Open your first PackDex pack while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 1,
  },
  {
    id: "packs_opened_10",
    title: "Pack Rookie",
    description: "Open 10 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 10,
  },
  {
    id: "packs_opened_25",
    title: "Pack Regular",
    description: "Open 25 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 25,
  },
  {
    id: "packs_opened_50",
    title: "Rip Streak",
    description: "Open 50 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 50,
  },
  {
    id: "packs_opened_100",
    title: "Pack Pro",
    description: "Open 100 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 100,
  },
  {
    id: "packs_opened_250",
    title: "Sealed Seeker",
    description: "Open 250 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 250,
  },
  {
    id: "packs_opened_500",
    title: "Pack Veteran",
    description: "Open 500 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 500,
  },
  {
    id: "packs_opened_1000",
    title: "Thousand-Pack Club",
    description: "Open 1,000 PackDex packs while signed in.",
    trust: "trusted",
    category: "packs",
    icon_key: "pack",
    progress_target: 1000,
  },
  {
    id: "binder_page_9",
    title: "First Binder Page",
    description: "Own 9 unique cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 9,
  },
  {
    id: "collector_100",
    title: "Card Collector",
    description: "Own 100 unique cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 100,
  },
  {
    id: "unique_cards_250",
    title: "Binder Builder",
    description: "Own 250 unique cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 250,
  },
  {
    id: "collector_500",
    title: "Binder Beast",
    description: "Own 500 unique cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 500,
  },
  {
    id: "card_stack_100",
    title: "Stacked Up",
    description: "Own 100 total virtual cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 100,
  },
  {
    id: "total_cards_250",
    title: "Card Stack",
    description: "Own 250 total virtual cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 250,
  },
  {
    id: "total_cards_500",
    title: "Bulk Builder",
    description: "Own 500 total virtual cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 500,
  },
  {
    id: "card_stack_1000",
    title: "Bulk Box",
    description: "Own 1,000 total virtual cards.",
    trust: "trusted",
    category: "collection",
    icon_key: "binder",
    progress_target: 1000,
  },
  {
    id: "value_10",
    title: "Pocket Change",
    description: "Reach $10 in estimated collection value.",
    trust: "trusted",
    category: "value",
    icon_key: "dollar",
    progress_target: 10,
  },
  {
    id: "value_100",
    title: "Treasure Binder",
    description: "Reach $100 in estimated collection value.",
    trust: "trusted",
    category: "value",
    icon_key: "dollar",
    progress_target: 100,
  },
  {
    id: "value_500",
    title: "Vault Starter",
    description: "Reach $500 in estimated collection value.",
    trust: "trusted",
    category: "value",
    icon_key: "dollar",
    progress_target: 500,
  },
  {
    id: "first_set_complete",
    title: "Page Perfect",
    description: "Complete your first set.",
    trust: "trusted",
    category: "set_mastery",
    icon_key: "trophy",
    progress_target: 1,
  },
  {
    id: "sets_complete_5",
    title: "Mastery Run",
    description: "Complete 5 sets.",
    trust: "trusted",
    category: "set_mastery",
    icon_key: "trophy",
    progress_target: 5,
  },
  {
    id: "first_big_hit",
    title: "First Big Hit",
    description: "Pull your first Rare+ hit.",
    trust: "trusted",
    category: "pulls",
    icon_key: "sparkle",
    progress_target: 1,
  },
  {
    id: "big_hits_10",
    title: "Hit Streak",
    description: "Pull 10 Rare+ hits.",
    trust: "trusted",
    category: "pulls",
    icon_key: "sparkle",
    progress_target: 10,
  },
  {
    id: "rare_hits_25",
    title: "Hit Hunter",
    description: "Pull 25 Rare+ hits.",
    trust: "trusted",
    category: "pulls",
    icon_key: "sparkle",
    progress_target: 25,
  },
  {
    id: "rare_hits_50",
    title: "Hit Magnet",
    description: "Pull 50 Rare+ hits.",
    trust: "trusted",
    category: "pulls",
    icon_key: "sparkle",
    progress_target: 50,
  },
];
const WELCOME_REWARD_CHOICES = [
  { setId: "prismatic-evolutions", title: "Prismatic Evolutions", description: "A premium Eeveelution God Pack.", forcedFormat: "PRISMATIC_FULL_EEVEELUTION_PACK" },
  { setId: "black-bolt", title: "Black Bolt", description: "Nine Illustration Rares and one Special Illustration Rare." },
  { setId: "white-flare", title: "White Flare", description: "Nine Illustration Rares and one Special Illustration Rare." },
  { setId: "ascended-heroes", title: "Ascended Heroes", description: "Mega Attack Rares and Special Illustration Rares." },
  { setId: "151", title: "151", description: "A starter evolution line demi-god pack." },
];
const LEGAL_URLS = {
  terms: `${getSiteOrigin()}${LEGAL_ROUTES.terms}`,
  privacy: `${getSiteOrigin()}${LEGAL_ROUTES.privacy}`,
};

function getMobileAuthCallbackUrl() {
  return `${getSiteOrigin()}/mobile-app/auth/callback`;
}

function getMobileResetPasswordUrl() {
  return `${getSiteOrigin()}/mobile-app/reset-password`;
}

function getWelcomeRewardChoices() {
  return WELCOME_REWARD_CHOICES.map((choice) => {
    const set = sets.find((candidate) => candidate.id === choice.setId);

    return set ? { ...choice, set } : null;
  }).filter(Boolean);
}

async function getFunctionErrorDetails(error) {
  const response = error?.context;

  if (!response || typeof response.clone !== "function") return null;

  try {
    return await response.clone().json();
  } catch {
    try {
      return { message: await response.clone().text() };
    } catch {
      return null;
    }
  }
}

async function claimMobileWelcomeGodPack(setId, forcedFormat = "") {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.functions.invoke("claim-welcome-god-pack", {
    body: { set_id: setId, forcedFormat },
  });

  if (error) {
    const details = await getFunctionErrorDetails(error);
    throw new Error(details?.error || details?.message || error.message || "Unable to claim welcome reward.");
  }

  const cards = Array.isArray(data?.cards) ? data.cards : [];

  if (!cards.length) throw new Error(data?.message || "The welcome reward service did not return cards.");

  Object.assign(cards, {
    isGodPack: true,
    godPackDisplayName: data?.godPackDisplayName || "God Pack",
    godPackFormat: data?.godPackFormat || "",
    welcomeReward: true,
  });

  return {
    cards,
    status: data?.rewardStatus || null,
    stats: data?.stats || null,
  };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function scheduleIdleTask(callback) {
  if (typeof window === "undefined") return null;
  if ("requestIdleCallback" in window) {
    return {
      type: "idle",
      id: window.requestIdleCallback(callback, { timeout: 1500 }),
    };
  }

  return {
    type: "timeout",
    id: window.setTimeout(callback, 800),
  };
}

function cancelIdleTask(handle) {
  if (!handle || typeof window === "undefined") return;
  if (handle.type === "idle" && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(handle.id);
    return;
  }

  window.clearTimeout(handle.id);
}

function TcgplayerSourceBadge({ compact = false }) {
  return (
    <span className={`tcgplayer-source-badge ${compact ? "is-compact" : ""}`} aria-label="Price source: TCGplayer market data">
      <span className="tcgplayer-source-mark" aria-hidden="true">
        T
      </span>
      <span>TCGplayer</span>
    </span>
  );
}

function getEstimatedCardValue(card, count = 1) {
  const rarity = normalizeText(card?.rarity || card?.rarityCategory);
  const name = normalizeText(card?.name);
  let base = 0.25;

  if (rarity.includes("classic") || rarity.includes("futuristic")) base = 28;
  else if (rarity.includes("special illustration")) base = 42;
  else if (rarity.includes("hyper") || rarity.includes("secret")) base = 31;
  else if (rarity.includes("illustration")) base = 12;
  else if (rarity.includes("mega") || rarity.includes("double") || rarity.includes("ex")) base = 5;
  else if (rarity.includes("rare")) base = 1.5;

  if (name.includes("charizard")) base *= 2.4;
  if (name.includes("umbreon") || name.includes("pikachu") || name.includes("mew")) base *= 1.7;

  return Math.round(base * count);
}

function getSetNumber(card) {
  const value = String(card?.number || "").match(/\d+/)?.[0];

  return value ? Number(value) : 9999;
}

function sortSetsByEra(setList) {
  return [...setList].sort((a, b) => {
    const dateA = new Date(a.releaseDate || 0).getTime();
    const dateB = new Date(b.releaseDate || 0).getTime();

    if (dateA !== dateB) return dateB - dateA;

    const eraA = eraOrder.indexOf(a.era);
    const eraB = eraOrder.indexOf(b.era);
    const safeEraA = eraA === -1 ? 99 : eraA;
    const safeEraB = eraB === -1 ? 99 : eraB;

    if (safeEraA !== safeEraB) return safeEraA - safeEraB;

    return String(a.name).localeCompare(String(b.name));
  });
}

function groupSetsByEra(setList) {
  return setList.reduce((groups, set) => {
    const era = set.era || "Other";

    return {
      ...groups,
      [era]: [...(groups[era] || []), set],
    };
  }, {});
}

function getOwnedCards(collection) {
  return sets.flatMap((set) =>
    (set.cards || [])
      .map((card) => ({
        set,
        card,
        count: getCardCount(collection, card, set.id),
        entry: collection?.[set.id]?.[String(card.id)],
      }))
      .filter((item) => item.count > 0)
  );
}

function getOwnedSetIds(collection) {
  return Object.entries(collection || {})
    .filter(([, cards]) => Object.keys(cards || {}).length > 0)
    .map(([setId]) => setId);
}

function getCardKey(card, setId) {
  return `${setId}:${String(card?.id || card?.number || card?.name || "")}`;
}

function getPackCardImageUrl(card, set) {
  return getCardImageUrl({ ...card, setFolder: card.setFolder || set?.setFolder || set?.id });
}

function SetLogo({ set, className = "" }) {
  return <img className={className} src={getSetLogoUrl(set)} alt={`${set.name} logo`} loading="lazy" />;
}

function isFoilHit(card, set) {
  return getFoilProfile(card, set) !== "none" || isHigherThanRare(card);
}

function preventCardImageBrowserAction(event) {
  event.preventDefault();
}

function CardImage({
  card,
  set,
  className = "",
  withEffects = false,
  isFinal = false,
  loading = "lazy",
  fetchPriority = "auto",
  ownedShimmer = false,
}) {
  const foilProfile = getFoilProfile(card, set);
  const showEffects = withEffects && foilProfile !== "none";
  const imageUrl = getPackCardImageUrl(card, set);

  return (
    <span
      className={`mobile-card-image-shell foil-profile-${foilProfile} ${getRarityVisualClass(card, set)} ${showEffects ? "has-foil" : ""} ${ownedShimmer && isRarePlusVisual(card, set) ? "has-owned-shimmer" : ""} ${
        isFinal && showEffects ? "is-final-hit" : ""
      } ${className}`.trim()}
      onContextMenu={preventCardImageBrowserAction}
      onDragStart={preventCardImageBrowserAction}
    >
      <img
        src={imageUrl}
        alt={getDisplayCardName(card, set)}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        draggable={false}
        onContextMenu={preventCardImageBrowserAction}
        onDragStart={preventCardImageBrowserAction}
      />
      {showEffects && (
        <>
          <span className="mobile-foil-glare" aria-hidden="true" />
          <span className="mobile-foil-sparkles" aria-hidden="true" />
          <span className="mobile-foil-shine" aria-hidden="true" />
        </>
      )}
    </span>
  );
}

function CardBackImage({ className = "" }) {
  return <img className={className} src={getCardBackUrl()} alt="" decoding="async" loading="eager" draggable={false} onContextMenu={preventCardImageBrowserAction} onDragStart={preventCardImageBrowserAction} />;
}

function AccountNotice({ user, onLogin, onCreateAccount }) {
  if (user) return null;

  return (
    <p className="account-notice">
      <button type="button" onClick={onLogin}>
        Log in
      </button>{" "}
      or{" "}
      <button type="button" onClick={onCreateAccount}>
        create an account
      </button>{" "}
      to save your simulated pulls across devices.
    </p>
  );
}

function PokeballLoadingOverlay({ message = "Loading..." }) {
  return (
    <div className="mobile-loading-overlay" role="status" aria-live="polite">
      <div className="mobile-loading-card">
        <img src={POKEBALL_LOADING_SRC} alt="" />
        <span>{message}</span>
      </div>
    </div>
  );
}


function hasSeenDisclaimer() {
  if (typeof window === "undefined") return true;

  return window.localStorage.getItem(MOBILE_DISCLAIMER_SEEN_KEY) === "true";
}

function markDisclaimerSeen() {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(MOBILE_DISCLAIMER_SEEN_KEY, "true");
}

function WelcomeDisclaimerModal({ isOpen, onDismiss }) {
  if (!isOpen) return null;

  function handleDismiss() {
    markDisclaimerSeen();
    onDismiss?.();
  }

  return (
    <div className="mobile-disclaimer-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-disclaimer-title">
      <section className="mobile-disclaimer-modal">
        <span className="eyebrow">Disclaimer</span>
        <h2 id="mobile-disclaimer-title">Welcome to PackDex</h2>
        <div className="mobile-disclaimer-copy">
          <p>PackDex is a fan-made Pokemon TCG pack-opening simulator and collection tracker.</p>
          <p>Pack openings are simulated and do not award physical cards, money, prizes, or redeemable items.</p>
          <p>PackDex is not affiliated with Nintendo, Creatures, Game Freak, or The Pokemon Company.</p>
          <p>Card names, artwork, set names, and related trademarks belong to their respective owners.</p>
          <p>
            For support or bug reports, contact{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
        <a
          className="mobile-install-tutorial-link"
          href="https://youtube.com/shorts/Ri6i8fEIdrU"
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch how to add PackDex to your Home Screen (Apple &amp; Android)
        </a>
        <button className="primary-action" type="button" onClick={handleDismiss}>
          Got it
        </button>
      </section>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" />
      <path d="M19.4 13.5a7.5 7.5 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.6A7.8 7.8 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a7.8 7.8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2" />
    </svg>
  );
}

function EyeIcon({ isVisible = false }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.8 12s3.2-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z" />
      <path d="M12 9.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z" />
      {!isVisible && <path d="M4.5 4.5 19.5 19.5" />}
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v4.4a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5.5a2.5 2.5 0 0 0 2.8 4.9M16 6h2.5a2.5 2.5 0 0 1-2.8 4.9" />
      <path d="M12 12.5V17M8.5 20h7M10 17h4" />
    </svg>
  );
}

function AchievementIcon({ iconKey = "trophy" }) {
  const pathsByIcon = {
    pack: ["M5 8.5 12 4l7 4.5v7L12 20l-7-4.5v-7Z", "M5 8.5 12 13l7-4.5M12 13v7"],
    binder: ["M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z", "M9 4v16M12 8h3M12 12h3"],
    dollar: ["M12 3v18", "M16.5 7.5c-.8-1-2.2-1.7-4-1.7-2.1 0-3.5 1-3.5 2.6 0 3.8 7.5 1.8 7.5 6 0 1.7-1.5 2.8-4 2.8-2 0-3.5-.7-4.4-1.9"],
    sparkle: ["M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3Z", "M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"],
    chase: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 11.2v1.6"],
    trophy: ["M8 4h8v4.4a4 4 0 0 1-8 0V4Z", "M8 6H5.5a2.5 2.5 0 0 0 2.8 4.9M16 6h2.5a2.5 2.5 0 0 1-2.8 4.9", "M12 12.5V17M8.5 20h7M10 17h4"],
  };
  const paths = pathsByIcon[iconKey] || pathsByIcon.trophy;

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths.map((path) => <path d={path} key={path} />)}
    </svg>
  );
}

function AchievementUnlockToast({ toast }) {
  if (!toast) return null;

  const iconKey = toast.iconKey || "trophy";

  return (
    <aside className={`achievement-unlock-toast achievement-icon-${iconKey}`} role="status" aria-live="polite">
      <span className="achievement-toast-sparkles" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="achievement-trophy-icon" aria-hidden="true"><AchievementIcon iconKey={iconKey} /></span>
      <span className="achievement-toast-copy">
        <em>Achievement Unlocked!</em>
        <strong>{toast.title}</strong>
      </span>
    </aside>
  );
}

function SignupVerificationModal({ isOpen, email, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="mobile-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="signup-verification-title" onClick={onClose}>
      <section className="mobile-auth-modal signup-verification-modal" onClick={(event) => event.stopPropagation()}>
        <button className="mobile-auth-close" type="button" onClick={onClose} aria-label="Close verification notice">
          <CloseIcon />
        </button>
        <div className="mobile-auth-heading">
          <span className="eyebrow">Verify Email</span>
          <h2 id="signup-verification-title">Check your email</h2>
          <p>
            We sent a verification link{email ? ` to ${email}` : ""}. Open it to finish signup, then PackDex mobile will sign you in.
          </p>
        </div>
        <button className="primary-action compact-auth-submit" type="button" onClick={onClose}>
          Got it
        </button>
      </section>
    </div>
  );
}

function WelcomeRewardModal({ isOpen, rewardStatus, selectedSetId, isClaiming, error, onSelect, onClaim, onClose }) {
  const choices = useMemo(() => getWelcomeRewardChoices(), []);

  if (!isOpen || !rewardStatus?.isEligible || rewardStatus?.isClaimed) return null;

  const selectedChoice = choices.find((choice) => choice.setId === selectedSetId) || choices[0];

  return (
    <div className="mobile-auth-overlay welcome-reward-mobile-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-reward-title" onClick={onClose}>
      <section className="mobile-auth-modal welcome-reward-mobile-modal" onClick={(event) => event.stopPropagation()}>
        <button className="mobile-auth-close" type="button" onClick={onClose} aria-label="Close welcome reward">
          <CloseIcon />
        </button>
        <div className="mobile-auth-heading">
          <span className="eyebrow">Welcome Pack</span>
          <h2 id="welcome-reward-title">Choose a welcome God Pack</h2>
          <p>Thanks for signing up! Here’s a free God Pack on us to get your collection started.</p>
        </div>
        <div className="welcome-reward-mobile-grid">
          {choices.map((choice) => (
            <button
              className={`welcome-reward-mobile-choice ${choice.setId === selectedChoice?.setId ? "is-selected" : ""}`}
              type="button"
              key={choice.setId}
              onClick={() => onSelect(choice.setId)}
              aria-pressed={choice.setId === selectedChoice?.setId}
            >
              <SetLogo set={choice.set} className="welcome-reward-mobile-logo" />
              <span>
                <strong>{choice.title}</strong>
                <small>{choice.description}</small>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="auth-message is-error">{error}</p>}
        <button className="primary-action compact-auth-submit" type="button" disabled={isClaiming || !selectedChoice} onClick={() => onClaim(selectedChoice)}>
          {isClaiming ? "Opening..." : "Open Welcome Pack"}
        </button>
      </section>
    </div>
  );
}

function MobileAuthModal({
  isOpen,
  authMode,
  authEmail,
  authPassword,
  authConfirmPassword,
  turnstileToken,
  turnstileMessage,
  authMessage,
  isAuthSubmitting,
  onClose,
  onAuthMode,
  onAuthEmail,
  onAuthPassword,
  onAuthConfirmPassword,
  onTurnstileToken,
  onTurnstileMessage,
  onAuthSubmit,
}) {
  const isCreateMode = authMode === "signup";
  const isResetMode = authMode === "forgot";
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  if (!isOpen) return null;

  const canSubmitAuth =
    isSupabaseConfigured && !isAuthSubmitting && (!isCreateMode || (Boolean(TURNSTILE_SITE_KEY) && Boolean(turnstileToken)));

  if (isResetMode) {
    const canSubmitReset = isSupabaseConfigured && !isAuthSubmitting && Boolean(TURNSTILE_SITE_KEY) && Boolean(turnstileToken);

    return (
      <div className="mobile-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-auth-title" onClick={onClose}>
        <section className="mobile-auth-modal" onClick={(event) => event.stopPropagation()}>
          <button className="mobile-auth-close" type="button" onClick={onClose} aria-label="Close password reset form">
            <CloseIcon />
          </button>
          <div className="mobile-auth-heading">
            <span className="eyebrow">Account</span>
            <h2 id="mobile-auth-title">Reset your password</h2>
            <p>Enter your email to receive a reset link.</p>
            <span className="mobile-supabase-badge">Powered by Supabase Auth</span>
          </div>
          <form className="auth-form" onSubmit={onAuthSubmit}>
            <label>
              Email
              <input value={authEmail} type="email" autoComplete="email" required onChange={(event) => onAuthEmail(event.target.value)} />
            </label>
            <div className="mobile-turnstile-panel">
              {TURNSTILE_SITE_KEY ? (
                <>
                  <Turnstile
                    sitekey={TURNSTILE_SITE_KEY}
                    size="flexible"
                    theme="dark"
                    onVerify={(token) => {
                      onTurnstileToken(token);
                      onTurnstileMessage("");
                    }}
                    onExpire={() => {
                      onTurnstileToken("");
                      onTurnstileMessage("Verification expired. Please verify again.");
                    }}
                    onError={() => {
                      onTurnstileToken("");
                      onTurnstileMessage("Verification failed. Please try again.");
                    }}
                  />
                  {turnstileMessage && <p className="turnstile-status">{turnstileMessage}</p>}
                </>
              ) : (
                <p className="auth-message is-error">Password reset verification is unavailable.</p>
              )}
            </div>
            <button className="primary-action compact-auth-submit" type="submit" disabled={!canSubmitReset}>
              {isAuthSubmitting ? "Sending..." : "Send reset email"}
            </button>
            <button className="auth-switch-link" type="button" onClick={() => onAuthMode("login")}>
              Back to log in
            </button>
            {authMessage && <p className="auth-message">{authMessage}</p>}
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="mobile-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-auth-title" onClick={onClose}>
      <section className="mobile-auth-modal" onClick={(event) => event.stopPropagation()}>
        <button className="mobile-auth-close" type="button" onClick={onClose} aria-label="Close account form">
          <CloseIcon />
        </button>
        <div className="mobile-auth-heading">
          <span className="eyebrow">Account</span>
          <h2 id="mobile-auth-title">{isCreateMode ? "Create your PackDex account" : "Welcome back"}</h2>
          <span className="mobile-supabase-badge">Powered by Supabase Auth</span>
        </div>
        <div className="auth-tabs">
          <button className={authMode === "login" ? "is-active" : ""} type="button" onClick={() => onAuthMode("login")}>
            Log In
          </button>
          <button className={authMode === "signup" ? "is-active" : ""} type="button" onClick={() => onAuthMode("signup")}>
            Create account
          </button>
        </div>
        <form className="auth-form" onSubmit={onAuthSubmit}>
          <label>
            Email
            <input value={authEmail} type="email" autoComplete="email" onChange={(event) => onAuthEmail(event.target.value)} />
          </label>
          <label>
            Password
            <span className="auth-password-field">
              <input
                value={authPassword}
                type={isPasswordVisible ? "text" : "password"}
                autoComplete={isCreateMode ? "new-password" : "current-password"}
                minLength={8}
                onChange={(event) => onAuthPassword(event.target.value)}
              />
              <button
                className="auth-password-toggle"
                type="button"
                aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                aria-pressed={isPasswordVisible}
                onClick={() => setIsPasswordVisible((value) => !value)}
              >
                <EyeIcon isVisible={isPasswordVisible} />
              </button>
            </span>
          </label>
          {authMode === "login" && (
            <button className="auth-switch-link" type="button" onClick={() => onAuthMode("forgot")}>
              Forgot password?
            </button>
          )}
          {isCreateMode && (
            <>
              <label>
                Confirm password
                <span className="auth-password-field">
                  <input
                    value={authConfirmPassword}
                    type={isConfirmPasswordVisible ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={8}
                    onChange={(event) => onAuthConfirmPassword(event.target.value)}
                  />
                  <button
                    className="auth-password-toggle"
                    type="button"
                    aria-label={isConfirmPasswordVisible ? "Hide confirm password" : "Show confirm password"}
                    aria-pressed={isConfirmPasswordVisible}
                    onClick={() => setIsConfirmPasswordVisible((value) => !value)}
                  >
                    <EyeIcon isVisible={isConfirmPasswordVisible} />
                  </button>
                </span>
              </label>
              <div className="mobile-turnstile-panel">
                {TURNSTILE_SITE_KEY ? (
                  <>
                    <Turnstile
                      sitekey={TURNSTILE_SITE_KEY}
                      size="flexible"
                      theme="dark"
                      onVerify={(token) => {
                        onTurnstileToken(token);
                        onTurnstileMessage("");
                      }}
                      onExpire={() => {
                        onTurnstileToken("");
                        onTurnstileMessage("Verification expired. Please verify again.");
                      }}
                      onError={() => {
                        onTurnstileToken("");
                        onTurnstileMessage("Verification failed. Please try again.");
                      }}
                    />
                    {turnstileMessage && <p className="turnstile-status">{turnstileMessage}</p>}
                  </>
                ) : (
                  <p className="auth-message is-error">Add VITE_TURNSTILE_SITE_KEY to mobile-app/.env to enable account creation.</p>
                )}
              </div>
            </>
          )}
          <button className="primary-action compact-auth-submit" type="submit" disabled={!canSubmitAuth}>
            {isAuthSubmitting ? "Loading..." : authMode === "login" ? "Log In" : "Create Account"}
          </button>
          {isCreateMode && (
            <p className="auth-legal-copy">
              By creating an account, you agree to the{" "}
              <a href={LEGAL_URLS.terms}>
                Terms of Service
              </a>{" "}
              and{" "}
              <a href={LEGAL_URLS.privacy}>
                Privacy Policy
              </a>
              .
            </p>
          )}
          <button className="auth-switch-link" type="button" onClick={() => onAuthMode(isCreateMode ? "login" : "signup")}>
            {isCreateMode ? "Already have an account? Log in" : "New to PackDex? Create an account"}
          </button>
          {authMessage && <p className="auth-message">{authMessage}</p>}
        </form>
      </section>
    </div>
  );
}

function TabIcon({ icon }) {
  if (icon === "collection") {
    return (
      <span className="mobile-icon mobile-icon-book" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (icon === "open") {
    return (
      <span className="mobile-icon mobile-icon-pack" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (icon === "scanner") {
    return (
      <span className="mobile-icon mobile-icon-scanner" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (icon === "explore") {
    return (
      <span className="mobile-icon mobile-icon-explore" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (icon === "value") {
    return (
      <span className="mobile-icon mobile-icon-chart" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (icon === "profile") {
    return (
      <span className="mobile-icon mobile-icon-profile" aria-hidden="true">
        <i />
        <i />
      </span>
    );
  }

  return null;
}

function MobileBrandHeader() {
  return (
    <header className="mobile-brand-header" aria-label="PackDex mobile app">
      <img src="/packdex-icon-192.png" alt="" />
      <span className="mobile-wordmark">
        <span>Pack</span>
        <span>Dex</span>
      </span>
    </header>
  );
}

function OpenSetSelector({ collection, onOpenPack }) {
  const [eraFilter, setEraFilter] = useState("All Eras");
  const orderedSets = useMemo(() => sortSetsByEra(sets), []);
  const eras = useMemo(() => ["All Eras", ...new Set(orderedSets.map((set) => set.era).filter(Boolean))], [orderedSets]);
  const visibleSets = eraFilter === "All Eras" ? orderedSets : orderedSets.filter((set) => set.era === eraFilter);
  const groupedSets = groupSetsByEra(visibleSets);

  return (
    <section className="open-set-selector">
      <div className="mobile-screen-title">
        <span>Open a Pack</span>
        <h1>Choose a set</h1>
      </div>

      <label className="mobile-filter-pill">
        <span>Era</span>
        <select value={eraFilter} onChange={(event) => setEraFilter(event.target.value)}>
          {eras.map((era) => (
            <option key={era}>{era}</option>
          ))}
        </select>
      </label>

      <div className="mobile-era-list">
        {Object.entries(groupedSets).map(([era, eraSets]) => (
          <section className="mobile-era-section" key={era}>
            <div className="mobile-era-heading">
              <h2>{era} Era</h2>
              <span>{eraSets.length === 1 ? "1 set" : `${eraSets.length} sets`}</span>
            </div>
            <div className="mobile-set-list">
              {eraSets.map((set) => {
                const progress = getSetCollectionProgress(collection, set);

                return (
                  <article className="mobile-set-row" key={set.id}>
                    <button className="mobile-set-main" type="button" onClick={() => onOpenPack(set)}>
                      <SetLogo set={set} className="mobile-set-row-logo" />
                      <div>
                        <strong>{set.name}</strong>
                        {set.isNew && <small className="mobile-set-new-badge">New</small>}
                        <span>
                          {progress.collected} / {progress.total} collected
                        </span>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function PackScreen({
  user,
  pack,
  packInstanceId,
  selectedSet,
  stage,
  revealedCount,
  packImagesReady,
  onStartReveal,
  onSkipReveal,
  onBack,
  onOpenAnother,
  onViewCollection,
  onLogin,
  onCreateAccount,
  onInspectCard,
  soundEnabled,
  newPullKeys,
  priceMap,
}) {
  if (!selectedSet || (!pack?.length && stage !== "ready" && stage !== "preloading")) return null;

  const isRevealing = stage === "revealing";
  const isSummary = stage === "summary";
  const isReady = stage === "ready";
  const isPreloading = stage === "preloading";
  const visibleCount = isSummary ? pack.length : revealedCount;
  const pullValueCoverage = isSummary
    ? getCollectionValueCoverage(
        pack.map((card) => ({ card, set: selectedSet, count: 1 })),
        priceMap
      )
    : null;
  const featuredPull = isSummary ? selectFeaturedPull(pack, selectedSet) : null;
  return (
    <section className={`pack-stage is-${stage}`}>
      {isReady ? (
        <>
          <div className="pack-ready-artwork">
            <span className="eyebrow">Pack Ready</span>
            <SetLogo set={selectedSet} className="pack-logo" />
            <div className="card-stack is-floating" aria-hidden="true">
              <div><CardBackImage /></div>
              <div><CardBackImage /></div>
              <div><CardBackImage /></div>
            </div>
          </div>
          <div className="pack-ready-actions">
            {selectedSet.id === "30th-anniversary" && <p className="anniversary-catalog-note">This preview includes currently confirmed cards. More cards will be added as they are announced.</p>}
            <AccountNotice user={user} onLogin={onLogin} onCreateAccount={onCreateAccount} />
            <div className="pack-actions">
              <button className="secondary-action" type="button" onClick={onBack}>
                Back to Sets
              </button>
              <button className="secondary-action" type="button" onClick={() => onViewCollection?.(selectedSet)}>
                View Collection
              </button>
              <button className="primary-action" type="button" onClick={onStartReveal} disabled={isPreloading}>
                Click to Open
              </button>
            </div>
          </div>
        </>
      ) : isSummary ? (
        <>
          <SetLogo set={selectedSet} className="pack-logo pack-logo-compact" />
          {pullValueCoverage?.isComplete && pullValueCoverage.totalCards > 0 && (
            <section className="value-note compact-value-note">
              <span>Estimated Pull Value</span>
              <strong>{formatUsd(pullValueCoverage.totalValue)}</strong>
            </section>
          )}
          {selectedSet.id === "30th-anniversary" && <p className="anniversary-catalog-note is-summary-note">This preview includes currently confirmed cards. More cards will be added as they are announced.</p>}
          {featuredPull?.card && <p className="pack-featured-pull"><span>Featured Pull</span><strong>{getDisplayCardName(featuredPull.card)} · {getDisplayRarity(featuredPull.card)}</strong></p>}
          <div className="pack-actions">
            <button className="secondary-action" type="button" onClick={onBack}>
              Back to Sets
            </button>
            <button className="secondary-action" type="button" onClick={() => onViewCollection?.(selectedSet)}>
              View Collection
            </button>
            <button className="primary-action" type="button" onClick={onOpenAnother}>
              Open Another
            </button>
            <SharePullButton
              cards={pack}
              setId={selectedSet.id}
              packNumber={packInstanceId}
            />
          </div>
        </>
      ) : (
        <SetLogo set={selectedSet} className="pack-logo pack-logo-compact" />
      )}

      {isRevealing && packImagesReady && <p className="pack-skip-hint">Tap anywhere to skip</p>}

      {(isRevealing || isSummary) && (
        <div
          className={`reveal-grid ${isSummary ? "is-summary-grid" : "is-reveal-grid"} count-${pack.length}`}
          aria-live="polite"
        >
          {pack.map((card, index) => {
            const isVisible = index < visibleCount;
            const isFinal = index === pack.length - 1;
            const isFeatured = isSummary && index === featuredPull?.index;
            const isHit = isFoilHit(card, selectedSet);
            const isNewPull = isSummary && newPullKeys?.has(getCardKey(card, selectedSet.id));

            return (
              <button
                className={`reveal-card ${getRarityVisualClass(card, selectedSet)} ${isVisible ? "is-revealed" : ""} ${isFinal ? "is-final" : ""} ${isFeatured ? "is-featured" : ""} ${
                  isVisible && isHit ? "is-hit" : ""
                }`}
                type="button"
                key={`${packInstanceId}-${card.id || card.name}-${index}`}
                style={{
                  "--deal-index": index,
                  "--deal-delay": `${index * CARD_DEAL_STAGGER_MS}ms`,
                  "--reveal-delay": `${getMobileRevealDelay(index, pack.length)}ms`,
                }}
                disabled={!isVisible && !isRevealing}
                onClick={(event) => {
                  event.stopPropagation();

                  if (isRevealing) {
                    onSkipReveal?.();
                    return;
                  }

                  if (isVisible) onInspectCard?.(card, selectedSet);
                }}
              >
                <span className="reveal-card-inner">
                  <span className="reveal-card-back">
                    <CardBackImage />
                  </span>
                  <span className="reveal-card-face">
                    {isNewPull && <span className="new-pull-badge">NEW</span>}
                    <CardImage
                      card={card}
                      set={selectedSet}
                      withEffects={isVisible && isFoilHit(card, selectedSet)}
                      isFinal={isFinal}
                      loading="eager"
                      fetchPriority="high"
                    />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isSummary && <AccountNotice user={user} onLogin={onLogin} onCreateAccount={onCreateAccount} />}
    </section>
  );
}

function getMobileRevealDelay(index, totalCards) {
  const baseDelay = index * CARD_FLIP_STAGGER_MS;

  return index === totalCards - 1 ? baseDelay + LAST_CARD_EXTRA_DELAY_MS : baseDelay;
}

function CollectionCards({
  collection,
  selectedSetId,
  eraFilter,
  setSearch,
  onSelectSet,
  onEraFilter,
  onSetSearch,
  onOpenPacks,
  onViewBinder,
  onInspectCard,
  onReturnFromSet,
  returnLabel,
  priceMap,
  priceStatus = "idle",
}) {
  const orderedSets = useMemo(() => sortSetsByEra(sets), []);
  const selectedSet = orderedSets.find((set) => set.id === selectedSetId) || null;
  const [isPickingSet, setIsPickingSet] = useState(!selectedSet);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogSearchStatus, setCatalogSearchStatus] = useState("idle");
  const eras = useMemo(() => ["All Eras", ...new Set(orderedSets.map((set) => set.era).filter(Boolean))], [orderedSets]);
  const visibleSets = orderedSets.filter((set) => {
    const matchesEra = eraFilter === "All Eras" || set.era === eraFilter;
    return matchesEra;
  });
  const progress = selectedSet ? getSetCollectionProgress(collection, selectedSet) : { collected: 0, total: 0, percent: 0 };
  const setCards = selectedSet ? getPullableCollectionCards(selectedSet).sort((a, b) => getSetNumber(a) - getSetNumber(b)) : [];
  const setValueLoading = Boolean(selectedSet && priceStatus === "loading");
  const setValueCoverage = selectedSet ? getCollectionValueCoverage(setCards.map((card) => ({ card, set: selectedSet })), priceMap) : null;

  useEffect(() => {
    if (!selectedSet) setIsPickingSet(true);
  }, [selectedSet]);

  useEffect(() => {
    const query = catalogQuery.trim();
    if (!query) {
      setCatalogResults([]);
      setCatalogSearchStatus("idle");
      return undefined;
    }
    let current = true;
    setCatalogSearchStatus("loading");
    const timer = window.setTimeout(() => {
      import("./explore/exploreData.js")
        .then(({ searchCollectionCatalog }) => {
          if (!current) return;
          setCatalogResults(searchCollectionCatalog(query));
          setCatalogSearchStatus("ready");
        })
        .catch(() => {
          if (!current) return;
          setCatalogResults([]);
          setCatalogSearchStatus("error");
        });
    }, 120);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [catalogQuery]);

  if (isPickingSet) {
    return (
      <section className="set-progress-mobile">
        <section className="collection-toolbar set-picker-panel set-picker-page">
          <div className="section-heading">
            <h2>{selectedSet ? "Change Set" : "All Sets"}</h2>
            {selectedSet && (
              <button className="text-action compact-text-action" type="button" onClick={() => setIsPickingSet(false)}>
                Back
              </button>
            )}
          </div>
          <section className="collection-catalog-search" aria-labelledby="collection-catalog-search-title">
            <div>
              <h3 id="collection-catalog-search-title" className="sr-only">Search the card catalog</h3>
            </div>
            <label className="mobile-search collection-card-search">
              <span className="sr-only">Search cards</span>
              <input
                value={catalogQuery}
                type="search"
                placeholder="Search cards, sets, or collector numbers"
                inputMode="search"
                onChange={(event) => setCatalogQuery(event.target.value)}
                aria-describedby="collection-search-status"
              />
            </label>
            <div id="collection-search-status" className="collection-search-status" role="status" aria-live="polite">
              {catalogSearchStatus === "loading" && "Searching the catalog…"}
              {catalogSearchStatus === "error" && "Catalog search is temporarily unavailable."}
              {catalogSearchStatus === "ready" && `${catalogResults.length}${catalogResults.length === 80 ? "+" : ""} result${catalogResults.length === 1 ? "" : "s"}`}
            </div>
            {catalogSearchStatus === "ready" && catalogResults.length === 0 && (
              <div className="collection-search-empty"><strong>No matching cards</strong><span>Try a shorter name or remove punctuation.</span></div>
            )}
            {catalogResults.length > 0 && (
              <div className="collection-catalog-results">
                {catalogResults.map((entry) => {
                  const owned = getCardCount(collection, entry.card, entry.set.id);
                  return (
                    <button
                      className={`collection-catalog-result ${owned ? "is-owned" : "is-missing"}`}
                      type="button"
                      key={`${entry.set.id}:${entry.card.id}`}
                      onClick={() => onInspectCard?.(entry.card, entry.set)}
                      aria-label={`${entry.card.name}, ${entry.set.name}, ${owned ? `owned quantity ${owned}` : "missing"}`}
                    >
                      <CardImage card={entry.card} set={entry.set} ownedShimmer={owned > 0} />
                      <span>
                        <strong>{getDisplayCardName(entry.card, entry.set)}</strong>
                        <small>{entry.set.name} · #{entry.card.number || getSetNumber(entry.card)}</small>
                        <em>{entry.category} · {entry.card.rarity || "Rarity unavailable"} · {owned ? `Owned ×${owned}` : "Missing"}</em>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <label className="mobile-filter-pill set-picker-era">
            <span>Era</span>
            <select value={eraFilter} onChange={(event) => onEraFilter(event.target.value)}>
              {eras.map((era) => (
                <option key={era}>{era}</option>
              ))}
            </select>
          </label>
          <div className="section-heading collection-latest-heading"><h2>Latest Sets</h2></div>
          <div className="set-picker-list set-picker-list-full">
            {visibleSets.map((set) => {
              const setProgress = getSetCollectionProgress(collection, set);

              return (
                <button
                  className={`set-picker-row ${selectedSet?.id === set.id ? "is-active" : ""}`}
                  type="button"
                  key={set.id}
                  onClick={() => {
                    onSelectSet(set);
                    setIsPickingSet(false);
                  }}
                >
                  <SetLogo set={set} className="set-picker-logo" />
                  <span>
                    <strong>{set.name}</strong>
                    {set.isNew && <small className="mobile-set-new-badge">New</small>}
                    <em>
                      {setProgress.collected} / {setProgress.total} collected
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="set-progress-mobile">
      {selectedSet && (
        <section className="set-detail-mobile">
          <div className="set-detail-topline">
            <span className="eyebrow">Set Progress</span>
            <button className="text-action compact-text-action" type="button" onClick={() => setIsPickingSet(true)}>
              Change Set
            </button>
          </div>
          <SetLogo set={selectedSet} className="set-detail-logo" />
          <h2>{selectedSet.name}</h2>
          <div className="set-progress-card">
            <div>
              <strong>
                {progress.collected} / {progress.total}
              </strong>
              <span>{progress.percent}% complete</span>
            </div>
            <div className="set-progress-bar" aria-hidden="true">
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            {setValueLoading ? <p className="value-inline"><span>Set Value</span><strong>Loading...</strong></p> : setValueCoverage?.pricedCards > 0 && (
              <p className="value-inline">
                <span>{setValueCoverage.isComplete ? "Estimated Set Value" : "Known Set Value"}</span>
                <strong>{formatUsd(setValueCoverage.totalValue)}</strong>
                {!setValueCoverage.isComplete && <small>Based on {setValueCoverage.pricedCards} of {setValueCoverage.totalCards} priced cards.</small>}
              </p>
            )}
          </div>
          {selectedSet.id === "30th-anniversary" && (
            <p className="set-preview-note">New card images will be added as they are released.</p>
          )}
          <div className="set-detail-actions">
            <button className={returnLabel === "Back to Open Packs" ? "primary-action" : "secondary-action"} type="button" onClick={() => (onReturnFromSet ? onReturnFromSet(selectedSet) : onSelectSet(null))}>
              {returnLabel || "Back to Collection"}
            </button>
            {returnLabel !== "Back to Open Packs" && (
              <button className="primary-action" type="button" onClick={() => onOpenPacks(selectedSet)}>
                Open Packs
              </button>
            )}
            <button className="secondary-action" type="button" onClick={() => onViewBinder(selectedSet)}>
              View Binder
            </button>
          </div>
          <section className="set-card-grid-mobile">
            {setCards.map((card) => {
              const count = getCardCount(collection, card, selectedSet.id);
              const isCollected = count > 0;

              return (
                <button
                  className={`set-card-slot ${isCollected ? "is-collected" : "is-missing"}`}
                  type="button"
                  key={`${selectedSet.id}-${card.id}`}
                  onClick={() => onInspectCard?.(card, selectedSet)}
                >
                  <CardImage card={card} set={selectedSet} ownedShimmer={isCollected} />
                  {!isCollected && <span className="missing-badge">Missing</span>}
                  <strong>{getDisplayCardName(card, selectedSet)}</strong>
                  <em>#{card.number || getSetNumber(card)} - {getDisplayRarity(card, selectedSet)}</em>
                </button>
              );
            })}
          </section>
        </section>
      )}
    </section>
  );
}

function getBinderSlots(binder) {
  const set = binder.setId ? sets.find((candidate) => candidate.id === binder.setId) : null;
  const masterCards = set ? getPullableCollectionCards(set).map((card) => ({ set, card })) : [];
  const customCards = !set
    ? binder.cards.map((item) => {
        const itemSet = sets.find((candidate) => candidate.id === item.setId);
        const card = itemSet?.cards?.find((candidate) => String(candidate.id) === String(item.cardId) || String(candidate.number) === String(item.cardNumber));

        return { set: itemSet, card };
      })
    : [];

  return set ? masterCards : customCards;
}

function BinderPageView({ binder, collection, onBack, onInspectCard }) {
  const [pageIndex, setPageIndex] = useState(0);
  const slots = getBinderSlots(binder);
  const totalPages = Math.max(1, Math.ceil(slots.length / 9));
  const pageSlots = slots.slice(pageIndex * 9, pageIndex * 9 + 9);

  return (
    <section className="binder-reader-mobile">
      <div className="binder-reader-heading">
        <div>
          <span className="eyebrow">Binder</span>
          <h2>{binder.name}</h2>
          <p>
            Page {pageIndex + 1} of {totalPages}
          </p>
        </div>
        <button className="secondary-action" type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="binder-page-preview binder-page-reader">
        {slots.length === 0 && (
          <div className="binder-reader-empty" role="status">
            <strong>This binder has no available cards.</strong>
            <span>{binder.setId ? "The linked set is unavailable. Return to My Binders and choose another set." : "Add cards to this binder, or import a master set."}</span>
          </div>
        )}
        {Array.from({ length: 9 }).map((_, index) => {
          const item = pageSlots[index];
          const quantity = item?.set && item?.card ? getCardCount(collection, item.card, item.set.id) : 0;
          const collected = quantity > 0;

          return (
            <button
              className={`binder-pocket ${item?.card && collected ? "is-filled" : ""}`}
              type="button"
              key={index}
              onClick={() => item?.card && onInspectCard?.(item.card, item.set)}
              disabled={!item?.card}
            >
              {item?.card && collected ? <><CardImage card={item.card} set={item.set} ownedShimmer /><span className="binder-pocket-quantity">×{quantity}</span></> : <span>{item?.card ? "Missing" : "+"}</span>}
            </button>
          );
        })}
      </div>
      <div className="binder-page-controls">
        <button className="secondary-action" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>
          Previous
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={pageIndex >= totalPages - 1}
          onClick={() => setPageIndex((value) => Math.min(totalPages - 1, value + 1))}
        >
          Next
        </button>
      </div>
    </section>
  );
}

const MOBILE_BINDER_THEME_OPTIONS = [
  { id: "midnight", label: "Midnight", value: "#25245a" },
  { id: "royal", label: "Royal", value: "#3439a5" },
  { id: "violet", label: "Violet", value: "#6425d6" },
  { id: "forest", label: "Forest", value: "#1d6548" },
  { id: "crimson", label: "Crimson", value: "#8a2539" },
  { id: "gold", label: "Gold", value: "#846f20" },
];

function BinderThemePicker({ value, onChange }) {
  return (
    <div className="binder-theme-picker" aria-label="Binder color">
      {MOBILE_BINDER_THEME_OPTIONS.map((theme) => (
        <button
          className={value === theme.id ? "is-active" : ""}
          key={theme.id}
          type="button"
          style={{ "--swatch": theme.value }}
          onClick={() => onChange(theme.id)}
          aria-label={theme.label}
          aria-pressed={value === theme.id}
        >
          <span />
        </button>
      ))}
    </div>
  );
}

function CollectionBinders({ collection, binders, onImportMasterSet, onCreateBinder, onInspectCard }) {
  const [openBinderId, setOpenBinderId] = useState("");
  const [activeModal, setActiveModal] = useState("");
  const [customBinderName, setCustomBinderName] = useState("");
  const [customBinderTheme, setCustomBinderTheme] = useState("midnight");
  const eligibleSets = sets.filter((set) => !binders.some((binder) => binder.id === "master-set-" + set.id));
  const [importSetId, setImportSetId] = useState(eligibleSets[0]?.id || "");
  const selectedImportSet = eligibleSets.find((set) => set.id === importSetId) || eligibleSets[0] || null;
  const [importBinderName, setImportBinderName] = useState(selectedImportSet ? selectedImportSet.name + " Master Set" : "");
  const [importBinderTheme, setImportBinderTheme] = useState("midnight");
  const openBinder = binders.find((binder) => binder.id === openBinderId);

  useEffect(() => {
    if (!selectedImportSet) return;
    setImportBinderName((current) => current.trim() || selectedImportSet.name + " Master Set");
  }, [selectedImportSet?.id]);

  function openCreateModal() {
    setCustomBinderName("");
    setCustomBinderTheme("midnight");
    setActiveModal("create");
  }

  function openImportModal() {
    const nextSet = selectedImportSet || eligibleSets[0] || null;
    setImportSetId(nextSet?.id || "");
    setImportBinderName(nextSet ? nextSet.name + " Master Set" : "");
    setImportBinderTheme("midnight");
    setActiveModal("import");
  }

  function handleCreateBinder(event) {
    event.preventDefault();
    const name = customBinderName.trim();
    if (!name) return;
    onCreateBinder?.(name, customBinderTheme);
    setCustomBinderName("");
    setActiveModal("");
  }

  function handleImportBinder(event) {
    event.preventDefault();
    if (!selectedImportSet) return;
    const name = importBinderName.trim() || selectedImportSet.name + " Master Set";
    onImportMasterSet?.(selectedImportSet, name, importBinderTheme);
    setActiveModal("");
  }

  if (openBinder) {
    return <BinderPageView binder={openBinder} collection={collection} onBack={() => setOpenBinderId("")} onInspectCard={onInspectCard} />;
  }

  return (
    <>
      <section className={"binder-actions " + (binders.length === 0 ? "is-empty" : "")}>
        <div className="binder-actions-heading">
          <div>
            <span className="eyebrow">My Binders</span>
            <h2>{binders.length} binders</h2>
          </div>
          {binders.length > 0 && (
            <div className="binder-quick-actions">
              <button className="secondary-action" type="button" onClick={openCreateModal}>+ Create</button>
              <button className="secondary-action" type="button" onClick={openImportModal} disabled={eligibleSets.length === 0}>Import</button>
            </div>
          )}
        </div>

        {binders.length === 0 && (
          <div className="binder-empty-state">
            <strong>No binders yet.</strong>
            <p>Create a binder or import a master set to get started.</p>
            <button className="primary-action" type="button" onClick={openCreateModal}>Create Binder</button>
            <button className="inline-auth-link" type="button" onClick={openImportModal} disabled={eligibleSets.length === 0}>Import Master Set</button>
          </div>
        )}
      </section>

      {binders.length > 0 && (
        <section className="binder-list-mobile">
          {binders.map((binder) => {
            const set = binder.setId ? sets.find((candidate) => candidate.id === binder.setId) : null;
            const progress = set ? getSetCollectionProgress(collection, set) : null;

            return (
              <article className={"binder-card-mobile is-" + (binder.theme || "midnight")} key={binder.id}>
                <div className="binder-spine" aria-hidden="true"><span /><span /><span /></div>
                <div className="binder-card-body">
                  <div className="binder-cover-logo">
                    {set ? <SetLogo set={set} className="binder-logo" /> : <span>{binder.name?.slice(0, 2) || "PD"}</span>}
                  </div>
                  <strong>{binder.name}</strong>
                  <em>{binder.tag}</em>
                  <small>{set ? progress.collected + "/" + progress.total + " cards" : (binder.cards?.length || 0) + " cards"}</small>
                  <button className="secondary-action" type="button" onClick={() => setOpenBinderId(binder.id)}>
                    Open Binder
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {activeModal === "create" && (
        <div className="mobile-auth-overlay binder-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-binder-title" onClick={() => setActiveModal("")}>
          <section className="mobile-auth-modal binder-sheet" onClick={(event) => event.stopPropagation()}>
            <button className="mobile-auth-close" type="button" onClick={() => setActiveModal("")} aria-label="Close create binder"><CloseIcon /></button>
            <div className="mobile-auth-heading"><span className="eyebrow">My Binders</span><h2 id="create-binder-title">Create Binder</h2></div>
            <form className="custom-binder-form" onSubmit={handleCreateBinder}>
              <label><span>Binder name</span><input type="text" value={customBinderName} onChange={(event) => setCustomBinderName(event.target.value)} placeholder="Binder name" maxLength={48} autoFocus /></label>
              <label><span>Color</span><BinderThemePicker value={customBinderTheme} onChange={setCustomBinderTheme} /></label>
              <button className="primary-action" type="submit" disabled={!customBinderName.trim()}>Create Binder</button>
            </form>
          </section>
        </div>
      )}

      {activeModal === "import" && (
        <div className="mobile-auth-overlay binder-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="import-binder-title" onClick={() => setActiveModal("")}>
          <section className="mobile-auth-modal binder-sheet" onClick={(event) => event.stopPropagation()}>
            <button className="mobile-auth-close" type="button" onClick={() => setActiveModal("")} aria-label="Close import binder"><CloseIcon /></button>
            <div className="mobile-auth-heading"><span className="eyebrow">My Binders</span><h2 id="import-binder-title">Import Master Set</h2></div>
            <form className="custom-binder-form" onSubmit={handleImportBinder}>
              <div className="binder-set-choice-list" aria-label="Eligible master sets">
                {eligibleSets.map((set) => (
                  <button className={set.id === selectedImportSet?.id ? "is-active" : ""} key={set.id} type="button" onClick={() => { setImportSetId(set.id); setImportBinderName(set.name + " Master Set"); }}>
                    <SetLogo set={set} className="binder-set-choice-logo" />
                    <span>{set.name}</span>
                  </button>
                ))}
              </div>
              <label><span>Binder name</span><input type="text" value={importBinderName} onChange={(event) => setImportBinderName(event.target.value)} placeholder="Binder name" maxLength={64} /></label>
              <label><span>Color</span><BinderThemePicker value={importBinderTheme} onChange={setImportBinderTheme} /></label>
              <button className="primary-action" type="submit" disabled={!selectedImportSet}>Import Binder</button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function CollectionScreen({
  collection,
  binders,
  selectedSetId,
  collectionEraFilter,
  collectionSetSearch,
  onSelectSet,
  onCollectionEraFilter,
  onCollectionSetSearch,
  onOpenPacks,
  onImportMasterSet,
  onCreateBinder,
  onInspectCard,
  onReturnFromSet,
  returnLabel,
  priceMap,
  priceStatus,
  valueScreenProps,
}) {
  const [collectionTab, setCollectionTab] = useState("cards");
  const isSetDetailOpen = Boolean(selectedSetId);

  function showSetList() {
    onSelectSet(null);
    setCollectionTab("cards");
  }

  return (
    <section className="collection-screen-mobile">
      <div className="mobile-screen-title">
        <span>Collection</span>
        <h1>{collectionTab === "cards" ? "Set Collection" : collectionTab === "binders" ? "My Binders" : "Collection Value"}</h1>
      </div>

      <div className="collection-subtabs-mobile">
        <button
          className={[
            collectionTab === "cards" && !isSetDetailOpen ? "is-active" : "",
            collectionTab === "cards" && isSetDetailOpen ? "is-back-action" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          onClick={() => {
            if (isSetDetailOpen) showSetList();
            else setCollectionTab("cards");
          }}
        >
          {isSetDetailOpen ? "All Sets" : "Set Collection"}
        </button>
        <button className={collectionTab === "binders" ? "is-active" : ""} type="button" onClick={() => { onSelectSet(null); setCollectionTab("binders"); }}>
          Binders
        </button>
        <button className={collectionTab === "value" ? "is-active" : ""} type="button" onClick={() => { onSelectSet(null); setCollectionTab("value"); }}>
          Value
        </button>
      </div>

      {collectionTab === "cards" ? (
        <CollectionCards
          collection={collection}
          selectedSetId={selectedSetId}
          eraFilter={collectionEraFilter}
          setSearch={collectionSetSearch}
          onSelectSet={onSelectSet}
          onEraFilter={onCollectionEraFilter}
          onSetSearch={onCollectionSetSearch}
          onOpenPacks={onOpenPacks}
          onViewBinder={(set) => {
            onImportMasterSet(set);
            setCollectionTab("binders");
          }}
          onInspectCard={onInspectCard}
          onReturnFromSet={onReturnFromSet}
          returnLabel={returnLabel}
          priceMap={priceMap}
          priceStatus={priceStatus}
        />
      ) : collectionTab === "binders" ? (
        <CollectionBinders collection={collection} binders={binders} onImportMasterSet={onImportMasterSet} onCreateBinder={onCreateBinder} onInspectCard={onInspectCard} />
      ) : (
        <ValueScreen {...valueScreenProps} />
      )}
    </section>
  );
}

function CardInspectModal({ item, collection, user, wishlistKeys, wishlistPendingKeys, wishlistMessage, onToggleWishlist, onLogin, onClose, priceMap, onLoadSpecies, onViewPokemon, onViewSet, onViewEra }) {
  const [tiltStyle, setTiltStyle] = useState({});
  const [isInspectTilting, setIsInspectTilting] = useState(false);
  const [linkedSpecies, setLinkedSpecies] = useState([]);
  const activeInspectPointerRef = useRef(null);
  const pendingInspectTiltRef = useRef(null);
  const inspectTiltRafRef = useRef(null);

  useEffect(() => {
    let current = true;
    if (!item?.card || !item?.set || !onLoadSpecies) {
      setLinkedSpecies([]);
      return undefined;
    }
    onLoadSpecies(item.card, item.set).then((species) => { if (current) setLinkedSpecies(species || []); }).catch(() => { if (current) setLinkedSpecies([]); });
    return () => { current = false; };
  }, [item?.card, item?.set, onLoadSpecies]);

  if (!item?.card || !item?.set) return null;

  const { card, set } = item;
  const marketPrice = getCardDisplayPrice(card, priceMap, set.id);
  const hasMarketPrice = Number(marketPrice?.marketPriceUsd) > 0;
  const tcgplayerCardUrl = getTcgplayerCardUrl({
    exactUrl: marketPrice?.tcgplayerUrl,
    cardName: getDisplayCardName(card, set),
    setName: set.name,
    cardNumber: card.number,
  });
  const ownedCount = getCardCount(collection, card, set.id);
  const wishlistKey = getWishlistKey(set.id, card.id);
  const isWishlisted = wishlistKeys.has(wishlistKey);
  const isWishlistPending = wishlistPendingKeys.has(wishlistKey);
  const inspectOrigin = item.context?.origin || item.origin || "direct";
  const actionVisibility = getCardDetailActionVisibility(inspectOrigin, {
    hasPokemon: linkedSpecies.length > 0,
    hasSet: Boolean(set.id),
    hasEra: Boolean(set.era),
  });
  const contextualActions = [
    ...(actionVisibility.pokemon ? linkedSpecies.map((species) => <button key={`pokemon:${species.id}`} className="secondary-action" type="button" onClick={() => onViewPokemon?.(species.id)}>View {linkedSpecies.length > 1 ? species.displayName : "Pokémon"}</button>) : []),
    actionVisibility.set ? <button key="set" className="secondary-action" type="button" onClick={() => onViewSet?.(set.id)}>View Set</button> : null,
    actionVisibility.era ? <button key="era" className="secondary-action" type="button" onClick={() => onViewEra?.(set.era)}>View Era</button> : null,
  ].filter(Boolean);

  function getInspectTilt(event, target) {
    const rect = target.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    const tilt = Math.min(1, Math.hypot(nx, ny));

    return {
      transform: `translate3d(${(nx * 3).toFixed(2)}px, ${(ny * 3).toFixed(2)}px, 0) rotateX(${(ny * -8).toFixed(
        2
      )}deg) rotateY(${(nx * 10).toFixed(2)}deg) scale(1.025)`,
      "--foil-angle": `${(115 + nx * 24 - ny * 12).toFixed(2)}deg`,
      "--foil-shift-x": `${(50 + nx * 18).toFixed(2)}%`,
      "--foil-shift-y": `${(50 + ny * 12).toFixed(2)}%`,
      "--shine-opacity": (0.18 + tilt * 0.18).toFixed(3),
    };
  }

  function scheduleInspectTilt(nextStyle) {
    pendingInspectTiltRef.current = nextStyle;

    if (inspectTiltRafRef.current) return;

    inspectTiltRafRef.current = window.requestAnimationFrame(() => {
      inspectTiltRafRef.current = null;
      setTiltStyle(pendingInspectTiltRef.current || {});
    });
  }

  function startTilt(event) {
    activeInspectPointerRef.current = event.pointerId;
    setIsInspectTilting(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (event.pointerType === "touch" || event.pointerType === "pen") event.preventDefault();
    scheduleInspectTilt(getInspectTilt(event, event.currentTarget));
  }

  function updateTilt(event) {
    const isTouchPointer = event.pointerType === "touch" || event.pointerType === "pen";
    const isMousePointer = event.pointerType === "mouse";
    const hasActivePointer = activeInspectPointerRef.current === event.pointerId;

    if (isTouchPointer && !hasActivePointer) return;
    if (!isTouchPointer && !isMousePointer && !hasActivePointer) return;
    if (isTouchPointer && hasActivePointer) event.preventDefault();

    scheduleInspectTilt(getInspectTilt(event, event.currentTarget));
  }

  function resetTilt(event) {
    if (inspectTiltRafRef.current) {
      window.cancelAnimationFrame(inspectTiltRafRef.current);
      inspectTiltRafRef.current = null;
    }

    if (event?.pointerId != null && activeInspectPointerRef.current === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    activeInspectPointerRef.current = null;
    pendingInspectTiltRef.current = null;
    setIsInspectTilting(false);
    setTiltStyle({});
  }

  return (
    <div className="inspect-backdrop" role="presentation" onClick={onClose}>
      <section className="inspect-modal" role="dialog" aria-modal="true" aria-label={getDisplayCardName(card, set)} onClick={(event) => event.stopPropagation()}>
        <button className="inspect-close" type="button" onClick={onClose} aria-label="Close card details">
          <CloseIcon />
        </button>
        <div
          className={`inspect-tilt-frame ${isInspectTilting ? "is-tilting" : ""}`}
          style={tiltStyle}
          onPointerDown={startTilt}
          onPointerMove={updateTilt}
          onPointerEnter={updateTilt}
          onPointerUp={resetTilt}
          onPointerCancel={resetTilt}
          onPointerLeave={resetTilt}
          onLostPointerCapture={resetTilt}
        >
          <CardImage card={card} set={set} className="inspect-card-image" withEffects={isFoilHit(card, set)} isFinal />
        </div>
        <div className="inspect-card-copy">
          <span>{set.name}</span>
          <h2>{getDisplayCardName(card, set)}</h2>
          <p>{getDisplayRarity(card, set)}</p>
          <p>{ownedCount > 0 ? `Owned in PackDex x${ownedCount}` : "Not owned in your PackDex collection"}</p>
          {ownedCount === 0 && (
            <button
              className="secondary-action inspect-wishlist-action"
              type="button"
              disabled={isWishlistPending}
              onClick={() => user ? onToggleWishlist?.(set, card) : onLogin?.()}
            >
              {isWishlistPending ? "Saving..." : isWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
            </button>
          )}
          {ownedCount === 0 && wishlistMessage?.key === wishlistKey && <p className={`wishlist-inline-message ${wishlistMessage.isError ? "is-error" : ""}`}>{wishlistMessage.text}</p>}
          {hasMarketPrice && <p className="market-price-line">
            Estimated Market Value: <strong>{formatUsd(marketPrice.marketPriceUsd)}</strong>
            <TcgplayerSourceBadge compact />
          </p>}
          {tcgplayerCardUrl && (
            <a className="tcgplayer-card-link" href={tcgplayerCardUrl} target="_blank" rel="noopener noreferrer">
              View on TCGplayer
            </a>
          )}
          {contextualActions.length > 0 && <div className={`inspect-explore-links ${getCardActionLayoutClass(contextualActions.length)}`}>{contextualActions}</div>}
        </div>
      </section>
    </div>
  );
}

function ValueScreen({
  user,
  collection,
  priceMapsBySet,
  estimatedCollectionValue,
  isValueLoading,
  onInspectCard,
  onOpenLogin,
  onOpenSignup,
}) {
  const isLoggedIn = Boolean(user);
  const ownedCards = isLoggedIn ? getOwnedCards(collection) : [];
  const valuedCards = ownedCards
    .map((item) => ({
      ...item,
      price: getCardDisplayPrice(item.card, priceMapsBySet?.[item.set.id], item.set.id),
    }))
    .filter((item) => Number(item.price?.marketPriceUsd) > 0)
    .map((item) => ({ ...item, unitValue: Number(item.price.marketPriceUsd), value: Number(item.price.marketPriceUsd) * item.count }))
    .sort((a, b) => b.value - a.value);
  const valueCoverage = getCollectionValueCoverage(ownedCards, priceMapsBySet);

  if (!isLoggedIn) {
    return (
      <section className="value-screen-mobile">
        <div className="mobile-screen-title">
          <span>Value</span>
          <h1>Collection Snapshot</h1>
        </div>
        <section className="value-hero">
          <span className="eyebrow">Estimated Virtual Collection Value</span>
          <strong>Sign in to see account value</strong>
          <p>
            Collection value is tied to your PackDex account. Sign in or create an account to see your stats.
          </p>
          <div className="value-auth-actions">
            <button className="primary-action compact-auth-submit" type="button" onClick={onOpenLogin}>
              Sign in
            </button>
            <button className="inline-auth-link" type="button" onClick={onOpenSignup}>
              Create account
            </button>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="value-screen-mobile">
      <div className="mobile-screen-title">
        <span>Value</span>
        <h1>Collection Snapshot</h1>
      </div>
      <section className="value-hero">
        <span className="eyebrow">{valueCoverage.isComplete ? "Estimated Virtual Collection Value" : "Known Value"}</span>
        {isValueLoading ? <strong>Loading...</strong> : <strong>{formatUsd(valueCoverage.totalValue)}</strong>}
        {!isValueLoading && valueCoverage.totalCards === 0 && <p>No owned cards yet.</p>}
        {!isValueLoading && valueCoverage.totalCards > 0 && <p>Based on {valueCoverage.pricedCards} of {valueCoverage.totalCards} priced cards.</p>}
        {valueCoverage.pricedCards > 0 && <TcgplayerSourceBadge />}
      </section>

      <section className="quick-stats">
        <article className="stat-card">
          <span>Virtual Cards</span>
          <strong>{ownedCards.length}</strong>
          <em>Unique cards</em>
        </article>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <h2>Top Estimated Cards</h2>
        </div>
        <div className="value-list">
          {valuedCards.slice(0, 10).map(({ set, card, value, unitValue, count }) => (
            <button className="value-row" type="button" key={`${set.id}-${card.id}`} onClick={() => onInspectCard?.(card, set)}>
              <CardImage card={card} set={set} />
              <strong>
                {getDisplayCardName(card, set)}
                {count > 1 ? ` x${count}` : ""}
              </strong>
              <em>{formatUsd(value)}</em>
              <small>{set.name} - {formatUsd(unitValue)} each</small>
            </button>
          ))}
          {valuedCards.length === 0 && <p className="section-copy">Open simulated packs to populate this future collector dashboard.</p>}
        </div>
      </section>
    </section>
  );
}

function WishlistScreen({ entries, status, error, pendingKeys, onRetry, onBack, onOpenSet, onInspectCard, onRemove }) {
  const resolvedGroups = useMemo(() => {
    const bySet = new Map();
    entries.forEach((entry) => {
      const resolved = resolveCatalogWishlistItem(entry.setId, entry.cardId);
      if (!resolved) return;
      const current = bySet.get(resolved.set.id) || { set: resolved.set, cards: [] };
      if (!current.cards.some((card) => String(card.id) === String(resolved.card.id))) current.cards.push(resolved.card);
      bySet.set(resolved.set.id, current);
    });
    const order = new Map(sortSetsByEra(sets).map((set, index) => [set.id, index]));
    return [...bySet.values()]
      .sort((a, b) => (order.get(a.set.id) ?? 9999) - (order.get(b.set.id) ?? 9999))
      .map((group) => ({ ...group, cards: group.cards.sort((a, b) => getSetNumber(a) - getSetNumber(b)) }));
  }, [entries]);

  return (
    <section className="wishlist-screen-mobile">
      <div className="mobile-screen-title wishlist-title-row">
        <div><span>Profile</span><h1>Wishlist</h1></div>
        <button className="secondary-action" type="button" onClick={onBack}>Back</button>
      </div>
      {status === "loading" && <section className="wishlist-state"><p>Loading wishlist...</p></section>}
      {status === "error" && <section className="wishlist-state"><p>{error || "Unable to load your wishlist."}</p><button className="primary-action" type="button" onClick={onRetry}>Retry</button></section>}
      {status === "ready" && resolvedGroups.length === 0 && <section className="wishlist-state"><h2>Your wishlist is empty</h2><p>Add missing cards from a set Collection page.</p></section>}
      {status === "ready" && resolvedGroups.map(({ set, cards }) => (
        <section className="wishlist-set-group" key={set.id}>
          <div className="wishlist-set-heading">
            <div className="wishlist-set-identity"><SetLogo set={set} className="wishlist-set-logo" /><span className="wishlist-set-copy"><strong>{set.name}</strong><small>{cards.length} card{cards.length === 1 ? "" : "s"}</small></span></div>
            <button className="wishlist-open-collection" type="button" onClick={() => onOpenSet(set)}>Open Collection</button>
          </div>
          <div className="set-card-grid-mobile wishlist-card-grid">
            {cards.map((card) => {
              const key = getWishlistKey(set.id, card.id);
              return <article className="wishlist-card" key={key}>
                <button className="set-card-slot is-missing" type="button" onClick={() => onInspectCard(card, set)}>
                  <CardImage card={card} set={set} />
                  <strong>{getDisplayCardName(card, set)}</strong><em>#{card.number || getSetNumber(card)}</em>
                </button>
                <button className="wishlist-remove" type="button" disabled={pendingKeys.has(key)} onClick={() => onRemove(set, card)} aria-label={`Remove ${getDisplayCardName(card, set)} from wishlist`}>
                  {pendingKeys.has(key) ? "Saving..." : "Remove"}
                </button>
              </article>;
            })}
          </div>
        </section>
      ))}
    </section>
  );
}

function SettingsModal({
  isOpen,
  user,
  soundEnabled,
  hapticsEnabled,
  onClose,
  onLogout,
  onDeleteAccount,
  onToggleSound,
  onToggleHaptics,
  scannerTestEnabled = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="mobile-auth-overlay settings-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-settings-title" onClick={onClose}>
      <section className="mobile-auth-modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <button className="mobile-auth-close" type="button" onClick={onClose} aria-label="Close settings">
          <CloseIcon />
        </button>
        <div className="mobile-auth-heading">
          <span className="eyebrow">Profile</span>
          <h2 id="mobile-settings-title">Settings</h2>
        </div>

        {user && (
          <section className="settings-section">
            <span className="eyebrow">Account</span>
            <p className="settings-email">{user.email}</p>
            <button className="settings-danger" type="button" onClick={onLogout}>
              Log Out
            </button>
            <button className="settings-danger settings-delete-account" type="button" onClick={onDeleteAccount}>
              Delete Account
            </button>
          </section>
        )}

        <section className="settings-section">
          <span className="eyebrow">Preferences</span>
          <button className="settings-toggle" type="button" onClick={onToggleSound} aria-pressed={soundEnabled}>
            <span>
              <strong>Sound Effects</strong>
              <em>{soundEnabled ? "Enabled" : "Muted"}</em>
            </span>
            <i className={soundEnabled ? "is-on" : ""} />
          </button>
          <button className="settings-toggle" type="button" onClick={onToggleHaptics} aria-pressed={hapticsEnabled}>
            <span><strong>Haptics</strong><em>{hapticsEnabled ? "Enabled" : "Disabled"}</em></span>
            <i className={hapticsEnabled ? "is-on" : ""} />
          </button>
        </section>

        {__PACKDEX_SCANNER_TEST__ && scannerTestEnabled && <section className="settings-section"><span className="eyebrow">Development</span><button className="settings-link" type="button" onClick={() => window.location.assign("/?scanner-test=1")}>Scanner Test</button></section>}

        <section className="settings-section settings-contact-section">
          <span className="eyebrow">Support</span>
          <span className="settings-support-label">Support email</span>
          <a className="settings-link settings-email-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </section>

        <section className="settings-section">
          <span className="eyebrow">Legal</span>
          <a className="settings-link" href={LEGAL_URLS.terms}>
            Terms of Service
          </a>
          <a className="settings-link" href={LEGAL_URLS.privacy}>
            Privacy Policy
          </a>
          <button className="settings-link" type="button" onClick={(event) => openPrivacyChoices(event.currentTarget)}>
            Privacy Choices
          </button>
        </section>
      </section>
    </div>
  );
}

function ProfileScreen({
  user,
  stats,
  setsCompleted,
  isAuthPanelOpen,
  onOpenLogin,
  onOpenSignup,
  onLogout,
  onDeleteAccount,
  soundEnabled,
  onToggleSound,
  hapticsEnabled,
  onToggleHaptics,
  wishlistCount,
  onOpenWishlist,
  estimatedCollectionValue,
  isValueLoading,
  achievements = [],
  achievementProgress = [],
  isAchievementsLoading = false,
  welcomeRewardStatus,
  onOpenWelcomeReward,
  onLoadAchievementProgress,
}) {
  const isLoggedIn = Boolean(user);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAchievementsOpen, setIsAchievementsOpen] = useState(false);
  const earnedAchievementMap = useMemo(() => new Map(achievements.map((achievement) => [achievement.achievementId, achievement])), [achievements]);
  const earnedAchievementIds = useMemo(() => new Set(earnedAchievementMap.keys()), [earnedAchievementMap]);
  const achievementProgressMap = useMemo(() => new Map(achievementProgress.map((progress) => [progress.achievementId, progress])), [achievementProgress]);
  const publicAchievements = useMemo(() => MOBILE_ACHIEVEMENTS.filter((achievement) => achievement.trust === "trusted"), []);
  const earnedPublicAchievements = publicAchievements.filter((achievement) => earnedAchievementIds.has(achievement.id)).length;
  const achievementTotal = publicAchievements.length;
  const achievementPercent = achievementTotal > 0 ? Math.round((earnedPublicAchievements / achievementTotal) * 100) : 0;

  function openAchievements() {
    setIsAchievementsOpen(true);
    onLoadAchievementProgress?.();
  }

  return (
    <section className="profile-screen-mobile">
      <div className="mobile-screen-title profile-title-row">
        <div>
          <span>Profile</span>
          <h1>{isLoggedIn ? "Account" : "Guest Mode"}</h1>
        </div>
        <button className="settings-gear-button" type="button" onClick={() => setIsSettingsOpen(true)} aria-label="Open settings">
          <GearIcon />
        </button>
      </div>

      {!isLoggedIn && (
        <section className="profile-card">
          <span className="eyebrow">Guest Mode</span>
          <h2>Save your PackDex.</h2>
          <p>
            <button className="inline-auth-link" type="button" onClick={onOpenLogin}>
              Log in
            </button>{" "}
            or{" "}
            <button className="inline-auth-link" type="button" onClick={onOpenSignup}>
              create an account
            </button>{" "}
            to save simulated pulls, collection progress, binders, and future app stats.
          </p>
        </section>
      )}

      {isLoggedIn && welcomeRewardStatus?.isEligible && !welcomeRewardStatus?.isClaimed && (
        <section className="welcome-reward-profile-card-mobile">
          <span className="eyebrow">Welcome Pack Available</span>
          <h2>Claim your welcome God Pack</h2>
          <p>Thanks for signing up! Here’s a free God Pack on us to get your collection started.</p>
          <button className="primary-action compact-auth-submit" type="button" onClick={onOpenWelcomeReward}>
            Claim Welcome Pack
          </button>
        </section>
      )}


      {isLoggedIn && (
        <section className="quick-stats">
          <article className="stat-card">
            <span>Packs Opened</span>
            <strong>{stats.packsOpened}</strong>
          </article>
          <article className="stat-card">
            <span>Total Pulled</span>
            <strong>{stats.totalCardsPulled}</strong>
          </article>
          <article className="stat-card stat-card-wide">
            <span>Sets Completed</span>
            <strong>{setsCompleted}</strong>
          </article>
          <button className="stat-card stat-card-wide achievement-summary-card" type="button" onClick={openAchievements}>
            <span className="achievement-card-heading">
              <span className="achievement-trophy-icon" aria-hidden="true"><TrophyIcon /></span>
              Achievements
            </span>
            <strong>{isAchievementsLoading ? "..." : `${earnedPublicAchievements} / ${achievementTotal}`}</strong>
            <em>{achievementPercent}% complete</em>
          </button>
          <button className="stat-card stat-card-wide wishlist-summary-card" type="button" onClick={onOpenWishlist}>
            <span><strong>Wishlist</strong><em>{wishlistCount} card{wishlistCount === 1 ? "" : "s"}</em></span>
            <b aria-hidden="true">›</b>
          </button>
        </section>
      )}

      {isAchievementsOpen && (
        <div className="mobile-auth-overlay achievements-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-achievements-title" onClick={() => setIsAchievementsOpen(false)}>
          <section className="mobile-auth-modal achievements-modal" onClick={(event) => event.stopPropagation()}>
            <button className="mobile-auth-close" type="button" onClick={() => setIsAchievementsOpen(false)} aria-label="Close achievements">
              <CloseIcon />
            </button>
            <div className="mobile-auth-heading">
              <span className="eyebrow">Profile</span>
              <h2 id="mobile-achievements-title">Achievements</h2>
              <p>{earnedPublicAchievements} of {achievementTotal} public achievements earned.</p>
            </div>
            <div className="achievement-list-mobile">
              {MOBILE_ACHIEVEMENTS.map((achievement) => {
                const earnedAchievement = earnedAchievementMap.get(achievement.id);
                const metadata = earnedAchievement?.metadata || {};
                const isEarned = earnedAchievementIds.has(achievement.id);
                const isPendingTrust = achievement.trust === "pending";
                const trustedProgress = achievementProgressMap.get(achievement.id);
                const progressTarget = Number(trustedProgress?.progressTarget || 0);
                const progressCurrentRaw = Number(trustedProgress?.progressCurrent || 0);
                const hasTrustedProgress = !isEarned && progressTarget > 0 && Number.isFinite(progressCurrentRaw) && progressCurrentRaw < progressTarget;
                const progressCurrent = hasTrustedProgress
                  ? Math.min(progressTarget, Math.max(0, trustedProgress?.category === "value" ? progressCurrentRaw : Math.floor(progressCurrentRaw)))
                  : 0;
                const progressPercent = hasTrustedProgress ? Math.min(99, Math.max(0, Math.floor((progressCurrent / progressTarget) * 100))) : 0;
                const progressLabel = trustedProgress?.category === "value"
                  ? `${formatUsd(progressCurrent, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / ${formatUsd(progressTarget, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : `${progressCurrent} / ${progressTarget}`;
                const iconKey = metadata.icon_key || achievement.icon_key || "trophy";

                return (
                  <article className={`achievement-row-mobile achievement-icon-${iconKey} ${isEarned ? "is-earned" : ""} ${isPendingTrust ? "is-pending-trust" : ""}`} key={achievement.id}>
                    <span className="achievement-trophy-icon" aria-hidden="true"><AchievementIcon iconKey={iconKey} /></span>
                    <div>
                      <strong>{achievement.title}</strong>
                      <em>{achievement.description}</em>
                      {hasTrustedProgress && (
                        <span className="achievement-progress-mobile">
                          <i style={{ "--achievement-progress": `${progressPercent}%` }} />
                          <b>{progressLabel}</b>
                        </span>
                      )}
                    </div>
                    <small>{isPendingTrust ? "Pending trusted stats" : isEarned ? "Earned" : "Locked"}</small>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {!isSupabaseConfigured && (
        <section className="content-section">
          <p className="section-copy">
            Supabase is not configured for this mobile app. Add {missingSupabaseEnv.join(" and ")} to
            mobile-app/.env, then restart npm run dev.
          </p>
        </section>
      )}

      <section className="content-section">
        <p className="section-copy">
          Fan-made Pokemon TCG pack-opening simulator. Not affiliated with Nintendo, Creatures, Game Freak, or The
          Pokemon Company. PackDex tracks a virtual collection only.
        </p>
      </section>
      <SettingsModal
        isOpen={isSettingsOpen}
        user={user}
        soundEnabled={soundEnabled}
        hapticsEnabled={hapticsEnabled}
        onClose={() => setIsSettingsOpen(false)}
        onLogout={() => {
          setIsSettingsOpen(false);
          onLogout?.();
        }}
        onDeleteAccount={() => {
          setIsSettingsOpen(false);
          onDeleteAccount?.();
        }}
        onToggleSound={onToggleSound}
        onToggleHaptics={onToggleHaptics}
        scannerTestEnabled={__PACKDEX_SCANNER_TEST__}
      />
    </section>
  );
}

function MobileAuthCallbackPage() {
  const [status, setStatus] = useState("Confirming your PackDex account...");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function finishCallback() {
      if (!supabase) {
        setStatus("");
        setError("Supabase is not configured for this mobile app.");
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = searchParams.get("error_description") || hashParams.get("error_description");
      const code = searchParams.get("code");

      if (authError) {
        if (!mounted) return;
        setStatus("");
        setError(authError);
        window.history.replaceState({}, document.title, "/mobile-app/auth/callback");
        return;
      }

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session) throw new Error("Confirmation link is missing or has expired.");
        }

        if (!mounted) return;

        window.history.replaceState({}, document.title, "/mobile-app/");
        setStatus("Account confirmed. Open the installed PackDex app again to continue.");
      } catch (callbackError) {
        if (!mounted) return;
        window.history.replaceState({}, document.title, "/mobile-app/auth/callback");
        setStatus("");
        setError(callbackError.message || "Unable to confirm your account. Please request a new email.");
      }
    }

    finishCallback();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="mobile-app theme-dark">
      <section className="phone-shell" aria-label="PackDex mobile account confirmation">
        <div className="screen-content auth-callback-mobile-screen">
          <MobileBrandHeader />
          <section className="mobile-auth-modal auth-callback-mobile-card">
            <div className="mobile-auth-heading">
              <span className="eyebrow">Account</span>
              <h1>Email verification</h1>
              {status && <p>{status}</p>}
              {error && <p className="auth-message is-error">{error}</p>}
            </div>
            <a className="primary-action compact-auth-submit" href="/mobile-app/">
              Open PackDex Mobile
            </a>
          </section>
        </div>
      </section>
    </main>
  );
}

function MobileApp() {
  const [activeTab, setActiveTab] = useState(() => typeof window !== "undefined" && window.location.pathname.includes("/explore") ? "explore" : "open");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(loadHapticsEnabled);
  const [wishlistEntries, setWishlistEntries] = useState([]);
  const [wishlistStatus, setWishlistStatus] = useState("idle");
  const [wishlistError, setWishlistError] = useState("");
  const [wishlistPendingKeys, setWishlistPendingKeys] = useState(() => new Set());
  const [wishlistMessage, setWishlistMessage] = useState(null);
  const [collection, setCollection] = useState(loadCollection);
  const [binders, setBinders] = useState([]);
  const [user, setUser] = useState(null);
  const [authValidationState, setAuthValidationState] = useState(isSupabaseConfigured ? "validating" : "guest");
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loadingMessage, setLoadingMessage] = useState("Loading account...");
  const [selectedSet, setSelectedSet] = useState(null);
  const [selectedCollectionSetId, setSelectedCollectionSetId] = useState("");
  const [collectionReturnSource, setCollectionReturnSource] = useState("collection");
  const [collectionEraFilter, setCollectionEraFilter] = useState(() => {
    if (typeof window === "undefined") return "All Eras";

    return window.localStorage.getItem(COLLECTION_ERA_FILTER_KEY) || "All Eras";
  });
  const [collectionSetSearch, setCollectionSetSearch] = useState("");
  const [pack, setPack] = useState([]);
  const [packStage, setPackStage] = useState("sets");
  const [revealedCount, setRevealedCount] = useState(0);
  const [packImagesReady, setPackImagesReady] = useState(false);
  const [packInstanceId, setPackInstanceId] = useState(0);
  const [newPullKeys, setNewPullKeys] = useState(() => new Set());
  const [hasSavedCurrentPack, setHasSavedCurrentPack] = useState(false);
  const savedPackKeyRef = useRef("");
  const [inspectedCard, setInspectedCard] = useState(null);
  const [cardDestinationOverlay, setCardDestinationOverlay] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileMessage, setTurnstileMessage] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthPanelOpen, setIsAuthPanelOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isSignupVerificationOpen, setIsSignupVerificationOpen] = useState(false);
  const [signupVerificationEmail, setSignupVerificationEmail] = useState("");
  const [isWelcomeDisclaimerOpen, setIsWelcomeDisclaimerOpen] = useState(false);
  const [welcomeRewardStatus, setWelcomeRewardStatus] = useState(null);
  const [selectedWelcomeRewardSetId, setSelectedWelcomeRewardSetId] = useState(WELCOME_REWARD_CHOICES[0]?.setId || "");
  const [isWelcomeRewardModalOpen, setIsWelcomeRewardModalOpen] = useState(false);
  const isMobileAuthCallbackRoute = typeof window !== "undefined" && window.location.pathname === "/mobile-app/auth/callback";
  const [isClaimingWelcomeReward, setIsClaimingWelcomeReward] = useState(false);
  const [welcomeRewardError, setWelcomeRewardError] = useState("");
  const [achievements, setAchievements] = useState([]);
  const [achievementProgress, setAchievementProgress] = useState([]);
  const [isAchievementsLoading, setIsAchievementsLoading] = useState(false);
  const [achievementToastQueue, setAchievementToastQueue] = useState([]);
  const [activeAchievementToast, setActiveAchievementToast] = useState(null);
  const achievementCacheByUserIdRef = useRef(new Map());
  const lastAchievementsLoadedUserIdRef = useRef("");
  const lastAccountScopedUserIdRef = useRef("");
  const accountLoadPromisesRef = useRef(new Map());
  const accountLoadedAtRef = useRef(new Map());
  const authRefreshPromiseRef = useRef(null);
  const authValidationAttemptRef = useRef(0);
  const validatedScannerUserIdRef = useRef("");
  const [priceMapsBySet, setPriceMapsBySet] = useState({});
  const [fullSetPriceMapsBySet, setFullSetPriceMapsBySet] = useState({});
  const [fullSetPriceStatusBySet, setFullSetPriceStatusBySet] = useState({});
  const [estimatedCollectionValue, setEstimatedCollectionValue] = useState(0);
  const [isValueLoading, setIsValueLoading] = useState(false);
  const collectionValueCacheRef = useRef(new Map());
  const loadingPriceSetIdsRef = useRef(new Set());
  const cardIdLoadedSetValueIdsRef = useRef(new Set());
  const completePriceSetIdsRef = useRef(new Set());
  const preloadedAssetUrlsRef = useRef(new Set());
  const shownWelcomeRewardUserRef = useRef("");
  const soundEnabledRef = useRef(soundEnabled);
  const hapticsEnabledRef = useRef(hapticsEnabled);
  const wishlistScrollRef = useRef(0);
  const playedRevealSoundKeysRef = useRef(new Set());
  const playedRevealHapticKeysRef = useRef(new Set());
  const activeRevealSoundSessionRef = useRef("");
  const revealSoundSessionCounterRef = useRef(0);
  const revealTimersRef = useRef([]);
  const packImagePreloadIdRef = useRef(0);
  const skipRevealStartedRef = useRef(false);
  const screenContentRef = useRef(null);
  validatedScannerUserIdRef.current = authValidationState === "authenticated" ? String(user?.id || "") : "";
  const setsCompleted = useMemo(
    () =>
      sets.filter((set) => {
        const progress = getSetCollectionProgress(collection, set);

        return progress.total > 0 && progress.collected >= progress.total;
      }).length,
    [collection]
  );
  const ownedCards = useMemo(() => getOwnedCards(collection), [collection]);
  const isPackOpening = activeTab === "open" && (packStage === "revealing" || packStage === "preloading");

  function scrollScreenToTop(behavior = "auto") {
    window.requestAnimationFrame(() => {
      screenContentRef.current?.scrollTo({ top: 0, left: 0, behavior });
    });
  }

  function switchMobileTab(nextTab) {
    if (isPackOpening && nextTab !== "open") return;

    if (nextTab === "collection") {
      setSelectedCollectionSetId("");
      setCollectionReturnSource("collection");
    }

    setActiveTab(nextTab);
    if (nextTab === "explore") {
      window.history.replaceState({}, "", buildExplorePath({ kind: "home" }, window.location.pathname));
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else if (window.location.pathname.includes("/explore")) {
      window.history.replaceState({}, "", window.location.pathname.startsWith("/mobile-app") ? "/mobile-app/" : "/");
    }
    if (nextTab !== "open") returnToSets();
    scrollScreenToTop();
  }

  function openExploreRoute(route) {
    setInspectedCard(null);
    setActiveTab("explore");
    window.history.pushState({ packdexExplore: true }, "", buildExplorePath(route, window.location.pathname));
    window.dispatchEvent(new PopStateEvent("popstate"));
    returnToSets();
    scrollScreenToTop();
  }

  function openCardDestination(route) {
    if (!inspectedCard) {
      openExploreRoute(route);
      return;
    }
    window.history.pushState({ packdexExplore: true, packdexCardReturn: true, packdexCardDestination: true }, "", buildExplorePath(route, window.location.pathname));
    setCardDestinationOverlay(true);
  }

  function openPokemonFromInspect(id) {
    openCardDestination({ kind: "pokemon", id });
  }

  useEffect(() => {
    if (!cardDestinationOverlay) return undefined;
    const handleCardReturn = () => {
      if (!window.history.state?.packdexCardDestination) setCardDestinationOverlay(false);
    };
    window.addEventListener("popstate", handleCardReturn);
    return () => window.removeEventListener("popstate", handleCardReturn);
  }, [cardDestinationOverlay]);

  async function loadExploreSpeciesForCard(card, set) {
    const { catalogCards, speciesById } = await import("./explore/exploreData.js");
    const entry = catalogCards.find((candidate) => candidate.set.id === set?.id && String(candidate.card.id) === String(card?.id));
    return (entry?.speciesIds || []).map((id) => speciesById.get(id)).filter(Boolean);
  }

  async function addScannedCardToCollection(result) {
    const set = sets.find((item) => item.id === result?.setId);
    const card = set?.cards?.find((item) => String(item.id) === String(result?.cardId || result?.card?.id));
    const actionUserId = validatedScannerUserIdRef.current;
    if (!actionUserId || !supabase) throw new Error("Sign in to add this card to your Collection.");
    if (!set || !card) throw new Error("This card is unavailable in the PackDex catalog.");

    const outcome = await addScannedCardOnce(supabase, { cardId: String(card.id), setId: set.id });
    if (validatedScannerUserIdRef.current !== actionUserId) throw new Error("Your account session changed. Please try again.");
    if (outcome.added) {
      const timestamp = Date.now();
      const key = getCardCollectionKey(card, set.id);
      setCollection((current) => {
        const setCollection = current[set.id] || {};
        const existing = setCollection[key];
        return {
          ...current,
          [set.id]: {
            ...setCollection,
            [key]: {
              count: outcome.quantity,
              firstCollectedAt: existing?.firstCollectedAt || timestamp,
              lastCollectedAt: timestamp,
            },
          },
        };
      });
      setStats((current) => ({ ...current, totalCardsPulled: Number(current.totalCardsPulled || 0) + 1 }));
    }
    return outcome;
  }

  async function addScannedCardToWishlist(result) {
    const set = sets.find((item) => item.id === result?.setId);
    const card = set?.cards?.find((item) => String(item.id) === String(result?.cardId || result?.card?.id));
    const actionUserId = validatedScannerUserIdRef.current;
    if (!actionUserId || !supabase) throw new Error("Sign in to add this card to your Wishlist.");
    if (!set || !card) throw new Error("This card is unavailable in the PackDex catalog.");

    const key = getWishlistKey(set.id, card.id);
    if (wishlistEntries.some((entry) => getWishlistKey(entry.setId, entry.cardId) === key)) {
      return { added: false, alreadyAdded: true };
    }

    setWishlistPendingKeys((current) => new Set(current).add(key));
    try {
      await addWishlistCard(supabase, actionUserId, set.id, card.id);
      if (validatedScannerUserIdRef.current !== actionUserId) throw new Error("Your account session changed. Please try again.");
      setWishlistEntries((current) => current.some((entry) => getWishlistKey(entry.setId, entry.cardId) === key)
        ? current
        : [...current, { setId: set.id, cardId: String(card.id), createdAt: new Date().toISOString() }]);
      return { added: true, alreadyAdded: false };
    } finally {
      setWishlistPendingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  async function loadScannedCardActionState(result) {
    const actionUserId = validatedScannerUserIdRef.current;
    if (!actionUserId || !supabase) return { collectionAdded: false, wishlisted: false };
    const state = await loadScannerCardActionState(supabase, { cardId: result?.cardId, setId: result?.setId });
    if (validatedScannerUserIdRef.current !== actionUserId) throw new Error("Your account session changed.");
    return state;
  }

  function openScannerSearchInCollection() {
    setSelectedCollectionSetId("");
    setCollectionReturnSource("collection");
    setActiveTab("collection");
    scrollScreenToTop();
  }

  function openWishlist() {
    setActiveTab("wishlist");
    window.requestAnimationFrame(() => screenContentRef.current?.scrollTo({ top: wishlistScrollRef.current, behavior: "auto" }));
  }

  function leaveWishlist() {
    wishlistScrollRef.current = screenContentRef.current?.scrollTop || 0;
    setActiveTab("profile");
    scrollScreenToTop();
  }

  function selectCollectionSet(set, source = "collection") {
    if (!set?.id) {
      setSelectedCollectionSetId("");
      setCollectionReturnSource("collection");
      scrollScreenToTop();
      return;
    }

    setCollectionReturnSource(source);
    setSelectedCollectionSetId(set.id);
    scrollScreenToTop();
  }

  function updateCollectionEraFilter(nextEra) {
    const normalizedEra = nextEra || "All Eras";

    setCollectionEraFilter(normalizedEra);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLECTION_ERA_FILTER_KEY, normalizedEra);
    }
  }

  function viewSetCollection(set) {
    selectCollectionSet(set, "open");
    setActiveTab("collection");
    scrollScreenToTop();
  }

  function viewWishlistSet(set) {
    wishlistScrollRef.current = screenContentRef.current?.scrollTop || 0;
    selectCollectionSet(set, "wishlist");
    setActiveTab("collection");
  }

  function returnFromCollectionSet() {
    if (collectionReturnSource === "wishlist") {
      setSelectedCollectionSetId("");
      setCollectionReturnSource("collection");
      openWishlist();
      return;
    }

    if (collectionReturnSource === "open") {
      setActiveTab("open");
      setSelectedCollectionSetId("");
      setCollectionReturnSource("collection");
      scrollScreenToTop();
      return;
    }

    selectCollectionSet(null);
  }

  function setAuthModeClean(nextMode) {
    setAuthMode(nextMode);
    setAuthPassword("");
    setAuthConfirmPassword("");
    setTurnstileToken("");
    setTurnstileMessage("");
    setAuthMessage("");
  }

  function openAuthProfile(nextMode = "login") {
    setAuthModeClean(nextMode);
    setIsAuthPanelOpen(true);
    setActiveTab("profile");
    scrollScreenToTop();
  }

  function openScannerAuth() {
    setAuthModeClean("login");
    setIsAuthPanelOpen(true);
  }

  function closeAuthProfile() {
    setIsAuthPanelOpen(false);
    setAuthMessage("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setTurnstileToken("");
    setTurnstileMessage("");
  }

  function maybeShowWelcomeDisclaimer() {
    if (hasSeenDisclaimer()) return;

    setIsWelcomeDisclaimerOpen(true);
  }

  function clearAccountScopedState() {
    clearCachedSupabaseUser(supabase);
    accountLoadedAtRef.current.clear();
    setUser(null);
    setCollection(loadCollection());
    setStats(EMPTY_STATS);
    setBinders([]);
    setSelectedCollectionSetId("");
    setCollectionReturnSource("collection");
    setEstimatedCollectionValue(0);
    setIsValueLoading(false);
    setWelcomeRewardStatus(null);
    setIsWelcomeRewardModalOpen(false);
    setWelcomeRewardError("");
    setAchievements([]);
    setAchievementProgress([]);
    setIsAchievementsLoading(false);
    setAchievementToastQueue([]);
    setActiveAchievementToast(null);
    setWishlistEntries([]);
    setWishlistStatus("idle");
    setWishlistError("");
    setWishlistPendingKeys(new Set());
    setWishlistMessage(null);
    achievementCacheByUserIdRef.current.clear();
    lastAchievementsLoadedUserIdRef.current = "";
    lastAccountScopedUserIdRef.current = "";
    setInspectedCard(null);
  }

  async function refreshWishlist(currentUser = user) {
    if (!currentUser?.id || !supabase) return [];
    setWishlistStatus("loading");
    setWishlistError("");
    try {
      const entries = await loadWishlist(supabase, currentUser.id);
      setWishlistEntries(entries);
      setWishlistStatus("ready");
      return entries;
    } catch (error) {
      console.warn("Unable to load mobile wishlist", error);
      setWishlistError("Unable to load your wishlist.");
      setWishlistStatus("error");
      return [];
    }
  }

  async function toggleWishlistCard(set, card, forceRemove = false) {
    if (!user?.id || !supabase) {
      setWishlistMessage({ key: getWishlistKey(set?.id, card?.id), text: "Log in to use your wishlist.", isError: true });
      return;
    }
    if (!resolveCatalogWishlistItem(set?.id, card?.id)) {
      setWishlistMessage({ key: getWishlistKey(set?.id, card?.id), text: "This card is unavailable.", isError: true });
      return;
    }
    const key = getWishlistKey(set.id, card.id);
    if (wishlistPendingKeys.has(key)) return;
    const wasWishlisted = wishlistEntries.some((entry) => getWishlistKey(entry.setId, entry.cardId) === key);
    const shouldRemove = forceRemove || wasWishlisted;
    const previous = wishlistEntries;
    setWishlistPendingKeys((current) => new Set(current).add(key));
    setWishlistMessage(null);
    setWishlistEntries((current) => shouldRemove
      ? current.filter((entry) => getWishlistKey(entry.setId, entry.cardId) !== key)
      : [...current, { setId: set.id, cardId: String(card.id), createdAt: new Date().toISOString() }]);
    try {
      if (shouldRemove) await removeWishlistCard(supabase, user.id, set.id, card.id);
      else await addWishlistCard(supabase, user.id, set.id, card.id);
      setWishlistMessage({ key, text: shouldRemove ? "Removed from wishlist." : "Added to wishlist.", isError: false });
    } catch (error) {
      console.warn("Unable to update mobile wishlist", error);
      setWishlistEntries(previous);
      setWishlistMessage({ key, text: "Wishlist update failed. Please try again.", isError: true });
    } finally {
      setWishlistPendingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  async function loadUserAchievements(currentUser = user) {
    if (!currentUser?.id) return [];

    setIsAchievementsLoading(true);
    try {
      const cloudAchievements = await loadCurrentUserAchievements(currentUser.id);

      achievementCacheByUserIdRef.current.set(currentUser.id, cloudAchievements);
      lastAchievementsLoadedUserIdRef.current = currentUser.id;
      setAchievements(cloudAchievements);
      return cloudAchievements;
    } catch (error) {
      console.warn("Unable to load mobile achievements", {
        userId: currentUser.id,
        error,
      });
      return [];
    } finally {
      setIsAchievementsLoading(false);
    }
  }

  async function loadUserAchievementProgress(currentUser = user) {
    if (!currentUser?.id) {
      setAchievementProgress([]);
      return [];
    }

    try {
      const cloudProgress = await loadCurrentUserAchievementProgress(currentUser.id);
      setAchievementProgress(cloudProgress);
      return cloudProgress;
    } catch (error) {
      console.warn("Unable to load mobile achievement progress", {
        userId: currentUser.id,
        error,
      });
      setAchievementProgress([]);
      return [];
    }
  }

  function enqueueAchievementUnlocks(awardedRows = []) {
    const queuedToasts = (awardedRows || [])
      .map((row) => {
        const achievementId = row?.achievementId || row?.achievement_id;
        const catalogAchievement = MOBILE_ACHIEVEMENTS.find((achievement) => achievement.id === achievementId);

        if (!achievementId || !catalogAchievement) return null;

        return {
          id: achievementId,
          key: `${achievementId}:${row?.awardKey || row?.award_key || row?.id || row?.awardedAt || Date.now()}`,
          title: catalogAchievement.title,
          iconKey: row?.metadata?.icon_key || catalogAchievement.icon_key || "trophy",
        };
      })
      .filter(Boolean);

    if (queuedToasts.length > 0) {
      setAchievementToastQueue((currentQueue) => [...currentQueue, ...queuedToasts]);
    }
  }

  function mergeAwardedAchievements(currentUser, awardedRows = []) {
    if (!currentUser?.id || awardedRows.length === 0) return;

    const hasCompleteCache =
      lastAchievementsLoadedUserIdRef.current === currentUser.id &&
      achievementCacheByUserIdRef.current.has(currentUser.id);
    if (!hasCompleteCache) return;

    const mergedAchievements = mergeUserAchievementRows(
      achievementCacheByUserIdRef.current.get(currentUser.id),
      awardedRows
    );
    achievementCacheByUserIdRef.current.set(currentUser.id, mergedAchievements);
    setAchievements(mergedAchievements);
  }

  async function runPostPackAchievementFlow({ currentUser = user, set, cards, openedAt = "", recordPackEvent = true } = {}) {
    if (!currentUser?.id || !set?.id || !cards?.length) return null;

    const result = recordPackEvent
      ? await recordPackOpenEvent({
          userId: currentUser.id,
          setId: set.id,
          cards,
          openedAt,
        })
      : null;

    if (result?.stats) setStats(result.stats);

    const achievementResult = await requestServerAchievementAward(currentUser.id);
    enqueueAchievementUnlocks(achievementResult?.awarded);
    mergeAwardedAchievements(currentUser, achievementResult?.awarded);

    return { packEvent: result, achievements: achievementResult };
  }

  async function performAccountScopedStateLoad(currentUser) {
    if (!currentUser?.id) {
      clearAccountScopedState();
      return;
    }

    if (lastAccountScopedUserIdRef.current && lastAccountScopedUserIdRef.current !== currentUser.id) {
      achievementCacheByUserIdRef.current.clear();
      lastAchievementsLoadedUserIdRef.current = "";
      setAchievements([]);
      setAchievementProgress([]);
        setIsAchievementsLoading(false);
    }
    lastAccountScopedUserIdRef.current = currentUser.id;

    const localPendingCollection = mergePendingCloudPullsIntoCollection({}, currentUser.id);
    setUser(currentUser);
    setCollection(localPendingCollection);

    let pendingSyncResult = null;
    try {
      pendingSyncResult = await syncPendingCloudPulls(currentUser.id);
    } catch (error) {
      console.warn("Pending mobile collection pulls remain queued for retry", {
        userId: currentUser.id,
        error,
      });
    }

    let mergedCollection = localPendingCollection;
    try {
      const cloudCollection = await loadCloudCollection();
      mergedCollection = mergePendingCloudPullsIntoCollection(cloudCollection, currentUser.id);
    } catch (error) {
      console.warn("Unable to load mobile cloud collection; showing durable pending pulls", {
        userId: currentUser.id,
        error,
      });
    }

    const mergedCardCount = Object.values(mergedCollection).reduce(
      (total, setCollection) => total + Object.values(setCollection || {}).reduce((setTotal, entry) => setTotal + Number(entry?.count || 0), 0),
      0
    );
    const pendingPulls = getPendingCloudPulls(currentUser.id);
    const legacyPendingPackCount = pendingPulls.filter(
      (pull) =>
        pull?.expectedPacksOpened === null ||
        pull?.expectedPacksOpened === undefined ||
        !Number.isFinite(Number(pull.expectedPacksOpened))
    ).length;
    const expectedPendingPackCount = pendingPulls.reduce(
      (maximum, pull) =>
        pull?.expectedPacksOpened !== null &&
        pull?.expectedPacksOpened !== undefined &&
        Number.isFinite(Number(pull.expectedPacksOpened))
          ? Math.max(maximum, Number(pull.expectedPacksOpened))
          : maximum,
      0
    );
    let cloudStats = {
      packsOpened: Math.max(
        Number(pendingSyncResult?.stats?.packsOpened || 0),
        expectedPendingPackCount,
        legacyPendingPackCount
      ),
      totalCardsPulled: mergedCardCount,
    };
    try {
      const storedStats = await loadCloudProfileStats(currentUser.id, { totalCardsPulled: mergedCardCount });
      cloudStats = {
        ...storedStats,
        packsOpened: Math.max(
          Number(storedStats?.packsOpened || 0) + legacyPendingPackCount,
          expectedPendingPackCount,
          Number(pendingSyncResult?.stats?.packsOpened || 0)
        ),
      };
    } catch (error) {
      console.warn("Unable to load mobile cloud stats; using durable local totals", {
        userId: currentUser.id,
        error,
      });
    }

    if (pendingSyncResult?.saved > 0) {
      try {
        const achievementResult = await requestServerAchievementAward(currentUser.id);
        enqueueAchievementUnlocks(achievementResult?.awarded);
      } catch (error) {
        console.warn("Unable to refresh achievements after pending pull recovery", {
          userId: currentUser.id,
          error,
        });
      }
    }

    const cachedAchievements = achievementCacheByUserIdRef.current.get(currentUser.id);
    const shouldLoadAchievements = lastAchievementsLoadedUserIdRef.current !== currentUser.id || !cachedAchievements;

    if (cachedAchievements) {
      setAchievements(cachedAchievements);
      setIsAchievementsLoading(false);
    }

    if (shouldLoadAchievements) {
      try {
        await loadUserAchievements(currentUser);
      } catch (error) {
        console.warn("Unable to load mobile achievements", {
          userId: currentUser.id,
          error,
        });
        if (!cachedAchievements) setAchievements([]);
      }
    }

    setUser(currentUser);
    setCollection(mergedCollection);
    setStats(cloudStats || EMPTY_STATS);
    setBinders(loadBinders());
    refreshWishlist(currentUser);
  }

  function loadAccountScopedState(currentUser, { force = false } = {}) {
    if (!currentUser?.id) {
      clearAccountScopedState();
      return Promise.resolve();
    }

    const userId = currentUser.id;
    const existing = accountLoadPromisesRef.current.get(userId);
    if (existing) return existing;
    const loadedAt = accountLoadedAtRef.current.get(userId) || 0;
    if (!force && lastAccountScopedUserIdRef.current === userId && Date.now() - loadedAt < ACCOUNT_STATE_FRESH_MS) {
      setUser(currentUser);
      return Promise.resolve();
    }

    countDevRequest("loadAccountScopedState");
    const promise = performAccountScopedStateLoad(currentUser)
      .then(() => accountLoadedAtRef.current.set(userId, Date.now()))
      .finally(() => accountLoadPromisesRef.current.delete(userId));
    accountLoadPromisesRef.current.set(userId, promise);
    return promise;
  }

  useEffect(() => {
    preloadMobileSounds();
  }, []);


  useEffect(() => {
    if (!user?.id || !supabase) {
      setEstimatedCollectionValue(0);
      setIsValueLoading(false);
      return undefined;
    }

    if (ownedCards.length === 0) {
      setEstimatedCollectionValue(0);
      setIsValueLoading(false);
      return undefined;
    }

    const valueCacheKey = [
      user.id,
      ...ownedCards
        .map((item) => `${item.set.id}:${item.card.id || item.card.number || item.card.name}:${item.count}`)
        .sort(),
    ].join("|");
    const cachedValue = collectionValueCacheRef.current.get(valueCacheKey);

    if (cachedValue) {
      setEstimatedCollectionValue(cachedValue.totalValue);
      setPriceMapsBySet((current) => ({ ...current, ...cachedValue.priceMapsBySet }));
      setIsValueLoading(false);
      return undefined;
    }

    if (activeTab !== "collection" && activeTab !== "value" && activeTab !== "profile") return undefined;
    let cancelled = false;

    async function loadCollectionValue() {
      setIsValueLoading(true);
      try {
        const result = await loadCardPricesForCollection(supabase, ownedCards);

        if (cancelled) return;

        const nextPriceMapsBySet = result.priceMapsBySet || {};

        setPriceMapsBySet((current) => {
          const next = { ...current };
          Object.entries(nextPriceMapsBySet).forEach(([setId, priceMap]) => {
            next[setId] = priceMap;
            cardIdLoadedSetValueIdsRef.current.add(setId);
          });
          return next;
        });
        const nextTotalValue = Number(result.totalValue || 0);
        collectionValueCacheRef.current.set(valueCacheKey, {
          totalValue: nextTotalValue,
          priceMapsBySet: nextPriceMapsBySet,
        });
        setEstimatedCollectionValue(nextTotalValue);
      } catch (error) {
        console.error("[PackDex prices] Unable to load mobile collection value; using fallback value", error);
        if (!cancelled) setEstimatedCollectionValue(0);
      } finally {
        if (!cancelled) {
          setIsValueLoading(false);
        }
      }
    }

    loadCollectionValue();

    return () => {
      cancelled = true;
    };
  }, [activeTab, ownedCards, user?.id]);
  useEffect(() => {
    const idsToLoad = [selectedSet?.id, selectedCollectionSetId]
      .filter(Boolean)
      .filter((setId, index, list) => list.indexOf(setId) === index)
      .filter((setId) => !SETS_WITHOUT_MARKET_PRICE_DATA.has(setId))
      .filter((setId) => !completePriceSetIdsRef.current.has(setId) && !loadingPriceSetIdsRef.current.has(setId));

    if (!supabase || idsToLoad.length === 0) return undefined;

    let cancelled = false;

    async function loadCurrentSetPriceMaps() {
      idsToLoad.forEach((setId) => loadingPriceSetIdsRef.current.add(setId));
      setFullSetPriceStatusBySet((current) => ({
        ...current,
        ...Object.fromEntries(idsToLoad.map((setId) => [setId, "loading"])),
      }));
      const entries = await Promise.allSettled(idsToLoad.map(async (setId) => [setId, await loadCardPricesForSet(supabase, setId)]));

      idsToLoad.forEach((setId) => loadingPriceSetIdsRef.current.delete(setId));
      entries.forEach((entry) => {
        if (entry.status === "fulfilled") completePriceSetIdsRef.current.add(entry.value[0]);
      });
      if (cancelled) return;

      setFullSetPriceMapsBySet((current) => {
        const next = { ...current };
        entries.forEach((entry) => {
          if (entry.status !== "fulfilled") return;
          const [setId, priceMap] = entry.value;
          next[setId] = priceMap;
        });
        return next;
      });
      setFullSetPriceStatusBySet((current) => {
        const next = { ...current };
        entries.forEach((entry, index) => {
          const setId = entry.status === "fulfilled" ? entry.value[0] : idsToLoad[index];
          next[setId] = entry.status === "fulfilled" ? "loaded" : "error";
        });
        return next;
      });
    }

    loadCurrentSetPriceMaps().catch((error) => {
      console.warn("Unable to load selected set cached prices", {
        setIds: idsToLoad,
        error,
      });
      idsToLoad.forEach((setId) => loadingPriceSetIdsRef.current.delete(setId));
    });

    return () => { cancelled = true; };
  }, [selectedCollectionSetId, selectedSet?.id]);

  useEffect(() => {
    const shouldPausePreload = Boolean(
      isValueLoading ||
        loadingMessage ||
        isAuthSubmitting ||
        packStage === "revealing" ||
        packStage === "preloading"
    );

    if (shouldPausePreload) return undefined;

    const selectedCollectionSet = selectedCollectionSetId ? sets.find((set) => set.id === selectedCollectionSetId) : null;
    const candidateSets = [
      selectedSet,
      selectedCollectionSet,
      ...sortSetsByEra(sets),
    ]
      .filter(Boolean)
      .filter((set, index, list) => list.findIndex((candidate) => candidate.id === set.id) === index)
      .slice(0, PRELOAD_SET_LIMIT);

    const urls = [
      getCardBackUrl(),
      ...candidateSets.flatMap((set) => [
        getSetLogoUrl(set),
        ...getPullableCollectionCards(set)
          .slice(0, PRELOAD_CARD_LIMIT_PER_SET)
          .map((card) => getPackCardImageUrl(card, set)),
      ]),
    ].filter((url) => url && !preloadedAssetUrlsRef.current.has(url));

    if (urls.length === 0) return undefined;

    const idleHandle = scheduleIdleTask(() => {
      urls.forEach((url) => preloadedAssetUrlsRef.current.add(url));
      preloadImages(urls, { timeoutMs: 1200 }).catch(() => {});
    });

    return () => cancelIdleTask(idleHandle);
  }, [activeTab, isAuthSubmitting, isValueLoading, loadingMessage, packStage, selectedCollectionSetId, selectedSet?.id]);

  async function refreshWelcomeRewardStatus(currentUser, { autoOpen = true } = {}) {
    if (!currentUser?.id) {
      setWelcomeRewardStatus(null);
      setIsWelcomeRewardModalOpen(false);
      setWelcomeRewardError("");
      return null;
    }

    const status = await loadWelcomeRewardStatus(currentUser);

    setWelcomeRewardStatus(status);
    if (autoOpen && status.isEligible && !status.isClaimed && shownWelcomeRewardUserRef.current !== currentUser.id) {
      shownWelcomeRewardUserRef.current = currentUser.id;
      setSelectedWelcomeRewardSetId(WELCOME_REWARD_CHOICES[0]?.setId || "");
      setWelcomeRewardError("");
      setIsWelcomeRewardModalOpen(true);
    }

    return status;
  }

  async function refreshAuthSession({ showLoading = false, autoOpenWelcomeReward = true } = {}) {
    if (authRefreshPromiseRef.current) return authRefreshPromiseRef.current;
    if (!supabase) {
      clearAccountScopedState();
      setAuthValidationState("guest");
      setLoadingMessage("");
      return null;
    }

    countDevRequest("refreshAuthSession");
    const validationAttempt = ++authValidationAttemptRef.current;
    setAuthValidationState("validating");
    clearCachedSupabaseUser(supabase);
    setIsWelcomeRewardModalOpen(false);
    setWelcomeRewardStatus(null);
    setWelcomeRewardError("");
    if (showLoading) setLoadingMessage("Loading account...");

    const promise = (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const session = data.session || null;
        if (!session) {
          if (validationAttempt !== authValidationAttemptRef.current) return null;
          clearAccountScopedState();
          setAuthValidationState("guest");
          return null;
        }

        const validation = await validateSupabaseIdentity(supabase, session);
        if (validationAttempt !== authValidationAttemptRef.current) return null;
        if (!validation.user) {
          clearAccountScopedState();
          setAuthValidationState("guest");
          return null;
        }

        const sessionUser = validation.user;
        setIsSignupVerificationOpen(false);
        setSignupVerificationEmail("");
        await loadAccountScopedState(sessionUser);
        if (validationAttempt !== authValidationAttemptRef.current) return null;
        await refreshWelcomeRewardStatus(sessionUser, { autoOpen: autoOpenWelcomeReward });
        if (validationAttempt !== authValidationAttemptRef.current) return null;
        setAuthValidationState("authenticated");
        return sessionUser;
      } catch (error) {
        console.warn("Unable to refresh mobile PackDex auth session", error);
        if (validationAttempt === authValidationAttemptRef.current) {
          clearAccountScopedState();
          setAuthValidationState("guest");
        }
        return null;
      } finally {
        if (validationAttempt === authValidationAttemptRef.current) setLoadingMessage("");
      }
    })().finally(() => {
      authRefreshPromiseRef.current = null;
    });
    authRefreshPromiseRef.current = promise;
    return promise;
  }

  useEffect(() => {
    maybeShowWelcomeDisclaimer();
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get("password_reset") !== "success") return;

    window.history.replaceState({}, document.title, "/mobile-app/");
    setAuthMode("login");
    setAuthMessage("Password updated. Please sign in.");
    setIsAuthPanelOpen(true);
    setActiveTab("profile");
    setLoadingMessage("");
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    hapticsEnabledRef.current = hapticsEnabled;
    saveHapticsEnabled(hapticsEnabled);
  }, [hapticsEnabled]);

  useEffect(() => {
    if (!wishlistMessage || wishlistMessage.isError) return undefined;
    const timer = window.setTimeout(() => setWishlistMessage(null), 1800);
    return () => window.clearTimeout(timer);
  }, [wishlistMessage]);

  useEffect(() => {
    if (activeAchievementToast || achievementToastQueue.length === 0) return;

    const [nextToast, ...remainingToasts] = achievementToastQueue;
    setActiveAchievementToast(nextToast);
    setAchievementToastQueue(remainingToasts);
  }, [activeAchievementToast, achievementToastQueue]);

  useEffect(() => {
    if (!activeAchievementToast) return undefined;

    playAchievementUnlockSound(soundEnabledRef.current);
    const timer = window.setTimeout(() => {
      setActiveAchievementToast(null);
    }, ACHIEVEMENT_TOAST_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [activeAchievementToast]);

  useEffect(() => {
    let mounted = true;

    refreshAuthSession({ showLoading: true }).finally(() => {
      if (!mounted) return;
    });

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    function refreshIfActive() {
      if (!mounted || document.visibilityState === "hidden") return;
      refreshAuthSession({ showLoading: true, autoOpenWelcomeReward: true });
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user || null;

      if (nextUser) {
        setIsSignupVerificationOpen(false);
        setSignupVerificationEmail("");
      }
      if (!nextUser) {
        authValidationAttemptRef.current += 1;
        clearAccountScopedState();
        setAuthValidationState("guest");
        setLoadingMessage("");
        return;
      }

      setAuthValidationState("validating");
      clearCachedSupabaseUser(supabase);
      setIsWelcomeRewardModalOpen(false);
      setWelcomeRewardStatus(null);
      setLoadingMessage("Loading account...");
      window.setTimeout(() => {
        refreshAuthSession({ showLoading: true, autoOpenWelcomeReward: true });
      }, 0);
    });

    function handleAuthStorage(event) {
      if (event.key !== null && !isSupabaseAuthStorageKey(supabase, event.key)) return;
      refreshIfActive();
    }

    window.addEventListener("focus", refreshIfActive);
    window.addEventListener("storage", handleAuthStorage);
    document.addEventListener("visibilitychange", refreshIfActive);

    return () => {
      mounted = false;
      window.removeEventListener("focus", refreshIfActive);
      window.removeEventListener("storage", handleAuthStorage);
      document.removeEventListener("visibilitychange", refreshIfActive);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.id || authValidationState !== "authenticated") return undefined;

    let active = true;
    let nativeAppStateListener = null;

    async function retryPendingPulls() {
      if (!active || getPendingCloudPullCount(user.id) === 0) return;

      try {
        const syncResult = await syncPendingCloudPulls(user.id);
        if (!active || syncResult.saved === 0) return;

        if (syncResult.stats) setStats(syncResult.stats);

        try {
          const refreshedCollection = await loadCloudCollection();
          if (active) {
            setCollection(mergePendingCloudPullsIntoCollection(refreshedCollection, user.id));
          }
        } catch (error) {
          console.warn("Unable to refresh mobile collection after pending pull sync", error);
        }

        try {
          const achievementResult = await requestServerAchievementAward(user.id);
          if (!active) return;
          enqueueAchievementUnlocks(achievementResult?.awarded);
          mergeAwardedAchievements(user, achievementResult?.awarded);
        } catch (error) {
          console.warn("Unable to refresh achievements after pending pull sync", {
            userId: user.id,
            error,
          });
        }
      } catch (error) {
        console.warn("Pending mobile collection retry will remain queued", {
          userId: user.id,
          error,
        });
      }
    }

    function retryIfVisible() {
      if (document.visibilityState !== "hidden") retryPendingPulls();
    }

    window.addEventListener("online", retryPendingPulls);
    window.addEventListener("focus", retryIfVisible);
    document.addEventListener("visibilitychange", retryIfVisible);

    import("@capacitor/app")
      .then(({ App }) => App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) retryPendingPulls();
      }))
      .then((listener) => {
        if (!active) {
          listener.remove();
          return;
        }
        nativeAppStateListener = listener;
      })
      .catch(() => {});

    return () => {
      active = false;
      window.removeEventListener("online", retryPendingPulls);
      window.removeEventListener("focus", retryIfVisible);
      document.removeEventListener("visibilitychange", retryIfVisible);
      nativeAppStateListener?.remove();
    };
  }, [authValidationState, user?.id]);

  useEffect(() => {
    if (packStage !== "revealing" || pack.length === 0) return undefined;

    clearRevealTimers();
    const timers = [];
    revealTimersRef.current = timers;
    const dealCompleteDelay = Math.max(0, (pack.length - 1) * CARD_DEAL_STAGGER_MS) + CARD_DEAL_ANIMATION_MS;
    const revealStartDelay = dealCompleteDelay + WAIT_AFTER_DEAL_MS;

    pack.forEach((_card, index) => {
      const dealDelay = index * CARD_DEAL_STAGGER_MS;
      const revealDelay = revealStartDelay + getMobileRevealDelay(index, pack.length);

      timers.push(window.setTimeout(() => playDealSound(soundEnabledRef.current), dealDelay));
      timers.push(
        window.setTimeout(() => {
          setRevealedCount(index + 1);
          playFlipSound(soundEnabledRef.current);

          const card = pack[index];
          const revealKey = `${activeRevealSoundSessionRef.current}:${index}:${card?.id || card?.name || "card"}`;
          if (card && !playedRevealHapticKeysRef.current.has(revealKey)) {
            playedRevealHapticKeysRef.current.add(revealKey);
            triggerRevealHaptic(card, selectedSet, hapticsEnabledRef.current);
          }

          if (index === pack.length - 1) {
            if (!pack.isGodPack) playFinalRevealSound(soundEnabledRef.current);
          }

          if (card && isFoilHit(card, selectedSet)) {
            const soundSessionKey = activeRevealSoundSessionRef.current || [packInstanceId, getPackSaveKey(pack, selectedSet)].join(":");
            const hitSoundKey = pack.isGodPack
              ? `${soundSessionKey}:god-pack-hit`
              : `${soundSessionKey}:${index}:${card.id || card.name || "card"}`;

            if (!playedRevealSoundKeysRef.current.has(hitSoundKey)) {
              playedRevealSoundKeysRef.current.add(hitSoundKey);
              playHitRevealSound(card, selectedSet, soundEnabledRef.current);
            }
          }
        }, revealDelay)
      );
    });

    const totalDelay = revealStartDelay + getMobileRevealDelay(pack.length - 1, pack.length) + CARD_FLIP_ANIMATION_MS;

    timers.push(
      window.setTimeout(() => {
        setPackStage("summary");
      }, totalDelay + SUMMARY_AFTER_LAST_CARD_MS)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      if (revealTimersRef.current === timers) revealTimersRef.current = [];
    };
  }, [pack, packStage, selectedSet]);

  function persistSessionCollection(nextCollection) {
    if (!user) saveCollection(nextCollection);
    setCollection(nextCollection);
  }

  function openPack(set) {
    const nextPack = generatePack(set);
    ensurePackOpenClientEventId(nextPack, set.id);

    preparePackImages(nextPack, set);
    setCollectionReturnSource("collection");
    setSelectedSet(set);
    setPack(nextPack);
    setPackInstanceId((current) => current + 1);
    setPackStage("ready");
    setRevealedCount(0);
    setNewPullKeys(new Set());
    setHasSavedCurrentPack(false);
    savedPackKeyRef.current = "";
    scrollScreenToTop();
  }

  function getPackSaveKey(cards, set) {
    return `${set.id}:${cards.map((card) => card.id || card.number || card.name).join("|")}`;
  }

  function startRevealSoundSession(cards, set) {
    revealSoundSessionCounterRef.current += 1;
    activeRevealSoundSessionRef.current = [revealSoundSessionCounterRef.current, getPackSaveKey(cards, set)].join(":");
    playedRevealSoundKeysRef.current = new Set();
    playedRevealHapticKeysRef.current = new Set();
  }

  async function preloadPackAssets(cards, set) {
    const cardUrls = cards.map((card) => getPackCardImageUrl(card, set));

    await preloadImages([getCardBackUrl(), ...cardUrls], { timeoutMs: 5000 });
  }

  function preparePackImages(cards, set) {
    const preloadId = packImagePreloadIdRef.current + 1;
    packImagePreloadIdRef.current = preloadId;
    setPackImagesReady(false);

    preloadPackAssets(cards, set).finally(() => {
      if (packImagePreloadIdRef.current === preloadId) setPackImagesReady(true);
    });
  }

  function clearRevealTimers() {
    revealTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    revealTimersRef.current = [];
  }

  async function saveRevealedPack(cards, set) {
    const saveKey = getPackSaveKey(cards, set);

    if (savedPackKeyRef.current === saveKey) return;

    savedPackKeyRef.current = saveKey;
    setHasSavedCurrentPack(true);

    const timestamp = Date.now();
    const nextNewPullKeys = new Set(
      cards
        .filter((card) => getCardCount(collection, card, set.id) <= 0)
        .map((card) => getCardKey(card, set.id))
    );
    const nextCollection = markCardsCollected(collection, cards, set.id, timestamp);
    const nextStats = {
      packsOpened: stats.packsOpened + 1,
      totalCardsPulled: stats.totalCardsPulled + cards.length,
    };

    setNewPullKeys(nextNewPullKeys);
    persistSessionCollection(nextCollection);
    setStats(nextStats);

    if (user) {
      const clientEventId = ensurePackOpenClientEventId(cards, set.id);
      enqueuePendingCloudPull(cards, set.id, user.id, clientEventId, {
        createdAt: timestamp,
        expectedPacksOpened: nextStats.packsOpened,
      });

      let syncResult = null;
      try {
        syncResult = await syncPendingCloudPulls(user.id);
      } catch (error) {
        console.warn("Mobile PackDex cloud save failed; durable pull remains queued", {
          setId: set.id,
          cardCount: cards.length,
          error,
        });
        return;
      }

      setStats(syncResult?.stats || nextStats);

      try {
        await runPostPackAchievementFlow({
          currentUser: user,
          set,
          cards,
          recordPackEvent: false,
        });
      } catch (error) {
        console.warn("Mobile PackDex achievement refresh failed after durable pack sync", {
          setId: set.id,
          cardCount: cards.length,
          error,
        });
      }
    }
  }

  function startReveal() {
    if (!selectedSet || pack.length === 0 || packStage !== "ready") return;

    playPackOpenSound(soundEnabled);
    beginReveal(pack, selectedSet);
  }

  function beginReveal(cards, set) {
    startRevealSoundSession(cards, set);
    skipRevealStartedRef.current = false;
    setRevealedCount(0);
    setPackStage("revealing");
    saveRevealedPack(cards, set);
  }

  function skipPackReveal() {
    if (packStage !== "revealing" || !packImagesReady || skipRevealStartedRef.current) return;

    skipRevealStartedRef.current = true;
    clearRevealTimers();
    setRevealedCount(pack.length);
    setPackStage("summary");
  }

  function handlePackScreenClick(event) {
    if (activeTab !== "open" || packStage !== "revealing" || !packImagesReady) return;
    if (event.target.closest("button, a, input, select, textarea, [role='button']")) return;

    skipPackReveal();
  }

  function returnToSets() {
    packImagePreloadIdRef.current += 1;
    setPackImagesReady(false);
    setPackStage("sets");
    setCollectionReturnSource("collection");
    setSelectedSet(null);
    setPack([]);
    setPackInstanceId((current) => current + 1);
    setRevealedCount(0);
    setNewPullKeys(new Set());
    setHasSavedCurrentPack(false);
    savedPackKeyRef.current = "";
    scrollScreenToTop();
  }

  function openAnotherPack() {
    if (!selectedSet) {
      returnToSets();
      return;
    }

    const nextPack = generatePack(selectedSet);
    ensurePackOpenClientEventId(nextPack, selectedSet.id);

    preparePackImages(nextPack, selectedSet);
    setPack(nextPack);
    setPackInstanceId((current) => current + 1);
    setRevealedCount(0);
    setNewPullKeys(new Set());
    setHasSavedCurrentPack(false);
    savedPackKeyRef.current = "";
    playPackOpenSound(soundEnabled);
    beginReveal(nextPack, selectedSet);
    scrollScreenToTop();
  }

  function inspectCard(card, set, context = {}) {
    setWishlistMessage(null);
    const origin = context.origin || activeTab;
    setInspectedCard({ card, set, origin, context: { ...context, origin, returnScroll: Number(screenContentRef.current?.scrollTop || 0) } });

    if (
      supabase &&
      set?.id &&
      !SETS_WITHOUT_MARKET_PRICE_DATA.has(set.id) &&
      !loadingPriceSetIdsRef.current.has(set.id)
    ) {
      loadingPriceSetIdsRef.current.add(set.id);
      loadCardPricesForCards(supabase, set, [card])
        .then((priceMap) => {
          setPriceMapsBySet((current) => {
            const merged = new Map(current[set.id] || []);
            priceMap.forEach((value, key) => merged.set(key, value));
            return { ...current, [set.id]: merged };
          });
        })
        .catch((error) => {
          console.warn("[PackDex prices] Unable to load inspect card prices", {
            setId: set.id,
            setName: set.name,
            error,
          });
        })
        .finally(() => {
          loadingPriceSetIdsRef.current.delete(set.id);
        });
    }
  }

  async function loadScannerCardPrice(card, set) {
    const cachedPriceMap = fullSetPriceMapsBySet[set?.id] || priceMapsBySet[set?.id];
    const cachedPrice = getCardDisplayPrice(card, cachedPriceMap, set?.id);

    if (cachedPrice || !supabase || !set?.id || SETS_WITHOUT_MARKET_PRICE_DATA.has(set.id)) return cachedPrice;

    try {
      const priceMap = await loadCardPricesForCards(supabase, set, [card]);
      setPriceMapsBySet((current) => {
        const merged = new Map(current[set.id] || []);
        priceMap.forEach((value, key) => merged.set(key, value));
        return { ...current, [set.id]: merged };
      });
      return getCardDisplayPrice(card, priceMap, set.id);
    } catch (error) {
      console.warn("[PackDex prices] Unable to load scanner card prices", { setId: set.id, setName: set.name, error });
      throw error;
    }
  }

  function createCustomBinder(name, theme = "midnight") {
    const nextBinder = createBinder({ name, tag: "Custom Binder", theme });
    const nextBinders = [nextBinder, ...binders];

    setBinders(nextBinders);
    saveBinders(nextBinders);
  }

  function importMasterSetBinder(set, name = "", theme = "midnight") {
    const existing = binders.find((binder) => binder.id === `master-set-${set.id}`);

    if (existing) return;

    const nextBinder = createMasterSetBinder(set, theme);

    if (!nextBinder) return;

    if (name.trim()) nextBinder.name = name.trim();

    const nextBinders = [nextBinder, ...binders];

    setBinders(nextBinders);
    saveBinders(nextBinders);
  }

  async function handleClaimWelcomeReward(choice) {
    if (!user?.id || !choice?.set || isClaimingWelcomeReward) return;

    setIsClaimingWelcomeReward(true);
    setWelcomeRewardError("");
    setLoadingMessage("Opening welcome pack...");

    try {
      const result = await claimMobileWelcomeGodPack(choice.set.id, choice.forcedFormat);
      const rewardPack = result.cards;

      if (!rewardPack?.length || !rewardPack.isGodPack) {
        throw new Error("This God Pack is not available right now. Please choose another pack.");
      }

      const claimedStatus = result.rewardStatus || result.status || {
          isEligible: true,
          isClaimed: true,
          setId: choice.set.id,
          claimedAt: new Date().toISOString(),
        };
      setWelcomeRewardStatus(claimedStatus);
      cacheWelcomeRewardStatus(user.id, claimedStatus);
      if (result.stats) setStats(result.stats);

      try {
        const refreshedCollection = await loadCloudCollection();
        setCollection(mergePendingCloudPullsIntoCollection(refreshedCollection, user.id));
      } catch (collectionError) {
        console.warn("Unable to refresh collection after welcome reward claim", collectionError);
      }

      try {
        await runPostPackAchievementFlow({
          currentUser: user,
          set: choice.set,
          cards: rewardPack,
          openedAt: result.rewardStatus?.claimedAt || result.status?.claimedAt || new Date().toISOString(),
          recordPackEvent: false,
        });
      } catch (achievementError) {
        console.warn("Unable to sync achievements after welcome reward claim", {
          setId: choice.set.id,
          cardCount: rewardPack.length,
          error: achievementError,
        });
      }

      preparePackImages(rewardPack, choice.set);
      setIsWelcomeRewardModalOpen(false);
      setActiveTab("open");
      setSelectedSet(choice.set);
      setPack(rewardPack);
      setPackInstanceId((current) => current + 1);
      setRevealedCount(0);
      setNewPullKeys(new Set(rewardPack.map((card) => getCardKey(card, choice.set.id))));
      setHasSavedCurrentPack(true);
      savedPackKeyRef.current = getPackSaveKey(rewardPack, choice.set);
      startRevealSoundSession(rewardPack, choice.set);
      setPackStage("revealing");
      playPackOpenSound(soundEnabled);
      scrollScreenToTop();
    } catch (error) {
      console.warn("Mobile welcome reward claim failed", error);
      setWelcomeRewardError(error?.message || "Could not open your welcome reward. Please try again.");
    } finally {
      setIsClaimingWelcomeReward(false);
      setLoadingMessage("");
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthMessage("");
    const isCreateMode = authMode === "signup";

    if (!supabase) {
      setAuthMessage("Supabase is not configured in this mobile app.");
      return;
    }

    if (authMode === "forgot") {
      if (!TURNSTILE_SITE_KEY) {
        setAuthMessage("Password reset verification is unavailable.");
        return;
      }

      if (!turnstileToken) {
        setAuthMessage("Please complete verification before requesting a reset link.");
        return;
      }

      setIsAuthSubmitting(true);
      setLoadingMessage("Sending reset email...");

      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), {
          redirectTo: getMobileResetPasswordUrl(),
          captchaToken: turnstileToken,
        });

        if (resetError) {
          setAuthMessage("Unable to send a reset email. Please try again.");
          setTurnstileToken("");
          setTurnstileMessage("Verification reset. Please verify again.");
          return;
        }

        setAuthMessage("If an account exists for this email, we sent a reset link.");
        setTurnstileToken("");
        setTurnstileMessage("");
      } catch {
        setAuthMessage("Unable to send a reset email. Please check your connection and try again.");
        setTurnstileToken("");
        setTurnstileMessage("Verification reset. Please verify again.");
      } finally {
        setIsAuthSubmitting(false);
        setLoadingMessage("");
      }

      return;
    }

    if (authPassword.length < 8) {
      setAuthMessage("Password must be at least 8 characters.");
      return;
    }

    if (isCreateMode && authPassword !== authConfirmPassword) {
      setAuthMessage("Passwords do not match.");
      return;
    }

    if (isCreateMode && !TURNSTILE_SITE_KEY) {
      setAuthMessage("Turnstile is not configured. Add VITE_TURNSTILE_SITE_KEY to mobile-app/.env.");
      return;
    }

    if (isCreateMode && !turnstileToken) {
      setAuthMessage("Please complete verification before creating an account.");
      return;
    }

    setIsAuthSubmitting(true);
    setLoadingMessage(authMode === "login" ? "Logging in..." : "Creating account...");

    try {
      const credentials = {
        email: authEmail.trim(),
        password: authPassword,
      };
      const { data, error } = isCreateMode
        ? await supabase.auth.signUp({
            ...credentials,
            options: {
              captchaToken: turnstileToken,
              emailRedirectTo: getMobileAuthCallbackUrl(),
            },
          })
        : await supabase.auth.signInWithPassword(credentials);

     if (error) {
       const message = String(error.message || "");
       setAuthMessage(
         message.toLowerCase().includes("email not confirmed")
           ? "Please confirm your email before logging in."
           : message
       );
        if (isCreateMode) {
          setTurnstileToken("");
          setTurnstileMessage("Verification reset. Please verify again.");
        }
        return;
      }

      const hasSession = Boolean(data?.session);
      const hasVerifiedSession = Boolean(
        data?.session &&
          (data?.user?.email_confirmed_at ||
            data?.user?.confirmed_at ||
            data?.session?.user?.email_confirmed_at ||
            data?.session?.user?.confirmed_at)
      );

      setAuthPassword("");
      setAuthConfirmPassword("");
      setTurnstileToken("");
      setTurnstileMessage("");

      if (isCreateMode && (!hasSession || !hasVerifiedSession)) {
        setSignupVerificationEmail(authEmail.trim());
        setIsSignupVerificationOpen(true);
        setIsAuthPanelOpen(false);
        await supabase.auth.signOut().catch(() => {});
        clearAccountScopedState();
        return;
      }

      const nextUser = await refreshAuthSession({ showLoading: false, autoOpenWelcomeReward: true });
      setAuthMessage(isCreateMode ? "Account created! You're now signed in." : "Logged in.");

      if (nextUser) {
        setIsAuthPanelOpen(false);
      } else {
        throw new Error("The account session could not be validated.");
      }
    } catch (error) {
      console.warn("Unable to load account data after mobile auth", error);
      setAuthMessage("Unable to finish account loading. Please try again.");
    } finally {
      setIsAuthSubmitting(false);
      setLoadingMessage("");
    }
  }

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();

    authValidationAttemptRef.current += 1;
    clearAccountScopedState();
    setAuthValidationState("guest");
    closeAuthProfile();
  }

  async function handleDeleteAccount() {
    const deletedUserId = user?.id;

    if (!deletedUserId || !supabase) {
      throw new Error("You must be signed in to delete your PackDex account.");
    }

    await deleteCurrentAccount(supabase);
    clearDeletedAccountLocalState(deletedUserId);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    authValidationAttemptRef.current += 1;
    clearAccountScopedState();
    setAuthValidationState("guest");
    setSoundEnabled(true);
    setHapticsEnabled(true);
    setCollectionEraFilter("All Eras");
    setActiveTab("open");
    returnToSets();
    closeAuthProfile();
  }

  async function handleContinueAsGuest() {
    await supabase?.auth.signOut({ scope: "local" }).catch(() => {});
    authValidationAttemptRef.current += 1;
    clearAccountScopedState();
    setAuthValidationState("guest");
    setIsDeleteAccountOpen(false);
  }

  if (isMobileAuthCallbackRoute) return <MobileAuthCallbackPage />;

  return (
    <main className="mobile-app theme-dark">
      <section className="phone-shell" aria-label="PackDex mobile app">
        <div className={`screen-content screen-${activeTab}`} ref={screenContentRef} onClick={handlePackScreenClick}>
          <MobileBrandHeader />
          {authValidationState === "validating" && activeTab !== "scanner" ? (
            <section className="mobile-auth-validation" role="status" aria-live="polite">
              <img src={POKEBALL_LOADING_SRC} alt="" />
              <strong>Checking your account...</strong>
              <span>Verifying this session securely.</span>
            </section>
          ) : <>
          {activeTab === "open" &&
            (packStage === "sets" ? (
              <OpenSetSelector collection={collection} onOpenPack={openPack} />
            ) : (
              <PackScreen
                user={user}
                pack={pack}
                packInstanceId={packInstanceId}
                selectedSet={selectedSet}
                stage={packStage}
                revealedCount={revealedCount}
                packImagesReady={packImagesReady}
                onStartReveal={startReveal}
                onSkipReveal={skipPackReveal}
                onBack={returnToSets}
                onOpenAnother={openAnotherPack}
                onViewCollection={viewSetCollection}
                onLogin={() => openAuthProfile("login")}
                onCreateAccount={() => openAuthProfile("signup")}
                onInspectCard={inspectCard}
                soundEnabled={soundEnabled}
                newPullKeys={newPullKeys}
                priceMap={selectedSet ? fullSetPriceMapsBySet[selectedSet.id] || priceMapsBySet[selectedSet.id] : null}
              />
            ))}
          {activeTab === "collection" && (
            <CollectionScreen
              collection={collection}
              binders={binders}
              selectedSetId={selectedCollectionSetId}
              collectionEraFilter={collectionEraFilter}
              collectionSetSearch={collectionSetSearch}
              onSelectSet={selectCollectionSet}
              onCollectionEraFilter={updateCollectionEraFilter}
              onCollectionSetSearch={setCollectionSetSearch}
              onOpenPacks={(set) => {
                setActiveTab("open");
                openPack(set);
              }}
              onImportMasterSet={importMasterSetBinder}
              onCreateBinder={createCustomBinder}
              onInspectCard={inspectCard}
              onReturnFromSet={returnFromCollectionSet}
              returnLabel={collectionReturnSource === "open" ? "Back to Open Packs" : collectionReturnSource === "wishlist" ? "Back to Wishlist" : "Back to Collection"}
              priceMap={selectedCollectionSetId ? fullSetPriceMapsBySet[selectedCollectionSetId] : null}
              priceStatus={selectedCollectionSetId ? fullSetPriceStatusBySet[selectedCollectionSetId] || "idle" : "idle"}
              valueScreenProps={{ user, collection, priceMapsBySet, estimatedCollectionValue, isValueLoading, onInspectCard: inspectCard, onOpenLogin: () => openAuthProfile("login"), onOpenSignup: () => openAuthProfile("signup") }}
            />
          )}
          {activeTab === "explore" && <Suspense fallback={<section className="mobile-auth-validation" role="status"><img src={POKEBALL_LOADING_SRC} alt="" /><strong>Loading Explore...</strong></section>}><ExploreScreen collection={collection} wishlistEntries={wishlistEntries} priceMapsBySet={{ ...priceMapsBySet, ...fullSetPriceMapsBySet }} onInspectCard={inspectCard} onOpenPack={(set) => { setActiveTab("open"); window.history.replaceState({}, "", window.location.pathname.startsWith("/mobile-app") ? "/mobile-app/" : "/"); openPack(set); }} onViewSetCollection={(set) => { selectCollectionSet(set, "collection"); setActiveTab("collection"); window.history.replaceState({}, "", window.location.pathname.startsWith("/mobile-app") ? "/mobile-app/" : "/"); }} /></Suspense>}
          {__PACKDEX_SCANNER_TEST__ && activeTab === "scanner" && MobileScannerPage && <Suspense fallback={null}><MobileScannerPage authState={authValidationState} authUserId={authValidationState === "authenticated" ? user?.id || "" : ""} onRequireAuth={openScannerAuth} onLoadActionState={loadScannedCardActionState} onAddToCollection={addScannedCardToCollection} onAddToWishlist={addScannedCardToWishlist} onSearchManually={openScannerSearchInCollection} onLoadCardPrice={loadScannerCardPrice} /></Suspense>}
          {activeTab === "value" && (
            <ValueScreen
              user={user}
              collection={collection}
              priceMapsBySet={priceMapsBySet}
              estimatedCollectionValue={estimatedCollectionValue}
              isValueLoading={isValueLoading}
              onInspectCard={inspectCard}
              onOpenLogin={() => openAuthProfile("login")}
              onOpenSignup={() => openAuthProfile("signup")}
            />
          )}
          {activeTab === "wishlist" && user && (
            <WishlistScreen
              entries={wishlistEntries}
              status={wishlistStatus}
              error={wishlistError}
              pendingKeys={wishlistPendingKeys}
              onRetry={() => refreshWishlist(user)}
              onBack={leaveWishlist}
              onOpenSet={viewWishlistSet}
              onInspectCard={inspectCard}
              onRemove={(set, card) => toggleWishlistCard(set, card, true)}
            />
          )}
          {activeTab === "profile" && (
            <ProfileScreen
              user={user}
              stats={stats}
              setsCompleted={setsCompleted}
              isAuthPanelOpen={isAuthPanelOpen}
              soundEnabled={soundEnabled}
              hapticsEnabled={hapticsEnabled}
              onOpenLogin={() => openAuthProfile("login")}
              onOpenSignup={() => openAuthProfile("signup")}
              onLogout={handleLogout}
              onDeleteAccount={() => setIsDeleteAccountOpen(true)}
              onToggleSound={() => setSoundEnabled((value) => !value)}
              onToggleHaptics={() => setHapticsEnabled((value) => !value)}
              wishlistCount={wishlistEntries.length}
              onOpenWishlist={openWishlist}
              estimatedCollectionValue={estimatedCollectionValue}
              isValueLoading={isValueLoading}
              achievements={achievements}
              achievementProgress={achievementProgress}
              isAchievementsLoading={isAchievementsLoading}
              onLoadAchievementProgress={() => loadUserAchievementProgress(user)}
              welcomeRewardStatus={welcomeRewardStatus}
              onOpenWelcomeReward={() => {
                setWelcomeRewardError("");
                setSelectedWelcomeRewardSetId(WELCOME_REWARD_CHOICES[0]?.setId || "");
                setIsWelcomeRewardModalOpen(true);
              }}
            />
          )}
          </>}
        </div>

        {cardDestinationOverlay && (
          <div className="card-destination-overlay" aria-label="Card detail destination">
            <Suspense fallback={<section className="mobile-auth-validation" role="status"><img src={POKEBALL_LOADING_SRC} alt="" /><strong>Loading Pokémon...</strong></section>}>
              <ExploreScreen
                collection={collection}
                wishlistEntries={wishlistEntries}
                priceMapsBySet={{ ...priceMapsBySet, ...fullSetPriceMapsBySet }}
                onInspectCard={inspectCard}
                onOpenPack={() => {}}
                onViewSetCollection={() => {}}
              />
            </Suspense>
          </div>
        )}

        <nav className={`bottom-tabs ${isPackOpening ? "is-pack-locked" : ""}`} aria-label="Mobile app sections">
          {tabs.map((tab) => {
            const isNavigationLocked = isPackOpening && tab.id !== "open";

            return (
              <button
                className={`${activeTab === tab.id ? "is-active" : ""} ${isNavigationLocked ? "is-disabled" : ""}`}
                key={tab.id}
                type="button"
                disabled={isNavigationLocked}
                aria-disabled={isNavigationLocked}
                onClick={() => switchMobileTab(tab.id)}
              >
                <TabIcon icon={tab.icon} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {authValidationState !== "validating" && <AchievementUnlockToast toast={activeAchievementToast} />}

        {authValidationState !== "validating" && !cardDestinationOverlay && <CardInspectModal
          item={inspectedCard}
          collection={collection}
          user={user}
          wishlistKeys={new Set(wishlistEntries.map((entry) => getWishlistKey(entry.setId, entry.cardId)))}
          wishlistPendingKeys={wishlistPendingKeys}
          wishlistMessage={wishlistMessage}
          onToggleWishlist={toggleWishlistCard}
          onLogin={() => openAuthProfile("login")}
          priceMap={inspectedCard?.set ? fullSetPriceMapsBySet[inspectedCard.set.id] || priceMapsBySet[inspectedCard.set.id] : null}
          onLoadSpecies={loadExploreSpeciesForCard}
          onViewPokemon={openPokemonFromInspect}
          onViewSet={(id) => openCardDestination({ kind: "set", id })}
          onViewEra={(name) => import("./explore/exploreData.js").then(({ exploreEras }) => { const era = exploreEras.find((item) => item.name === name); if (era) openCardDestination({ kind: "era", id: era.id }); })}
          onClose={() => setInspectedCard(null)}
        />}
        <MobileAuthModal
          isOpen={authValidationState !== "validating" && isAuthPanelOpen && !user}
          authMode={authMode}
          authEmail={authEmail}
          authPassword={authPassword}
          authConfirmPassword={authConfirmPassword}
          turnstileToken={turnstileToken}
          turnstileMessage={turnstileMessage}
          authMessage={authMessage}
          isAuthSubmitting={isAuthSubmitting}
          onClose={closeAuthProfile}
          onAuthMode={setAuthModeClean}
          onAuthEmail={setAuthEmail}
          onAuthPassword={setAuthPassword}
          onAuthConfirmPassword={setAuthConfirmPassword}
          onTurnstileToken={setTurnstileToken}
          onTurnstileMessage={setTurnstileMessage}
          onAuthSubmit={handleAuthSubmit}
        />
        <DeleteAccountDialog
          isOpen={isDeleteAccountOpen}
          onClose={() => setIsDeleteAccountOpen(false)}
          onConfirm={handleDeleteAccount}
          onContinueAsGuest={handleContinueAsGuest}
        />
        <SignupVerificationModal
          isOpen={isSignupVerificationOpen}
          email={signupVerificationEmail}
          onClose={() => setIsSignupVerificationOpen(false)}
        />
        <WelcomeRewardModal
          isOpen={authValidationState !== "validating" && isWelcomeRewardModalOpen}
          rewardStatus={welcomeRewardStatus}
          selectedSetId={selectedWelcomeRewardSetId}
          isClaiming={isClaimingWelcomeReward}
          error={welcomeRewardError}
          onSelect={(setId) => {
            setSelectedWelcomeRewardSetId(setId);
            setWelcomeRewardError("");
          }}
          onClaim={handleClaimWelcomeReward}
          onClose={() => setIsWelcomeRewardModalOpen(false)}
        />
        <WelcomeDisclaimerModal
          isOpen={isWelcomeDisclaimerOpen}
          onDismiss={() => setIsWelcomeDisclaimerOpen(false)}
        />
        <PrivacyChoicesDialog />
        {loadingMessage && <PokeballLoadingOverlay message={loadingMessage} />}
      </section>
    </main>
  );
}

function App() {
  const normalizedPath = typeof window === "undefined" ? "" : window.location.pathname.replace(/\/+$/, "");
  const isResetPasswordRoute =
    normalizedPath === "/mobile-app/reset-password" || normalizedPath === "/reset-password";

  if (isResetPasswordRoute) {
    return <MobileResetPasswordPage supabase={supabase} />;
  }

  return <MobileApp />;
}

export default App;
