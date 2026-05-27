import { useEffect, useRef, useState } from "react";
import { getCardImageUrl } from "../utils/assetUrls.js";
import { getFoilProfile } from "../utils/foil.js";
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
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  const imageUrl = getCardImageUrl(card);

  useEffect(() => {
    setLoaded(false);
  }, [imageUrl]);

  useEffect(() => {
    if (imgRef.current?.complete) {
      setLoaded(true);
    }
  }, [imageUrl]);

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
        <img
          ref={imgRef}
          className="foil-card__image"
          src={imageUrl}
          alt={card.name}
          onLoad={() => setLoaded(true)}
        />

        {loaded && foilProfile !== "none" && (
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
