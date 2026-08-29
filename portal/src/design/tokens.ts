/**
 * ── Design tokens: semantic layer ────────────────────────────────────────────
 * Raw values (colours, radii, shadows) live in one place: the `@theme` block in
 * src/app/globals.css. This file is the other half of that contract — it maps
 * those values onto UI roles, so no component ever hardcodes a colour or picks
 * its own surface, radius, or type size.
 *
 * Components import from here. If a style needs changing, change it here.
 */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Elevation and shape for containers. */
export const surface = {
  card: "rounded-card border border-line bg-surface shadow-card",
  cardFlat: "rounded-card border border-line bg-surface",
  inset: "rounded-control border border-line bg-surface-soft",
  insetMuted: "rounded-control border border-line bg-surface-muted",
  pop: "rounded-card border border-line bg-surface shadow-pop",
  rail: "border-line bg-surface",
} as const;

/**
 * What sits inside a card.
 *
 * A card is the only elevated surface in the product, and it is one level deep.
 * Anything within one is therefore separated by a hairline and tinted on hover —
 * never given a border and a fill of its own, which reads as a second card and
 * makes a page of lists look like a page of boxes.
 */
export const row = {
  /** Hairlines between rows. Pair with a flush card body so they reach the edges. */
  divide: "divide-y divide-line",
  /** The inset every row shares. Display is the caller's, so add `flex` or `block`. */
  pad: "px-5 py-3.5",
  /**
   * Resting and selected are separate recipes rather than one plus a modifier:
   * both set a hover background, and two competing `hover:` utilities resolve by
   * stylesheet order rather than by the order they are passed in.
   */
  hover: "transition-colors hover:bg-surface-soft",
  selected: "bg-brand-soft/60 transition-colors hover:bg-brand-soft",
  /**
   * A cell in a grid of facts. A grid cannot be divided, so the hairline goes
   * above each cell instead of around it.
   */
  cell: "border-t border-line pt-3",
} as const;

/** Type scale. Every size in the product comes from this list. */
export const type = {
  pageTitle: "text-[19px] font-semibold tracking-[-0.01em] text-ink",
  sectionTitle: "text-[15px] font-semibold text-ink",
  cardTitle: "text-[14px] font-semibold text-ink",
  body: "text-[13.5px] leading-relaxed text-ink-soft",
  bodyStrong: "text-[13.5px] leading-relaxed text-ink",
  small: "text-[12.5px] leading-relaxed text-ink-soft",
  meta: "text-[12px] text-ink-muted",
  label: "text-[11px] font-medium tracking-[0.08em] text-ink-muted uppercase",
  metric: "font-mono text-[26px] leading-none tracking-tight text-ink",
  mono: "font-mono text-[12px] tracking-tight text-ink-soft",
  monoSmall: "font-mono text-[11px] tracking-tight text-ink-muted",
} as const;

/**
 * The row that runs across the top of every column: sidebar wordmark, page
 * header, activity rail, chat panel. Each is a two-line lockup set at a
 * different size, and they sit side by side, so the metrics are pinned rather
 * than font-relative — a fixed 64px row (border included) and fixed line boxes
 * are what put all four pairs of lines on the same two baselines.
 */
export const chrome = {
  row: "flex h-16 shrink-0 items-center border-b border-line",
  /**
   * First line. Carries the box only; the size comes from `type`. The height is
   * stated as well as the leading so the box holds even where the line is a
   * flex row with a badge on it, which leading alone would not constrain.
   */
  title: "h-[22px] leading-[22px]",
  /** Second line. Carries the box only; each surface sets its own size. */
  subtitle: "mt-0.5 block truncate leading-[16px]",
} as const;

