import { useEffect, useRef } from "react";
import { BUY_ME_A_COFFEE_URL, isBuyMeACoffeeEnabled } from "../config/support.js";

export default function BuyMeACoffeePrompt({ isOpen, mobile = false, onDismiss }) {
  const promptRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  const mobileHistoryEntryRef = useRef(false);
  onDismissRef.current = onDismiss;

  function requestDismiss() {
    if (mobile && mobileHistoryEntryRef.current && window.history?.back) {
      window.history.back();
      return;
    }

    onDismissRef.current?.();
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    restoreFocusRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => promptRef.current?.querySelector("a")?.focus(), 0);

    function handlePopState() {
      if (!mobileHistoryEntryRef.current) return;
      mobileHistoryEntryRef.current = false;
      onDismissRef.current?.();
    }

    if (mobile && window.history?.pushState) {
      window.history.pushState({ ...window.history.state, packdexSupportPrompt: true }, "", window.location.href);
      mobileHistoryEntryRef.current = true;
      window.addEventListener("popstate", handlePopState);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestDismiss();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
      if (mobileHistoryEntryRef.current) {
        mobileHistoryEntryRef.current = false;
        window.history.back();
      }
      const previousFocus = restoreFocusRef.current;
      if (previousFocus?.isConnected) window.setTimeout(() => previousFocus.focus(), 0);
    };
  }, [isOpen, mobile]);

  if (!isOpen || !isBuyMeACoffeeEnabled()) return null;

  return (
    <aside
      className={`buy-me-a-coffee-prompt ${mobile ? "is-mobile" : "is-desktop"}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="buy-me-a-coffee-prompt-title"
      ref={promptRef}
    >
      <button
        className="buy-me-a-coffee-prompt__close"
        type="button"
        onClick={requestDismiss}
        aria-label="Dismiss optional PackDex support prompt"
      >
        ×
      </button>
      <div>
        <span className="buy-me-a-coffee-prompt__eyebrow">Pack milestone</span>
        <h2 id="buy-me-a-coffee-prompt-title">You’ve opened 50 packs!</h2>
        <p>Enjoying PackDex? Optional contributions help cover the infrastructure that keeps PackDex running and free.</p>
      </div>
      <div className="buy-me-a-coffee-prompt__actions">
        <a
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buy Me a Coffee to support PackDex (opens outside PackDex)"
          data-support-source="milestone_prompt"
        >
          Buy Me a Coffee
        </a>
        <button type="button" onClick={requestDismiss}>Maybe later</button>
      </div>
    </aside>
  );
}
