import { AppShell } from "@/components/AppShell";

/**
 * Everything a signed-in person uses lives under this group, inside the sidebar
 * and header chrome. The sign-in routes sit outside it, in (auth).
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
