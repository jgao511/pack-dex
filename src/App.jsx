import { useEffect, useMemo, useRef, useState } from "react";
import { Mail } from "lucide-react";
import PackOpening from "./components/PackOpening.jsx";
import AccountSaveNotice from "./components/AccountSaveNotice.jsx";
import AuthPanel, { AuthModal } from "./components/AuthPanel.jsx";
import DeleteAccountDialog from "./components/DeleteAccountDialog.jsx";
import CardReveal from "./components/CardReveal.jsx";
import CardDetailModal from "./components/CardDetailModal.jsx";
import CollectionPage from "./components/CollectionPage.jsx";
import FoilCard from "./components/FoilCard.jsx";
import PullSummary from "./components/PullSummary.jsx";
import SetSelect from "./components/SetSelect.jsx";
import { sets } from "./data/sets.js";
import {
  enqueuePendingCloudPull,
  getPendingCloudPullCount,
  loadCloudCollection,
  mergePendingCloudPullsIntoCollection,
  savePulledCardsToCloud,
  syncPendingCloudPulls,
} from "./lib/cloudCollection.js";
import {
  loadCloudBinders,
  saveCloudBinders,
  upsertCloudBinder,
} from "./lib/cloudBinders.js";
import {
  emptyProfileStats,
  loadCloudProfileStats,
} from "./lib/cloudProfileStats.js";
import { ensurePackOpenClientEventId, recordPackOpenEvent } from "./lib/packOpenEvents.js";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient.js";
import {
  canGeneratePack,
  generateForcedGodPack,
  generatePack,
  GOD_PACK_CONFIG,
  getDisplayCardName,
  getDisplayRarity,
} from "./utils/packGenerator.js";
import {
  addCardToBinder,
  clearBinderCards,
  createBinder,
  createMasterSetBinder,
  getBinderCardKey,
  isMasterSetBinder,
  loadBinders,
  removeCardFromBinder,
  saveBinders,
  updateBinderTheme,
} from "./utils/binderStorage.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
  getSetCollectionProgress,
  isCardCollected,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "./utils/collectionStorage.js";
import { CARD_BACK_URL, getCardImageUrl, getPokeballLoadingUrl, getSetLogoUrl, getSetPackArtUrl } from "./utils/assetUrls.js";
import { preloadImage, preloadImages } from "./utils/imageCache.js";
import { compareCardsByRarity } from "./utils/rarityRank.js";
import { cacheWelcomeRewardStatus, loadWelcomeRewardStatus } from "./lib/welcomeReward.js";
import { claimWelcomeGodPack } from "./lib/securePackOpening.js";
import { clearDeletedAccountLocalState, deleteCurrentAccount } from "./lib/accountDeletion.js";
import { markPackGenerationComplete, markPackGenerationStart } from "./utils/imageDebug.js";
import { markCardBackPreloadFinish, markCardBackPreloadStart } from "./utils/cardBackDebug.js";
import {
  clearImageWarmupQueue,
  pauseImageWarmup,
  resumeImageWarmup,
  scheduleSelectedSetImageWarmup,
} from "./utils/imageWarmup.js";

const TAB_LOADING_MS = 420;
const AUTH_MODAL_LOADING_MS = 380;
const MIN_RETURN_LOADING_MS = 450;
const RETURN_LOADING_RENDER_DELAY_MS = 100;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const SUPPORT_EMAIL = "packdexsupport@gmail.com";
const GUEST_WELCOME_BETA_SEEN_KEY = "packdex_guest_welcome_beta_seen";
const USER_WELCOME_BETA_SEEN_KEY_PREFIX = "packdex_welcome_beta_seen_";
const LEGACY_PROFILE_STATS_STORAGE_KEYS = ["packdex-profile-stats"];
const THEME_STORAGE_KEY = "packdex-theme";
const COLLECTION_DASHBOARD_PAGE_SIZE = 60;
const BINDER_PAGE_SIZE = 9;
const MASTER_BINDER_PAGE_SIZE = 9;
const ACTIVE_BINDER_STORAGE_KEY = "packdex-active-binder-id";
const WELCOME_REWARD_CHOICES = [
  {
    setId: "prismatic-evolutions",
    title: "Prismatic Evolutions",
    description: "A premium Eeveelution God Pack with a glowing final Eevee ex reveal.",
    forcedFormat: "PRISMATIC_FULL_EEVEELUTION_PACK",
  },
  {
    setId: "black-bolt",
    title: "Black Bolt",
    description: "Nine Illustration Rares and one Special Illustration Rare from Black Bolt.",
  },
  {
    setId: "white-flare",
    title: "White Flare",
    description: "Nine Illustration Rares and one Special Illustration Rare from White Flare.",
  },
  {
    setId: "ascended-heroes",
    title: "Ascended Heroes",
    description: "Three Mega Attack Rares and seven Special Illustration Rares.",
  },
  {
    setId: "151",
    title: "151 Demi-God Pack",
    description: "One complete starter evolution line with IR, IR, and SIR cards.",
  },
];

const MAIN_TABS = [
  { id: "open", label: "Open a Pack" },
  { id: "collection", label: "Collection" },
  { id: "profile", label: "Profile" },
];

function getInitialTheme() {
  if (typeof window === "undefined") return "light";

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return "dark";
}

function applyPackDexTheme(theme) {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

if (typeof window !== "undefined") {
  applyPackDexTheme(getInitialTheme());
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => getInitialTheme());

  useEffect(() => {
    applyPackDexTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <div
      className="theme-toggle"
      role="group"
      aria-label="Theme selector"
    >
      {["light", "dark"].map((themeOption) => (
        <button
          key={themeOption}
          className={`theme-toggle__option ${theme === themeOption ? "is-active" : ""}`}
          type="button"
          aria-pressed={theme === themeOption}
          onClick={() => setTheme(themeOption)}
        >
          {themeOption}
        </button>
      ))}
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label="Returning to set">
      <img className="loading-pokeball" src={POKEBALL_LOADING_SRC} alt="" />
      <div className="loading-text">Returning to set...</div>
    </div>
  );
}

function TabLoadingOverlay({ text = "Loading...", subtext = "" }) {
  return (
    <div className="tab-loading-overlay" role="status" aria-live="polite" aria-label="Loading section">
      <div className="tab-loading-card">
        <img src={POKEBALL_LOADING_SRC} alt="" />
        <div className="tab-loading-copy">
          <span>{text}</span>
          {subtext && <small>{subtext}</small>}
        </div>
      </div>
    </div>
  );
}

function getWelcomeBetaSeenKey(user) {
  return user?.id ? `${USER_WELCOME_BETA_SEEN_KEY_PREFIX}${user.id}` : GUEST_WELCOME_BETA_SEEN_KEY;
}

function hasSeenWelcomeBeta(user) {
  if (typeof window === "undefined") return true;

  return window.localStorage.getItem(getWelcomeBetaSeenKey(user)) === "true";
}

function markWelcomeBetaSeen(user) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(getWelcomeBetaSeenKey(user), "true");
}

function WelcomeBetaModal({ isOpen, onDismiss }) {
  if (!isOpen) return null;

  return (
    <div className="welcome-beta-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-beta-title">
      <div className="welcome-beta-card">
        <div className="welcome-beta-heading">
          <span>Beta</span>
          <h2 id="welcome-beta-title">Welcome to PackDex</h2>
        </div>
        <div className="welcome-beta-copy">
          <p>
            Welcome to PackDex! PackDex is currently in beta, so you may still notice small bugs, layout changes, or
            slower image loading while we continue improving the site.
          </p>
          <p>
            Card images may load slowly the first few times you open a pack, but they should get faster as your browser
            caches them.
          </p>
          <p>
            We recently reset early beta collection data to fix account saving issues and give testers a clean start.
            Thanks for helping test PackDex while it improves.
          </p>
          <p>
            For support or bug reports, contact{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
        <button className="primary-button welcome-beta-button" type="button" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}

function hasCollectionEntries(collection) {
  return Object.values(collection || {}).some((setCollection) => Object.keys(setCollection || {}).length > 0);
}

function resetPageScroll() {
  if (typeof window === "undefined") return;

  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
  window.setTimeout(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, 0);
}

function pushAppHistory(state) {
  if (typeof window === "undefined") return;

  window.history.pushState(
    {
      ...(window.history.state || {}),
      packdexApp: true,
      ...state,
    },
    "",
    window.location.pathname
  );
}

function replaceAppHistory(state) {
  if (typeof window === "undefined") return;

  window.history.replaceState(
    {
      packdexApp: true,
      ...state,
    },
    "",
    window.location.pathname
  );
}

function removeLegacyProfileStatsStorage() {
  if (typeof window === "undefined") return;

  LEGACY_PROFILE_STATS_STORAGE_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
}

function getCollectedCards(collection) {
  return sets.flatMap((set) =>
    getPullableCollectionCards(set)
      .filter((card) => isCardCollected(collection, card, set.id))
      .map((card) => ({
        card,
        set,
        count: getCardCount(collection, card, set.id),
      }))
  );
}

function getBinderDisplayCards(binder, collection) {
  return (binder?.cards || [])
    .map((item) => {
      const set = sets.find((candidateSet) => candidateSet.id === item.setId);

      if (!set) return null;

      const card = getPullableCollectionCards(set).find((candidateCard) => getBinderCardKey(candidateCard, set.id) === item.key);

      if (!card || !isCardCollected(collection, card, set.id)) return null;

      return {
        ...item,
        card,
        set,
        count: getCardCount(collection, card, set.id),
      };
    })
    .filter(Boolean);
}

function sortBinderCards(cards, sortMode) {
  const sorted = [...cards];

  if (sortMode === "rarity") {
    sorted.sort((a, b) => compareCardsByRarity(a.card, b.card, a.set, b.set));
    return sorted;
  }

  if (sortMode === "set") {
    sorted.sort(
      (a, b) =>
        String(a.set.name || "").localeCompare(String(b.set.name || "")) ||
        compareCardsByRarity(a.card, b.card, a.set, b.set)
    );
    return sorted;
  }

  sorted.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt || 0) - (b.addedAt || 0));
  return sorted;
}

