import { useEffect, useRef, useState } from "react";
import { getCardBackUrl, getCardImageUrl } from "../utils/assetUrls.js";
import { isImageLoaded, markImageLoaded, preloadImage } from "../utils/imageCache.js";
import { getFoilProfile } from "../utils/foil.js";
import { getDisplayCardName } from "../utils/packGenerator.js";
import { markRenderedImageError, markRenderedImageLoad, markRenderedImageSrc } from "../utils/imageDebug.js";
import TiltCardFrame from "./TiltCardFrame.jsx";

function FoilCard({
  card,
  set,
  foilProfile = getFoilProfile(card, set),
  className = "",
  variant = "default",
  interactive = true,
  enableTransform = interactive,
  enableCursorBlob = false,
  enableTiltFoil = true,
  showFoil = true,
  useCardBackPlaceholder = false,
  imageDebugMeta = null,
}) {
  const [loaded, setLoaded] = useState(false);
  const [displaySrc, setDisplaySrc] = useState("");
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  const imageUrl = getCardImageUrl(card);
  const cardBackUrl = getCardBackUrl();
  const displayName = getDisplayCardName(card, set);
  const shouldUsePlaceholder = useCardBackPlaceholder;

  useEffect(() => {
    let isMounted = true;

    setLoaded(false);
    setFailed(false);

    if (!imageUrl) {
      setDisplaySrc("");
      setFailed(true);
      return () => {
        isMounted = false;
      };
    }

    if (!shouldUsePlaceholder || isImageLoaded(imageUrl)) {
      setDisplaySrc(imageUrl);
      return () => {
        isMounted = false;
      };
    }

    setDisplaySrc(cardBackUrl);
    preloadImage(imageUrl, { timeoutMs: 0 }).then((didLoad) => {
      if (isMounted && didLoad) {
        setDisplaySrc(imageUrl);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [cardBackUrl, imageUrl, shouldUsePlaceholder]);

  useEffect(() => {
    if (imgRef.current?.complete) {
      setLoaded(displaySrc === imageUrl);
    }

    if (imageDebugMeta?.packId && displaySrc === imageUrl && imgRef.current) {
      markRenderedImageSrc(
        imageDebugMeta.packId,
        imageDebugMeta.slot,
        imgRef.current.currentSrc || imgRef.current.src
      );
    }
  }, [displaySrc, imageUrl]);

  return (
    <TiltCardFrame variant={variant} enabled={enableTransform || enableTiltFoil}>
      <div
        className={`foil-card card-image-shell foil-profile-${foilProfile} foil-card--${variant} ${
          enableTransform ? "is-interactive" : "is-static"
        } ${className}`.trim()}
        data-foil-profile={foilProfile}
        data-cursor-blob={enableCursorBlob ? "on" : "off"}
        data-tilt-foil={enableTiltFoil ? "on" : "off"}
      >
        {failed ? (
          <div className="foil-card__fallback" role="img" aria-label={displayName}>
            <strong>{displayName}</strong>
            {card.rarity && <span>{card.rarity}</span>}
          </div>
        ) : (
          <img
            ref={imgRef}
            className="foil-card__image"
            src={displaySrc || imageUrl || ""}
            alt={displayName}
            loading={variant === "collection" ? "lazy" : "eager"}
            decoding="async"
            fetchPriority={variant === "collection" ? "low" : "high"}
            onLoad={(event) => {
              setLoaded(displaySrc === imageUrl || variant === "reveal");
              if ((displaySrc === imageUrl || variant === "reveal") && imageUrl) {
                markImageLoaded(imageUrl);
                if (imageDebugMeta?.packId) {
                  markRenderedImageLoad(
                    imageDebugMeta.packId,
                    imageDebugMeta.slot,
                    event.currentTarget.currentSrc || event.currentTarget.src,
                    event.currentTarget
                  );
                }
              }
            }}
            onError={(event) => {
              if (imageDebugMeta?.packId) {
                markRenderedImageError(
                  imageDebugMeta.packId,
                  imageDebugMeta.slot,
                  event.currentTarget.currentSrc || event.currentTarget.src
                );
              }
              setLoaded(false);
              setFailed(true);
              setDisplaySrc("");
            }}
          />
        )}

        {showFoil && loaded && foilProfile !== "none" && (
          <>
            <span className="foil-card__rainbow-glare" aria-hidden="true" />
            <span className="foil-card__sparkles" aria-hidden="true" />
            <span className="foil-card__shine" aria-hidden="true" />
          </>
        )}
      </div>
    </TiltCardFrame>
  );
}

export default FoilCard;
