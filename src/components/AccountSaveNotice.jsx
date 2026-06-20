function AccountSaveNotice({ onOpenAuth, message = "to save your collection and binders across devices.", className = "" }) {
  return (
    <div className={`account-save-notice ${className}`.trim()} role="status">
      <button type="button" onClick={onOpenAuth}>
        Log in
      </button>{" "}
      or{" "}
      <button type="button" onClick={onOpenAuth}>
        create an account
      </button>{" "}
      {message}
    </div>
  );
}

export default AccountSaveNotice;
