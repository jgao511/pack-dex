import { useEffect, useRef, useState } from "react";
import { PRIVACY_CHOICES_OPEN_EVENT } from "../lib/privacyChoices.js";
import "./PrivacyChoicesDialog.css";

export default function PrivacyChoicesDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    function handleOpen(event) {
      triggerRef.current = event.detail?.trigger || document.activeElement;
      setIsOpen(true);
    }

    window.addEventListener(PRIVACY_CHOICES_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(PRIVACY_CHOICES_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function closeDialog() {
    setIsOpen(false);
    window.requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    });
  }

  if (!isOpen) return null;

  return (
    <div className="privacy-choices-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
      <section
        className="privacy-choices-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-choices-title"
        aria-describedby="privacy-choices-description"
      >
        <span className="privacy-choices-eyebrow">Privacy</span>
        <h2 id="privacy-choices-title">Privacy Choices</h2>
        <div id="privacy-choices-description" className="privacy-choices-copy">
          <p>
            PackDex uses essential browser or device storage for authentication, security, preferences, and core
            functionality.
          </p>
          <div className="privacy-choices-status">
            <strong>Advertising preferences — not currently active</strong>
            <p>
              PackDex does not currently display advertising. Additional privacy and advertising choices may appear
              here if advertising is enabled.
            </p>
          </div>
          <p>Available controls may vary by region and platform. You can close this dialog and return later.</p>
        </div>
        <button ref={closeButtonRef} className="privacy-choices-close" type="button" onClick={closeDialog}>
          Close
        </button>
      </section>
    </div>
  );
}
