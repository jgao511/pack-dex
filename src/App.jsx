import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Mail, Settings2, X } from "lucide-react";
import "./App.css";
import "./DesktopTheme.css";
import PackOpening from "./components/PackOpening.jsx";
import AccountSaveNotice from "./components/AccountSaveNotice.jsx";
import AuthPanel, { AuthModal } from "./components/AuthPanel.jsx";
import DeleteAccountDialog from "./components/DeleteAccountDialog.jsx";
import CardReveal from "./components/CardReveal.jsx";
import CardDetailModal from "./components/CardDetailModal.jsx";
import CollectionPage from "./components/CollectionPage.jsx";
import FoilCard from "./components/FoilCard.jsx";
import BinderSystem from "./components/binders/BinderSystem.jsx";
import PullSummary from "./components/PullSummary.jsx";
import PrivacyChoicesDialog from "./components/PrivacyChoicesDialog.jsx";
import SetSelect from "./components/SetSelect.jsx";
import {
  LEGAL_DOCUMENTS,
  LEGAL_LAST_UPDATED,
  LEGAL_ROUTES,
  PACKDEX_SUPPORT_EMAIL,
} from "./content/legalDocuments.js";
import { activeSets, isRetiredSet, sets } from "./data/sets.js";
import {
  enqueuePendingCloudPull,
  getPendingCloudPullCount,
  loadCloudCollection,
  mergePendingCloudPullsIntoCollection,
  savePulledCardsToCloud,
  syncPendingCloudPulls,
} from "./lib/cloudCollection.js";
import {
  deletePersistedBinder,
  loadPersistedBinders,
  persistBindersForUser,
} from "./lib/binderPersistence.js";
import {
  emptyProfileStats,
  loadCloudProfileStats,
} from "./lib/cloudProfileStats.js";
import { ensurePackOpenClientEventId, recordPackOpenEvent } from "./lib/packOpenEvents.js";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient.js";
import {
  DESKTOP_MOBILE_NOTICE_DISMISSED_KEY,
  dismissDesktopMobileNotice,
  readStorageFlag,
} from "./welcomeEntry.js";
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
  addCardsToBinder,
  createBinder,
  createMasterSetBinder,
  isMasterSetBinder,
  loadBinders,
  removeCardFromBinder,
  replaceBinderCards,
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
import { isSupabaseAuthStorageKey, validateSupabaseIdentity } from "./lib/authIdentityValidation.js";
import { clearCachedSupabaseUser } from "./lib/sessionUserCache.js";
import { openPrivacyChoices } from "./lib/privacyChoices.js";
import { markPackGenerationComplete, markPackGenerationStart } from "./utils/imageDebug.js";
import { markCardBackPreloadFinish, markCardBackPreloadStart } from "./utils/cardBackDebug.js";
import {
  clearImageWarmupQueue,
  pauseImageWarmup,
  resumeImageWarmup,
  scheduleSelectedSetImageWarmup,
} from "./utils/imageWarmup.js";

const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const SUPPORT_EMAIL = PACKDEX_SUPPORT_EMAIL;
const GUEST_WELCOME_BETA_SEEN_KEY = "packdex_guest_welcome_beta_seen";
const USER_WELCOME_BETA_SEEN_KEY_PREFIX = "packdex_welcome_beta_seen_";
const LEGACY_PROFILE_STATS_STORAGE_KEYS = ["packdex-profile-stats"];
const COLLECTION_DASHBOARD_PAGE_SIZE = 60;
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

function applyDesktopTheme() {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
}

