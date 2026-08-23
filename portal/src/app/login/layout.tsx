import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — CaseRelay",
  description:
    "Two ways in: a CASA volunteer advocate signs in to their appointed cases, a platform administrator signs in to the agent fleet console.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
