import { useEffect, useMemo, useState } from "react";
import { sets } from "../../src/data/sets.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";
import { getPublicPullShare } from "../../src/lib/publicPullShares.js";
import { selectFeaturedPull } from "../../src/utils/rarityRank.js";
import "./PublicPullSharePage.css";

function ShareCardImage({ card, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className={`public-share-image-fallback ${className}`}>Image unavailable</div>;
  return <img className={className} src={getCardImageUrl(card)} alt={card.name} loading="eager" decoding="async" onError={() => setFailed(true)} />;
}

function ShareBrand() {
  return <div className="public-share-brand"><img src="/packdex-icon-192.png" alt="" /><strong><span>Pack</span>Dex</strong></div>;
}

export default function PublicPullSharePage({ shareCode }) {
  const [state, setState] = useState({ status: "loading", share: null });

  useEffect(() => {
    let active = true;

    async function loadShare() {
      try {
        const data = await getPublicPullShare(shareCode);
        const set = sets.find((candidate) => candidate.id === data?.set_id || candidate.id === data?.setId);
        const cardIds = data?.card_ids || data?.cardIds || [];
        if (!data || !set) throw new Error("Share not found.");
        const cardMap = new Map((set.cards || []).map((card) => [String(card.id), card]));
        const cards = cardIds.map((id) => cardMap.get(String(id)));
        if (cards.some((card) => !card)) throw new Error("Share not found.");
        if (active) setState({ status: "loaded", share: { ...data, setName: set.name, cards } });
      } catch {
        if (active) setState({ status: "not-found", share: null });
      }
    }

    setState({ status: "loading", share: null });
    loadShare();
    return () => { active = false; };
  }, [shareCode]);

  useEffect(() => {
    const title = state.share ? `${state.share.setName} Pull | PackDex` : "Shared Pull | PackDex";
    document.title = title;
    const values = { description: "Look what I pulled on PackDex!", "og:title": title, "og:description": "Look what I pulled on PackDex!" };
    Object.entries(values).forEach(([name, content]) => {
      const attribute = name.startsWith("og:") ? "property" : "name";
      let meta = document.head.querySelector(`meta[${attribute}="${name}"]`);
      if (!meta) { meta = document.createElement("meta"); meta.setAttribute(attribute, name); document.head.appendChild(meta); }
      meta.setAttribute("content", content);
    });
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = `${window.location.origin}/mobile-app/share/${encodeURIComponent(shareCode)}`;
  }, [state.share, shareCode]);

  const bestPullIndex = state.share?.cards?.length ? selectFeaturedPull(state.share.cards, sets.find((candidate) => candidate.id === (state.share.set_id || state.share.setId)))?.index ?? state.share.cards.length - 1 : -1;
  const bestPull = state.share?.cards?.[bestPullIndex];
  const others = useMemo(() => state.share?.cards?.filter((_, index) => index !== bestPullIndex) || [], [bestPullIndex, state.share]);

  if (state.status === "loading") return <main className="public-share-page"><section className="public-share-loading" role="status" aria-live="polite"><ShareBrand /><p>Loading shared pull...</p></section></main>;
  if (state.status === "not-found" || !bestPull) return <main className="public-share-page"><section className="public-share-not-found"><ShareBrand /><h1>Shared pull not found</h1><p>This link may be invalid or unavailable.</p><a href="/mobile-app">Try PackDex</a></section></main>;

  const gridRemainder = others.length % 3;
  return <main className="public-share-page">
    <header className="public-share-header"><ShareBrand /><h1>LOOK WHAT I PULLED!</h1><p>{state.share.setName}{state.share.pack_number ? ` · Pack #${state.share.pack_number}` : ""}</p></header>
    <section className="public-share-hero"><ShareCardImage card={bestPull} /></section>
    {others.length > 0 && <section className={`public-share-card-grid remainder-${gridRemainder}`}>{others.map((card, index) => <ShareCardImage key={`${card.id}-${index}`} card={card} />)}</section>}
    <footer className="public-share-page-footer"><p>Opened on PackDex.</p><a href="/mobile-app">Open a Pack</a></footer>
  </main>;
}
