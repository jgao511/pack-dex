import { forwardRef } from "react";

const PullShareCard = forwardRef(function PullShareCard({ setName, cards, bestPull, getCardImageUrl }, ref) {
  const otherCards = cards.filter((_, index) => index !== bestPull.index);

  return (
    <div className="pull-share-capture" aria-hidden="true">
      <article className="pull-share-card" ref={ref}>
        <header className="pull-share-header">
          <div className="pull-share-brand">
            <img src="/packdex-small.png" alt="" crossOrigin="anonymous" />
            <strong><span>Pack</span>Dex</strong>
          </div>
          <h1>LOOK WHAT I PULLED!</h1>
          <p>{setName}</p>
        </header>

        <section className="pull-share-hero">
          <img src={getCardImageUrl(bestPull.card)} alt="" crossOrigin="anonymous" loading="eager" decoding="async" />
        </section>

        <section className={`pull-share-grid ${otherCards.length > 5 ? "is-dense" : ""}`}>
          {otherCards.map((card, index) => (
            <img key={`${card.id || card.number || card.name}-${index}`} src={getCardImageUrl(card)} alt="" crossOrigin="anonymous" loading="eager" decoding="async" />
          ))}
        </section>

        <footer className="pull-share-footer">
          <span>Opened on PackDex</span>
          <strong>pack-dex.com</strong>
        </footer>
      </article>
    </div>
  );
});

export default PullShareCard;