if (typeof window !== "undefined") {
  applyDesktopTheme();
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

function AuthSaveNotice({ onOpenAuth }) {
  return <AccountSaveNotice onOpenAuth={onOpenAuth} message="to save your collection and binders across devices." />;
}

function LegalPage({ type }) {
  const legalDocument = LEGAL_DOCUMENTS[type];

  useEffect(() => {
    if (!legalDocument) return undefined;

    document.title = legalDocument.pageTitle;
    let description = document.head.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.name = "description";
      document.head.appendChild(description);
    }
    description.content = legalDocument.metaDescription;
    return undefined;
  }, [legalDocument]);

  if (!legalDocument) return null;

  return (
    <article className="legal-screen">
      <img className="site-logo" src="/packdex-icon-192.png" alt="PackDex" />
      <span className="set-mark">{legalDocument.label}</span>
      <h1>{legalDocument.title}</h1>
      <p className="legal-effective-date">Last updated: {LEGAL_LAST_UPDATED}</p>
      <div className="legal-copy">
        {legalDocument.introduction.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {legalDocument.sections.map((section, index) => (
          <section key={section.title}>
            <h2>{index + 1}. {section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
            {section.contact && (
              <p>
                {section.contact}{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
              </p>
            )}
          </section>
        ))}
      </div>
      <a className="primary-button" href="/">
        Back to PackDex
      </a>
    </article>
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
  onAddBinderCards,
  onReplaceBinderCards,
  onDeleteBinder,
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
    () => ["all", ...new Set(collectedCards.filter(({ set }) => !isRetiredSet(set)).map(({ set }) => set.era || "Other"))],
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
    <section className={`dashboard-screen ${activeCollectionSubtab === "binders" ? "is-binders-active" : ""}`}>
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
          <BinderSystem
            binders={binders}
            collection={collection}
            requestedBinderId={requestedBinderId}
            onBinderRequestHandled={onBinderRequestHandled}
            binderHomeRequest={binderHomeRequest}
            onCreateBinder={onCreateBinder}
            onImportMasterSet={onCreateMasterSetBinder}
            onAddCards={onAddBinderCards}
            onReplaceCards={onReplaceBinderCards}
            onDeleteBinder={onDeleteBinder}
            desktopSurface
            onInspectCard={(card, set) => setSelectedCard({
              card,
              set,
              count: getCardCount(collection, card, set.id),
              collected: isCardCollected(collection, card, set.id),
            })}
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

function SocialIcon({ type }) {
  if (type === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.1 2h9.8A5.1 5.1 0 0 1 22 7.1v9.8a5.1 5.1 0 0 1-5.1 5.1H7.1A5.1 5.1 0 0 1 2 16.9V7.1A5.1 5.1 0 0 1 7.1 2Zm0 2A3.1 3.1 0 0 0 4 7.1v9.8A3.1 3.1 0 0 0 7.1 20h9.8a3.1 3.1 0 0 0 3.1-3.1V7.1A3.1 3.1 0 0 0 16.9 4H7.1Zm10.4 1.7a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM12 7.2A4.8 4.8 0 1 1 12 16.8 4.8 4.8 0 0 1 12 7.2Zm0 2A2.8 2.8 0 1 0 12 14.8 2.8 2.8 0 0 0 12 9.2Z" />
    </svg>
  );
}

function SiteFooter() {
  const socialLinks = [
    { label: "PackDex YouTube", href: "https://www.youtube.com/@pack-dex", type: "youtube" },
    { label: "PackDex Instagram", href: "https://www.instagram.com/pack.dex/", type: "instagram" },
  ];

  return (
    <footer className="site-footer">
      <PrivacyChoicesDialog />
      <div className="site-footer__brand">
        <img src="/packdex-icon-192.png" alt="" />
        <span className="site-wordmark site-footer__wordmark">
          <span>Pack</span>
          <span>Dex</span>
        </span>
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
      <nav className="site-footer__legal" aria-label="Legal and privacy links">
        <a href="/welcome">About PackDex</a>
        <a href={LEGAL_ROUTES.privacy}>Privacy</a>
        <a href={LEGAL_ROUTES.terms}>Terms</a>
        <button type="button" onClick={(event) => openPrivacyChoices(event.currentTarget)}>
          Privacy Choices
        </button>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
      </nav>
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

  if (!isOpen || !rewardStatus?.isEligible || !rewardStatus?.isReady || rewardStatus?.isClaimed) return null;

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
  if (!rewardStatus?.isEligible || !rewardStatus?.isReady) return null;

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
  profileStatsError,
  user,
  isAuthLoading,
  welcomeRewardStatus,
  onOpenAuth,
  onOpenWelcomeReward,
  onDeleteAccount,
}) {
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const completedSets = sets.filter((set) => getSetCollectionProgress(collection, set).percent === 100).length;
  const isAccountResolving = isAuthLoading && !user;

  return (
    <section className="dashboard-screen profile-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Profile</span>
        <h1>Your PackDex</h1>
      </div>

      <AuthPanel user={user} isAuthLoading={isAccountResolving} onOpenAuth={onOpenAuth} />

      {user && <WelcomeRewardProfileCard rewardStatus={welcomeRewardStatus} onClaim={onOpenWelcomeReward} />}

      {isAccountResolving ? (
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
          {profileStatsError && (
            <p className="profile-stats-error" role="status">
              {profileStatsError}
            </p>
          )}
          <details className="profile-settings">
            <summary>
              <span className="profile-settings__icon" aria-hidden="true">
                <Settings2 size={19} />
              </span>
              <span className="profile-settings__copy">
                <strong>Settings</strong>
                <small>Manage your PackDex account</small>
              </span>
              <ChevronRight className="profile-settings__chevron" size={20} aria-hidden="true" />
            </summary>
            <div className="profile-settings__content">
              <div>
                <span className="set-mark">Account Settings</span>
                <h2>Manage your account</h2>
              </div>
              <section className="profile-danger-zone" aria-labelledby="profile-danger-zone-title">
                <span className="set-mark">Danger Zone</span>
                <h3 id="profile-danger-zone-title">Delete your PackDex account</h3>
                <p>Delete your PackDex account and associated data. You will be asked to confirm before anything is removed.</p>
                <button className="delete-account-button" type="button" onClick={onDeleteAccount}>
                  Delete Account
                </button>
              </section>
            </div>
          </details>
        </>
      ) : (
        <div className="empty-state">
          <h2>Sign in to track your PackDex stats.</h2>
          <p>Guest pulls stay local on this browser, but sign in to view account stats.</p>
        </div>
      )}

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
  const legalPagePath = pagePath.length > 1 ? pagePath.replace(/\/+$/, "") : pagePath;
  const legalPageType = legalPagePath === "/terms" ? "terms" : legalPagePath === "/privacy" ? "privacy" : "";

  if (pagePath === "/auth/callback") {
    return (
      <main className="app-shell">
        <AuthCallbackPage />
        <SiteFooter />
      </main>
    );
  }

  if (pagePath === "/reset-password") {
    return (
      <main className="app-shell">
        <ResetPasswordPage />
        <SiteFooter />
      </main>
    );
  }

  if (legalPageType) {
    return (
      <main className="app-shell">
        <LegalPage type={legalPageType} />
        <SiteFooter />
      </main>
    );
  }

  if (import.meta.env.DEV && pagePath === "/dev/god-pack-animation") {
    return (
      <main className="app-shell is-pack-flow">
        <DevGodPackAnimationPreview />
        <SiteFooter />
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
  const [profileStatsError, setProfileStatsError] = useState("");
  const [authSession, setAuthSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isOpeningPack, setIsOpeningPack] = useState(false);
  const [cloudWarning, setCloudWarning] = useState("");
  const [welcomeRewardStatus, setWelcomeRewardStatus] = useState(null);
  const [isWelcomeRewardLoading, setIsWelcomeRewardLoading] = useState(false);
  const [isWelcomeRewardModalOpen, setIsWelcomeRewardModalOpen] = useState(false);
  const [selectedWelcomeRewardSetId, setSelectedWelcomeRewardSetId] = useState(WELCOME_REWARD_CHOICES[0]?.setId || "");
  const [isClaimingWelcomeReward, setIsClaimingWelcomeReward] = useState(false);
  const [welcomeRewardError, setWelcomeRewardError] = useState("");
  const [isWelcomeBetaOpen, setIsWelcomeBetaOpen] = useState(false);
  const [collectionDashboardSubtabRequest, setCollectionDashboardSubtabRequest] = useState("");
  const [binderOpenRequestId, setBinderOpenRequestId] = useState("");
  const [showDesktopMobileNotice, setShowDesktopMobileNotice] = useState(
    () => !readStorageFlag(DESKTOP_MOBILE_NOTICE_DISMISSED_KEY, window)
  );
  const shownWelcomeRewardUserRef = useRef("");
  const loadedProfileStatsUserIdRef = useRef("");
  const authSessionRef = useRef(null);
  const authRefreshPromiseRef = useRef(null);
  const authValidationAttemptRef = useRef(0);
  const isPackFlow = activeTab === "open" && ["opening", "reveal", "summary"].includes(screen);
  const authUser = authSession?.user || null;

  function commitAuthSession(nextSession) {
    authSessionRef.current = nextSession;
    setAuthSession(nextSession);
  }

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

    function refreshValidatedAuth({ showLoading = true } = {}) {
      if (showLoading && !authSessionRef.current?.user) setIsAuthLoading(true);
      if (authRefreshPromiseRef.current) return authRefreshPromiseRef.current;

      const validationAttempt = ++authValidationAttemptRef.current;
      clearCachedSupabaseUser(supabase);
      if (showLoading) {
        setIsWelcomeRewardModalOpen(false);
        setWelcomeRewardStatus(null);
        setWelcomeRewardError("");
      }

      const promise = (async () => {
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            if (isMounted && validationAttempt === authValidationAttemptRef.current) commitAuthSession(null);
            return null;
          }

          const validation = await validateSupabaseIdentity(supabase, data.session);
          if (!isMounted || validationAttempt !== authValidationAttemptRef.current) return null;
          commitAuthSession(validation.session);
          return validation.user;
        } catch (error) {
          console.warn("Unable to validate PackDex auth session", error);
          if (isMounted && validationAttempt === authValidationAttemptRef.current) commitAuthSession(null);
          return null;
        } finally {
          if (isMounted && validationAttempt === authValidationAttemptRef.current) {
            setIsAuthLoading(false);
          }
        }
      })().finally(() => {
        authRefreshPromiseRef.current = null;
      });

      authRefreshPromiseRef.current = promise;
      return promise;
    }

    function refreshIfActive() {
      if (!isMounted || document.visibilityState === "hidden") return;
      refreshValidatedAuth({ showLoading: false });
    }

    refreshValidatedAuth();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        authValidationAttemptRef.current += 1;
        clearCachedSupabaseUser(supabase);
        commitAuthSession(null);
        setIsAuthLoading(false);
        setIsWelcomeRewardModalOpen(false);
        setWelcomeRewardStatus(null);
        return;
      }

      const hasCurrentSession = authSessionRef.current?.user?.id === session.user.id;
      if (!hasCurrentSession) setIsAuthLoading(true);
      clearCachedSupabaseUser(supabase);
      setIsWelcomeRewardModalOpen(false);
      setWelcomeRewardStatus(null);
      window.setTimeout(() => refreshValidatedAuth({ showLoading: !hasCurrentSession }), 0);
    });

    function handleAuthStorage(event) {
      if (event.key !== null && !isSupabaseAuthStorageKey(supabase, event.key)) return;
      refreshIfActive();
    }

    window.addEventListener("focus", refreshIfActive);
    window.addEventListener("storage", handleAuthStorage);
    document.addEventListener("visibilitychange", refreshIfActive);

    return () => {
      isMounted = false;
      authValidationAttemptRef.current += 1;
      window.removeEventListener("focus", refreshIfActive);
      window.removeEventListener("storage", handleAuthStorage);
      document.removeEventListener("visibilitychange", refreshIfActive);
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
    if (isAuthLoading || authUser) return;

    loadedProfileStatsUserIdRef.current = "";
    setCollection(loadCollection());
    setBinders(loadBinders());
    setProfileStats(emptyProfileStats());
    setAreProfileStatsLoading(false);
    setProfileStatsError("");
    setCloudWarning("");
    setWelcomeRewardStatus(null);
    setIsWelcomeRewardLoading(false);
    setIsWelcomeRewardModalOpen(false);
    setWelcomeRewardError("");
  }, [authUser?.id, isAuthLoading]);

  useEffect(() => {
    if (!authUser) return undefined;

    let isMounted = true;
    const userId = authUser.id;
    const hasLoadedStats = loadedProfileStatsUserIdRef.current === userId;

    setCloudWarning("");
    setProfileStatsError("");
    setAreProfileStatsLoading(!hasLoadedStats);

    loadCloudCollection()
      .then(async (cloudCollection) => {
        if (!isMounted) return;

        setCollection(mergePendingCloudPullsIntoCollection(cloudCollection, userId));

        const pendingPullCount = getPendingCloudPullCount(userId);

        if (pendingPullCount === 0) return;

        try {
          const syncResult = await syncPendingCloudPulls(userId);

          if (!isMounted) return;

          if (syncResult.failed > 0) {
            setCollection((currentCollection) => mergePendingCloudPullsIntoCollection(currentCollection, userId));
            setCloudWarning("Some saved pulls are waiting to sync. PackDex will retry automatically.");
            return;
          }

          if (syncResult.saved > 0) setCloudWarning("");
        } catch (error) {
          console.warn("Pending PackDex cloud pulls could not be synced after account load", {
            userId,
            pendingPullCount,
            error,
          });

          if (!isMounted) return;

          setCollection((currentCollection) => mergePendingCloudPullsIntoCollection(currentCollection, userId));
          setCloudWarning("Some saved pulls are waiting to sync. PackDex will retry automatically.");
        }
      })
      .catch((error) => {
        console.warn("Cloud collection load failed", error);
        if (!isMounted) return;

        setCollection(mergePendingCloudPullsIntoCollection({}, userId));
        setCloudWarning("Account collection could not be loaded yet. Guest pulls stay local on this device.");
      });

    loadPersistedBinders(userId)
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

    loadCloudProfileStats(userId)
      .then((stats) => {
        if (!isMounted) return;

        loadedProfileStatsUserIdRef.current = userId;
        setProfileStats(stats);
        setAreProfileStatsLoading(false);
        setProfileStatsError("");
      })
      .catch((error) => {
        console.warn("Cloud profile stats load failed", {
          userId,
          error,
        });
        if (!isMounted) return;

        if (!hasLoadedStats) setProfileStats(emptyProfileStats());
        setAreProfileStatsLoading(false);
        setProfileStatsError("Account stats are temporarily unavailable. Your account remains connected.");
        setCloudWarning("Account stats could not be loaded yet. Pack opening still works.");
      });

    return () => {
      isMounted = false;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser) return undefined;

    let isMounted = true;

    setIsWelcomeRewardLoading(true);

    loadWelcomeRewardStatus(authUser)
      .then((status) => {
        if (!isMounted) return;

        setWelcomeRewardStatus(status);
        setIsWelcomeRewardLoading(false);
        if (status.isEligible && status.isReady && !status.isClaimed && shownWelcomeRewardUserRef.current !== authUser.id) {
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
  }, [authUser?.id]);

  useEffect(() => {
    function handlePopState(event) {
      const state = event.state;

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
        ? activeSets.find((candidateSet) => candidateSet.id === state.selectedSetId) || null
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

    setActiveTab(tab);
    setScreen(nextScreen);
    setSelectedSet(null);
    setPulledCards([]);
    setCollectionDashboardSubtabRequest(tab === "collection" ? "sets" : "");
    setBinderOpenRequestId("");
    pushAppHistory({ activeTab: tab, screen: nextScreen });
    resetPageScroll();
  }

  function openAuthModal() {
    if (isAuthModalOpen) return;

    setIsAuthModalOpen(true);
  }

  async function handleDeleteAccount() {
    const deletedUserId = authUser?.id;

    if (!deletedUserId || !supabase) {
      throw new Error("You must be signed in to delete your PackDex account.");
    }

    await deleteCurrentAccount(supabase);
    clearDeletedAccountLocalState(deletedUserId);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    authValidationAttemptRef.current += 1;
    commitAuthSession(null);
    setIsAuthLoading(false);
    setCollection({});
    setBinders([]);
    setProfileStats(emptyProfileStats());
    loadedProfileStatsUserIdRef.current = "";
    setAreProfileStatsLoading(false);
    setProfileStatsError("");
    setWelcomeRewardStatus(null);
    setIsWelcomeRewardModalOpen(false);
    setActiveTab("open");
    setScreen("home");
    replaceAppHistory({ activeTab: "open", screen: "home" });
    resetPageScroll();
  }

  async function handleContinueAsGuest() {
    await supabase?.auth.signOut({ scope: "local" }).catch(() => {});
    authValidationAttemptRef.current += 1;
    commitAuthSession(null);
    setIsAuthLoading(false);
    setIsDeleteAccountOpen(false);
  }

  function startPackOpening(set = selectedSet) {
    if (!set || isRetiredSet(set)) return;

    if (!(activeTab === "open" && screen === "home")) {
      pushAppHistory({ activeTab: "open", screen: "home" });
    }

    pushAppHistory({ activeTab: "open", screen: "opening", selectedSetId: set.id });
    setActiveTab("open");
    setCollectionDashboardSubtabRequest("");
    setBinderOpenRequestId("");
    setSelectedSet(set);
    setPulledCards([]);
    setScreen("opening");
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
    if (!selectedSet || isRetiredSet(selectedSet) || !canGeneratePack(selectedSet) || isOpeningPack) return;

    pauseImageWarmup({ packOpening: true });
    setActiveTab("open");
    resetPageScroll();
    setCloudWarning("");
    const generationStart = markPackGenerationStart(selectedSet);
    const nextPack = generatePack(selectedSet);
    ensurePackOpenClientEventId(nextPack, selectedSet.id);
    markPackGenerationComplete(selectedSet, nextPack, generationStart);

    setPulledCards(nextPack);
    setScreen("reveal");
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

            if (result?.stats) {
              loadedProfileStatsUserIdRef.current = authUser.id;
              setProfileStats(result.stats);
              setProfileStatsError("");
            }
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
    persistBindersForUser({
      userId: authUser?.id,
      binders: nextBinders,
      changedBinderId,
    })
      .then(() => {})
      .catch((error) => {
        console.warn("Cloud binder save failed", error);
        setCloudWarning("Binder save failed. Your latest binder changes may not persist after refresh.");
      });
  }

  function handleCreateBinder(name, theme = "midnight") {
    const binder = createBinder({ name, tag: "Custom Binder", theme });

    setBinders((currentBinders) => {
      const nextBinders = [binder, ...currentBinders];

      persistBinderState(nextBinders, binder.id);
      return nextBinders;
    });

    return binder;
  }

  function handleCreateMasterSetBinder(set, name = "", theme = "midnight") {
    if (!set?.id) return null;

    const existingBinder = binders.find((binder) => isMasterSetBinder(binder) && binder.setId === set.id);

    if (existingBinder) return existingBinder;

    const requestedTheme = typeof name === "object" ? name.theme : theme;
    const requestedName = typeof name === "string" ? name.trim() : "";
    const binder = createMasterSetBinder(set, requestedTheme);

    if (!binder) return null;
    if (requestedName) binder.name = requestedName;

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
        loadedProfileStatsUserIdRef.current = authUser.id;
        setProfileStats(result.stats);
        setProfileStatsError("");
      } else {
        loadCloudProfileStats(authUser.id)
          .then((stats) => {
            loadedProfileStatsUserIdRef.current = authUser.id;
            setProfileStats(stats);
            setProfileStatsError("");
          })
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
      resetPageScroll();
    } catch (error) {
      console.warn("Welcome reward claim failed", error);
      setWelcomeRewardError(error?.message || "Could not open your welcome reward. Please try again.");
    } finally {
      setIsClaimingWelcomeReward(false);
    }
  }

  function handleAddBinderCards(binderId, selections) {
    setBinders((currentBinders) => {
      const ownedSelections = (Array.isArray(selections) ? selections : []).filter(({ card, setId }) =>
        isCardCollected(collection, card, setId)
      );
      const nextBinders = addCardsToBinder(currentBinders, binderId, ownedSelections);

      persistBinderState(nextBinders, binderId);
      return nextBinders;
    });
  }

  function handleReplaceBinderCards(binderId, cards) {
    setBinders((currentBinders) => {
      const nextBinders = replaceBinderCards(currentBinders, binderId, cards);

      persistBinderState(nextBinders, binderId);
      return nextBinders;
    });
  }

  async function handleDeleteBinder(binderId) {
    const refreshedBinders = await deletePersistedBinder({
      userId: authUser?.id,
      binderId,
      binders,
    });

    setBinders(refreshedBinders);
    return refreshedBinders;
  }

  function backToSets() {
    clearImageWarmupQueue();
    setPulledCards([]);
    setSelectedSet(null);
    setActiveTab("open");
    setScreen("home");
    pushAppHistory({ activeTab: "open", screen: "home" });
    resetPageScroll();
  }

  return (
    <main className={`app-shell ${isPackFlow ? "is-pack-flow" : ""}`.trim()}>
      <header className="site-header">
        <div className="site-brand">
          <img className="site-brand__icon" src="/packdex-icon-192.png" alt="" />
          <span className="site-wordmark">
            <span>Pack</span>
            <span>Dex</span>
          </span>
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

      {!isPackFlow && activeTab === "open" && screen === "home" && !authUser && (
        <AccountSaveNotice
          className="account-save-notice--shell"
          onOpenAuth={openAuthModal}
          message="to save your collection and binders across devices."
        />
      )}

      {!isPackFlow && showDesktopMobileNotice && (
        <aside className="mobile-experience-notice" aria-label="PackDex mobile experience">
          <span>
            PackDex is fully playable on desktop. For the newest features and most actively updated experience, try the
            mobile app.
          </span>
          <div className="mobile-experience-notice__actions">
            <a href="/mobile-app/">Open mobile PackDex</a>
            <button
              type="button"
              onClick={() => {
                dismissDesktopMobileNotice(window);
                setShowDesktopMobileNotice(false);
              }}
              aria-label="Dismiss mobile app notice"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}

      {cloudWarning && (
        <div className="cloud-warning" role="status">
          {cloudWarning}
        </div>
      )}

      <div className="desktop-screen-cache" hidden={!(activeTab === "open" && screen === "home")}>
        <SetSelect
          sets={activeSets}
          collection={collection}
          onSelectSet={startPackOpening}
          onViewCollection={viewCollection}
          footer={<SiteFooter />}
        />
      </div>

      {activeTab === "open" && screen !== "home" && (
        <>
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
          onAddBinderCards={handleAddBinderCards}
          onReplaceBinderCards={handleReplaceBinderCards}
          onDeleteBinder={handleDeleteBinder}
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
          profileStatsError={profileStatsError}
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
      {isOpeningPack && <TabLoadingOverlay text={authUser ? "Saving pulls securely..." : "Opening your pack..."} />}
    </main>
  );
}

export default App;
