import type { ReactNode } from "react";
import { cx, type as type_ } from "@/design/tokens";

/**
 * Shared parts of a listing that reads as a table: field names stated once at
 * the top, and values that line up underneath them.
 *
 * The column track itself belongs to the caller — a caseload and an approval
 * queue hold different things and want different widths — but it has to be the
 * same string on the header and on every row, which is the whole reason these
 * two live together.
 *
 * Both are built for a flush card, so a row's own padding sets the inset and the
 * hairlines reach the edges.
 */

/**
 * The headings, above the rows.
 *
 * A trailing spacer column is always emitted for the chevron that ends each
 * row, since a heading over an affordance would be noise.
 */
export function ColumnHeader({ labels, track }: { labels: string[]; track: string }) {
  return (
    <div
      className={cx(
        // Hidden below `lg`, where there is no grid and each cell labels itself.
        "hidden px-5 py-2.5",
        // A tint rather than a hairline alone: this is chrome, not a row, and the
        // fill is what stops it reading as the first entry in the list. Opaque,
        // so it can hold the top of the list with rows passing beneath it.
        "sticky top-0 z-10 border-b border-line bg-surface-soft",
        // Matches the state rule every row carries, so the two column tracks
        // start at the same x and each heading sits true over its values.
        "border-l-2 border-l-transparent",
        track,
      )}
      aria-hidden="true"
    >
      {labels.map((label) => (
        <span key={label} className={cx("truncate", type_.label)}>
          {label}
        </span>
      ))}
      <span />
    </div>
  );
}

/**
 * One value in a row. The heading names it at `lg`; below that there is no
 * header, so the cell carries the name itself.
 */
export function TableCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <p className={cx("lg:hidden", type_.label)}>{label}</p>
      <div className="mt-1 min-w-0 truncate text-[12.5px] text-ink-soft lg:mt-0">{children}</div>
    </div>
  );
}
