import Image from "next/image";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { auth } from "@/design/tokens";

/**
 * The artwork is not a panel beside the form — it is the page. It runs edge to
 * edge behind everything, including the form, so the form reads as sitting inside
 * the same scene rather than next to a picture of one.
 */
export function AuthBackdrop({ src }: { src: string }) {
  return (
    <>
      <Image src={src} alt="" fill priority sizes="100vw" className={auth.art} />
      <span aria-hidden="true" className={auth.scrimBase} />
      <span aria-hidden="true" className={auth.scrimFoot} />
      <span aria-hidden="true" className={auth.scrimForm} />
    </>
  );
}

/** The left share of the scene: the mark above, the claim beneath the figures. */
export function AuthPanel({ children }: { children: ReactNode }) {
  return (
    <div className={auth.panel}>
      <Logo size={32} variant="light" />
      <blockquote>{children}</blockquote>
    </div>
  );
}
