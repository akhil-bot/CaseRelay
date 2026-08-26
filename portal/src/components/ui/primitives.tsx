import type { ElementType, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { control, cx, layout, row, surface, tone, type Tone, type as type_ } from "@/design/tokens";
import type {
  CaseFlag,
  CommitmentStatus,
  Domain,
  Health,
  PolicyOutcome,
} from "@/lib/types";

export { cx };

export function Card({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  bodyClassName,
  flush,
  fill,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  /**
   * What operates on the body: a link out, a count, or the controls that filter
   * and reshape it. It holds its width and the title lockup yields, because a
   * control that moves to a band of its own stops reading as part of the header.
   */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Drop the body padding, so divided rows can carry their own and reach the edges. */
  flush?: boolean;
  /**
   * Scroll the body inside the card rather than letting it set the card's height.
   * For the one card a page is *about* — a caseload, a log — so its header and
   * controls stay put while the rows move. The height itself comes from the
   * caller (`layout.fillHeight`); the floor here is what stops a short window
   * squeezing the body down to a row and a half.
   */
  fill?: boolean;
}) {
  return (
    <section
      className={cx(
        surface.card,
        "overflow-hidden",
        fill && "flex min-h-[360px] flex-col",
        className,
      )}
    >
      {(title || action) && (
        <header
          className={cx(
            "flex items-start justify-between gap-4 border-b border-line px-5 py-4",
            fill && "shrink-0",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
                <Icon name={icon} size={17} />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className={type_.sectionTitle}>{title}</h2>}
              {subtitle && <p className={cx("mt-1", layout.measure, type_.small)}>{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div
        className={cx(
          !flush && "px-5 py-4",
          fill && "thin-scroll min-h-0 flex-1 overflow-y-auto",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A list inside a card: hairlines between the entries, nothing around them.
 * Use with `flush` on the card so each row's own padding sets the inset and the
 * dividers run the full width, the way a table rule does.
 */
export function Rows({
  as: Tag = "ul",
  children,
  className,
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
}) {
  return <Tag className={cx(row.divide, className)}>{children}</Tag>;
}

/**
 * A labelled group of facts inside a card — disclosed against withheld, in scope
 * against denied.
 *
 * These used to be bordered, tinted boxes, which put a second card inside the
 * first. The distinction they carry is worth keeping, so it moves to the label
 * and a single left rule: still legible at a glance, no longer a container.
 */
export function Group({
  label,
  variant = "neutral",
  icon,
  count,
  children,
  className,
}: {
  label: ReactNode;
  variant?: Tone;
  icon?: IconName;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("border-l-2 pl-4", tone[variant].border, className)}>
      <p
        className={cx(
          "flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] uppercase",
          tone[variant].text,
        )}
      >
        {icon && <Icon name={icon} size={13} />}
        {label}
        {count !== undefined && <span className="font-mono opacity-70">{count}</span>}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

export function Badge({
  children,
  variant = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  variant?: Tone;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        tone[variant].badge,
        className,
      )}
    >
      {icon && <Icon name={icon} size={12.5} />}
      {children}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(type_.mono, className)}>{children}</span>;
}

export function Dot({ variant = "neutral", pulse }: { variant?: Tone; pulse?: boolean }) {
  return (
    <span
      className={cx(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone[variant].dot,
        pulse && "animate-pulse-dot",
      )}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={type_.label}>{label}</dt>
      <dd className={cx("mt-1.5", type_.bodyStrong)}>{children}</dd>
    </div>
  );
}

export function Avatar({
  name,
  size = 36,
  variant = "brand",
}: {
  name: string;
  size?: number;
  variant?: Tone;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full border font-medium",
        tone[variant].badge,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function ProgressBar({
  value,
  total,
  variant = "brand",
  hideValue,
  className,
}: {
  value: number;
  total: number;
  variant?: Tone;
  /**
   * Drops the percentage, for callers that already state the same thing in a
   * more useful form — a table cell reading "2 of 5" does not also need "40%".
   */
  hideValue?: boolean;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <span className={cx("flex items-center gap-2", className)}>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <span
          className={cx("block h-full rounded-full transition-[width]", tone[variant].bar)}
          style={{ width: `${pct}%` }}
        />
      </span>
      {!hideValue && (
        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ink-muted">{pct}%</span>
      )}
    </span>
  );
}

export function EmptyState({
  icon = "sparkle",
  title,
  hint,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
        <Icon name={icon} size={19} />
      </span>
      <p className={cx("mt-3", type_.bodyStrong)}>{title}</p>
      {hint && <p className={cx("mt-1", type_.meta)}>{hint}</p>}
    </div>
  );
}

export function Note({ children, icon = "lock" }: { children: ReactNode; icon?: IconName }) {
  return (
    <p className={cx(surface.inset, "flex items-start gap-2.5 px-4 py-3", type_.meta)}>
      <Icon name={icon} size={15} className="mt-px shrink-0" />
      <span className={cx("leading-relaxed", layout.measure)}>{children}</span>
    </p>
  );
}

export function SectionLabel({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <p className={cx("flex items-center gap-1.5", type_.label)}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </p>
  );
}

export const buttons = control;

/* ── Domain metadata ──────────────────────────────────────────────────────── */

export const DOMAIN_META: Record<Domain, { label: string; icon: IconName; variant: Tone }> = {
  legal: { label: "Legal aid", icon: "legal", variant: "seal" },
  education: { label: "School", icon: "school", variant: "brand" },
  health: { label: "Clinic", icon: "health", variant: "accent" },
  shelter: { label: "Shelter", icon: "shelter", variant: "warn" },
  family_services: { label: "Family services", icon: "users", variant: "neutral" },
};

export function DomainIcon({ domain, size = 36 }: { domain: Domain; size?: number }) {
  const meta = DOMAIN_META[domain];
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-control border",
        tone[meta.variant].badge,
      )}
      style={{ width: size, height: size }}
      title={meta.label}
    >
      <Icon name={meta.icon} size={size * 0.52} />
    </span>
  );
}

/* ── Status metadata ──────────────────────────────────────────────────────── */

const STATUS_META: Record<CommitmentStatus, { label: string; variant: Tone; icon: IconName }> = {
  proposed: { label: "Proposed", variant: "neutral", icon: "document" },
  pending: { label: "Pending", variant: "brand", icon: "clock" },
  in_progress: { label: "In progress", variant: "brand", icon: "activity" },
  scheduled: { label: "Scheduled", variant: "accent", icon: "calendar" },
  waitlisted: { label: "Waitlisted", variant: "warn", icon: "clock" },
  unresolved: { label: "Unresolved", variant: "warn", icon: "alert" },
  blocked: { label: "Blocked", variant: "danger", icon: "alert" },
  completed: { label: "Completed", variant: "seal", icon: "checkCircle" },
};

export function StatusBadge({ status }: { status: CommitmentStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

const FLAG_META: Record<CaseFlag, { label: string; variant: Tone; icon: IconName }> = {
  overdue: { label: "Overdue", variant: "danger", icon: "alert" },
  blocked: { label: "Blocked", variant: "warn", icon: "lock" },
  approval_needed: { label: "Needs you", variant: "accent", icon: "approvals" },
  on_track: { label: "On track", variant: "brand", icon: "check" },
  recently_completed: { label: "Completed", variant: "seal", icon: "checkCircle" },
  intake_pending: { label: "Awaiting activation", variant: "neutral", icon: "clock" },
};

export function FlagBadge({ flag }: { flag: CaseFlag }) {
  const meta = FLAG_META[flag];
  return (
    <Badge variant={meta.variant} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

const OUTCOME_META: Record<PolicyOutcome, { label: string; variant: Tone; icon: IconName }> = {
  allow: { label: "Allowed", variant: "brand", icon: "check" },
  deny: { label: "Refused", variant: "danger", icon: "close" },
  quarantine: { label: "Quarantined", variant: "danger", icon: "shield" },
  requires_human_approval: { label: "Needs a human", variant: "accent", icon: "user" },
};

export function OutcomeBadge({ outcome }: { outcome: PolicyOutcome }) {
  const meta = OUTCOME_META[outcome];
  return (
    <Badge variant={meta.variant} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

export function HealthBadge({ health }: { health: Health }) {
  const map: Record<Health, { label: string; variant: Tone }> = {
    healthy: { label: "Healthy", variant: "brand" },
    degraded: { label: "Degraded", variant: "warn" },
    unverified: { label: "Unverified", variant: "neutral" },
  };
  const meta = map[health];
  return (
    <Badge variant={meta.variant}>
      <Dot variant={meta.variant} />
      {meta.label}
    </Badge>
  );
}
