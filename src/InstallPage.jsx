import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import "./install.css";
import { getStaticPublicSeoDescriptor } from "./lib/staticPublicSeo.js";
import useSeoMetadata from "./lib/useSeoMetadata.js";

const APP_STORE_URL = "https://apps.apple.com/us/app/packdex/id6802345131";
const WEB_URL = "https://www.pack-dex.com";
const INSTALL_METADATA = getStaticPublicSeoDescriptor("/install");

const previews = [
  { src: "/install/explore.webp", alt: "Explore Pokémon TCG history with PackDex" },
  { src: "/install/appearances.webp", alt: "Discover every Pokémon card appearance with PackDex" },
  { src: "/install/collection.webp", alt: "Build your digital Pokémon TCG collection with PackDex" },
  { src: "/install/eras.webp", alt: "Browse every Pokémon TCG era with PackDex" },
  { src: "/install/packs.webp", alt: "Open virtual packs and chase discoveries with PackDex" },
  { src: "/install/binder.webp", alt: "Curate a dream Pokémon TCG binder with PackDex" },
];

function AppleMark({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 384 512" role="img" aria-label="Apple">
      <path
        fill="currentColor"
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 130.5 4 174.9 4 265.7c0 26.9 4.9 54.6 14.8 83.1 13.2 36.7 60.8 126.7 110.5 125.2 26-.6 44.3-18.4 78.3-18.4 33 0 49.9 18.4 78.9 18.4 50.1-.7 93.9-82.8 106.4-119.6-67.2-31.6-63.6-92.1-58.6-95.3zM261.6 95.6c-36.9 2.5-68 25.7-80.8 52.3-11.7 24-21.5 53.3-14.2 81.6 40.4 3.1 70.8-17.7 84.6-44.3 12.9-25.1 22.5-52.4 10.4-89.6z"
      />
    </svg>
  );
}

function AppStoreButton() {
  return (
    <a className="install-app-store" href={APP_STORE_URL} aria-label="Download PackDex on the App Store">
      <AppleMark className="install-app-store__icon" />
      <span className="install-app-store__copy">
        <small>Download on the</small>
        <strong>App Store</strong>
      </span>
    </a>
  );
}

export default function InstallPage() {
  const primaryCtaRef = useRef(null);
  const [showFloatingCta, setShowFloatingCta] = useState(false);
  useSeoMetadata(INSTALL_METADATA);

  useEffect(() => {
    const primaryCta = primaryCtaRef.current;
    if (!primaryCta) return undefined;
    if (!("IntersectionObserver" in window)) {
      setShowFloatingCta(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingCta(!entry.isIntersecting),
      { threshold: 0.2 }
    );
    observer.observe(primaryCta);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="install-site">
      <a className="install-skip-link" href="#install-main">Skip to content</a>

      <main id="install-main">
        <section className="install-hero" aria-labelledby="install-title">
          <div className="install-shell install-hero__inner">
            <a className="install-brand" href={WEB_URL} aria-label="PackDex home">
              <img src="/packdex-icon-192.png" width="52" height="52" alt="" />
              <span>Pack<span>Dex</span></span>
            </a>

            <p className="install-kicker">Now available</p>
            <h1 id="install-title">
              <span>Your Pokémon TCG collection,</span>
              <span>reimagined.</span>
            </h1>
            <p className="install-lede">
              Explore sets, discover cards, open virtual packs, and build your collection.
            </p>

            <div className="install-actions" ref={primaryCtaRef}>
              <AppStoreButton />
              <p className="install-availability"><span aria-hidden="true" /> Available now on iPhone</p>
              <a className="install-web-link" href={WEB_URL}>
                Continue on the Web
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="install-preview" aria-labelledby="preview-title">
          <div className="install-shell">
            <div className="install-section-heading">
              <h2 id="preview-title">Meet your new favorite way to collect.</h2>
            </div>

            <div
              className="install-conveyor"
              tabIndex="0"
              aria-label="PackDex feature preview carousel. The animation pauses while focused."
            >
              <div className="install-conveyor__belt">
                {[false, true].map((duplicate) => (
                  <div className="install-conveyor__set" aria-hidden={duplicate || undefined} key={duplicate ? "duplicate" : "original"}>
                    {previews.map((preview, index) => (
                      <figure className="install-preview-card" key={`${duplicate ? "duplicate-" : ""}${preview.src}`}>
                        <img
                          src={preview.src}
                          alt={duplicate ? "" : preview.alt}
                          width="520"
                          height="1126"
                          loading={!duplicate && index < 2 ? "eager" : "lazy"}
                          fetchPriority={!duplicate && index === 0 ? "high" : "auto"}
                          decoding="async"
                        />
                      </figure>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {showFloatingCta && (
        <a className="install-floating-cta" href={APP_STORE_URL} aria-label="Get PackDex on the App Store">
          <AppleMark className="install-floating-cta__icon" />
          <span><strong>Get PackDex</strong><small>On the App Store</small></span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      )}

      <footer className="install-footer">
        <div className="install-shell install-footer__inner">
          <div className="install-footer__brand">
            <strong>PackDex</strong>
            <a href={WEB_URL}>pack-dex.com</a>
          </div>
          <p>
            PackDex is an unofficial, fan-made Pokémon TCG companion and is not affiliated with or endorsed by
            Nintendo, Creatures, GAME FREAK, or The Pokémon Company. Pokémon names, imagery, and related trademarks
            belong to their respective owners.
          </p>
        </div>
      </footer>
    </div>
  );
}