function cardNumberValue(card) {
  const parsed = Number.parseInt(String(card?.number || ""), 10);

  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sortCardsBySetNumber(cards) {
  return [...cards].sort(
    (a, b) =>
      cardNumberValue(a) - cardNumberValue(b) ||
      String(a?.number || "").localeCompare(String(b?.number || "")) ||
      String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}

function chunkItems(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function AuthSaveNotice({ onOpenAuth }) {
  return <AccountSaveNotice onOpenAuth={onOpenAuth} message="to save your collection and binders across devices." />;
}

function LegalPage({ type }) {
  const isPrivacy = type === "privacy";

  return (
    <section className="legal-screen">
      <img className="site-logo" src="/packdex-icon-192.png" alt="PackDex" />
      <span className="set-mark">{isPrivacy ? "Privacy" : "Terms"}</span>
      <h1>{isPrivacy ? "Privacy Policy" : "Terms of Service"}</h1>
      <p className="legal-effective-date">Effective Date: June 1, 2026</p>
      {isPrivacy ? (
        <div className="legal-copy">
          <p>This Privacy Policy explains how PackDex handles information when you use the site.</p>
          <h2>1. Information We Collect</h2>
          <p>
            If you create an account, PackDex may collect and store your email address through Supabase authentication.
            PackDex may also store collection-related data linked to your account, including card IDs, set IDs,
            quantities, card names, card numbers, rarity, and image URLs.
          </p>
          <h2>2. How We Use Information</h2>
          <p>
            PackDex uses account and collection information to let users log in, save account collections, and use
            account-based features.
          </p>
          <h2>3. Authentication</h2>
          <p>
            PackDex uses Supabase to provide account authentication. Supabase may process login-related information
            such as your email address and authentication tokens according to Supabase's own terms and privacy
            practices.
          </p>
          <h2>4. Local Storage</h2>
          <p>
            PackDex may use browser localStorage to save guest collection data, preferences, or other local site data
            on your device. Guest data may remain on your device unless you clear your browser storage.
          </p>
          <h2>5. Cloud Collection Saving</h2>
          <p>
            When you are signed in, PackDex may save your collection data to Supabase so your collection can load again
            when you log back in.
          </p>
          <h2>6. What We Do Not Collect</h2>
          <p>
            PackDex does not intentionally collect sensitive personal information. Do not enter sensitive personal
            information into PackDex.
          </p>
          <h2>7. Sharing of Information</h2>
          <p>
            PackDex does not sell user data. Information may be processed by service providers used to operate the
            site, such as Supabase for authentication and database features.
          </p>
          <h2>8. Data Security</h2>
          <p>
            PackDex uses reasonable technical measures such as Supabase authentication and database access rules to help
            protect account-linked data. However, no online service can guarantee perfect security.
          </p>
          <h2>9. Children's Privacy</h2>
          <p>
            PackDex is intended for general audiences and entertainment purposes. Users should only create accounts if
            they are allowed to do so under the rules that apply to them.
          </p>
          <h2>10. Changes to This Policy</h2>
          <p>
            This Privacy Policy may be updated from time to time. Continued use of PackDex after changes means you
            accept the updated policy.
          </p>
          <h2>11. Contact</h2>
          <p>
            For questions about this Privacy Policy, contact PackDex support at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      ) : (
        <div className="legal-copy">
          <p>Welcome to PackDex. By using PackDex, you agree to these Terms of Service.</p>
          <h2>1. About PackDex</h2>
          <p>
            PackDex is a fan-made Pokemon TCG pack-opening simulator and collection tracker for virtual collections.
            Pack openings are simulated and do not award physical cards, money, prizes, or redeemable items.
            PackDex is not affiliated with Nintendo, Creatures, Game Freak, or The Pokemon Company.
          </p>
          <h2>2. Use of the Site</h2>
          <p>
            You may use PackDex for personal, non-commercial entertainment purposes. You agree not to abuse the service,
            interfere with the site's operation, attempt to access another user's account or data, or use automated
            tools to overload the site.
          </p>
          <h2>3. Accounts</h2>
          <p>
            You may create an account to save your collection and related account features. You are responsible for
            keeping your login information secure. PackDex uses Supabase to provide authentication services.
          </p>
          <h2>4. Saved Collection Data</h2>
          <p>
            When you are signed in, PackDex may save collection data connected to your account, including card IDs, set
            IDs, quantities, rarity, card names, card numbers, and image URLs. This data is used to provide
            virtual collection-saving features inside PackDex.
          </p>
          <h2>5. Intellectual Property</h2>
          <p>
            Pokemon names, card artwork, logos, and related trademarks belong to their respective owners. PackDex does
            not claim ownership of Pokemon intellectual property. PackDex's original site design, layout, and code
            belong to the PackDex project unless otherwise noted.
          </p>
          <h2>6. Availability</h2>
          <p>
            PackDex is provided as-is. The site may change, experience downtime, or have features removed or updated at
            any time.
          </p>
          <h2>7. Limitation of Liability</h2>
          <p>
            PackDex is provided for entertainment purposes. To the fullest extent permitted by law, PackDex is not
            responsible for losses, damages, or issues that may result from using the site.
          </p>
          <h2>8. Changes to These Terms</h2>
          <p>
            These Terms may be updated from time to time. Continued use of PackDex after changes means you accept the
            updated Terms.
          </p>
          <h2>9. Contact</h2>
          <p>
            For questions about these Terms, contact PackDex support at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      )}
      <a className="primary-button" href="/">
        Back to PackDex
      </a>
    </section>
  );
}

function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("Preparing your password reset...");
  const [error, setError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function prepareResetSession() {
      if (!supabase) {
        setError("Supabase is not configured yet.");
        setStatus("");
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = searchParams.get("error_description") || hashParams.get("error_description");
      const code = searchParams.get("code");

      if (authError) {
        if (!isMounted) return;
        window.history.replaceState({}, document.title, "/reset-password");
        setError(authError);
        setStatus("");
        return;
      }

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            throw exchangeError;
          }
        } else {
          const { data, error: sessionError } = await supabase.auth.getSession();

          if (sessionError) {
            throw sessionError;
          }

          if (!data.session) {
            throw new Error("Password reset link is missing or has expired.");
          }
        }

        if (!isMounted) return;

        window.history.replaceState({}, document.title, "/reset-password");
        setIsReady(true);
        setStatus("Enter a new password for your PackDex account.");
      } catch (resetError) {
        if (!isMounted) return;

        window.history.replaceState({}, document.title, "/reset-password");
        setStatus("");
        setError(resetError.message || "Unable to open this password reset link.");
      }
    }

    prepareResetSession();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!isReady) {
      setError("Password reset link is not ready. Please request a new reset email.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setStatus("Password updated. Redirecting to PackDex...");
      window.setTimeout(() => {
        window.location.assign("/");
      }, 1100);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="reset-password-screen">
      <img className="site-logo" src="/packdex-icon-192.png" alt="PackDex" />
      <span className="set-mark">Account</span>
      <h1>Reset Password</h1>
      <p>Choose a new password for your PackDex account.</p>
      <form className="auth-form reset-password-form" onSubmit={handleSubmit}>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            disabled={!isReady}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            disabled={!isReady}
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={isSubmitting || !isReady}>
          {isSubmitting ? "Updating..." : "Update Password"}
        </button>
      </form>
      {status && <div className="auth-message">{status}</div>}
      {error && <div className="auth-message is-error">{error}</div>}
      <a className="secondary-button" href="/">
        Back to PackDex
      </a>
    </section>
  );
}

function AuthCallbackPage() {
  const [status, setStatus] = useState("Confirming your PackDex account...");
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function finishAuthCallback() {
      if (!supabase) {
        setError("Supabase is not configured yet.");
        setStatus("");
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = searchParams.get("error_description") || hashParams.get("error_description");
      const code = searchParams.get("code");

      if (authError) {
        if (!isMounted) return;
        setError(authError);
        setStatus("");
        window.history.replaceState({}, document.title, "/auth/callback");
        return;
      }

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            throw exchangeError;
          }
        } else {
          const { data, error: sessionError } = await supabase.auth.getSession();

          if (sessionError) {
            throw sessionError;
          }

          if (!data.session) {
            throw new Error("Confirmation link is missing or has expired.");
          }
        }

        if (!isMounted) return;

        window.history.replaceState({}, document.title, "/");
        setStatus("Account confirmed! Redirecting to PackDex...");
        window.setTimeout(() => {
          window.location.assign("/");
        }, 900);
      } catch (callbackError) {
        if (!isMounted) return;

        window.history.replaceState({}, document.title, "/auth/callback");
        setStatus("");
        setError(callbackError.message || "Unable to confirm your account. Please request a new email.");
      }
    }

    finishAuthCallback();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <section className="auth-callback-screen">
      <img className="site-logo" src="/packdex-icon-192.png" alt="PackDex" />
      <span className="set-mark">Account</span>
      <h1>Email Confirmation</h1>
      {status && <div className="auth-message">{status}</div>}
      {error && <div className="auth-message is-error">{error}</div>}
      {error && (
        <a className="secondary-button" href="/">
          Back to PackDex
        </a>
      )}
    </section>
  );
}

