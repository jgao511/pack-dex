import { useEffect, useRef, useState } from "react";
import { createPublicPullShare } from "../../../src/lib/publicPullShares.js";
import { buildMobileShareUrl } from "../utils/mobileShareUrl.js";

export default function SharePullButton({ cards, setId, packNumber = null }) {
  const generationRef = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    generationRef.current = false;
    setIsGenerating(false);
  }, [cards]);

  async function copyShareUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }

  async function handleShare() {
    if (generationRef.current) return;
    generationRef.current = true;
    setIsGenerating(true);
    setError("");

    try {
      const result = await createPublicPullShare({
        setId,
        cardIds: cards.map((card) => String(card.id)),
        packNumber,
      });
      const mobileShareUrl = buildMobileShareUrl(result, window.location.origin);
      const shareData = { title: "My PackDex Pull", text: "Look what I pulled on PackDex!", url: mobileShareUrl };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          return;
        } catch (shareError) {
          if (shareError?.name === "AbortError") return;
        }
      }
      if (await copyShareUrl(mobileShareUrl)) setError("Link copied.");
      else setError(mobileShareUrl);
    } catch (shareError) {
      console.warn("Unable to share PackDex pull", shareError);
      setError("Couldn't create the share link. Please try again.");
    } finally {
      generationRef.current = false;
      setIsGenerating(false);
    }
  }

  return (
    <>
      <button className="secondary-action share-pull-action" type="button" onClick={handleShare} disabled={isGenerating}>
        {isGenerating ? "Sharing..." : "Share Pull"}
      </button>
      {error && <p className="share-pull-error" role="status">{error}</p>}
    </>
  );
}
