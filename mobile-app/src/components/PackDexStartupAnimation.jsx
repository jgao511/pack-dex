export default function PackDexStartupAnimation({ delayed = false }) {
  return (
    <section
      className={`packdex-startup is-loading${delayed ? " is-delayed" : ""}`}
      data-packdex-branded-loader
      role="status"
      aria-live="polite"
      aria-label="Loading PackDex"
    >
      <div className="packdex-startup__ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="packdex-startup__brand">
        <div className="packdex-startup__cards" aria-hidden="true">
          <img src="/packdex-icon-192.png" alt="" draggable={false} />
        </div>
        <span className="packdex-startup__wordmark"><span>Pack</span><span>Dex</span></span>
        <small>Preparing your collection</small>
      </div>
    </section>
  );
}
