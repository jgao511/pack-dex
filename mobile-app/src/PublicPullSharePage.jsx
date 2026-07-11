import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient.js";
import { sets } from "../../src/data/sets.js";
import { getCardImageUrl } from "../../src/utils/assetUrls.js";

function loadShare(token) {
  if (!supabase) return Promise.reject(new Error("Share service unavailable."));
  return Promise.race([
    supabase.functions.invoke("get-pull-share", { body: { token } }),
    new Promise((_, reject) => window.setTimeout(() => reject(new Error("Share request timed out.")), 15000)),
  ]);
}

function ShareCardImage({ card, className = "" }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className={`public-share-image-fallback ${className}`}>Image unavailable</div>;
  return <img className={className} src={getCardImageUrl(card)} alt={card.name} loading="eager" decoding="async" onError={() => setFailed(true)} />;
}

export default function PublicPullSharePage({ token }) {
  const [state, setState] = useState({ loading: true, share: null, error: "" });

  useEffect(() => {
    let active = true;
    loadShare(token).then(({ data, error }) => {
      if (!active) return;
      const set = sets.find((candidate) => candidate.id === data?.setId);
      const cardMap = new Map((set?.cards || []).map((card) => [String(card.id), card]));
      const cards = (data?.cardIds || []).map((id) => cardMap.get(String(id))).filter(Boolean);
      setState(error || !set || cards.length !== data?.cardIds?.length
        ? { loading: false, share: null, error: "Shared pull not found." }
        : { loading: false, share: { ...data, setName: set.name, cards }, error: "" });
    }).catch(() => active && setState({ loading: false, share: null, error: "Shared pull not found." }));
    return () => { active = false; };
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

  const bestPull = useMemo(() => state.share?.cards?.find((card) => card.id === state.share.bestPullCardId), [state.share]);
  const others = state.share?.cards?.filter((card) => card.id !== state.share.bestPullCardId) || [];

  if (state.loading) return <main className="public-share-page"><p className="public-share-status">Loading shared pull...</p></main>;
  if (state.error || !bestPull) return <main className="public-share-page"><section className="public-share-not-found"><img src="/packdex-small.png" alt="PackDex" /><h1>Shared pull not found</h1><p>This link may be invalid or unavailable.</p><a href="/mobile-app/">Try PackDex</a></section></main>;

  return <main className="public-share-page">
    <header className="public-share-header"><div><img src="/packdex-small.png" alt="" /><strong><span>Pack</span>Dex</strong></div><h1>LOOK WHAT I PULLED!</h1><p>{state.share.setName}</p></header>
    <section className="public-share-hero"><ShareCardImage card={bestPull} /></section>
    <section className="public-share-card-grid">{others.map((card, index) => <ShareCardImage key={`${card.id}-${index}`} card={card} />)}</section>
    <footer className="public-share-page-footer"><p>Opened on PackDex.</p><a href="/mobile-app/">Open a Pack</a></footer>
  </main>;
}
