import { BUY_ME_A_COFFEE_URL, isBuyMeACoffeeEnabled } from "../config/support.js";

export default function BuyMeACoffeeCard({ className = "", source = "settings" }) {
  if (!isBuyMeACoffeeEnabled()) return null;

  return (
    <section className={`buy-me-a-coffee-card ${className}`.trim()} aria-labelledby={`buy-me-a-coffee-${source}-title`}>
      <div>
        <span className="buy-me-a-coffee-card__eyebrow">Support PackDex</span>
        <h2 id={`buy-me-a-coffee-${source}-title`}>Help keep PackDex free</h2>
        <p>
          PackDex is independently built and free to use. Contributions help cover servers, storage, emails, and
          continued development.
        </p>
      </div>
      <a
        className="buy-me-a-coffee-card__action"
        href={BUY_ME_A_COFFEE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Buy Me a Coffee to support PackDex (opens outside PackDex)"
        data-support-source={source}
      >
        Buy Me a Coffee
      </a>
      <small>Optional support only—no gameplay advantages.</small>
    </section>
  );
}
