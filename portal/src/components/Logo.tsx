import { useId } from "react";
import { cx } from "@/design/tokens";

/**
 * The CaseRelay mark: a shield for the court authority that governs every action,
 * and inside it a handoff — one step passed forward to the next owner. Vector, so
 * it holds up from a 16px favicon to the sign-in panel.
 */
export function LogoMark({
  size = 32,
  variant = "brand",
  className,
}: {
  size?: number;
  variant?: "brand" | "light";
  className?: string;
}) {
  const gradientId = useId();
  const light = variant === "light";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="CaseRelay"
      className={className}
    >
      {!light && (
        <defs>
          <linearGradient id={gradientId} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-brand-deep)" />
          </linearGradient>
        </defs>
      )}

      <path
        d="M16 2.6 4.6 6.8v9.6c0 6.6 4.7 12.6 11.4 14.4 6.7-1.8 11.4-7.8 11.4-14.4V6.8Z"
        fill={light ? "#ffffff" : `url(#${gradientId})`}
      />
      <path
        d="M10.8 11.6 15.5 15.8 10.8 20"
        stroke={light ? "var(--color-seal)" : "#ffffff"}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20.2" cy="15.8" r="2" fill={light ? "var(--color-seal)" : "#ffffff"} />
    </svg>
  );
}

export function Logo({
  size = 32,
  variant = "brand",
  className,
}: {
  size?: number;
  variant?: "brand" | "light";
  className?: string;
}) {
  const light = variant === "light";
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <LogoMark size={size} variant={variant} />
      <span
        className={cx(
          "min-w-0 leading-tight font-semibold tracking-[-0.01em]",
          light ? "text-white" : "text-ink",
        )}
        style={{ fontSize: size * 0.44 }}
      >
        CaseRelay
      </span>
    </span>
  );
}
