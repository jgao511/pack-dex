import { useEffect, useMemo, useState } from "react";
import { sets } from "../../src/data/sets.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";
import { decodeSharePullPayload } from "./utils/sharePullPayload.js";
import "./PublicPullSharePage.css";

function ShareCardImage({ card, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className={`public-share-image-fallback ${className}`}>Image unavailable</div>;
  return <img className={className} src={getCardImageUrl(card)} alt={card.name} loading="eager" decoding="async" onError={() => setFailed(true)} />;
}

export default function PublicPullSharePage({ token }) {
  const [state, setState] = useState({ share: null, error: "" });

  useEffect(() => {
    const data = decodeSharePullPayload(token);
    const set = sets.find((candidate) => candidate.id === data?.setId);
    if (!data || !set) {
      setState({ share: null, error: "This shared pull could not be found." });
      return;
    }
      const cardMap = new Map((set?.cards || []).map((card) => [String(card.id), card]));
    const cards = data.cardIds.map((id) => cardMap.get(id));
    if (cards.some((card) => !card)) setState({ share: null, error: "This shared pull could not be found." });
    else setState({ share: { ...data, setName: set.name, cards }, error: "" });
  }, [token]);

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
    link.href = `${window.location.origin}/share/${token}`;
  }, [state.share, token]);

  const bestPull = state.share?.cards?.[state.share.bestPullIndex];
  const others = useMemo(() => state.share?.cards?.filter((_, index) => index !== state.share.bestPullIndex) || [], [state.share]);

  if (state.error || !bestPull) return <main className="public-share-page"><section className="public-share-not-found"><img src="/packdex-small.png" alt="PackDex" /><h1>Shared pull not found</h1><p>This link may be invalid or unavailable.</p><a href="/mobile-app/">Try PackDex</a></section></main>;

  return <main className="public-share-page">
    <header className="public-share-header"><div><img src="/packdex-small.png" alt="" /><strong><span>Pack</span>Dex</strong></div><h1>LOOK WHAT I PULLED!</h1><p>{state.share.setName}</p></header>
    <section className="public-share-hero"><ShareCardImage card={bestPull} /></section>
    <section className="public-share-card-grid">{others.map((card, index) => <ShareCardImage key={`${card.id}-${index}`} card={card} />)}</section>
    <footer className="public-share-page-footer"><p>Opened on PackDex.</p><a href="/mobile-app/">Open a Pack</a></footer>
  </main>;
}
