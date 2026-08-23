import type { SVGProps } from "react";

/**
 * Inline icon set — no icon dependency. Every glyph is a 24×24 stroked path that
 * inherits `currentColor`, so colour always comes from the design tokens.
 */
export type IconName =
  | "home"
  | "cases"
  | "approvals"
  | "agents"
  | "audit"
  | "search"
  | "bell"
  | "settings"
  | "logout"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "play"
  | "pause"
  | "reset"
  | "panel"
  | "clock"
  | "calendar"
  | "alert"
  | "shield"
  | "lock"
  | "check"
  | "checkCircle"
  | "close"
  | "arrowRight"
  | "user"
  | "users"
  | "school"
  | "health"
  | "legal"
  | "shelter"
  | "document"
  | "registry"
  | "memory"
  | "identity"
  | "gateway"
  | "retry"
  | "mail"
  | "activity"
  | "sleep"
  | "sparkle"
  | "filter"
  | "link"
  | "code"
  | "swap"
  | "eye"
  | "eyeOff"
  | "list"
  | "grid";

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.6V20h12V9.6" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  cases: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M4 12h16" />
    </>
  ),
  approvals: (
    <>
      <path d="M12 3.5 5 6.2v5.1c0 4 2.9 7.7 7 9.2 4.1-1.5 7-5.2 7-9.2V6.2z" />
      <path d="m9.2 11.8 2 2 3.6-3.6" />
    </>
  ),
  agents: (
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="2" />
      <path d="M12 4v3.5M12 16.5V20M4 12h3.5M16.5 12H20M6.5 6.5 8.7 8.7M15.3 15.3l2.2 2.2M17.5 6.5l-2.2 2.2M8.7 15.3l-2.2 2.2" />
    </>
  ),
  audit: (
    <>
      <path d="M3.5 12h3l2-5 3 10 2.5-6 1.8 3.5h4.7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.6 15.6 4 4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1" />
    </>
  ),
  logout: (
    <>
      <path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17" />
      <path d="M10 12h10m0 0-3-3m3 3-3 3" />
    </>
  ),
  chevronDown: <path d="m7 10 5 5 5-5" />,
  chevronRight: <path d="m10 7 5 5-5 5" />,
  chevronLeft: <path d="m14 7-5 5 5 5" />,
  play: <path d="M8 5.5 18 12 8 18.5z" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  reset: (
    <>
      <path d="M19 12a7 7 0 1 1-2.4-5.3" />
      <path d="M19.5 4v4h-4" />
    </>
  ),
  panel: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M14.5 5v14" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8v4.3l3 1.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M4 10.5h16M9 4v3.5M15 4v3.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.8 3.8 19h16.4z" />
      <path d="M12 10v4M12 16.6v.1" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6.2v5.1c0 4 2.9 7.7 7 9.2 4.1-1.5 7-5.2 7-9.2V6.2z" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="m8.5 12.2 2.3 2.3 4.7-4.7" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  arrowRight: <path d="M5 12h14m0 0-5-5m5 5-5 5" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a6 6 0 0 1 12 0" />
      <path d="M15.5 6.2a3.2 3.2 0 0 1 0 6.1M17 19.5a5.6 5.6 0 0 0-1.4-3.7" />
    </>
  ),
  school: (
    <>
      <path d="M3.5 9 12 5l8.5 4-8.5 4z" />
      <path d="M7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11" />
      <path d="M20.5 9v4.5" />
    </>
  ),
  health: (
    <>
      <path d="M12 19.5S4.5 15 4.5 10.2A3.7 3.7 0 0 1 12 8.1a3.7 3.7 0 0 1 7.5 2.1c0 4.8-7.5 9.3-7.5 9.3z" />
      <path d="M8.5 12h1.8l1 1.8 1.4-3 .8 1.2h1.9" />
    </>
  ),
  legal: (
    <>
      <path d="M12 4.5v15M7 19.5h10" />
      <path d="M4 9h16M6.8 9 4.5 14h4.6zM17.2 9l-2.3 5h4.6z" />
    </>
  ),
  shelter: (
    <>
      <path d="M4 11 12 4.5 20 11" />
      <path d="M6 10v9.5h12V10" />
      <path d="M10.5 19.5V14h3v5.5" />
    </>
  ),
  document: (
    <>
      <path d="M6 4.5h7l5 5v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" />
      <path d="M13 4.5v5h5M9 13h6M9 16.5h4" />
    </>
  ),
  registry: (
    <>
      <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5H10v14H6.5A1.5 1.5 0 0 1 5 17.5z" />
      <path d="M10 5h7.5A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5H10" />
      <path d="M13 9h3M13 12.5h3" />
    </>
  ),
  memory: (
    <>
      <ellipse cx="12" cy="7" rx="6.5" ry="2.8" />
      <path d="M5.5 7v10c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V7" />
      <path d="M5.5 12c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8" />
    </>
  ),
  identity: (
    <>
      <circle cx="9" cy="12" r="3.5" />
      <path d="M12.5 12H20m-3 0v3m-2.5-3v2" />
    </>
  ),
  gateway: (
    <>
      <path d="M4 12h4M16 12h4" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v4.5M12 15.5V20" />
    </>
  ),
  retry: (
    <>
      <path d="M4.5 9.5A7.5 7.5 0 0 1 18 7" />
      <path d="M18.5 3.5V7h-3.5" />
      <path d="M19.5 14.5A7.5 7.5 0 0 1 6 17" />
      <path d="M5.5 20.5V17H9" />
    </>
  ),
  mail: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="m4.8 7.5 7.2 5.2 7.2-5.2" />
    </>
  ),
  activity: (
    <>
      <path d="M4 12h3.2l2.1-5.5 3.3 11 2.4-7 1.5 3.5H20" />
    </>
  ),
  sleep: (
    <>
      <path d="M19.5 14.2A7.6 7.6 0 0 1 9.8 4.5a7.6 7.6 0 1 0 9.7 9.7z" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4L6 10.5l4.4-1.6z" />
      <path d="M18 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  filter: <path d="M4.5 6.5h15M7 12h10M10 17.5h4" />,
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5L11.8 7.2" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.54 3.54 0 0 0 5 5l1.2-1.2" />
    </>
  ),
  code: (
    <>
      <path d="m9 8.5-4 3.5 4 3.5M15 8.5l4 3.5-4 3.5" />
    </>
  ),
  swap: (
    <>
      <path d="M4 9h13m0 0-3-3m3 3-3 3" />
      <path d="M20 15H7m0 0 3-3m-3 3 3 3" />
    </>
  ),
  eye: (
    <>
      <path d="M3.6 11.4c.7-1.2 3.8-5.5 8.4-5.5s7.7 4.3 8.4 5.5c.2.4.2.9 0 1.3-.7 1.2-3.8 5.5-8.4 5.5s-7.7-4.3-8.4-5.5a1.3 1.3 0 0 1 0-1.3z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.9 5.6A7.9 7.9 0 0 1 12 5.3c4.6 0 7.7 4.3 8.4 5.5.2.4.2.9 0 1.3-.4.6-1.3 2-2.7 3.2" />
      <path d="M15.2 15.9c-1 .5-2.1.8-3.2.8-4.6 0-7.7-4.3-8.4-5.5a1.3 1.3 0 0 1 0-1.3c.4-.6 1.1-1.7 2.2-2.7" />
      <path d="M10.3 10.3a2.4 2.4 0 0 0 3.4 3.4M4.5 4.5l15 15" />
    </>
  ),
  list: (
    <>
      <path d="M4.5 7h2M9.5 7h10M4.5 12h2M9.5 12h10M4.5 17h2M9.5 17h10" />
    </>
  ),
  grid: (
    <>
      <rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.2" y="4.2" width="6.6" height="6.6" rx="1.6" />
      <rect x="4.2" y="13.2" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.2" y="13.2" width="6.6" height="6.6" rx="1.6" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
