import { useEffect, useMemo, useRef, useState } from "react";
import PackOpening from "./components/PackOpening.jsx";
import AuthPanel, { AuthModal } from "./components/AuthPanel.jsx";
import CardReveal from "./components/CardReveal.jsx";
import CardDetailModal from "./components/CardDetailModal.jsx";
import CollectionPage from "./components/CollectionPage.jsx";
import FoilCard from "./components/FoilCard.jsx";
import PullSummary from "./components/PullSummary.jsx";
import SetSelect from "./components/SetSelect.jsx";
import { sets } from "./data/sets.js";
import {
  loadCloudCollection,
  savePulledCardsToCloud,
  syncLocalCollectionToCloud,
} from "./lib/cloudCollection.js";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient.js";
import {
  canGeneratePack,
  generatePack,
  getDisplayCardName,
  getDisplayRarity,
} from "./utils/packGenerator.js";
import {
  addCardToBinder,
  clearBinderCards,
  createBinder,
  getBinderCardKey,
  loadBinders,
  removeCardFromBinder,
  saveBinders,
} from "./utils/binderStorage.js";
import {
  getCardCollectionKey,
  getCardCount,
  getPullableCollectionCards,
  isCardCollected,
  loadCollection,
  markCardsCollected,
  saveCollection,
} from "./utils/collectionStorage.js";
import { getPokeballLoadingUrl, getSetLogoUrl } from "./utils/assetUrls.js";
import { compareCardsByRarity } from "./utils/rarityRank.js";

const TAB_LOADING_MS = 420;
const AUTH_MODAL_LOADING_MS = 380;
const MIN_RETURN_LOADING_MS = 450;
const RETURN_LOADING_RENDER_DELAY_MS = 100;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();
const PACK_STATS_STORAGE_KEY = "packdex-profile-stats";
const COLLECTION_DASHBOARD_PAGE_SIZE = 60;
const BINDER_PAGE_SIZE = 9;
const ACTIVE_BINDER_STORAGE_KEY = "packdex-active-binder-id";

const MAIN_TABS = [
  { id: "open", label: "Open a Pack" },
  { id: "collection", label: "Collection" },
  { id: "profile", label: "Profile" },
];

function LoadingOverlay() {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-label="Returning to set">
      <img className="loading-pokeball" src={POKEBALL_LOADING_SRC} alt="" />
      <div className="loading-text">Returning to set...</div>
    </div>
  );
}

function TabLoadingOverlay({ text = "Loading..." }) {
  return (
    <div className="tab-loading-overlay" role="status" aria-live="polite" aria-label="Loading section">
      <div className="tab-loading-card">
        <img src={POKEBALL_LOADING_SRC} alt="" />
        <span>{text}</span>
      </div>
    </div>
  );
}

function loadProfileStats() {
  if (typeof window === "undefined") {
    return { packsOpened: 0, recentSets: [] };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(PACK_STATS_STORAGE_KEY));

    return {
      packsOpened: Number(parsed?.packsOpened || 0),
      recentSets: Array.isArray(parsed?.recentSets) ? parsed.recentSets : [],
    };
  } catch {
    return { packsOpened: 0, recentSets: [] };
  }
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

function saveProfileStats(stats) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(PACK_STATS_STORAGE_KEY, JSON.stringify(stats));
}

