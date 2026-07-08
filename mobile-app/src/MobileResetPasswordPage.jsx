import { useEffect, useRef, useState } from "react";

const RESET_PATH = "/mobile-app/reset-password";
const MOBILE_HOME_PATH = "/mobile-app/";

export default function MobileResetPasswordPage({ supabase }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("Preparing your password reset...");
  const [error, setError] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTimerRef = useRef(0);
  const hasRecoveryToken = Boolean(new URLSearchParams(window.location.search).get("token_hash"));

  useEffect(() => {
    let mounted = true;

    async function verifyRecoveryLink() {
      if (!supabase) {
        setStatus("");
        setError("Supabase is not configured for this mobile app.");
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (!tokenHash || type !== "recovery") {
        window.history.replaceState({}, document.title, RESET_PATH);
        setStatus("");
        setError("This password reset link is invalid or has expired.");
        return;
      }

      try {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });

        if (verifyError || !data.session) throw verifyError || new Error("Recovery session unavailable.");
        if (!mounted) return;

        window.history.replaceState({}, document.title, RESET_PATH);
        setIsReady(true);
        setStatus("Enter a new password for your PackDex account.");
      } catch {
        if (!mounted) return;

        window.history.replaceState({}, document.title, RESET_PATH);
        setStatus("");
        setError("This password reset link is invalid or has expired.");
      }
    }

    verifyRecoveryLink();

    return () => {
      mounted = false;
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
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
      setStatus("Password updated. Please sign in.");
      await supabase.auth.signOut({ scope: "local" });
      redirectTimerRef.current = window.setTimeout(() => {
        window.location.assign(`${MOBILE_HOME_PATH}?password_reset=success`);
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
              <p className="reset-route-debug">Reset route detected</p>
              <p className="reset-route-debug">{hasRecoveryToken ? "Recovery token found" : "Missing recovery token"}</p>
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
