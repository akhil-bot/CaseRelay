import { notFound } from "next/navigation";
import { ROLE_ORDER, type Role } from "@/design/personas";
import { SignInForm } from "./SignInForm";

/** One route per way in, so /login/advocate and /login/supervisor are real URLs. */
export function generateStaticParams() {
  return ROLE_ORDER.map((role) => ({ role }));
}

export default async function RoleLoginPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!ROLE_ORDER.includes(role as Role)) notFound();
  return <SignInForm role={role as Role} />;
}
