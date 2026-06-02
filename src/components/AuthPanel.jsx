import { useEffect, useState } from "react";
import { LogOut, Mail, X } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";

function AuthForm({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isCreateMode = mode === "signup";

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setIsSubmitting(true);

    try {
      const credentials = {
        email: email.trim(),
        password,
      };
      const { data, error: authError } = isCreateMode
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);

      if (authError) {
        setError(authError.message);
        return;
      }

      const hasSession = Boolean(data?.session);

      setStatus(
        isCreateMode
          ? hasSession
            ? "Account created! You're now signed in."
            : "Account created. You may now log in."
          : "Logged in successfully."
      );
      setPassword("");

      if (hasSession || !isCreateMode) {
        window.setTimeout(() => onAuthenticated?.(), 550);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div>
        <span className="set-mark">Account</span>
        <h2>{isCreateMode ? "Create Account" : "Log In"}</h2>
        <p>Log in to save your collection and binders. Guest progress still works locally.</p>
      </div>

      <div className="auth-mode-toggle" role="tablist" aria-label="Choose auth mode">
        <button className={mode === "login" ? "is-active" : ""} type="button" onClick={() => setMode("login")}>
          Log In
        </button>
        <button className={mode === "signup" ? "is-active" : ""} type="button" onClick={() => setMode("signup")}>
          Create Account
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete={isCreateMode ? "new-password" : "current-password"}
            minLength={6}
            required
          />
        </label>
        {isCreateMode && (
          <p className="auth-legal-copy">
            By creating an account, you agree to PackDex's{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            . Authentication is powered by Supabase.
          </p>
        )}
        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Working..." : isCreateMode ? "Create Account" : "Log In"}
        </button>
      </form>

      {!isSupabaseConfigured && (
        <div className="auth-message is-error">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login.</div>
      )}
      {status && <div className="auth-message">{status}</div>}
      {error && <div className="auth-message is-error">{error}</div>}
    </>
  );
}

function AuthPanel({ user, onOpenAuth }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    if (!supabase) return;

    setStatus("");
    setError("");
    setIsSubmitting(true);

    try {
      const { error: authError } = await supabase.auth.signOut();

      if (authError) {
        setError(authError.message);
      } else {
        setStatus("Logged out. Your guest progress is still saved locally.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user) {
    return (
      <section className="auth-panel is-signed-in" aria-label="Account">
        <div>
          <span className="set-mark">Account</span>
          <h2>Signed In</h2>
          <p>Signed in as {user.email}. Cloud collection saving will be added in the next step.</p>
        </div>
        <div className="auth-user-card">
          <Mail size={18} aria-hidden="true" />
          <span>{user.email}</span>
        </div>
        <button className="secondary-button auth-logout-button" type="button" onClick={handleLogout} disabled={isSubmitting}>
          <LogOut size={18} aria-hidden="true" />
          Logout
        </button>
        {status && <div className="auth-message">{status}</div>}
        {error && <div className="auth-message is-error">{error}</div>}
      </section>
    );
  }

  return (
    <section className="auth-panel" aria-label="Log in to PackDex">
      <div>
        <span className="set-mark">Account</span>
        <h2>Guest Mode</h2>
        <p>Log in or create an account to save your collection and binders across devices.</p>
      </div>
      <button className="primary-button auth-open-button" type="button" onClick={onOpenAuth}>
        Log In / Create Account
      </button>
    </section>
  );
}

export function AuthModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-label="PackDex account" onClick={onClose}>
      <section className="auth-modal-card" onClick={(event) => event.stopPropagation()}>
        <button className="auth-modal-close" type="button" onClick={onClose} aria-label="Close account modal">
          <X size={22} aria-hidden="true" />
        </button>
        <AuthForm onAuthenticated={onClose} />
      </section>
    </div>
  );
}

export default AuthPanel;