/** Interactive controls. */
export const control = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-control bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep disabled:opacity-40",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-40",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-control px-2.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40",
  icon: "inline-flex size-9 items-center justify-center rounded-control border border-line bg-surface text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink",
  /**
   * An icon control that carries a tone at rest, for the one button whose subject
   * is a standing note rather than an action on the case in front of you.
   * Written out in full, like `chip` and `chipActive`, so neither state resolves
   * by stylesheet order.
   */
  iconWarn:
    "inline-flex size-9 items-center justify-center rounded-control border border-line bg-surface text-warn transition-colors hover:border-warn/30 hover:bg-warn-soft",
  iconWarnActive:
    "inline-flex size-9 items-center justify-center rounded-control border border-warn/35 bg-warn-soft text-warn",
  chip: "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink",
  chipActive:
    "inline-flex items-center gap-1.5 rounded-full border border-brand/35 bg-brand-soft px-3 py-1.5 text-[12.5px] font-medium text-brand-deep",
  /**
   * A control that opens a menu, and the native selects it sits beside. The
   * active recipe carries a tint, because a control that is narrowing the list
   * below it should never look the same as one that is letting everything past.
   */
  select:
    "inline-flex items-center gap-2 rounded-control border border-line bg-surface-soft px-3 py-2 text-[13px] text-ink-soft transition-colors hover:bg-surface hover:text-ink focus:border-brand/40 focus:outline-none",
  selectActive:
    "inline-flex items-center gap-2 rounded-control border border-brand/35 bg-brand-soft px-3 py-2 text-[13px] font-medium text-brand-deep transition-colors focus:outline-none",
  /** A row inside a popover menu. Both states are full recipes, as above. */
  menuItem:
    "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink",
  menuItemActive:
    "flex w-full items-center gap-2.5 rounded-control bg-brand-soft px-2.5 py-2 text-left text-[13px] font-medium text-brand-deep",
  input:
    "w-full rounded-control border border-line bg-surface-soft py-2 pr-3 pl-9 text-[13px] text-ink transition-colors placeholder:text-ink-muted focus:border-brand/40 focus:bg-surface focus:outline-none",
} as const;

/**
 * Sign-in surfaces. This is the only screen in the product that runs dark: the
 * form floats as a glass card over full-bleed artwork. Every control on it needs
 * its own recipe, because the light ones used everywhere else disappear there.
 */
export const auth = {
  screen: "on-dark relative flex min-h-screen overflow-hidden bg-seal",
  /**
   * One picture carries the whole screen. It is composed for this layout — subject
   * left, open sky right — so the scrims only need to deepen where type lands.
   */
  art: "object-cover object-center",
  scrimBase: "pointer-events-none absolute inset-0 bg-seal/55 lg:bg-transparent",
  scrimFoot:
    "pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-seal via-seal/45 to-transparent",
  scrimForm:
    "pointer-events-none absolute inset-y-0 right-0 w-full bg-gradient-to-l from-seal/85 via-seal/35 to-transparent lg:w-[48%]",
  /** The artwork's subject holds the larger share; the form takes what it needs. */
  panel: "relative z-10 hidden w-[60%] shrink-0 flex-col justify-between p-9 lg:flex 2xl:p-11",
  column: "relative z-10 flex min-w-0 flex-1 flex-col px-4 py-7 sm:px-8 lg:px-10 xl:px-16",
  form: "mx-auto w-full max-w-[392px]",
  /** The panel claim is set as a quotation, so it opens with the mark. */
  headlineQuote: "block text-[60px] leading-[0.5] font-semibold text-white/25 select-none",
  headline:
    "text-balance text-[32px] leading-[1.15] font-semibold tracking-[-0.02em] text-white 2xl:text-[36px]",
  /** The phrase the headline argues against, drawn fading out of the sentence. */
  headlineFade: "headline-fade box-decoration-clone bg-clip-text text-transparent",
  lede: "text-pretty text-[14px] leading-relaxed text-white/70",
  title: "text-[24px] leading-tight font-semibold tracking-[-0.015em] text-white",
  subtitle: "text-[13.5px] leading-relaxed text-white/65",
  label: "text-[12.5px] font-medium text-white/80",
  field:
    "w-full rounded-control border border-white/15 bg-white/[0.07] py-3 pr-3 pl-10 text-[13.5px] text-white transition-colors placeholder:text-white/35 hover:border-white/25 focus:border-white/55 focus:bg-white/[0.12] focus:outline-none",
  primary:
    "inline-flex w-full items-center justify-center gap-2 rounded-control bg-white px-4 py-3 text-[13.5px] font-semibold text-seal transition-colors hover:bg-white/90 disabled:opacity-50",
  secondary:
    "inline-flex w-full items-center justify-center gap-2 rounded-control border border-white/20 bg-white/[0.06] px-4 py-3 text-[13.5px] font-medium text-white transition-colors hover:border-white/35 hover:bg-white/[0.14] disabled:opacity-50",
  switcher:
    "inline-flex items-center gap-1.5 rounded-[5px] border border-white/20 bg-white/10 px-2.5 py-1 text-[11.5px] text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white",
  menu: "absolute top-full right-0 z-30 mt-1.5 w-[212px] rounded-[8px] border border-white/15 bg-seal/90 p-1 shadow-pop backdrop-blur-xl",
  menuItem: "flex items-center gap-2.5 rounded-[5px] px-2 py-1.5 transition-colors hover:bg-white/10",
  menuLabel: "block text-[12px] font-medium text-white",
  menuMeta: "mt-0.5 block text-[10.5px] leading-snug text-white/45",
  link: "text-[12.5px] font-medium text-white/65 transition-colors hover:text-white",
  progressTrack: "fixed inset-x-0 top-0 z-50 h-[2px] overflow-hidden bg-white/10",
  progressBar: "block h-full w-full origin-left bg-white",
  divider: "flex items-center gap-3 text-[11.5px] tracking-[0.06em] text-white/45 uppercase",
  rule: "h-px flex-1 bg-white/15",
  meta: "text-[12px] leading-relaxed text-white/50",
  notice:
    "flex items-start gap-2.5 rounded-control border border-white/25 bg-white/10 px-4 py-3 text-[12.5px] leading-relaxed text-white",
} as const;

