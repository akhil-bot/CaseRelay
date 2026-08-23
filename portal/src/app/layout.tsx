import type { Metadata } from "next";
import "./globals.css";
import { DemoProvider } from "@/lib/demo-store";
import { ViewerProvider } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "CaseRelay — no promise made for a child should quietly go missing",
  description:
    "UI prototype with synthetic data. An advocate view for CASA volunteers and a platform view for the team operating the agent fleet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ViewerProvider>
          <DemoProvider>{children}</DemoProvider>
        </ViewerProvider>
      </body>
    </html>
  );
}