function CollectionDashboard({
  collection,
  binders,
  user,
  requestedSubtab = "",
  requestedBinderId = "",
  onBinderRequestHandled,
  onOpenAuth,
  onCreateBinder,
  onCreateMasterSetBinder,
  onUpdateBinderTheme,
  onClearBinder,
  onAddToBinder,
  onRemoveFromBinder,
}) {
  const [activeCollectionSubtab, setActiveCollectionSubtab] = useState("sets");
  const [binderHomeRequest, setBinderHomeRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [eraFilter, setEraFilter] = useState("all");
  const [setFilter, setSetFilter] = useState("all");
  const [sortMode, setSortMode] = useState("recent");
  const [page, setPage] = useState(1);
  const [selectedCard, setSelectedCard] = useState(null);
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const eraOptions = useMemo(
    () => ["all", ...new Set(collectedCards.map(({ set }) => set.era || "Other"))],
    [collectedCards]
  );
  const setOptions = useMemo(
    () => collectedCards.map(({ set }) => set).filter((set, index, allSets) => allSets.findIndex((item) => item.id === set.id) === index),
    [collectedCards]
  );
  const visibleCards = useMemo(() => {
    const search = query.toLowerCase().trim();

    return collectedCards
      .filter(({ card, set }) => {
        const matchesSearch =
          !search ||
          String(card.name || "").toLowerCase().includes(search) ||
          String(card.rarity || "").toLowerCase().includes(search) ||
          String(set.name || "").toLowerCase().includes(search);
        const matchesEra = eraFilter === "all" || (set.era || "Other") === eraFilter;
        const matchesSet = setFilter === "all" || set.id === setFilter;

        return matchesSearch && matchesEra && matchesSet;
      })
      .sort((a, b) => {
        if (sortMode === "name") return String(a.card.name || "").localeCompare(String(b.card.name || ""));
        if (sortMode === "rarity") return compareCardsByRarity(a.card, b.card, a.set, b.set);
        if (sortMode === "set") return String(a.set.name || "").localeCompare(String(b.set.name || ""));

        const keyA = getCardCollectionKey(a.card, a.set.id);
        const keyB = getCardCollectionKey(b.card, b.set.id);

        return (collection[b.set.id]?.[keyB]?.lastCollectedAt || 0) - (collection[a.set.id]?.[keyA]?.lastCollectedAt || 0);
      });
  }, [collectedCards, collection, eraFilter, query, setFilter, sortMode]);
  const totalPages = Math.max(1, Math.ceil(visibleCards.length / COLLECTION_DASHBOARD_PAGE_SIZE));
  const pagedCards = visibleCards.slice(
    (page - 1) * COLLECTION_DASHBOARD_PAGE_SIZE,
    page * COLLECTION_DASHBOARD_PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [eraFilter, query, setFilter, sortMode]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!requestedSubtab && !requestedBinderId) return;

    if (requestedSubtab === "binders" || requestedBinderId) {
      setActiveCollectionSubtab("binders");
    } else if (requestedSubtab === "sets") {
      setActiveCollectionSubtab("sets");
    }
  }, [requestedBinderId, requestedSubtab]);

  return (
    <section className="dashboard-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Collection</span>
        <h1>{activeCollectionSubtab === "sets" ? "Set Collection" : "My Binders"}</h1>
      </div>

      {!user && <AuthSaveNotice onOpenAuth={onOpenAuth} />}

      <div className="collection-subtabs" role="tablist" aria-label="Collection views">
        <button
          className={activeCollectionSubtab === "sets" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={activeCollectionSubtab === "sets"}
          onClick={() => setActiveCollectionSubtab("sets")}
        >
          Set Collection
        </button>
        <button
          className={activeCollectionSubtab === "binders" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={activeCollectionSubtab === "binders"}
          onClick={() => {
            setActiveCollectionSubtab("binders");
            setBinderHomeRequest((request) => request + 1);
          }}
        >
          My Binders
        </button>
      </div>

      {activeCollectionSubtab === "sets" ? (
        <div className="collection-subtab-panel" role="tabpanel">
          {collectedCards.length === 0 ? (
            <div className="empty-state">
              <h2>No cards collected yet</h2>
              <p>Open a few packs first and your collection will start filling in here.</p>
            </div>
          ) : (
            <>
              <div className="collection-controls dashboard-controls">
                <label className="collection-search">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search collected cards"
                  />
                </label>
                <select value={eraFilter} onChange={(event) => setEraFilter(event.target.value)} aria-label="Filter by era">
                  {eraOptions.map((era) => (
                    <option key={era} value={era}>
                      {era === "all" ? "All Eras" : era}
                    </option>
                  ))}
                </select>
                <select value={setFilter} onChange={(event) => setSetFilter(event.target.value)} aria-label="Filter by set">
                  <option value="all">All Sets</option>
                  {setOptions.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort collected cards">
                  <option value="recent">Recently Collected</option>
                  <option value="name">Name</option>
                  <option value="rarity">Rarity</option>
                  <option value="set">Set</option>
                </select>
              </div>

              <div className="collection-grid">
                {pagedCards.map(({ card, set, count }) => (
                  <article
                    className="collection-card is-collected"
                    key={`${set.id}-${card.id || card.number}-${card.name}`}
                    onClick={() => setSelectedCard({ card, set, count })}
                  >
                    <div className="collection-card-image">
                      <FoilCard
                        card={card}
                        set={set}
                        variant="collection"
                        enableTransform={false}
                        enableCursorBlob={false}
                        enableTiltFoil={false}
                        showFoil={false}
                      />
                      {count > 1 && <span className="count-badge">x{count}</span>}
                    </div>
                    <div className="collection-card-meta">
                      <strong>{getDisplayCardName(card, set)}</strong>
                      <span>
                        {set.name} - {getDisplayRarity(card, set)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>

              {visibleCards.length > COLLECTION_DASHBOARD_PAGE_SIZE && (
                <div className="pagination-controls" aria-label="Collection pages">
                  <button type="button" onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))} disabled={page === 1}>
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages} - {visibleCards.length} cards
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="collection-subtab-panel" role="tabpanel">
          <BinderSection
            binders={binders}
            collection={collection}
            user={user}
            requestedBinderId={requestedBinderId}
            onBinderRequestHandled={onBinderRequestHandled}
            binderHomeRequest={binderHomeRequest}
            onOpenAuth={onOpenAuth}
            onCreateBinder={onCreateBinder}
            onCreateMasterSetBinder={onCreateMasterSetBinder}
            onUpdateBinderTheme={onUpdateBinderTheme}
            onClearBinder={onClearBinder}
            onAddToBinder={onAddToBinder}
            onRemoveFromBinder={onRemoveFromBinder}
          />
        </div>
      )}

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          set={selectedCard.set}
          collected={selectedCard.collected ?? true}
          count={selectedCard.count}
          showBinderControl={selectedCard.collected ?? true}
          binders={binders}
          onAddToBinder={onAddToBinder}
          onRemoveFromBinder={onRemoveFromBinder}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </section>
  );
}

const BINDER_TAGS = [...new Set([
  "Favorites",
  "Pulls",
  "Trade Binder",
  "Master Set",
  "Deck Ideas",
  "Chase Cards",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Full Art Collection",
  ...sets.map((set) => set.name),
])];

const BINDER_TAG_BASE_SET_IDS = {
  "Scarlet & Violet": "scarlet-violet",
  "Sword & Shield": "sword-shield",
  "Sun & Moon": "sun-moon",
  XY: "xy1",
};

const BINDER_THEME_OPTIONS = [
  { id: "midnight", label: "Midnight", value: "#18213f" },
  { id: "royal", label: "Royal", value: "#2557b8" },
  { id: "crimson", label: "Crimson", value: "#9f283d" },
  { id: "forest", label: "Forest", value: "#1d6b4f" },
  { id: "gold", label: "Gold", value: "#c58a21" },
  { id: "violet", label: "Violet", value: "#5146c8" },
];

function getBinderTheme(themeId) {
  return BINDER_THEME_OPTIONS.find((theme) => theme.id === themeId) || BINDER_THEME_OPTIONS[0];
}

function getBinderTagLogo(tag) {
  const setId = BINDER_TAG_BASE_SET_IDS[tag];
  const set = sets.find((candidateSet) => candidateSet.id === setId || candidateSet.name === tag);

  return set ? getSetLogoUrl(set) : "";
}

function loadActiveBinderId() {
  if (typeof window === "undefined") return "";

  return window.localStorage.getItem(ACTIVE_BINDER_STORAGE_KEY) || "";
}

function saveActiveBinderId(binderId) {
  if (typeof window === "undefined") return;

  if (binderId) {
    window.localStorage.setItem(ACTIVE_BINDER_STORAGE_KEY, binderId);
  } else {
    window.localStorage.removeItem(ACTIVE_BINDER_STORAGE_KEY);
  }
}

function useIsMobileBinderViewport() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 720px)").matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const handleChange = () => setIsMobile(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);

    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
    };
  }, []);

  return isMobile;
}

function BinderSection({
  binders,
  collection,
  user,
  requestedBinderId = "",
  binderHomeRequest = 0,
  onBinderRequestHandled,
  onOpenAuth,
  onCreateBinder,
  onCreateMasterSetBinder,
  onUpdateBinderTheme,
  onClearBinder,
  onAddToBinder,
  onRemoveFromBinder,
}) {
  const [activeBinderId, setActiveBinderId] = useState("");
  const [newBinderName, setNewBinderName] = useState("");
  const [newBinderTag, setNewBinderTag] = useState(BINDER_TAGS[0]);
  const [newBinderTheme, setNewBinderTheme] = useState(BINDER_THEME_OPTIONS[0].id);
  const [selectedMasterSetId, setSelectedMasterSetId] = useState(sets[0]?.id || "");
  const [importTheme, setImportTheme] = useState(BINDER_THEME_OPTIONS[1].id);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [binderSortMode, setBinderSortMode] = useState("updated");
  const [isMasterBinderOpen, setIsMasterBinderOpen] = useState(false);
  const [masterBinderPage, setMasterBinderPage] = useState(0);
  const [customBinderPage, setCustomBinderPage] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [nameError, setNameError] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addEraFilter, setAddEraFilter] = useState("all");
  const [addSetFilter, setAddSetFilter] = useState("all");
  const [addRarityFilter, setAddRarityFilter] = useState("all");
  const [sortMode, setSortMode] = useState("order");
  const [selectedCard, setSelectedCard] = useState(null);
  const isMobileBinder = useIsMobileBinderViewport();
  const activeBinder = useMemo(
    () => binders.find((binder) => binder.id === activeBinderId) || null,
    [activeBinderId, binders]
  );
  const activeMasterSet = useMemo(
    () => (isMasterSetBinder(activeBinder) ? sets.find((set) => set.id === activeBinder.setId) || null : null),
    [activeBinder]
  );
  const activeTheme = getBinderTheme(activeBinder?.theme);
  const selectedImportSet = useMemo(
    () => sets.find((set) => set.id === selectedMasterSetId) || sets[0] || null,
    [selectedMasterSetId]
  );
  const binderDisplayCards = useMemo(() => getBinderDisplayCards(activeBinder, collection), [activeBinder, collection]);
  const sortedBinderCards = useMemo(() => sortBinderCards(binderDisplayCards, sortMode), [binderDisplayCards, sortMode]);
  const customPages = useMemo(() => chunkItems(sortedBinderCards, BINDER_PAGE_SIZE), [sortedBinderCards]);
  const customPageCount = Math.max(1, customPages.length);
  const customPagesPerView = isMobileBinder || customBinderPage === 0 ? 1 : 2;
  const visibleCustomPages = customPages.slice(customBinderPage, customBinderPage + customPagesPerView);
  const visibleCustomPageNumbers =
    visibleCustomPages.length > 1
      ? `${customBinderPage + 1}-${customBinderPage + visibleCustomPages.length}`
      : `${customBinderPage + 1}`;
  const masterCards = useMemo(
    () => (activeMasterSet ? sortCardsBySetNumber(getPullableCollectionCards(activeMasterSet)) : []),
    [activeMasterSet]
  );
  const masterPages = useMemo(() => chunkItems(masterCards, MASTER_BINDER_PAGE_SIZE), [masterCards]);
  const masterProgress = activeMasterSet ? getSetCollectionProgress(collection, activeMasterSet) : { collected: 0, total: 0, percent: 0 };
  const masterMissingCount = Math.max(0, masterProgress.total - masterProgress.collected);
  const masterPageCount = Math.max(1, masterPages.length);
  const masterPagesPerView = isMobileBinder || masterBinderPage === 0 ? 1 : 2;
  const visibleMasterPages = masterPages.slice(masterBinderPage, masterBinderPage + masterPagesPerView);
  const visibleMasterPageNumbers =
    visibleMasterPages.length > 1
      ? `${masterBinderPage + 1}-${masterBinderPage + visibleMasterPages.length}`
      : `${masterBinderPage + 1}`;
  const sortedBinders = useMemo(() => {
    const binderValue = (binder) => {
      if (isMasterSetBinder(binder)) {
        const set = sets.find((candidateSet) => candidateSet.id === binder.setId);
        const progress = set ? getSetCollectionProgress(collection, set) : { collected: 0, total: 0, percent: 0 };

        return {
          cardCount: progress.collected,
          completion: progress.percent,
          name: binder.name,
        };
      }

      return {
        cardCount: binder.cards.length,
        completion: 0,
        name: binder.name,
      };
    };

    return [...binders].sort((a, b) => {
      const valueA = binderValue(a);
      const valueB = binderValue(b);

      if (binderSortMode === "created") return (b.createdAt || 0) - (a.createdAt || 0);
      if (binderSortMode === "name-asc") return valueA.name.localeCompare(valueB.name);
      if (binderSortMode === "name-desc") return valueB.name.localeCompare(valueA.name);
      if (binderSortMode === "master-first") return Number(isMasterSetBinder(b)) - Number(isMasterSetBinder(a)) || valueA.name.localeCompare(valueB.name);
      if (binderSortMode === "custom-first") return Number(isMasterSetBinder(a)) - Number(isMasterSetBinder(b)) || valueA.name.localeCompare(valueB.name);
      if (binderSortMode === "completion-desc") return valueB.completion - valueA.completion || valueA.name.localeCompare(valueB.name);
      if (binderSortMode === "completion-asc") return valueA.completion - valueB.completion || valueA.name.localeCompare(valueB.name);
      if (binderSortMode === "count-desc") return valueB.cardCount - valueA.cardCount || valueA.name.localeCompare(valueB.name);
      if (binderSortMode === "count-asc") return valueA.cardCount - valueB.cardCount || valueA.name.localeCompare(valueB.name);

      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  }, [binderSortMode, binders, collection]);
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const addEraOptions = useMemo(
    () => ["all", ...new Set(collectedCards.map(({ set }) => set.era || "Other"))],
    [collectedCards]
  );
  const addSetOptions = useMemo(
    () => collectedCards.map(({ set }) => set).filter((set, index, allSets) => allSets.findIndex((item) => item.id === set.id) === index),
    [collectedCards]
  );
  const addRarityOptions = useMemo(
    () => ["all", ...new Set(collectedCards.map(({ card, set }) => getDisplayRarity(card, set)))],
    [collectedCards]
  );
  const addableCards = useMemo(() => {
    if (!activeBinder) return [];

    const existingKeys = new Set(activeBinder.cards.map((item) => item.key));
    const search = addQuery.toLowerCase().trim();

    return getCollectedCards(collection)
      .filter(({ card, set }) => {
        if (existingKeys.has(getBinderCardKey(card, set.id))) return false;

        const displayRarity = getDisplayRarity(card, set);
        const matchesEra = addEraFilter === "all" || (set.era || "Other") === addEraFilter;
        const matchesSet = addSetFilter === "all" || set.id === addSetFilter;
        const matchesRarity = addRarityFilter === "all" || displayRarity === addRarityFilter;

        return (
          matchesEra &&
          matchesSet &&
          matchesRarity &&
          (!search ||
            String(card.name || "").toLowerCase().includes(search) ||
            String(card.rarity || "").toLowerCase().includes(search) ||
            String(set.name || "").toLowerCase().includes(search) ||
            displayRarity.toLowerCase().includes(search))
        );
      })
      .sort((a, b) => compareCardsByRarity(a.card, b.card, a.set, b.set));
  }, [activeBinder, addEraFilter, addQuery, addRarityFilter, addSetFilter, collection]);
  useEffect(() => {
    setCustomBinderPage(0);
  }, [sortMode, activeBinder?.id, activeBinder?.cards.length]);

  useEffect(() => {
    setIsMasterBinderOpen(false);
    setMasterBinderPage(0);
    setCustomBinderPage(0);
    setIsAddOpen(false);
  }, [activeBinder?.id]);

  useEffect(() => {
    if (!requestedBinderId) return;

    if (binders.some((binder) => binder.id === requestedBinderId)) {
      setActiveBinderId(requestedBinderId);
      saveActiveBinderId(requestedBinderId);
      onBinderRequestHandled?.();
    }
  }, [binders, onBinderRequestHandled, requestedBinderId]);

  useEffect(() => {
    if (!activeBinderId) return;

    if (!binders.some((binder) => binder.id === activeBinderId)) {
      setActiveBinderId("");
      saveActiveBinderId("");
    }
  }, [activeBinderId, binders]);

  useEffect(() => {
    if (binderHomeRequest > 0) {
      closeBinder();
    }
  }, [binderHomeRequest]);

  useEffect(() => {
    setMasterBinderPage((currentPage) => Math.min(currentPage, masterPageCount - 1));
  }, [masterPageCount]);

  useEffect(() => {
    setCustomBinderPage((currentPage) => Math.min(currentPage, customPageCount - 1));
  }, [customPageCount]);

  function handleCreateBinder(event) {
    event.preventDefault();
    const trimmedName = newBinderName.trim();

    if (!trimmedName) {
      setNameError("Binder name is required.");
      return;
    }

    const binder = onCreateBinder(trimmedName, newBinderTag, newBinderTheme);

    setNewBinderName("");
    setNewBinderTag(BINDER_TAGS[0]);
    setNewBinderTheme(BINDER_THEME_OPTIONS[0].id);
    setNameError("");
    setIsCreateOpen(false);
  }

  function openBinder(binderId) {
    setActiveBinderId(binderId);
    saveActiveBinderId(binderId);
    resetPageScroll();
  }

  function closeBinder() {
    setActiveBinderId("");
    saveActiveBinderId("");
    resetPageScroll();
  }

  function handleImportMasterSet() {
    if (!selectedImportSet) return;

    const existingBinder = binders.find((binder) => isMasterSetBinder(binder) && binder.setId === selectedImportSet.id);
    const binder = onCreateMasterSetBinder?.(selectedImportSet, { theme: importTheme });

    if (binder?.id) {
      setImportMessage(existingBinder ? "You already have this master set binder. Opening it now." : "");
      setIsImportOpen(false);
      openBinder(binder.id);
    }
  }

  function handleThemeChange(themeId) {
    if (!activeBinder) return;

    onUpdateBinderTheme?.(activeBinder.id, themeId);
  }

  function handleClearBinder() {
    if (!activeBinder || isMasterSetBinder(activeBinder) || activeBinder.cards.length === 0) return;

    if (window.confirm(`Clear ${activeBinder.name}? Your actual collection will not be deleted.`)) {
      onClearBinder(activeBinder.id);
    }
  }

  function goToPreviousMasterPage() {
    setMasterBinderPage((currentPage) => {
      if (currentPage <= 1) return 0;

      return Math.max(1, currentPage - (isMobileBinder ? 1 : 2));
    });
  }

  function goToNextMasterPage() {
    setMasterBinderPage((currentPage) => Math.min(masterPageCount - 1, currentPage + masterPagesPerView));
  }

  function goToPreviousCustomPage() {
    setCustomBinderPage((currentPage) => {
      if (currentPage <= 1) return 0;

      return Math.max(1, currentPage - (isMobileBinder ? 1 : 2));
    });
  }

  function goToNextCustomPage() {
    setCustomBinderPage((currentPage) => Math.min(customPageCount - 1, currentPage + customPagesPerView));
  }

  function renderMasterBinderSlot(card, slotIndex) {
    if (!activeMasterSet || !card) {
      return <div className="master-binder-slot is-empty" key={`empty-${slotIndex}`} aria-hidden="true" />;
    }

    const collected = isCardCollected(collection, card, activeMasterSet.id);
    const count = getCardCount(collection, card, activeMasterSet.id);

    return (
      <button
        className={`master-binder-slot ${collected ? "is-collected" : "is-missing"}`}
        key={card.id || `${activeMasterSet.id}-${card.number}-${card.name}`}
        onClick={() => setSelectedCard({ card, set: activeMasterSet, count, collected, fromBinder: true })}
        type="button"
      >
        <FoilCard
          card={card}
          set={activeMasterSet}
          variant="collection"
          className={collected ? "" : "is-uncollected-preview"}
          enableTransform={false}
          enableCursorBlob={false}
          enableTiltFoil={false}
          showFoil={false}
        />
        <span className="master-binder-card-meta">
          <strong>#{card.number}</strong>
          <em>{collected ? getDisplayRarity(card, activeMasterSet) : "Not collected yet"}</em>
        </span>
        {!collected && <span className="missing-badge">Missing</span>}
        {count > 1 && <span className="count-badge">x{count}</span>}
      </button>
    );
  }

  return (
    <div className={`profile-panel binder-panel ${activeBinder ? "is-open" : "is-library"}`.trim()}>
      <div className="binder-panel-header">
        <div>
          <h2>{activeBinder ? activeBinder.name : "My Binders"}</h2>
          <p>
            {activeBinder
              ? isMasterSetBinder(activeBinder)
                ? `${masterProgress.collected} / ${masterProgress.total} collected - ${masterProgress.percent}% complete`
                : `${activeBinder.cards.length} saved cards`
              : "Create custom binders or import master set binders into your library."}
          </p>
        </div>
        <div className="binder-controls">
          {activeBinder ? (
            <>
              <label className="binder-theme-select">
                <span>
                  <i style={{ "--swatch": activeTheme.value }} aria-hidden="true" />
                  Theme
                </span>
                <select value={activeBinder.theme || "midnight"} onChange={(event) => handleThemeChange(event.target.value)}>
                  {BINDER_THEME_OPTIONS.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary-button binder-create-button" type="button" onClick={closeBinder}>
                Back to Binders
              </button>
            </>
          ) : (
            <>
              <button className="primary-button binder-create-button" type="button" onClick={() => setIsCreateOpen(true)}>
                Create Custom Binder
              </button>
              <button
                className="secondary-button binder-create-button"
                type="button"
                onClick={() => {
                  setImportMessage("");
                  setIsImportOpen(true);
                }}
              >
                Import Master Set Binder
              </button>
            </>
          )}
        </div>
      </div>

      {!user && <AuthSaveNotice onOpenAuth={onOpenAuth} />}

      {!activeBinder && (
        <>
          {binders.length === 0 ? (
            <div className="binder-empty-state">
              <strong>No binders yet.</strong>
              <span>Create a custom binder or import a master set binder to start organizing your collection.</span>
            </div>
          ) : (
            <>
              <div className="binder-library-meta">
                <span>Showing {binders.length} binders</span>
                <label>
                  Sort by
                  <select
                    value={binderSortMode}
                    onChange={(event) => setBinderSortMode(event.target.value)}
                    aria-label="Sort binders"
                  >
                    <option value="updated">Recently Updated</option>
                    <option value="created">Recently Created</option>
                    <option value="name-asc">Name A-Z</option>
                    <option value="name-desc">Name Z-A</option>
                    <option value="master-first">Master Set First</option>
                    <option value="custom-first">Custom First</option>
                    <option value="completion-desc">Completion High to Low</option>
                    <option value="completion-asc">Completion Low to High</option>
                    <option value="count-desc">Card Count High to Low</option>
                    <option value="count-asc">Card Count Low to High</option>
                  </select>
                </label>
              </div>
              <div className="binder-shelf" aria-label="Binder library">
                {sortedBinders.map((binder) => {
                const masterSet = isMasterSetBinder(binder) ? sets.find((set) => set.id === binder.setId) : null;
                const progress = masterSet ? getSetCollectionProgress(collection, masterSet) : null;
                const logoUrl = masterSet ? getSetLogoUrl(masterSet) : "";
                const savedCount = isMasterSetBinder(binder) ? `${progress?.collected || 0} / ${progress?.total || 0}` : `${binder.cards.length} cards`;
                const theme = getBinderTheme(binder.theme);

                return (
                  <article
                    className={`binder-shelf-card is-${binder.type || "custom"}`}
                    key={binder.id}
                    style={{ "--binder-theme": theme.value }}
                  >
                    <div className="binder-shelf-card__spine" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="binder-shelf-card__body">
                      {logoUrl ? <img src={logoUrl} alt="" /> : <span className="binder-shelf-card__tag">{binder.tag}</span>}
                      <strong>{binder.name}</strong>
                      <em>{isMasterSetBinder(binder) ? "Master Set Binder" : "Custom Binder"}</em>
                      <span>{savedCount}{progress ? ` - ${progress.percent}% complete` : ""}</span>
                      <button className="primary-button" type="button" onClick={() => openBinder(binder.id)}>
                        Open Binder
                      </button>
                    </div>
                  </article>
                );
                })}
              </div>
            </>
          )}
        </>
      )}

      {activeBinder && !isMasterSetBinder(activeBinder) && (
        <>
          <div className="binder-view-header">
            <div className="binder-view-controls">
              <button className="primary-button binder-add-card-button" type="button" onClick={() => setIsAddOpen(true)}>
                + Add Card
              </button>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} aria-label="Sort binder cards">
                <option value="order">Binder Order</option>
                <option value="rarity">Rarity</option>
                <option value="set">Set</option>
              </select>
              <button className="secondary-button binder-clear-button" type="button" onClick={handleClearBinder} disabled={!activeBinder.cards.length}>
                Clear Binder
              </button>
            </div>
          </div>

          <div className="master-binder-pages custom-binder-pages" style={{ "--master-cover": activeTheme.value }}>
            <div className={`master-binder-spread ${visibleCustomPages.length > 1 ? "is-spread" : "is-single"}`}>
              {(visibleCustomPages.length > 0 ? visibleCustomPages : [[]]).map((pageItems, spreadIndex) => {
                const pageNumber = customBinderPage + spreadIndex + 1;
                const slots = Array.from({ length: BINDER_PAGE_SIZE }, (_, slotIndex) => pageItems[slotIndex]);

                return (
                  <div className="master-binder-page custom-binder-page" key={`custom-page-${pageNumber}`}>
                    <div className="master-binder-pocket-grid">
                      {slots.map((item, index) => (
                        <div className={`binder-slot ${item ? "is-filled" : "is-empty"}`} key={item?.key || `empty-${pageNumber}-${index}`}>
                          {item ? (
                            <>
                              <button className="binder-card-button" type="button" onClick={() => setSelectedCard({ ...item, fromBinder: true })}>
                                <FoilCard
                                  card={item.card}
                                  set={item.set}
                                  variant="collection"
                                  enableTransform={false}
                                  enableCursorBlob={false}
                                  enableTiltFoil={false}
                                  showFoil={false}
                                />
                                <span>{getDisplayCardName(item.card, item.set)}</span>
                              </button>
                              <button
                                className="binder-remove-card"
                                type="button"
                                onClick={() => onRemoveFromBinder(item.card, item.set, activeBinder.id)}
                                aria-label={`Remove ${getDisplayCardName(item.card, item.set)} from binder`}
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <button
                              className="binder-slot-add"
                              type="button"
                              onClick={() => setIsAddOpen(true)}
                              aria-label="Add card to binder"
                            >
                              <span aria-hidden="true">+</span>
                              <strong>Add Card</strong>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {binderDisplayCards.length === 0 && (
              <div className="binder-empty-state">This binder is empty. Add cards from your Collection.</div>
            )}

            <div className="master-binder-nav" aria-label="Custom binder pages">
              <button type="button" onClick={goToPreviousCustomPage} disabled={customBinderPage === 0}>
                Previous Page
              </button>
              <span>
                Page {visibleCustomPageNumbers} of {customPageCount}
              </span>
              <button
                type="button"
                onClick={goToNextCustomPage}
                disabled={customBinderPage + customPagesPerView >= customPageCount}
              >
                Next Page
              </button>
            </div>
          </div>
        </>
      )}

      {activeBinder && isMasterSetBinder(activeBinder) && activeMasterSet && (
        <section className="master-binder-view binder-master-view">
          {!isMasterBinderOpen ? (
            <div className="master-binder-cover-stage">
              <div className="master-binder-cover" style={{ "--master-cover": getBinderTheme(activeBinder.theme).value }}>
                <div className="master-binder-cover__spine" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="master-binder-cover__content">
                  <span className="set-mark">Master Set Binder</span>
                  <img className="collection-logo" src={getSetLogoUrl(activeMasterSet)} alt={`${activeMasterSet.name} logo`} />
                  <h2>{activeMasterSet.name}</h2>
                  <div className="master-binder-progress">
                    <div className="collection-progress-copy">
                      <strong>
                        {masterProgress.collected} / {masterProgress.total}
                      </strong>
                      <span>{masterProgress.percent}% complete</span>
                    </div>
                    <div className="collection-progress-bar" aria-hidden="true">
                      <span style={{ width: `${masterProgress.percent}%` }} />
                    </div>
                    <p>{masterMissingCount} cards still missing from this master set.</p>
                  </div>
                  <div className="master-binder-cover-actions">
                    <button className="primary-button" onClick={() => setIsMasterBinderOpen(true)} type="button">
                      Open Binder
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="master-binder-pages" style={{ "--master-cover": activeTheme.value }}>
              <div className={`master-binder-spread ${visibleMasterPages.length > 1 ? "is-spread" : "is-single"}`}>
                {(visibleMasterPages.length > 0 ? visibleMasterPages : [[]]).map((pageCards, spreadIndex) => {
                  const pageNumber = masterBinderPage + spreadIndex + 1;
                  const slots = Array.from({ length: MASTER_BINDER_PAGE_SIZE }, (_, slotIndex) => pageCards[slotIndex]);

                  return (
                    <div className="master-binder-page" key={`master-page-${pageNumber}`}>
                      <div className="master-binder-pocket-grid">
                        {slots.map((card, slotIndex) => renderMasterBinderSlot(card, `${pageNumber}-${slotIndex}`))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="master-binder-nav" aria-label="Master binder pages">
                <button type="button" onClick={goToPreviousMasterPage} disabled={masterBinderPage === 0}>
                  Previous Page
                </button>
                <span>
                  Page {visibleMasterPageNumbers} of {masterPageCount}
                </span>
                <button
                  type="button"
                  onClick={goToNextMasterPage}
                  disabled={masterBinderPage + masterPagesPerView >= masterPageCount}
                >
                  Next Page
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {isImportOpen && (
        <div className="binder-create-overlay" role="dialog" aria-modal="true" aria-label="Import master set binder">
          <div className="binder-create-modal binder-import-modal">
            <div>
              <span className="set-mark">Master Set</span>
              <h3>Import Binder</h3>
              <p>Choose a set, pick a cover theme, and add its master set binder to your library.</p>
            </div>
            <label>
              Choose set
              <select
                value={selectedMasterSetId}
                onChange={(event) => {
                  setSelectedMasterSetId(event.target.value);
                  setImportMessage("");
                }}
                aria-label="Select set for master set binder"
              >
                {sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="binder-theme-options" aria-label="Binder theme">
              {BINDER_THEME_OPTIONS.map((theme) => (
                <button
                  className={importTheme === theme.id ? "is-active" : ""}
                  key={theme.id}
                  onClick={() => setImportTheme(theme.id)}
                  style={{ "--swatch": theme.value }}
                  type="button"
                >
                  <span aria-hidden="true" />
                  {theme.label}
                </button>
              ))}
            </div>
            {selectedImportSet && (
              <div className="binder-import-preview">
                <div className="binder-shelf-card is-master_set" style={{ "--binder-theme": getBinderTheme(importTheme).value }}>
                  <div className="binder-shelf-card__spine" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="binder-shelf-card__body">
                    <img src={getSetLogoUrl(selectedImportSet)} alt="" />
                    <strong>{selectedImportSet.name} Master Set</strong>
                    <em>Master Set Binder</em>
                  </div>
                </div>
              </div>
            )}
            {importMessage && <div className="binder-form-error">{importMessage}</div>}
            <div className="binder-create-actions">
              <button className="secondary-button" type="button" onClick={() => setIsImportOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={handleImportMasterSet}>
                Import Binder
              </button>
            </div>
          </div>
        </div>
      )}

      {isCreateOpen && (
        <div className="binder-create-overlay" role="dialog" aria-modal="true" aria-label="Create binder">
          <form className="binder-create-modal" onSubmit={handleCreateBinder}>
            <div>
              <span className="set-mark">Binder</span>
              <h3>Create Binder</h3>
              <p>Name it, tag it, and start filling pages from your Collection.</p>
            </div>
            <label>
              Binder name
              <input
                value={newBinderName}
                onChange={(event) => {
                  setNewBinderName(event.target.value);
                  setNameError("");
                }}
                placeholder="Favorite Pulls"
                aria-label="Binder name"
                autoFocus
              />
            </label>
            {nameError && <div className="binder-form-error">{nameError}</div>}
            <div className="binder-theme-options" aria-label="Binder theme">
              {BINDER_THEME_OPTIONS.map((theme) => (
                <button
                  className={newBinderTheme === theme.id ? "is-active" : ""}
                  key={theme.id}
                  onClick={() => setNewBinderTheme(theme.id)}
                  style={{ "--swatch": theme.value }}
                  type="button"
                >
                  <span aria-hidden="true" />
                  {theme.label}
                </button>
              ))}
            </div>
            <div className="binder-create-actions">
              <button className="secondary-button" type="button" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="submit">
                Create Binder
              </button>
            </div>
          </form>
        </div>
      )}

      {isAddOpen && activeBinder && (
        <div className="binder-create-overlay" role="dialog" aria-modal="true" aria-label="Add card to binder">
          <div className="binder-add-modal">
            <div className="binder-add-header">
              <div>
                <span className="set-mark">Binder</span>
                <h3>Add Card</h3>
                <p>Add an owned card to {activeBinder.name}.</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setIsAddOpen(false)}>
                Close
              </button>
            </div>
            <label className="binder-add-search">
              <span>Search collection</span>
              <input
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Search by card, set, or rarity"
                type="search"
              />
            </label>
            <div className="binder-add-filters" aria-label="Filter cards to add">
              <label>
                <span>Era</span>
                <select value={addEraFilter} onChange={(event) => setAddEraFilter(event.target.value)}>
                  {addEraOptions.map((era) => (
                    <option key={era} value={era}>
                      {era === "all" ? "All Eras" : era}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Set</span>
                <select value={addSetFilter} onChange={(event) => setAddSetFilter(event.target.value)}>
                  <option value="all">All Sets</option>
                  {addSetOptions.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rarity</span>
                <select value={addRarityFilter} onChange={(event) => setAddRarityFilter(event.target.value)}>
                  {addRarityOptions.map((rarity) => (
                    <option key={rarity} value={rarity}>
                      {rarity === "all" ? "All Rarities" : rarity}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {addableCards.length === 0 ? (
              <div className="binder-empty-state">
                <strong>No cards to add</strong>
                <span>Every matching collected card is already in this binder.</span>
              </div>
            ) : (
              <div className="binder-add-grid">
                {addableCards.map(({ card, set, count }) => (
                  <button
                    className="binder-add-card"
                    key={getBinderCardKey(card, set.id)}
                    type="button"
                    onClick={() => onAddToBinder(card, set, activeBinder.id)}
                  >
                    <FoilCard
                      card={card}
                      set={set}
                      variant="collection"
                      enableTransform={false}
                      enableCursorBlob={false}
                      enableTiltFoil={false}
                      showFoil={false}
                    />
                    <span>
                      <strong>{getDisplayCardName(card, set)}</strong>
                      <em>
                        {set.name} - {getDisplayRarity(card, set)}
                        {count > 1 ? ` x${count}` : ""}
                      </em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          set={selectedCard.set}
          collected={selectedCard.collected ?? true}
          count={selectedCard.fromBinder ? 0 : selectedCard.count}
          showBinderControl={!selectedCard.fromBinder}
          binders={binders}
          onAddToBinder={onAddToBinder}
          onRemoveFromBinder={onRemoveFromBinder}
          onCreateBinder={() => setIsCreateOpen(true)}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
}

function SocialIcon({ type }) {
  if (type === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z" />
      </svg>
    );
  }

  if (type === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7.1 2h9.8A5.1 5.1 0 0 1 22 7.1v9.8a5.1 5.1 0 0 1-5.1 5.1H7.1A5.1 5.1 0 0 1 2 16.9V7.1A5.1 5.1 0 0 1 7.1 2Zm0 2A3.1 3.1 0 0 0 4 7.1v9.8A3.1 3.1 0 0 0 7.1 20h9.8a3.1 3.1 0 0 0 3.1-3.1V7.1A3.1 3.1 0 0 0 16.9 4H7.1Zm10.4 1.7a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM12 7.2A4.8 4.8 0 1 1 12 16.8 4.8 4.8 0 0 1 12 7.2Zm0 2A2.8 2.8 0 1 0 12 14.8 2.8 2.8 0 0 0 12 9.2Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M16.6 2c.4 3 2.1 4.8 5.1 5v3.4a8.4 8.4 0 0 1-5-1.6v6.8c0 4.3-2.7 6.4-6.1 6.4-3.8 0-6.3-2.7-6.3-5.9 0-3.6 2.8-6.1 6.8-6.1.4 0 .7 0 1 .1v3.6c-.3-.1-.7-.2-1.1-.2-1.7 0-2.8 1-2.8 2.5 0 1.4 1 2.4 2.4 2.4 1.5 0 2.5-.8 2.5-2.8V2h3.5Z" />
    </svg>
  );
}

function SiteFooter() {
  const socialLinks = [
    { label: "PackDex YouTube", href: "https://www.youtube.com/@pack-dex", type: "youtube" },
    { label: "PackDex Instagram", href: "https://www.instagram.com/pack.dex/", type: "instagram" },
    { label: "PackDex TikTok", href: "https://www.tiktok.com/@packdex", type: "tiktok" },
  ];

  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <img src="/packdex-icon-192.png" alt="" />
        <span>PackDex</span>
      </div>
      <nav className="site-footer__social" aria-label="PackDex social links">
        {socialLinks.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label}>
            <SocialIcon type={link.type} />
          </a>
        ))}
      </nav>
      <a className="site-footer__support" href={`mailto:${SUPPORT_EMAIL}`}>
        <Mail size={17} aria-hidden="true" />
        <span>{SUPPORT_EMAIL}</span>
      </a>
      <p>
        Fan-made Pokemon TCG pack-opening simulator. Not affiliated with Nintendo, Creatures, Game Freak, or The
        Pokemon Company. Pack openings are simulated for fun and do not award physical cards, money, prizes, or
        redeemable items. Pokemon, Pokemon TCG, and related names, artwork, and trademarks belong to their respective
        owners.
      </p>
      <div className="site-footer__bottom">
        <span>© 2026 PackDex. All rights reserved.</span>
        <a href="/image-credits.html" target="_blank" rel="noopener noreferrer">
          Image Credits
        </a>
      </div>
    </footer>
  );
}

function getWelcomeRewardChoices() {
  return WELCOME_REWARD_CHOICES.map((choice) => {
    const set = sets.find((candidateSet) => candidateSet.id === choice.setId);
    const config = set ? GOD_PACK_CONFIG[set.id] : null;

    return set && config?.enabled ? { ...choice, set, config } : null;
  }).filter(Boolean);
}

function WelcomeRewardChoice({ choice, isSelected, onSelect }) {
  const [packArtFailed, setPackArtFailed] = useState(false);
  const logoUrl = getSetLogoUrl(choice.set);
  const packArtUrl = getSetPackArtUrl(choice.set);
  const mainImageUrl = !packArtFailed && packArtUrl ? packArtUrl : logoUrl;

  return (
    <button
      className={`welcome-reward-choice ${isSelected ? "is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(choice.setId)}
      aria-pressed={isSelected}
    >
      {isSelected && <span className="welcome-reward-choice__selected">Selected</span>}
      <span className="welcome-reward-choice__media">
        {mainImageUrl && (
          <img
            className="welcome-reward-choice__pack"
            src={mainImageUrl}
            alt=""
            onError={() => setPackArtFailed(true)}
          />
        )}
      </span>
      <span className="welcome-reward-choice__copy">
        <strong>{choice.title}</strong>
        <small>{choice.description}</small>
      </span>
    </button>
  );
}

function WelcomeRewardModal({
  isOpen,
  rewardStatus,
  selectedSetId,
  isClaiming,
  error,
  onSelect,
  onClaim,
  onClose,
}) {
  const choices = useMemo(() => getWelcomeRewardChoices(), []);

  if (!isOpen || !rewardStatus?.isEligible || rewardStatus?.isClaimed) return null;

  const selectedChoice = choices.find((choice) => choice.setId === selectedSetId) || choices[0];

  return (
    <div className="welcome-reward-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-reward-title" onMouseDown={onClose}>
      <div className="welcome-reward-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="auth-modal-close" type="button" onClick={onClose} aria-label="Close welcome reward">
          x
        </button>

        <div className="welcome-reward-heading">
          <span>Welcome Pack</span>
          <h2 id="welcome-reward-title">Welcome to PackDex!</h2>
          <p>Choose a welcome God Pack simulation.</p>
          <small>As a thank-you for joining PackDex, pick one special virtual pack to open instantly.</small>
        </div>

        <div className="welcome-reward-grid">
          {choices.map((choice) => {
            const isSelected = choice.setId === selectedChoice?.setId;

            return (
              <WelcomeRewardChoice
                key={choice.setId}
                choice={choice}
                isSelected={isSelected}
                onSelect={onSelect}
              />
            );
          })}
        </div>

        {error && <div className="welcome-reward-error">{error}</div>}

        <button
          className="primary-button welcome-reward-cta"
          type="button"
          disabled={isClaiming || !selectedChoice}
          onClick={() => onClaim(selectedChoice)}
        >
          {isClaiming ? (
            <>
              <img className="welcome-reward-cta__pokeball" src={POKEBALL_LOADING_SRC} alt="" />
              <span>Opening this God Pack</span>
              <small>This may take a moment</small>
            </>
          ) : (
            "Open Welcome Pack"
          )}
        </button>
      </div>
    </div>
  );
}

function WelcomeRewardProfileCard({ rewardStatus, onClaim }) {
  if (!rewardStatus?.isEligible) return null;

  if (!rewardStatus.isClaimed) {
    return (
      <div className="welcome-reward-profile-card is-available">
        <div>
          <span>Welcome Pack Available</span>
          <strong>Choose a virtual welcome pack to open in PackDex.</strong>
        </div>
        <button className="primary-button" type="button" onClick={onClaim}>
          Open Welcome Pack
        </button>
      </div>
    );
  }

  return null;
}

function ProfilePage({
  collection,
  profileStats,
  areProfileStatsLoading,
  user,
  isAuthLoading,
  welcomeRewardStatus,
  onOpenAuth,
  onOpenWelcomeReward,
  onDeleteAccount,
}) {
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const completedSets = sets.filter((set) => getSetCollectionProgress(collection, set).percent === 100).length;

  return (
    <section className="dashboard-screen profile-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Profile</span>
        <h1>Your PackDex</h1>
      </div>

      <AuthPanel user={user} isAuthLoading={isAuthLoading} onOpenAuth={onOpenAuth} />

      {user && <WelcomeRewardProfileCard rewardStatus={welcomeRewardStatus} onClaim={onOpenWelcomeReward} />}

      {isAuthLoading ? (
        <div className="empty-state">
          <h2>Loading account stats...</h2>
          <p>Checking your PackDex session.</p>
        </div>
      ) : user ? (
        <>
          <div className="profile-stat-grid">
            <article>
              <span>Packs Opened</span>
              <strong>{areProfileStatsLoading ? "..." : profileStats.packsOpened}</strong>
            </article>
            <article>
              <span>Total Cards Pulled</span>
              <strong>{areProfileStatsLoading ? "..." : profileStats.totalCardsPulled}</strong>
            </article>
            <article>
              <span>Completed Sets</span>
              <strong>{completedSets}</strong>
            </article>
          </div>
          <div className="profile-stats-note">
            Stats are tied to your signed-in PackDex account.
          </div>
          <section className="profile-settings-section" aria-label="Account settings">
            <span className="set-mark">Settings</span>
            <h2>Account settings</h2>
            <p>Manage the PackDex account signed in on this device.</p>
            <button className="delete-account-button" type="button" onClick={onDeleteAccount}>
              Delete Account
            </button>
          </section>
        </>
      ) : (
        <div className="empty-state">
          <h2>Sign in to track your PackDex stats.</h2>
          <p>Guest pulls stay local on this browser, but sign in to view account stats.</p>
        </div>
      )}

      <div className="profile-stats-note">
        Fan-made Pokemon TCG pack-opening simulator. Not affiliated with Nintendo, Creatures, Game Freak, or The
        Pokemon Company. PackDex tracks a virtual collection only.
      </div>
    </section>
  );
}

function DevGodPackAnimationPreview() {
  const [isChooserOpen, setIsChooserOpen] = useState(true);
  const [selectedSetId, setSelectedSetId] = useState(WELCOME_REWARD_CHOICES[0]?.setId || "");
  const [previewSet, setPreviewSet] = useState(null);
  const [previewPack, setPreviewPack] = useState([]);

  function handlePreviewClaim(choice) {
    if (!choice?.set) return;

    const pack = generateForcedGodPack(choice.set, choice.set, choice.forcedFormat);

    Object.assign(pack, {
      isGodPack: true,
      godPackDisplayName: pack.godPackDisplayName || choice.config?.displayName || "God Pack",
      welcomeReward: true,
    });

    setPreviewSet(choice.set);
    setPreviewPack(pack);
    setIsChooserOpen(false);
  }

  return (
    <>
      <div className="dev-preview-toolbar">
        <span>Local God Pack chooser preview</span>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setPreviewPack([]);
            setPreviewSet(null);
            setIsChooserOpen(true);
          }}
        >
          Choose Pack
        </button>
      </div>
      {previewSet && previewPack.length > 0 ? (
        <CardReveal
          key={`${previewSet.id}-${previewPack.godPackFormat || "god-pack"}`}
          cards={previewPack}
          set={previewSet}
          onCardsRevealed={() => {}}
          onComplete={() => {}}
          onBackToSets={() => {
            setPreviewPack([]);
            setPreviewSet(null);
            setIsChooserOpen(true);
          }}
        />
      ) : (
        <section className="dashboard-screen">
          <div className="empty-state">
            <h2>Choose a God Pack</h2>
            <p>Use the chooser to preview the same flow a first-time account sees.</p>
          </div>
        </section>
      )}
      <WelcomeRewardModal
        isOpen={isChooserOpen}
        rewardStatus={{ isEligible: true, isClaimed: false }}
        selectedSetId={selectedSetId}
        isClaiming={false}
        error=""
        onSelect={setSelectedSetId}
        onClaim={handlePreviewClaim}
        onClose={() => setIsChooserOpen(false)}
      />
    </>
  );
}

function App() {
  const pagePath = typeof window === "undefined" ? "/" : window.location.pathname;
  const legalPageType = pagePath === "/terms" ? "terms" : pagePath === "/privacy" ? "privacy" : "";

  if (pagePath === "/auth/callback") {
    return (
      <main className="app-shell">
        <AuthCallbackPage />
        <SiteFooter />
        <ThemeToggle />
      </main>
    );
  }

  if (pagePath === "/reset-password") {
    return (
      <main className="app-shell">
        <ResetPasswordPage />
        <SiteFooter />
        <ThemeToggle />
      </main>
    );
  }

  if (legalPageType) {
    return (
      <main className="app-shell">
        <LegalPage type={legalPageType} />
        <SiteFooter />
        <ThemeToggle />
      </main>
    );
  }

  if (import.meta.env.DEV && pagePath === "/dev/god-pack-animation") {
    return (
      <main className="app-shell is-pack-flow">
        <DevGodPackAnimationPreview />
        <SiteFooter />
        <ThemeToggle />
      </main>
    );
  }

  const [activeTab, setActiveTab] = useState("open");
  const [screen, setScreen] = useState("home");
  const [selectedSet, setSelectedSet] = useState(null);
  const [pulledCards, setPulledCards] = useState([]);
  const [collection, setCollection] = useState(() => loadCollection());
  const [binders, setBinders] = useState(() => loadBinders());
  const [profileStats, setProfileStats] = useState(() => emptyProfileStats());
  const [areProfileStatsLoading, setAreProfileStatsLoading] = useState(false);
  const [authSession, setAuthSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isAuthOpening, setIsAuthOpening] = useState(false);
  const [isOpeningPack, setIsOpeningPack] = useState(false);
  const [cloudWarning, setCloudWarning] = useState("");
  const [welcomeRewardStatus, setWelcomeRewardStatus] = useState(null);
  const [isWelcomeRewardLoading, setIsWelcomeRewardLoading] = useState(false);
  const [isWelcomeRewardModalOpen, setIsWelcomeRewardModalOpen] = useState(false);
  const [selectedWelcomeRewardSetId, setSelectedWelcomeRewardSetId] = useState(WELCOME_REWARD_CHOICES[0]?.setId || "");
  const [isClaimingWelcomeReward, setIsClaimingWelcomeReward] = useState(false);
  const [welcomeRewardError, setWelcomeRewardError] = useState("");
  const [isWelcomeBetaOpen, setIsWelcomeBetaOpen] = useState(false);
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [isReturningToSet, setIsReturningToSet] = useState(false);
  const [collectionDashboardSubtabRequest, setCollectionDashboardSubtabRequest] = useState("");
  const [binderOpenRequestId, setBinderOpenRequestId] = useState("");
  const returnTokenRef = useRef(0);
  const tabLoadTokenRef = useRef(0);
  const shownWelcomeRewardUserRef = useRef("");
  const isPackFlow = activeTab === "open" && ["opening", "reveal", "summary"].includes(screen);
  const authUser = authSession?.user || null;

  useEffect(() => {
    removeLegacyProfileStatsStorage();
  }, []);

  useEffect(() => {
    replaceAppHistory({ activeTab: "open", screen: "home" });
  }, []);

  useEffect(() => {
    preloadImage(CARD_BACK_URL, {
      timeoutMs: 0,
      onStart: (detail) => markCardBackPreloadStart(CARD_BACK_URL, detail),
      onLoad: (detail) => markCardBackPreloadFinish(true, detail),
      onError: (detail) => markCardBackPreloadFinish(false, detail),
    });
  }, []);

  useEffect(() => {
    if (activeTab !== "open" || !selectedSet) {
      clearImageWarmupQueue();
      return;
    }

    if (screen === "reveal") {
      pauseImageWarmup({ packOpening: true });
      return;
    }

    if (screen === "summary") {
      resumeImageWarmup();
      scheduleSelectedSetImageWarmup(selectedSet, { source: "summary" });
      return;
    }

    if (screen === "opening") {
      resumeImageWarmup();
      scheduleSelectedSetImageWarmup(selectedSet, { source: "selected-set" });
      return;
    }

    clearImageWarmupQueue();
  }, [activeTab, screen, selectedSet]);

  useEffect(() => {
    if (!supabase) {
      setIsAuthLoading(false);
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;

      setAuthSession(data.session || null);
      setIsAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session || null);
      setIsAuthLoading(false);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;

    if (!hasSeenWelcomeBeta(authUser)) {
      setIsWelcomeBetaOpen(true);
    }
  }, [authUser?.id, isAuthLoading]);

  useEffect(() => {
    if (isAuthLoading) return;

    if (!authUser) {
      setCollection(loadCollection());
      setBinders(loadBinders());
      setProfileStats(emptyProfileStats());
      setAreProfileStatsLoading(false);
      setCloudWarning("");
      setWelcomeRewardStatus(null);
      setIsWelcomeRewardLoading(false);
      setIsWelcomeRewardModalOpen(false);
      setWelcomeRewardError("");
      return;
    }

    let isMounted = true;

    setCloudWarning("");
    setAreProfileStatsLoading(true);

    loadCloudCollection()
      .then(async (cloudCollection) => {
        if (!isMounted) return;

        setCollection(mergePendingCloudPullsIntoCollection(cloudCollection, authUser.id));

        const pendingPullCount = getPendingCloudPullCount(authUser.id);

        if (pendingPullCount === 0) return;

        try {
          const syncResult = await syncPendingCloudPulls(authUser.id);

          if (!isMounted) return;

          if (syncResult.failed > 0) {
            setCollection((currentCollection) => mergePendingCloudPullsIntoCollection(currentCollection, authUser.id));
            setCloudWarning("Some saved pulls are waiting to sync. PackDex will retry automatically.");
            return;
          }

          if (syncResult.saved > 0) setCloudWarning("");
        } catch (error) {
          console.warn("Pending PackDex cloud pulls could not be synced after account load", {
            userId: authUser.id,
            pendingPullCount,
            error,
          });

          if (!isMounted) return;

          setCollection((currentCollection) => mergePendingCloudPullsIntoCollection(currentCollection, authUser.id));
          setCloudWarning("Some saved pulls are waiting to sync. PackDex will retry automatically.");
        }
      })
      .catch((error) => {
        console.warn("Cloud collection load failed", error);
        if (!isMounted) return;

        setCollection(mergePendingCloudPullsIntoCollection({}, authUser.id));
        setCloudWarning("Account collection could not be loaded yet. Guest pulls stay local on this device.");
      });

    loadCloudBinders(authUser.id)
      .then((cloudBinders) => {
        if (!isMounted) return;

        setBinders(cloudBinders);
      })
      .catch((error) => {
        console.warn("Cloud binder load failed", error);
        if (!isMounted) return;

        setBinders([]);
        setCloudWarning("Account binders could not be loaded yet. Guest binders stay local on this device.");
      });

    loadCloudProfileStats(authUser.id)
      .then((stats) => {
        if (!isMounted) return;

        setProfileStats(stats);
        setAreProfileStatsLoading(false);
      })
      .catch((error) => {
        console.warn("Cloud profile stats load failed", {
          userId: authUser.id,
          error,
        });
        if (!isMounted) return;

        setProfileStats(emptyProfileStats());
        setAreProfileStatsLoading(false);
        setCloudWarning("Account stats could not be loaded yet. Pack opening still works.");
      });

    return () => {
      isMounted = false;
    };
  }, [authUser?.id, isAuthLoading]);

  useEffect(() => {
    if (isAuthLoading || !authUser) return undefined;

    let isMounted = true;

    setIsWelcomeRewardLoading(true);

    loadWelcomeRewardStatus(authUser)
      .then((status) => {
        if (!isMounted) return;

        setWelcomeRewardStatus(status);
        setIsWelcomeRewardLoading(false);
        if (status.isEligible && !status.isClaimed && shownWelcomeRewardUserRef.current !== authUser.id) {
          shownWelcomeRewardUserRef.current = authUser.id;
          setSelectedWelcomeRewardSetId(WELCOME_REWARD_CHOICES[0]?.setId || "");
          setWelcomeRewardError("");
          setIsWelcomeRewardModalOpen(true);
        }
      })
      .catch((error) => {
        console.warn("Welcome reward load failed", error);
        if (!isMounted) return;

        setWelcomeRewardStatus({ isEligible: false, isClaimed: true, setId: "", claimedAt: "" });
        setIsWelcomeRewardLoading(false);
        setCloudWarning("Welcome reward could not be loaded yet. Pack opening still works.");
      });

    return () => {
      isMounted = false;
    };
  }, [authUser?.id, isAuthLoading]);

  useEffect(() => {
    function handlePopState(event) {
      const state = event.state;

      setIsTabLoading(false);
      setIsReturningToSet(false);

      if (!state?.packdexApp) {
        setActiveTab("open");
        setScreen("home");
        setSelectedSet(null);
        setPulledCards([]);
        resetPageScroll();
        return;
      }

      const nextTab = state.activeTab || "open";
      const nextScreen = state.screen || (nextTab === "open" ? "home" : nextTab);
      const nextSet = state.selectedSetId
        ? sets.find((candidateSet) => candidateSet.id === state.selectedSetId) || null
        : null;

      setActiveTab(nextTab);
      setScreen(nextScreen);
      setSelectedSet(nextSet);
      setCollectionDashboardSubtabRequest(state.collectionSubtab || "");
      setBinderOpenRequestId(state.openBinderId || "");

      if (!["reveal", "summary"].includes(nextScreen)) {
        setPulledCards([]);
      }

      resetPageScroll();
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  function selectMainTab(tab) {
    const nextScreen = tab === "open" ? "home" : tab;

    if (tab === activeTab && screen === nextScreen) {
      resetPageScroll();
      return;
    }

    const token = tabLoadTokenRef.current + 1;

    tabLoadTokenRef.current = token;
    setIsTabLoading(true);
    setIsReturningToSet(false);
    setActiveTab(tab);
    setScreen(nextScreen);
    setSelectedSet(null);
    setPulledCards([]);
    setCollectionDashboardSubtabRequest(tab === "collection" ? "sets" : "");
    setBinderOpenRequestId("");
    pushAppHistory({ activeTab: tab, screen: nextScreen });
    resetPageScroll();

    window.setTimeout(() => {
      if (tabLoadTokenRef.current === token) {
        setIsTabLoading(false);
      }
    }, TAB_LOADING_MS);
  }

  function openAuthModal() {
    if (isAuthModalOpen || isAuthOpening) return;

    setIsAuthOpening(true);

    window.setTimeout(() => {
      setIsAuthOpening(false);
      setIsAuthModalOpen(true);
    }, AUTH_MODAL_LOADING_MS);
  }

  async function handleDeleteAccount() {
    const deletedUserId = authUser?.id;

    if (!deletedUserId || !supabase) {
      throw new Error("You must be signed in to delete your PackDex account.");
    }

    await deleteCurrentAccount(supabase);
    clearDeletedAccountLocalState(deletedUserId);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    setAuthSession(null);
    setCollection({});
    setBinders([]);
    setProfileStats(emptyProfileStats());
    setWelcomeRewardStatus(null);
    setIsWelcomeRewardModalOpen(false);
    setActiveTab("open");
    setScreen("home");
    replaceAppHistory({ activeTab: "open", screen: "home" });
    resetPageScroll();
  }

  async function handleContinueAsGuest() {
    await supabase?.auth.signOut({ scope: "local" }).catch(() => {});
    setAuthSession(null);
    setIsDeleteAccountOpen(false);
  }

  function startPackOpening(set = selectedSet) {
    if (!set) return;

    if (!(activeTab === "open" && screen === "home")) {
      pushAppHistory({ activeTab: "open", screen: "home" });
    }

    pushAppHistory({ activeTab: "open", screen: "opening", selectedSetId: set.id });
    setIsReturningToSet(false);
    setActiveTab("open");
    setCollectionDashboardSubtabRequest("");
    setBinderOpenRequestId("");
    setSelectedSet(set);
    setPulledCards([]);
    setScreen("opening");
    setIsTabLoading(false);
    resetPageScroll();
  }

  function revealPack() {
    if (!selectedSet || isOpeningPack) return;

    pauseImageWarmup({ packOpening: true });
    resetPageScroll();
    setCloudWarning("");
    const generationStart = markPackGenerationStart(selectedSet);
    const nextPack = generatePack(selectedSet);
    ensurePackOpenClientEventId(nextPack, selectedSet.id);
    markPackGenerationComplete(selectedSet, nextPack, generationStart);

    setPulledCards(nextPack);
    setScreen("reveal");
  }

  function openAnotherPack() {
    if (!selectedSet || !canGeneratePack(selectedSet) || isOpeningPack) return;

    pauseImageWarmup({ packOpening: true });
    setIsReturningToSet(false);
    setActiveTab("open");
    resetPageScroll();
    setCloudWarning("");
    const generationStart = markPackGenerationStart(selectedSet);
    const nextPack = generatePack(selectedSet);
    ensurePackOpenClientEventId(nextPack, selectedSet.id);
    markPackGenerationComplete(selectedSet, nextPack, generationStart);

    setPulledCards(nextPack);
    setScreen("reveal");
    setIsTabLoading(false);
  }

  function viewCollection(set = selectedSet) {
    if (!set) return;

    if (!(activeTab === "collection" && screen === "collection")) {
      pushAppHistory({ activeTab: "collection", screen: "collection" });
    }

    pushAppHistory({ activeTab: "collection", screen: "setCollection", selectedSetId: set.id });
    setActiveTab("collection");
    setCollectionDashboardSubtabRequest("");
    setBinderOpenRequestId("");
    setSelectedSet(set);
    setScreen("setCollection");
    setIsTabLoading(false);
    resetPageScroll();
  }

  function returnToCollectionList() {
    pushAppHistory({ activeTab: "collection", screen: "collection", collectionSubtab: "sets" });
    setActiveTab("collection");
    setScreen("collection");
    setSelectedSet(null);
    setPulledCards([]);
    setCollectionDashboardSubtabRequest("sets");
    setBinderOpenRequestId("");
    setIsTabLoading(false);
    resetPageScroll();
  }

  function returnToOpenSetList() {
    pushAppHistory({ activeTab: "open", screen: "home" });
    setActiveTab("open");
    setScreen("home");
    setSelectedSet(null);
    setPulledCards([]);
    setCollectionDashboardSubtabRequest("");
    setBinderOpenRequestId("");
    setIsTabLoading(false);
    resetPageScroll();
  }

  function handleCardsRevealed(cards) {
    if (!selectedSet || !cards.length) return;

    const currentCollection = authUser ? collection : loadCollection();
    const nextCollection = markCardsCollected(currentCollection, cards, selectedSet.id);

    if (!authUser) {
      saveCollection(nextCollection);
    }

    setCollection(nextCollection);

    if (cards.welcomeReward) return;

    if (authUser) {
      const clientEventId = ensurePackOpenClientEventId(cards, selectedSet.id);
      savePulledCardsToCloud(cards, selectedSet.id, { userId: authUser.id, clientEventId })
        .then(async () => {
          try {
            const result = await recordPackOpenEvent({
              userId: authUser.id,
              setId: selectedSet.id,
              cards,
            });

            if (result?.stats) setProfileStats(result.stats);
          } catch (statsError) {
            console.warn("Cloud pack-open event failed after pack save", {
              userId: authUser.id,
              setId: selectedSet.id,
              cardCount: cards.length,
              error: statsError,
            });
            setCloudWarning("Your collection saved, but account stats could not be updated yet.");
          }
        })
        .catch((error) => {
          console.warn("Cloud pack save failed; queued pull for retry", {
            setId: selectedSet.id,
            cardCount: cards.length,
            error,
          });

          enqueuePendingCloudPull(cards, selectedSet.id, authUser.id, clientEventId);
          setCloudWarning("Couldn't save this pack to your account yet. It was saved locally and will retry automatically.");
        });
    }
  }

  function persistBinderState(nextBinders, changedBinderId = "") {
    if (!authUser) {
      saveBinders(nextBinders);
      return;
    }

    const changedBinder = changedBinderId ? nextBinders.find((binder) => binder.id === changedBinderId) : null;
    const saveOperation = changedBinder
      ? upsertCloudBinder(authUser.id, changedBinder)
      : saveCloudBinders(authUser.id, nextBinders);

    saveOperation
      .then(() => {})
      .catch((error) => {
        console.warn("Cloud binder save failed", error);
        setCloudWarning("Binder save failed. Your latest binder changes may not persist after refresh.");
      });
  }

  function handleCreateBinder(name, tag, theme) {
    const binder = createBinder({ name, tag, theme });

    setBinders((currentBinders) => {
      const nextBinders = [binder, ...currentBinders];

      persistBinderState(nextBinders, binder.id);
      return nextBinders;
    });

    return binder;
  }

  function handleUpdateBinderTheme(binderId, theme) {
    setBinders((currentBinders) => {
      const nextBinders = updateBinderTheme(currentBinders, binderId, theme);

      persistBinderState(nextBinders, binderId);
      return nextBinders;
    });
  }

  function handleCreateMasterSetBinder(set, options = {}) {
    if (!set?.id) return null;

    const existingBinder = binders.find((binder) => isMasterSetBinder(binder) && binder.setId === set.id);

    if (existingBinder) return existingBinder;

    const binder = createMasterSetBinder(set, options.theme);

    if (!binder) return null;

    setBinders((currentBinders) => {
      const currentExisting = currentBinders.find((candidate) => isMasterSetBinder(candidate) && candidate.setId === set.id);

      if (currentExisting) return currentBinders;

      const nextBinders = [binder, ...currentBinders];

      persistBinderState(nextBinders, binder.id);
      return nextBinders;
    });

    return binder;
  }

  function openMasterSetBinder(set) {
    const binder = handleCreateMasterSetBinder(set);

    if (!binder) return;

    setSelectedSet(set);
    setActiveTab("collection");
    setScreen("collection");
    setCollectionDashboardSubtabRequest("binders");
    setBinderOpenRequestId(binder.id);
    pushAppHistory({ activeTab: "collection", screen: "collection", collectionSubtab: "binders", openBinderId: binder.id });
    resetPageScroll();
  }

  function handleAddToBinder(card, set, binderId) {
    setBinders((currentBinders) => {
      if (!isCardCollected(collection, card, set.id)) return currentBinders;

      const targetBinderId = binderId || currentBinders[0]?.id;

      if (!targetBinderId) return currentBinders;

      const nextBinders = addCardToBinder(currentBinders, targetBinderId, card, set.id);

      persistBinderState(nextBinders, targetBinderId);
      return nextBinders;
    });
  }

  function handleRemoveFromBinder(card, set, binderId) {
    setBinders((currentBinders) => {
      const targetBinderId = binderId || currentBinders[0]?.id;

      if (!targetBinderId) return currentBinders;

      const nextBinders = removeCardFromBinder(currentBinders, targetBinderId, card, set.id);

      persistBinderState(nextBinders, targetBinderId);
      return nextBinders;
    });
  }

  function handleClearBinder(binderId) {
    setBinders((currentBinders) => {
      const nextBinders = clearBinderCards(currentBinders, binderId);

      persistBinderState(nextBinders, binderId);
      return nextBinders;
    });
  }

  async function handleClaimWelcomeReward(choice) {
    if (!authUser || !choice?.set || isClaimingWelcomeReward) return;

    setIsClaimingWelcomeReward(true);
    setWelcomeRewardError("");

    try {
      const result = await claimWelcomeGodPack(choice.set.id, choice.forcedFormat);
      const rewardPack = result.cards;

      if (!rewardPack?.length || !rewardPack.isGodPack) {
        throw new Error("This God Pack is not available right now. Please choose another pack.");
      }

      const claimedStatus =
        result.status || {
          isEligible: true,
          isClaimed: true,
          setId: choice.set.id,
          claimedAt: new Date().toISOString(),
        };

      Object.assign(rewardPack, {
        isGodPack: true,
        godPackDisplayName: rewardPack.godPackDisplayName || choice.config?.displayName || "God Pack",
        welcomeReward: true,
      });

      preloadImages(rewardPack.map((card) => getCardImageUrl(card)), { timeoutMs: 0 });

      setWelcomeRewardStatus(claimedStatus);
      cacheWelcomeRewardStatus(authUser.id, claimedStatus);
      if (result.collection) setCollection(result.collection);
      if (result.stats) {
        setProfileStats(result.stats);
      } else {
        loadCloudProfileStats(authUser.id)
          .then((stats) => setProfileStats(stats))
          .catch((error) => {
            console.warn("Welcome reward profile stats reload failed", {
              userId: authUser.id,
              cardCount: rewardPack.length,
              error,
            });
          });
      }
      setIsWelcomeRewardModalOpen(false);
      setActiveTab("open");
      setSelectedSet(choice.set);
      setPulledCards(rewardPack);
      setScreen("reveal");
      setIsTabLoading(false);
      resetPageScroll();
    } catch (error) {
      console.warn("Welcome reward claim failed", error);
      setWelcomeRewardError(error?.message || "Could not open your welcome reward. Please try again.");
    } finally {
      setIsClaimingWelcomeReward(false);
    }
  }

  function backToSets() {
    const token = returnTokenRef.current + 1;
    const start = performance.now();

    returnTokenRef.current = token;
    setIsReturningToSet(true);

    window.setTimeout(() => {
      if (returnTokenRef.current !== token) return;

      setPulledCards([]);
      setSelectedSet(null);
      setActiveTab("open");
      setScreen("home");
      pushAppHistory({ activeTab: "open", screen: "home" });
      resetPageScroll();

      const elapsed = performance.now() - start;
      const remaining = Math.max(0, MIN_RETURN_LOADING_MS - elapsed);

      window.setTimeout(() => {
        if (returnTokenRef.current === token) {
          setIsReturningToSet(false);
        }
      }, remaining);
    }, RETURN_LOADING_RENDER_DELAY_MS);
  }

  return (
    <main className={`app-shell ${isPackFlow ? "is-pack-flow" : ""}`.trim()}>
      <header className="site-header">
        <div className="site-brand">
          <img className="site-brand__icon" src="/packdex-icon-192.png" alt="" />
          <span>PackDex</span>
        </div>
        {!isPackFlow && (
          <nav className="main-tabs" aria-label="Main navigation">
            {MAIN_TABS.map((tab) => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "is-active" : ""}
                type="button"
                onClick={() => selectMainTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {cloudWarning && (
        <div className="cloud-warning" role="status">
          {cloudWarning}
        </div>
      )}

      {activeTab === "open" && (
        <>
          {screen === "home" && (
            <SetSelect
              sets={sets}
              collection={collection}
              onSelectSet={startPackOpening}
              onViewCollection={viewCollection}
              user={authUser}
              onOpenAuth={openAuthModal}
              footer={<SiteFooter />}
            />
          )}

          {screen === "opening" && selectedSet && (
            <PackOpening
              set={selectedSet}
              onOpened={revealPack}
              onBackToSets={backToSets}
              onViewCollection={viewCollection}
              user={authUser}
              onOpenAuth={openAuthModal}
              isOpening={isOpeningPack}
            />
          )}

          {screen === "reveal" && selectedSet && (
            <CardReveal
              cards={pulledCards}
              set={selectedSet}
              onCardsRevealed={handleCardsRevealed}
              onComplete={() => setScreen("summary")}
              onBackToSets={backToSets}
            />
          )}

          {screen === "summary" && selectedSet && (
            <PullSummary
              cards={pulledCards}
              set={selectedSet}
              collection={collection}
              user={authUser}
              onOpenAuth={openAuthModal}
              onOpenAnother={openAnotherPack}
              onBackToSets={backToSets}
              onViewCollection={viewCollection}
              isOpeningAnother={isOpeningPack}
            />
          )}

        </>
      )}

      {activeTab === "collection" && screen === "collection" && (
        <CollectionDashboard
          collection={collection}
          binders={binders}
          user={authUser}
          requestedSubtab={collectionDashboardSubtabRequest}
          requestedBinderId={binderOpenRequestId}
          onBinderRequestHandled={() => {
            setCollectionDashboardSubtabRequest("");
            setBinderOpenRequestId("");
          }}
          onOpenAuth={openAuthModal}
          onCreateBinder={handleCreateBinder}
          onCreateMasterSetBinder={handleCreateMasterSetBinder}
          onUpdateBinderTheme={handleUpdateBinderTheme}
          onClearBinder={handleClearBinder}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
        />
      )}

      {activeTab === "collection" && screen === "setCollection" && selectedSet && (
        <CollectionPage
          set={selectedSet}
          collection={collection}
          binders={binders}
          user={authUser}
          onOpenAuth={openAuthModal}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
          onOpenPacks={returnToOpenSetList}
          onBackToSets={returnToOpenSetList}
          onOpenMasterSetBinder={openMasterSetBinder}
        />
      )}

      {activeTab === "profile" && (
        <ProfilePage
          collection={collection}
          profileStats={profileStats}
          areProfileStatsLoading={areProfileStatsLoading}
          user={authUser}
          isAuthLoading={isAuthLoading}
          welcomeRewardStatus={welcomeRewardStatus}
          onOpenAuth={openAuthModal}
          onOpenWelcomeReward={() => {
            setWelcomeRewardError("");
            setIsWelcomeRewardModalOpen(true);
          }}
          onDeleteAccount={() => setIsDeleteAccountOpen(true)}
        />
      )}

      {!(activeTab === "open" && screen === "home") && <SiteFooter />}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      <DeleteAccountDialog
        isOpen={isDeleteAccountOpen}
        onClose={() => setIsDeleteAccountOpen(false)}
        onConfirm={handleDeleteAccount}
        onContinueAsGuest={handleContinueAsGuest}
      />
      <WelcomeBetaModal
        isOpen={isWelcomeBetaOpen}
        onDismiss={() => {
          markWelcomeBetaSeen(authUser);
          setIsWelcomeBetaOpen(false);
        }}
      />
      <WelcomeRewardModal
        isOpen={isWelcomeRewardModalOpen}
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
      {isClaimingWelcomeReward && (
        <TabLoadingOverlay text="Opening welcome pack..." subtext="Preparing this virtual God Pack" />
      )}
      {isAuthOpening && <TabLoadingOverlay text="Opening account..." />}
      {isOpeningPack && <TabLoadingOverlay text={authUser ? "Saving pulls securely..." : "Opening your pack..."} />}
      {isTabLoading && <TabLoadingOverlay />}
      {isReturningToSet && <LoadingOverlay />}
      <ThemeToggle />
    </main>
  );
}

export default App;
