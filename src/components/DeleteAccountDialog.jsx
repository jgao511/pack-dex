import { useEffect, useState } from "react";

export default function DeleteAccountDialog({ isOpen, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setConfirmation("");
      setError("");
      setIsDeleting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (confirmation !== "DELETE" || isDeleting) return;

    setIsDeleting(true);
    setError("");

    try {
      await onConfirm?.();
    } catch (nextError) {
      setError(nextError?.message || "Account deletion could not be completed. Please try again.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="delete-account-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
      <form className="delete-account-dialog" onSubmit={handleSubmit}>
        <span className="set-mark">Account</span>
        <h2 id="delete-account-title">Delete your PackDex account?</h2>
        <p>Your account, collection, wishlist, achievements, saved binders, pack history, and saved progress will be permanently deleted. This cannot be undone.</p>
        <label>
          Type <strong>DELETE</strong> to confirm
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
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
            {isDeleting ? "Deleting account..." : "Permanently Delete Account"}
          </button>
        </div>
      </form>
    </div>
  );
}
