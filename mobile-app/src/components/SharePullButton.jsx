import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

function withTimeout(promise, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error("Share request timed out.")), timeoutMs)),
  ]);
}

export default function SharePullButton({ cards, user, onLogin }) {
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
    if (!user?.id) {
      setError("Sign in to create a permanent share link.");
      onLogin?.();
      return;
    }
    if (!cards.shareReceipt) {
      setError("This pack doesn't have a secure share receipt. Open a new pack while signed in.");
      return;
    }
    if (generationRef.current) return;
    generationRef.current = true;
    setIsGenerating(true);
    setError("");

    try {
      const { data, error: functionError } = await withTimeout(
        supabase.functions.invoke("create-pull-share", { body: { shareReceipt: cards.shareReceipt } })
      );
      if (functionError || !data?.url) throw functionError || new Error("No share URL returned.");
      const shareData = { title: "My PackDex Pull", text: "Look what I pulled on PackDex!", url: data.url };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          return;
        } catch (shareError) {
          if (shareError?.name === "AbortError") return;
        }
      }
      if (await copyShareUrl(data.url)) setError("Link copied.");
      else setError(data.url);
    } catch (shareError) {
      console.warn("Unable to create PackDex pull image", shareError);
      setError("Couldn't create the share link. Please try again.");
    } finally {
      generationRef.current = false;
      setIsGenerating(false);
    }
  }

  return (
    <>
      <button className="secondary-action share-pull-action" type="button" onClick={handleShare} disabled={isGenerating}>
        {isGenerating ? "Creating link..." : "Share Pull"}
      </button>
      {error && <p className="share-pull-error" role="status">{error}</p>}
    </>
  );
}
