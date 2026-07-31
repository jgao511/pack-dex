import "./InspectionBorderGlow.css";

/**
 * PackDex adaptation of React Bits' BorderGlow. Pointer coordinates are
 * supplied by the card's existing tilt system through CSS custom properties,
 * so this visual layer never installs a competing gesture handler.
 */
export default function InspectionBorderGlow({ children, strength = "standard", className = "" }) {
  if (strength === "none") return children;

  return (
    <div className={`inspection-border-glow is-${strength} ${className}`.trim()} data-inspection-glow={strength}>
      <span className="inspection-border-glow__edge" aria-hidden="true" />
      <div className="inspection-border-glow__inner">{children}</div>
    </div>
  );
}
