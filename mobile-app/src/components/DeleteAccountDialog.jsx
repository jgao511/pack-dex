import { useEffect, useState } from "react";

export default function DeleteAccountDialog({ isOpen, onClose, onConfirm, onContinueAsGuest }) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [deletionState, setDeletionState] = useState("idle");
  const isDeleting = deletionState === "deleting";

  useEffect(() => {
    if (isOpen) {
      setDeletionState("confirming");
    } else {
      setConfirmation("");
      setError("");
      setDeletionState("idle");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (confirmation !== "DELETE" || isDeleting) return;

    setDeletionState("deleting");
    setError("");

    try {
      await onConfirm?.();
      setDeletionState("success");
    } catch (nextError) {
      setError(nextError?.message || "Account deletion could not be completed. Please try again.");
      setDeletionState("error");
    }
  }

  async function handleContinueAsGuest() {
    await onContinueAsGuest?.();
  }

  return (
    <div className="delete-account-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
      <form className="delete-account-dialog" onSubmit={handleSubmit}>
        <span className="set-mark">Account</span>
        {deletionState === "success" ? (
          <>
            <h2 id="delete-account-title">Account Deleted</h2>
            <p>Your PackDex account and saved account data have been permanently deleted.</p>
            <div className="delete-account-actions">
              <button className="delete-account-button" type="button" onClick={handleContinueAsGuest}>
                Continue as Guest
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="delete-account-title">Delete your PackDex account?</h2>
            <p>Your account, collection, wishlist, achievements, saved binders, pack history, and saved progress will be permanently deleted. This cannot be undone.</p>
            <label>
              Type <strong>DELETE</strong> to confirm
              <input
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  if (deletionState === "error") setDeletionState("confirming");
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                disabled={isDeleting}
                aria-describedby="delete-account-help"
              />
            </label>
            <p id="delete-account-help" className="delete-account-help">This permanently removes your PackDex account and cannot be reversed.</p>
            {error && <p className="auth-message is-error">{error}</p>}
            <div className="delete-account-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
              <button className="delete-account-button" type="submit" disabled={confirmation !== "DELETE" || isDeleting}>
                {isDeleting ? "Deleting account..." : deletionState === "error" ? "Try Deleting Again" : "Permanently Delete Account"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
