import { useCardTilt } from "./useCardTilt.js";
import InspectionBorderGlow from "./InspectionBorderGlow.jsx";

function TiltCardFrame({ children, variant = "default", className = "", enabled = true, inspectionGlowStrength = "none" }) {
  const tilt = useCardTilt({
    enabled,
    intensity: "normal",
  });

  return (
    <div
      ref={tilt.ref}
      className={`tilt-card-shell tilt-card-shell--${variant} ${enabled ? "is-interactive" : "is-static"} ${className}`.trim()}
      onPointerDown={enabled ? tilt.onPointerDown : undefined}
      onPointerMove={enabled ? tilt.onPointerMove : undefined}
      onPointerUp={enabled ? tilt.onPointerUp : undefined}
      onPointerCancel={enabled ? tilt.onPointerCancel : undefined}
      onPointerLeave={enabled ? tilt.onPointerLeave : undefined}
      onLostPointerCapture={enabled ? tilt.onLostPointerCapture : undefined}
    >
      <div className={`tilt-card-frame tilt-card-frame--${variant}`}>
        <InspectionBorderGlow strength={inspectionGlowStrength}>{children}</InspectionBorderGlow>
      </div>
    </div>
  );
}

export default TiltCardFrame;
