import { useEffect, useRef, useState } from "react";
import { Turnstile } from "react-turnstile";
import { LogOut, Mail, X } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";
import { getAuthCallbackUrl, getResetPasswordUrl } from "../utils/authRedirects.js";
import { getPokeballLoadingUrl } from "../utils/assetUrls.js";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const POKEBALL_LOADING_SRC = getPokeballLoadingUrl();

function AuthLoadingLabel({ text }) {
  return (
    <>
      <img className="auth-button-pokeball" src={POKEBALL_LOADING_SRC} alt="" />
      <span>{text}</span>
    </>
  );
}

function AuthForm({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileMessage, setTurnstileMessage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const turnstileRef = useRef(null);
  const isCreateMode = mode === "signup";
  const isResetMode = mode === "reset";
  const requiresTurnstile = isCreateMode || isResetMode;
  const title = isResetMode ? "Reset your password" : isCreateMode ? "Create your PackDex account" : "Welcome back";
  const subtitle = isResetMode
    ? "Enter your email and we will send a secure link to reset your password."
    : "Create an account before opening packs to save your PackDex progress.";
  const submitLabel = isResetMode ? "Send reset link" : isCreateMode ? "Create account" : "Log in";

  useEffect(() => {
    setTurnstileToken("");
    setTurnstileMessage("");
    setStatus("");
    setError("");
    turnstileRef.current?.reset?.();
  }, [mode, requiresTurnstile]);

  function resetTurnstile() {
    setTurnstileToken("");
    setTurnstileMessage("");
    turnstileRef.current?.reset?.();
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return;

    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
  }

  function validateTurnstile() {
    if (!requiresTurnstile) return true;

    if (!TURNSTILE_SITE_KEY) {
      setError("Turnstile is not configured. Add VITE_TURNSTILE_SITE_KEY.");
      return false;
    }

    if (!turnstileToken) {
      setError(
        isCreateMode
          ? "Please complete the verification before signing up."
          : "Please complete the verification before requesting a password reset."
      );
      return false;
    }

    return true;
  }

  async function handleResetRequest(event) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!validateTurnstile()) return;

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getResetPasswordUrl(),
        captchaToken: turnstileToken,
      });

      if (resetError) {
        setError(resetError.message);
        resetTurnstile();
        return;
      }

      setStatus("Password reset email sent. Check your inbox.");
      resetTurnstile();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (isCreateMode && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!isResetMode && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (!validateTurnstile()) return;

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
        ? await supabase.auth.signUp({
          ...credentials,
          options: {
            captchaToken: turnstileToken,
            emailRedirectTo: getAuthCallbackUrl(),
          },
        })
        : await supabase.auth.signInWithPassword(credentials);

      if (authError) {
        const message = String(authError.message || "");

        setError(
          message.toLowerCase().includes("email not confirmed")
            ? "Please confirm your email before logging in."
            : message
        );
        if (isCreateMode) {
          resetTurnstile();
        }
        return;
      }

      const hasSession = Boolean(data?.session);

      setStatus(
        isCreateMode
          ? hasSession
            ? "Account created! You're now signed in."
            : "Account created! Please check your email to confirm your account."
          : "Logged in successfully."
      );
      setPassword("");
      setConfirmPassword("");
      if (isCreateMode) {
        resetTurnstile();
      }

      if (hasSession || !isCreateMode) {
        window.setTimeout(() => onAuthenticated?.(), 550);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="auth-modal-heading">
        <span className="set-mark">Account</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>

      {isCreateMode && (
        <div className="auth-reward-callout">
          <strong>New account bonus</strong>
          <span>Sign up to choose a one-time welcome God Pack after confirming your account.</span>
        </div>
      )}

      {!isResetMode && (
        <div className="auth-mode-toggle" role="tablist" aria-label="Choose auth mode">
          <button className={mode === "login" ? "is-active" : ""} type="button" onClick={() => switchMode("login")}>
            Log In
          </button>
          <button className={mode === "signup" ? "is-active" : ""} type="button" onClick={() => switchMode("signup")}>
            Create Account
          </button>
        </div>
      )}

      <form className="auth-form" onSubmit={isResetMode ? handleResetRequest : handleSubmit}>
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
        {!isResetMode && (
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete={isCreateMode ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </label>
        )}
        {isCreateMode && (
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        )}
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
        {requiresTurnstile && (
          <div className="turnstile-panel">
            {TURNSTILE_SITE_KEY ? (
              <>
                <Turnstile
                  ref={turnstileRef}
                  sitekey={TURNSTILE_SITE_KEY}
                  theme="light"
                  size="flexible"
                  onVerify={(token) => {
                    setTurnstileToken(token);
                    setTurnstileMessage("Verification complete.");
                    setError("");
                  }}
                  onExpire={() => {
                    setTurnstileToken("");
                    setTurnstileMessage("Verification expired. Please verify again.");
                  }}
                  onError={() => {
                    setTurnstileToken("");
                    setTurnstileMessage("Verification failed. Please try again.");
                    setError("Verification failed. Please try again.");
                  }}
                />
                {turnstileMessage && <p className="turnstile-status">{turnstileMessage}</p>}
              </>
            ) : (
              <div className="auth-message is-error">Add VITE_TURNSTILE_SITE_KEY to enable verification.</div>
            )}
          </div>
        )}
        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <AuthLoadingLabel text={isResetMode ? "Sending..." : isCreateMode ? "Creating..." : "Logging in..."} />
          ) : isResetMode ? (
            submitLabel
          ) : isCreateMode ? (
            submitLabel
          ) : (
            submitLabel
          )}
        </button>
      </form>

      <div className="auth-form-links">
        {mode === "login" && (
          <>
            <button type="button" onClick={() => switchMode("reset")}>
              Forgot password?
            </button>
            <span>
              New to PackDex?{" "}
              <button type="button" onClick={() => switchMode("signup")}>
                Create an account
              </button>
            </span>
          </>
        )}
        {isCreateMode && (
          <span>
            Already have an account?{" "}
            <button type="button" onClick={() => switchMode("login")}>
              Log in
            </button>
          </span>
        )}
        {isResetMode && (
          <button type="button" onClick={() => switchMode("login")}>
            Back to login
          </button>
        )}
        {isCreateMode && (
          <button type="button" onClick={() => switchMode("reset")}>
            Forgot password?
          </button>
        )}
      </div>

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
          {isSubmitting ? (
            <AuthLoadingLabel text="Logging out..." />
          ) : (
            <>
              <LogOut size={18} aria-hidden="true" />
              Logout
            </>
          )}
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
        <p>Playing as guest. Create an account before opening packs to save your pulls.</p>
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
    <div
      className="auth-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="PackDex account"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
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
