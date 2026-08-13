import { Mail, PackageOpen } from "lucide-react";
import PrivacyChoicesDialog from "../components/PrivacyChoicesDialog.jsx";
import { PACKDEX_SUPPORT_EMAIL } from "../content/legalDocuments.js";
import { openPrivacyChoices } from "../lib/privacyChoices.js";
import { BUY_ME_A_COFFEE_URL, isBuyMeACoffeeEnabled } from "../config/support.js";

const PUBLIC_LINKS = [
  ["Sets", "/sets"],
  ["How It Works", "/how-it-works"],
  ["FAQ", "/faq"],
  ["About", "/about"],
];

export function PublicBrand() {
  return (
    <a className="public-brand" href="/" aria-label="PackDex home">
      <img src="/packdex-icon-192.png" width="42" height="42" alt="" />
      <span><b>Pack</b>Dex</span>
    </a>
  );
}

export function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-shell public-header__inner">
        <PublicBrand />
        <nav className="public-nav" aria-label="Public pages">
          {PUBLIC_LINKS.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <a className="public-app-link" href="/sets">
          <PackageOpen size={17} aria-hidden="true" />
          Open PackDex
        </a>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <PrivacyChoicesDialog />
      <div className="public-shell public-footer__grid">
        <div className="public-footer__intro">
          <PublicBrand />
          <p>An unofficial, fan-made Pokémon TCG simulator and collector companion.</p>
          <a href={`mailto:${PACKDEX_SUPPORT_EMAIL}`}><Mail size={16} aria-hidden="true" /> Contact Support</a>
        </div>
        <nav aria-label="Explore PackDex">
          <strong>Explore</strong>
          {PUBLIC_LINKS.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <nav aria-label="Legal and privacy">
          <strong>Legal</strong>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <button type="button" onClick={(event) => openPrivacyChoices(event.currentTarget)}>Privacy Choices</button>
          <a href="/image-credits.html" target="_blank" rel="noopener noreferrer">Image Credits</a>
        </nav>
        <nav aria-label="Support and social links">
          <strong>Connect</strong>
          <a href="https://www.youtube.com/@pack-dex" target="_blank" rel="noopener noreferrer">YouTube</a>
          <a href="https://www.instagram.com/pack.dex/" target="_blank" rel="noopener noreferrer">Instagram</a>
          {isBuyMeACoffeeEnabled() && (
            <a href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noopener noreferrer">Buy Me a Coffee</a>
          )}
        </nav>
      </div>
      <div className="public-shell public-footer__bottom">
        <p>
          PackDex is not affiliated with Nintendo, Creatures, GAME FREAK, The Pokémon Company, or any official Pokémon
          TCG partner. Pokémon names, imagery, card data, and related trademarks belong to their respective owners.
        </p>
        <span>© 2026 PackDex.</span>
      </div>
    </footer>
  );
}

export default function PublicLayout({ children }) {
  return (
    <div className="public-site">
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}
