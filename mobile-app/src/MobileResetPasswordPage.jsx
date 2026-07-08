import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabaseClient.js";

const RESET_PATH = "/mobile-app/reset-password";
const MOBILE_HOME_PATH = "/mobile-app/";

export default function MobileResetPasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("Preparing your password reset...");
  const [error, setError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTimerRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    let invalidLinkTimer = 0;

    function showResetForm() {
      if (!mounted) return;

      if (invalidLinkTimer) window.clearTimeout(invalidLinkTimer);
      window.history.replaceState({}, document.title, RESET_PATH);
      setError("");
      setIsReady(true);
      setStatus("Enter a new password for your PackDex account.");
    }

    function showInvalidLink() {
      if (!mounted) return;

      setIsReady(false);
      setStatus("");
      setError("This password reset link is invalid or has expired.");
    }

    if (!supabase) {
      setStatus("");
      setError("Supabase is not configured for this mobile app.");
      return undefined;
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        showResetForm();
        return;
      }

      if (session && window.location.pathname === RESET_PATH) {
        showResetForm();
      }
    });

    async function prepareResetSession() {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = searchParams.get("error_description") || hashParams.get("error_description");
      const code = searchParams.get("code");

      if (authError) {
        window.history.replaceState({}, document.title, RESET_PATH);
        showInvalidLink();
        return;
      }

      try {
        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (data.session) {
            showResetForm();
            return;
          }
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (data.session) {
          showResetForm();
          return;
        }

        invalidLinkTimer = window.setTimeout(showInvalidLink, 4000);
      } catch {
        const { data: fallbackData } = await supabase.auth.getSession();

        if (fallbackData.session) {
          showResetForm();
          return;
        }

        window.history.replaceState({}, document.title, RESET_PATH);
        showInvalidLink();
      }
    }

    prepareResetSession();

    return () => {
      mounted = false;
      if (invalidLinkTimer) window.clearTimeout(invalidLinkTimer);
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!isReady) {
      setError("Please request a new password reset email.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!supabase) {
      setError("Supabase is not configured for this mobile app.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

      if (updateError) {
        setError(updateError.message || "Unable to update your password. Please try again.");
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      setIsReady(false);
      setStatus("Password updated. Returning to PackDex...");
      redirectTimerRef.current = window.setTimeout(() => {
        window.location.assign(MOBILE_HOME_PATH);
      }, 1100);
    } catch {
      setError("Unable to update your password. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mobile-app theme-dark">
      <section className="phone-shell" aria-label="Reset PackDex mobile password">
        <div className="screen-content auth-callback-mobile-screen">
          <header className="mobile-brand-header" aria-label="PackDex mobile app">
            <img src="/packdex-small.png" alt="" />
            <span className="mobile-wordmark">
              <span>Pack</span>
              <span>Dex</span>
            </span>
          </header>
          <section className="mobile-auth-modal auth-callback-mobile-card">
            <div className="mobile-auth-heading">
              <span className="eyebrow">Account</span>
              <h1>Reset password</h1>
              {status && <p>{status}</p>}
            </div>
            <form className="auth-form" onSubmit={handleSubmit}>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  autoComplete="new-password"
                  minLength={8}
                  disabled={!isReady}
                  required
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  minLength={8}
                  disabled={!isReady}
                  required
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              <button className="primary-action compact-auth-submit" type="submit" disabled={!isReady || isSubmitting}>
                {isSubmitting ? "Updating..." : "Update password"}
              </button>
              {error && <p className="auth-message is-error">{error}</p>}
            </form>
            <a className="auth-switch-link" href={MOBILE_HOME_PATH}>
              Back to PackDex
            </a>
          </section>
        </div>
      </section>
    </main>
  );
}
