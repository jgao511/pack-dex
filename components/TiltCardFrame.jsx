import { useCardTilt } from "./useCardTilt.js";

function TiltCardFrame({ children, variant = "default", className = "", enabled = true }) {
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
    >
      <div className={`tilt-card-frame tilt-card-frame--${variant}`}>
        {children}
      </div>
    </div>
  );
}

export default TiltCardFrame;
