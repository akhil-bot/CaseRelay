import type { Metadata } from "next";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";
import { CopilotProvider } from "@/components/copilot/CopilotProvider";
import { DemoProvider } from "@/lib/demo-store";
import { DEFAULT_ROLE, ROLE_SCRIPT } from "@/lib/role";
import { ViewerProvider } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "CaseRelay — no promise made for a child should quietly go missing",
  description:
    "UI prototype with synthetic data. Three ways in: a CASA volunteer advocate, their program supervisor, and the administrator running the agent fleet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-role={DEFAULT_ROLE} suppressHydrationWarning>
      <head>
        {/* Settles which role's sidebar is shown before anything is painted.
            See src/lib/role.ts. */}
        <script dangerouslySetInnerHTML={{ __html: ROLE_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ViewerProvider>
          <DemoProvider>
            <CopilotProvider>{children}</CopilotProvider>
          </DemoProvider>
        </ViewerProvider>
      </body>
    </html>
  );
}