function updatePackOpenedStats(stats, set) {
  const recentSets = [
    { id: set.id, name: set.name, openedAt: Date.now() },
    ...(stats.recentSets || []).filter((recentSet) => recentSet.id !== set.id),
  ].slice(0, 5);

  return {
    packsOpened: (stats.packsOpened || 0) + 1,
    recentSets,
  };
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

function AuthSaveNotice({ onOpenAuth }) {
  return (
    <div className="auth-save-notice">
      <button type="button" onClick={onOpenAuth}>
        Log in
      </button>{" "}
      or{" "}
      <button type="button" onClick={onOpenAuth}>
        create an account
      </button>{" "}
      to save your collection and binders across devices.
    </div>
  );
}

function GuestSignupNotice({ user, onOpenAuth }) {
  if (user) return null;

  return (
    <aside className="guest-signup-notice" aria-label="Create a PackDex account">
      <span>You're not signed in!</span>
      <button type="button" onClick={onOpenAuth}>
        Sign up
      </button>
      <span>to save your collection and binders.</span>
    </aside>
  );
}

function CloudSyncPrompt({ isVisible, status, onSync, onDismiss }) {
  if (!isVisible) return null;

  return (
    <section className="cloud-sync-prompt" aria-label="Sync guest collection">
      <div>
        <span className="set-mark">Cloud Sync</span>
        <strong>You have a guest collection saved on this device.</strong>
        <p>Sync it to your account?</p>
        {status && <em>{status}</em>}
      </div>
      <div className="cloud-sync-actions">
        <button className="primary-button" type="button" onClick={onSync}>
          Sync to account
        </button>
        <button className="secondary-button" type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}

function LegalPage({ type }) {
  const isPrivacy = type === "privacy";

  return (
    <section className="legal-screen">
      <img className="site-logo" src="/packdex-large.png" alt="PackDex" />
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
            PackDex uses account and collection information to let users log in, save collections, sync collections
            across devices, and use account-based features.
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
            For questions about this Privacy Policy, contact the PackDex creator through the contact method listed on
            the site or repository.
          </p>
        </div>
      ) : (
        <div className="legal-copy">
          <p>Welcome to PackDex. By using PackDex, you agree to these Terms of Service.</p>
          <h2>1. About PackDex</h2>
          <p>
            PackDex is a fan-made Pokemon TCG pack opening simulator. PackDex is not affiliated with, endorsed by,
            sponsored by, or approved by Nintendo, Creatures, GAME FREAK, The Pokemon Company, or any of their
            affiliates.
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
            collection-saving features.
          </p>
          <h2>5. Intellectual Property</h2>
          <p>
            Pokemon names, card images, logos, and related materials belong to their respective owners. PackDex does not
            claim ownership of Pokemon intellectual property. PackDex's original site design, layout, and code belong
            to the PackDex project unless otherwise noted.
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
            For questions about these Terms, contact the PackDex creator through the contact method listed on the site
            or repository.
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
      <img className="site-logo" src="/packdex-large.png" alt="PackDex" />
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
      <img className="site-logo" src="/packdex-large.png" alt="PackDex" />
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

function CollectionDashboard({ collection, binders, user, onOpenAuth, onAddToBinder, onRemoveFromBinder }) {
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

  return (
    <section className="dashboard-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Collection</span>
        <h1>Collected Cards</h1>
        <p>Your pulled cards across every set live here.</p>
      </div>

      {user ? <div className="cloud-save-badge">Cloud saving enabled</div> : <AuthSaveNotice onOpenAuth={onOpenAuth} />}

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

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          set={selectedCard.set}
          collected
          count={selectedCard.count}
          showBinderControl
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

function BinderSection({
  binders,
  collection,
  user,
  onOpenAuth,
  onCreateBinder,
  onClearBinder,
  onAddToBinder,
  onRemoveFromBinder,
}) {
  const [activeBinderId, setActiveBinderId] = useState(() => loadActiveBinderId());
  const [newBinderName, setNewBinderName] = useState("");
  const [newBinderTag, setNewBinderTag] = useState(BINDER_TAGS[0]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [nameError, setNameError] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addEraFilter, setAddEraFilter] = useState("all");
  const [addSetFilter, setAddSetFilter] = useState("all");
  const [addRarityFilter, setAddRarityFilter] = useState("all");
  const [sortMode, setSortMode] = useState("order");
  const [page, setPage] = useState(1);
  const [selectedCard, setSelectedCard] = useState(null);
  const activeBinder = useMemo(
    () => binders.find((binder) => binder.id === activeBinderId) || null,
    [activeBinderId, binders]
  );
  const binderDisplayCards = useMemo(() => getBinderDisplayCards(activeBinder, collection), [activeBinder, collection]);
  const sortedBinderCards = useMemo(() => sortBinderCards(binderDisplayCards, sortMode), [binderDisplayCards, sortMode]);
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
  const totalPages = Math.max(1, Math.ceil(sortedBinderCards.length / BINDER_PAGE_SIZE));
  const pageCards = sortedBinderCards.slice((page - 1) * BINDER_PAGE_SIZE, page * BINDER_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [sortMode, activeBinder?.id, activeBinder?.cards.length]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!activeBinderId) return;

    if (binders.some((binder) => binder.id === activeBinderId)) {
      saveActiveBinderId(activeBinderId);
    } else {
      setActiveBinderId("");
      saveActiveBinderId("");
    }
  }, [activeBinderId, binders]);

  function handleCreateBinder(event) {
    event.preventDefault();
    const trimmedName = newBinderName.trim();

    if (!trimmedName) {
      setNameError("Binder name is required.");
      return;
    }

    const binder = onCreateBinder(trimmedName, newBinderTag);

    setNewBinderName("");
    setNewBinderTag(BINDER_TAGS[0]);
    setNameError("");
    setIsCreateOpen(false);
    if (binder?.id) {
      setActiveBinderId(binder.id);
      saveActiveBinderId(binder.id);
    }
  }

  function handleClearBinder() {
    if (!activeBinder || activeBinder.cards.length === 0) return;

    if (window.confirm(`Clear ${activeBinder.name}? Your actual collection will not be deleted.`)) {
      onClearBinder(activeBinder.id);
    }
  }

  return (
    <div className="profile-panel binder-panel">
      <div className="binder-panel-header">
        <div>
          <h2>My Binders</h2>
          <p>{binders.length > 0 ? "Select one binder to view and manage." : "No binders yet!"}</p>
        </div>
        <div className="binder-controls">
          <label>
            <span>Select binder to display</span>
            <select
              value={activeBinderId}
              onChange={(event) => {
                setActiveBinderId(event.target.value);
                saveActiveBinderId(event.target.value);
              }}
              aria-label="Select binder to display"
              disabled={binders.length === 0}
            >
              <option value="">{binders.length === 0 ? "No binders yet" : "Choose a binder"}</option>
              {binders.map((binder) => (
                <option key={binder.id} value={binder.id}>
                  {binder.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button binder-create-button" type="button" onClick={() => setIsCreateOpen(true)}>
            Create Binder
          </button>
        </div>
      </div>

      {!user && <AuthSaveNotice onOpenAuth={onOpenAuth} />}

      {binders.length === 0 && (
        <div className="binder-empty-state">
          <strong>No binders yet!</strong>
          <span>Create your first binder to start organizing your favorite cards.</span>
        </div>
      )}

      {binders.length > 0 && !activeBinder && (
        <div className="binder-empty-state">
          <strong>Choose a binder</strong>
          <span>Choose a binder to view your saved cards.</span>
        </div>
      )}

      {activeBinder && (
        <>
          <div className="binder-view-header">
            <div>
              <h3>{activeBinder.name}</h3>
              <span className="binder-tag-badge">
                {getBinderTagLogo(activeBinder.tag) && <img src={getBinderTagLogo(activeBinder.tag)} alt="" />}
                {activeBinder.tag}
              </span>
            </div>
            <div className="binder-view-controls">
              <strong>{activeBinder.cards.length} saved cards</strong>
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

          <div className="binder-book">
            <div className="binder-rings" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="binder-page" key={`${activeBinder.id}-${page}`}>
              {Array.from({ length: BINDER_PAGE_SIZE }).map((_, index) => {
                const item = pageCards[index];

                return (
                  <div className={`binder-slot ${item ? "is-filled" : "is-empty"}`} key={item?.key || `empty-${index}`}>
                    {item ? (
                      <>
                        <button className="binder-card-button" type="button" onClick={() => setSelectedCard(item)}>
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
                );
              })}
            </div>
          </div>

          {binderDisplayCards.length === 0 && (
            <div className="binder-empty-state">This binder is empty. Add cards from your Collection.</div>
          )}

          <div className="pagination-controls" aria-label="Binder pages">
            <button type="button" onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))} disabled={page === 1}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button type="button" onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))} disabled={page === totalPages}>
              Next
            </button>
          </div>
        </>
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
            <label>
              Tag / category
              <select value={newBinderTag} onChange={(event) => setNewBinderTag(event.target.value)} aria-label="Binder tag">
                {BINDER_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <div className="binder-create-preview">
              {getBinderTagLogo(newBinderTag) ? <img src={getBinderTagLogo(newBinderTag)} alt="" /> : <span>{newBinderTag}</span>}
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
          collected
          count={selectedCard.count}
          showBinderControl
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

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__brand">
        <img src="/packdex-small.png" alt="" />
        <span>PackDex</span>
      </div>
      <p>
        PackDex is a fan-made Pokémon TCG pack opening simulator. PackDex is not affiliated with, endorsed by,
        sponsored by, or associated with Nintendo, The Pokémon Company, Creatures Inc., or Game Freak. Pokémon,
        Pokémon TCG, and related names, images, and trademarks are the property of their respective owners. All card
        images and related assets are used for informational and entertainment purposes only.
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

function ProfilePage({
  collection,
  profileStats,
  binders,
  user,
  cloudSyncStatus,
  showCloudSyncPrompt,
  onOpenAuth,
  onSyncGuestCollection,
  onDismissCloudSync,
  onCreateBinder,
  onClearBinder,
  onAddToBinder,
  onRemoveFromBinder,
}) {
  const collectedCards = useMemo(() => getCollectedCards(collection), [collection]);
  const uniqueCards = collectedCards.length;
  const totalCards = collectedCards.reduce((sum, item) => sum + item.count, 0);
  const completedSets = sets.filter((set) => {
    const pullableCards = getPullableCollectionCards(set);

    return pullableCards.length > 0 && pullableCards.every((card) => isCardCollected(collection, card, set.id));
  }).length;

  return (
    <section className="dashboard-screen profile-screen">
      <div className="dashboard-heading">
        <span className="set-mark">Profile</span>
        <h1>Your PackDex</h1>
        <p>A local snapshot of your pack-opening journey.</p>
      </div>

      <AuthPanel user={user} onOpenAuth={onOpenAuth} />

      {user && <div className="cloud-save-badge">Cloud saving enabled</div>}

      <CloudSyncPrompt
        isVisible={showCloudSyncPrompt}
        status={cloudSyncStatus}
        onSync={onSyncGuestCollection}
        onDismiss={onDismissCloudSync}
      />

      <div className="profile-stat-grid">
        <article>
          <span>Total Cards</span>
          <strong>{totalCards}</strong>
        </article>
        <article>
          <span>Unique Cards</span>
          <strong>{uniqueCards}</strong>
        </article>
        <article>
          <span>Packs Opened</span>
          <strong>{profileStats.packsOpened || 0}</strong>
        </article>
        <article>
          <span>Completed Sets</span>
          <strong>{completedSets}</strong>
        </article>
      </div>

      <BinderSection
        binders={binders}
        collection={collection}
        user={user}
        onOpenAuth={onOpenAuth}
        onCreateBinder={onCreateBinder}
        onClearBinder={onClearBinder}
        onAddToBinder={onAddToBinder}
        onRemoveFromBinder={onRemoveFromBinder}
      />
    </section>
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

  const [activeTab, setActiveTab] = useState("open");
  const [screen, setScreen] = useState("home");
  const [selectedSet, setSelectedSet] = useState(null);
  const [pulledCards, setPulledCards] = useState([]);
  const [collection, setCollection] = useState(() => loadCollection());
  const [binders, setBinders] = useState(() => loadBinders());
  const [profileStats, setProfileStats] = useState(() => loadProfileStats());
  const [authSession, setAuthSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAuthOpening, setIsAuthOpening] = useState(false);
  const [cloudWarning, setCloudWarning] = useState("");
  const [cloudSyncStatus, setCloudSyncStatus] = useState("");
  const [showCloudSyncPrompt, setShowCloudSyncPrompt] = useState(false);
  const [dismissedCloudSyncUserId, setDismissedCloudSyncUserId] = useState("");
  const [isTabLoading, setIsTabLoading] = useState(false);
  const [isReturningToSet, setIsReturningToSet] = useState(false);
  const returnTokenRef = useRef(0);
  const tabLoadTokenRef = useRef(0);
  const isPackFlow = activeTab === "open" && ["opening", "reveal", "summary"].includes(screen);
  const authUser = authSession?.user || null;

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

    if (!authUser) {
      setCollection(loadCollection());
      setShowCloudSyncPrompt(false);
      setCloudSyncStatus("");
      setCloudWarning("");
      return;
    }

    let isMounted = true;
    const localCollection = loadCollection();

    setCloudSyncStatus("");
    setCloudWarning("");

    loadCloudCollection()
      .then((cloudCollection) => {
        if (!isMounted) return;

        setCollection(cloudCollection);
        setShowCloudSyncPrompt(
          hasCollectionEntries(localCollection) && dismissedCloudSyncUserId !== authUser.id
        );
      })
      .catch((error) => {
        console.warn("Cloud collection load failed", error);
        if (!isMounted) return;

        setCollection(localCollection);
        setCloudWarning("Cloud collection load failed. Your local copy is still available.");
        setShowCloudSyncPrompt(false);
      });

    return () => {
      isMounted = false;
    };
  }, [authUser?.id, dismissedCloudSyncUserId, isAuthLoading]);

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
    if (tab === activeTab) return;

    const token = tabLoadTokenRef.current + 1;

    tabLoadTokenRef.current = token;
    setIsTabLoading(true);
    setIsReturningToSet(false);
    setActiveTab(tab);
    resetPageScroll();

    if (tab === "open") {
      setScreen("home");
      setSelectedSet(null);
      setPulledCards([]);
    } else {
      setScreen(tab);
    }

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

  function startPackOpening(set = selectedSet) {
    if (!set || !canGeneratePack(set)) return;

    pushAppHistory({ activeTab: "open", screen: "opening", selectedSetId: set.id });
    setIsReturningToSet(false);
    setActiveTab("open");
    setSelectedSet(set);
    setPulledCards([]);
    setScreen("opening");
    setIsTabLoading(false);
    resetPageScroll();
  }

  function revealPack() {
    if (!selectedSet) return;

    resetPageScroll();
    setPulledCards(generatePack(selectedSet));
    setProfileStats((currentStats) => {
      const nextStats = updatePackOpenedStats(currentStats, selectedSet);

      saveProfileStats(nextStats);
      return nextStats;
    });
    setScreen("reveal");
  }

  function openAnotherPack() {
    if (!selectedSet || !canGeneratePack(selectedSet)) return;

    setIsReturningToSet(false);
    setActiveTab("open");
    resetPageScroll();
    setPulledCards(generatePack(selectedSet));
    setProfileStats((currentStats) => {
      const nextStats = updatePackOpenedStats(currentStats, selectedSet);

      saveProfileStats(nextStats);
      return nextStats;
    });
    setScreen("reveal");
    setIsTabLoading(false);
  }

  function viewCollection(set = selectedSet) {
    if (!set) return;

    pushAppHistory({ activeTab: "open", screen: "setCollection", selectedSetId: set.id });
    setActiveTab("open");
    setSelectedSet(set);
    setScreen("setCollection");
    setIsTabLoading(false);
  }

  function handleCardsRevealed(cards) {
    if (!selectedSet || !cards.length) return;

    const currentCollection = authUser ? collection : loadCollection();
    const nextCollection = markCardsCollected(currentCollection, cards, selectedSet.id);

    if (!authUser) {
      saveCollection(nextCollection);
    }

    setCollection(nextCollection);

    if (authUser) {
      savePulledCardsToCloud(cards, selectedSet.id).catch((error) => {
        console.warn("Cloud save failed", error);
        saveCollection(nextCollection);
        setCloudWarning("Cloud save failed. Your local copy is still available.");
      });
    }
  }

  function handleDismissCloudSync() {
    setDismissedCloudSyncUserId(authUser?.id || "");
    setShowCloudSyncPrompt(false);
    setCloudSyncStatus("");
  }

  function handleSyncGuestCollection() {
    const localCollection = loadCollection();

    setCloudSyncStatus("Syncing...");
    syncLocalCollectionToCloud(localCollection)
      .then((cloudCollection) => {
        setCollection(cloudCollection);
        setCloudSyncStatus("Synced.");
        setShowCloudSyncPrompt(false);
      })
      .catch((error) => {
        console.warn("Guest collection sync failed", error);
        setCloudSyncStatus("Sync failed. Try again later.");
        setCloudWarning("Cloud save failed. Your local copy is still available.");
      });
  }

  function handleCreateBinder(name, tag) {
    const binder = createBinder({ name, tag });

    setBinders((currentBinders) => {
      const nextBinders = [binder, ...currentBinders];

      saveBinders(nextBinders);
      return nextBinders;
    });

    return binder;
  }

  function handleAddToBinder(card, set, binderId) {
    setBinders((currentBinders) => {
      if (!isCardCollected(collection, card, set.id)) return currentBinders;

      const targetBinderId = binderId || currentBinders[0]?.id;

      if (!targetBinderId) return currentBinders;

      const nextBinders = addCardToBinder(currentBinders, targetBinderId, card, set.id);

      saveBinders(nextBinders);
      return nextBinders;
    });
  }

  function handleRemoveFromBinder(card, set, binderId) {
    setBinders((currentBinders) => {
      const targetBinderId = binderId || currentBinders[0]?.id;

      if (!targetBinderId) return currentBinders;

      const nextBinders = removeCardFromBinder(currentBinders, targetBinderId, card, set.id);

      saveBinders(nextBinders);
      return nextBinders;
    });
  }

  function handleClearBinder(binderId) {
    setBinders((currentBinders) => {
      const nextBinders = clearBinderCards(currentBinders, binderId);

      saveBinders(nextBinders);
      return nextBinders;
    });
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
          <img className="site-brand__icon" src="/packdex-small.png" alt="" />
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

      {!authUser && !["reveal", "summary"].includes(screen) && (
        <GuestSignupNotice user={authUser} onOpenAuth={openAuthModal} />
      )}

      {cloudWarning && (
        <div className="cloud-warning" role="status">
          {cloudWarning}
        </div>
      )}

      {activeTab === "open" && screen === "home" && (
        <section className="home-brand-hero" aria-label="PackDex">
          <img className="site-logo" src="/packdex-large.png" alt="PackDex" />
          <h1>PackDex: Pokemon TCG Pack Opening Simulator</h1>
        </section>
      )}

      {activeTab === "open" && (
        <>
          {screen === "home" && (
            <SetSelect sets={sets} collection={collection} onSelectSet={startPackOpening} onViewCollection={viewCollection} />
          )}

          {screen === "opening" && selectedSet && (
            <PackOpening
              set={selectedSet}
              onOpened={revealPack}
              onBackToSets={backToSets}
              onViewCollection={viewCollection}
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
              onOpenAnother={openAnotherPack}
              onBackToSets={backToSets}
              onViewCollection={viewCollection}
            />
          )}

          {screen === "setCollection" && selectedSet && (
            <CollectionPage
              set={selectedSet}
              collection={collection}
              binders={binders}
              user={authUser}
              onOpenAuth={openAuthModal}
              onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
          onOpenPacks={startPackOpening}
          onBackToSets={backToSets}
        />
          )}
        </>
      )}

      {activeTab === "collection" && (
        <CollectionDashboard
          collection={collection}
          binders={binders}
          user={authUser}
          onOpenAuth={openAuthModal}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
        />
      )}

      {activeTab === "profile" && (
        <ProfilePage
          collection={collection}
          profileStats={profileStats}
          binders={binders}
          user={authUser}
          isAuthLoading={isAuthLoading}
          cloudSyncStatus={cloudSyncStatus}
          showCloudSyncPrompt={showCloudSyncPrompt}
          onOpenAuth={openAuthModal}
          onSyncGuestCollection={handleSyncGuestCollection}
          onDismissCloudSync={handleDismissCloudSync}
          onCreateBinder={handleCreateBinder}
          onClearBinder={handleClearBinder}
          onAddToBinder={handleAddToBinder}
          onRemoveFromBinder={handleRemoveFromBinder}
        />
      )}

      <SiteFooter />
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      {isAuthOpening && <TabLoadingOverlay text="Opening account..." />}
      {isTabLoading && <TabLoadingOverlay />}
      {isReturningToSet && <LoadingOverlay />}
    </main>
  );
}

export default App;
