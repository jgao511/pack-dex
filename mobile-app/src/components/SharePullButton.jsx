import { useEffect, useRef, useState } from "react";
import PullShareCard from "./PullShareCard.jsx";
import { createPullShareImage, sharePullImage } from "../utils/sharePullImage.js";

export default function SharePullButton({ setName, cards, bestPull, getCardImageUrl, imagesReady }) {
  const captureRef = useRef(null);
  const generationRef = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    generationRef.current = false;
    setIsGenerating(false);
  }, [cards]);

  async function handleShare() {
    if (generationRef.current || !imagesReady) return;
    generationRef.current = true;
    setIsGenerating(true);
    setError("");

    try {
      const blob = await createPullShareImage(captureRef.current);
      await sharePullImage(blob, setName);
    } catch (shareError) {
      console.warn("Unable to create PackDex pull image", shareError);
      setError("Couldn't create the image. Check your connection and try again.");
    } finally {
      generationRef.current = false;
      setIsGenerating(false);
    }
  }

  return (
    <>
      <button className="secondary-action share-pull-action" type="button" onClick={handleShare} disabled={!imagesReady || isGenerating}>
        {isGenerating ? "Creating image..." : "Share Pull"}
      </button>
      {error && <p className="share-pull-error" role="status">{error}</p>}
      <PullShareCard ref={captureRef} setName={setName} cards={cards} bestPull={bestPull} getCardImageUrl={getCardImageUrl} />
    </>
  );
}
