import { AppShell } from "@/components/AppShell";
import { LiveApprovalsProvider } from "@/lib/live-approvals";

/**
 * Everything a signed-in person uses lives under this group, inside the sidebar
 * and header chrome. The sign-in routes sit outside it, in (auth).
 *
 * The live approvals poll is mounted here rather than at the root so it starts
 * when someone is actually looking at their work, not while they are signing in.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveApprovalsProvider>
      <AppShell>{children}</AppShell>
    </LiveApprovalsProvider>
  );
}