/**
 * Semantic tones. Every status, flag, outcome, and accent in the product resolves
 * to one of these six, so the palette can never drift.
 */
export type Tone = "neutral" | "brand" | "accent" | "seal" | "warn" | "danger";

export const tone: Record<
  Tone,
  { badge: string; soft: string; dot: string; text: string; border: string; bar: string }
> = {
  neutral: {
    badge: "border-line-strong bg-surface-muted text-ink-soft",
    soft: "border-line bg-surface-soft",
    dot: "bg-ink-muted",
    text: "text-ink-soft",
    border: "border-line-strong",
    bar: "bg-ink-muted",
  },
  brand: {
    badge: "border-brand/25 bg-brand-soft text-brand-deep",
    soft: "border-brand/20 bg-brand-soft",
    dot: "bg-brand",
    text: "text-brand-deep",
    border: "border-brand/30",
    bar: "bg-brand",
  },
  accent: {
    badge: "border-accent/25 bg-accent-soft text-accent-deep",
    soft: "border-accent/20 bg-accent-soft",
    dot: "bg-accent",
    text: "text-accent-deep",
    border: "border-accent/30",
    bar: "bg-accent",
  },
  seal: {
    badge: "border-seal/25 bg-seal-soft text-seal",
    soft: "border-seal/20 bg-seal-soft",
    dot: "bg-seal",
    text: "text-seal",
    border: "border-seal/30",
    bar: "bg-seal",
  },
  warn: {
    badge: "border-warn/25 bg-warn-soft text-warn",
    soft: "border-warn/20 bg-warn-soft",
    dot: "bg-warn",
    text: "text-warn",
    border: "border-warn/30",
    bar: "bg-warn",
  },
  danger: {
    badge: "border-danger/25 bg-danger-soft text-danger",
    soft: "border-danger/20 bg-danger-soft",
    dot: "bg-danger",
    text: "text-danger",
    border: "border-danger/30",
    bar: "bg-danger",
  },
};

export const layout = {
  /** Content fills the viewport; only the reading measure is capped, never the shell. */
  page: "w-full px-4 py-5 sm:px-6 2xl:px-8",
  stack: "space-y-5",
  /**
   * What the window has left below the chrome row: 100dvh less the 64px header
   * and the 40px the page pads itself with, top and bottom. For the one region
   * on a page that should reach the bottom of the screen instead of stopping
   * where its content happens to stop — a caseload, a log. Pair it with a floor
   * (`Card`'s `fill` carries one) so a short window scrolls the page rather than
   * crushing the region into a couple of rows.
   */
  fillHeight: "h-[calc(100dvh-104px)]",
  /**
   * The same measure as `fillHeight`, but as a floor on a page rather than a
   * fixed height on one region. For a page whose *last* region should reach the
   * bottom of the screen while everything above it keeps its natural height:
   * make the page a flex column with this, then give that region `flex-1`.
   */
  fillHeightMin: "min-h-[calc(100dvh-104px)]",
  /** Paragraph width cap, so prose stays readable on a 2560px display. */
  measure: "max-w-[78ch]",
  sidebarWidth: "w-[248px]",
  headerHeight: "h-16",
} as const;
