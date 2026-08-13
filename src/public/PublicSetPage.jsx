import CollectionPage from "../components/CollectionPage.jsx";
import { AdSlot, AD_PLACEMENTS } from "../ads/index.js";
import { getSetExploreDetails } from "../lib/setExploreDetails.js";
import { getSetPublicContent } from "../lib/setContent.js";
import { getCardImageUrl } from "../utils/assetUrls.js";
import { getSetCollectionProgress } from "../utils/collectionStorage.js";
import "../public.css";

function formatReleaseDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export default function PublicSetPage({
  set,
  collection,
  binders,
  user,
  pathname,
  onOpenPack,
  onOpenAuth,
  onAddToBinder,
  onRemoveFromBinder,
  onOpenMasterSetBinder,
  onOverlayStateChange,
  adsDisabled = false,
  primaryHeading = true,
}) {
  const content = getSetPublicContent(set);
  const setDetails = getSetExploreDetails(set, {
    featuredCardLimit: 4,
    featuredPokemonLimit: 6,
  });
  const progress = getSetCollectionProgress(collection, set);
  const releaseDate = formatReleaseDate(content.releaseDate);
  const adContext = {
    contentReady: true,
    screen: "set-content",
    disabled: adsDisabled,
  };
  const AboutHeading = primaryHeading ? "h1" : "h2";

  return (
    <div className="public-set-page">
      <section className="public-shell public-set-section public-set-about" aria-labelledby="set-about-heading">
        <div className="public-set-section__heading">
          <span>About this set</span>
          <AboutHeading id="set-about-heading">About {set.name}</AboutHeading>
          <p>{content.summary}</p>
        </div>

        <div className="public-set-overview-grid">
          <dl className="public-set-stats">
            <div><dt>Era</dt><dd>{set.era || "Not listed"}</dd></div>
            <div><dt>Set size</dt><dd>{content.supportedCardCount} supported cards</dd></div>
            {releaseDate && <div><dt>Released</dt><dd>{releaseDate}</dd></div>}
            {content.printedTotal && <div><dt>Main set</dt><dd>{content.printedTotal} cards</dd></div>}
          </dl>

          <aside className="public-set-progress" aria-label={`${set.name} collection progress`}>
            <span>Your collection</span>
            <strong>{progress.percent}%</strong>
            <div aria-hidden="true"><span style={{ width: `${progress.percent}%` }} /></div>
            <p>{progress.collected} collected · {Math.max(0, progress.total - progress.collected)} missing</p>
          </aside>
        </div>

        {(content.guide?.themes?.length > 0 || content.guide?.mechanics?.length > 0) && (
          <div className="public-set-tags" aria-label="Set highlights">
            {[...(content.guide?.themes || []), ...(content.guide?.mechanics || [])].map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
        )}

        {(setDetails.featuredPokemon.length > 0 || setDetails.featuredCards.length > 0 || content.guide?.funFacts?.length > 0) && (
          <div className="public-set-collector-highlights">
            <div className="public-set-collector-copy">
              {setDetails.featuredPokemon.length > 0 && (
                <div className="public-set-featured-pokemon">
                  <span>Featured Pokémon</span>
                  <p>{setDetails.featuredPokemon.map(({ species }) => species.displayName).join(" · ")}</p>
                </div>
              )}
              {content.guide?.funFacts?.length > 0 && (
                <div className="public-set-highlight-note">
                  <span>Set highlight</span>
                  {content.guide.funFacts.map((fact) => <p key={fact}>{fact}</p>)}
                </div>
              )}
              {setDetails.specialFeature && <p className="public-set-special-feature">✦ {setDetails.specialFeature}</p>}
            </div>

            {setDetails.featuredCards.length > 0 && (
              <div className="public-set-featured-cards" aria-label={`Featured cards in ${set.name}`}>
                <span>Featured in this set</span>
                <div>
                  {setDetails.featuredCards.map(({ card }) => (
                    <figure key={card.id}>
                      <img src={getCardImageUrl(card)} alt={`${card.name} card`} loading="lazy" decoding="async" />
                      <figcaption>{card.name}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <AdSlot
        className="public-set-mobile-ad"
        placement={AD_PLACEMENTS.MOBILE_INLINE}
        pathname={pathname}
        context={{ ...adContext, isMobile: true }}
      />

      <AdSlot
        className="public-set-desktop-inline-ad"
        placement={AD_PLACEMENTS.SET_INLINE}
        pathname={pathname}
        context={adContext}
      />

      <section id="set-collection" className="public-shell public-set-section public-set-collection" aria-labelledby="collection-heading">
        <div className="public-set-section__heading">
          <span>Your collection</span>
          <h2 id="collection-heading">Track {set.name}</h2>
          <p>
            Review collection progress, filter collected and missing cards, inspect rarities, and use PackDex's
            existing collection and binder controls.
          </p>
        </div>
        <div className="collection-progress-panel public-set-collection-progress">
          <div className="collection-progress-copy">
            <strong>{progress.collected} / {progress.total}</strong>
            <span>{progress.percent}% complete</span>
          </div>
          <div className="collection-progress-bar" aria-hidden="true">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
        <h3 className="public-set-checklist-heading">Card checklist</h3>
        <CollectionPage
          embedded
          set={set}
          collection={collection}
          binders={binders}
          user={user}
          onOpenAuth={onOpenAuth}
          onAddToBinder={onAddToBinder}
          onRemoveFromBinder={onRemoveFromBinder}
          onOpenPacks={onOpenPack}
          onBackToSets={() => { window.location.assign("/sets"); }}
          onOpenMasterSetBinder={onOpenMasterSetBinder}
          onOverlayStateChange={onOverlayStateChange}
        />
      </section>
    </div>
  );
}
