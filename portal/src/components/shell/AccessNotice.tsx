"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, cx } from "@/components/ui/primitives";
import { control, layout } from "@/design/tokens";
import { PERSONAS } from "@/design/personas";
import { useViewer } from "@/lib/viewer";

/**
 * Shown when the advocate view lands on a platform-only route. Minimum-necessary
 * applies to people too, so this explains rather than 404s.
 */
export function AccessNotice({ what }: { what: string }) {
  const { setPersona } = useViewer();
  const router = useRouter();

  return (
    // A refusal is the whole page, so it sits in the middle of it rather than
    // clinging to the top of an otherwise empty screen.
    <div className={cx(layout.fillHeight, "flex min-h-[320px] items-center justify-center")}>
      <Card icon="eyeOff" title="This is not part of your view" className="w-full max-w-[620px]">
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          {what} is technical detail for whoever runs the platform. Your view is deliberately
          narrower: the children you advocate for, what their next step is, and anything waiting on
          your approval.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          Nothing is hidden from you that affects a decision you are asked to make. Every message
          CaseRelay wants to send is shown to you in full, in plain language, before it goes
          anywhere.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => router.push("/")} className={control.primary}>
            <Icon name="home" size={15} />
            Back to my work
          </button>
          <button
            type="button"
            onClick={() => {
              setPersona("platform");
              router.push("/");
            }}
            className={control.secondary}
          >
            <Icon name="swap" size={15} />
            Switch to the {PERSONAS.platform.viewLabel} view
          </button>
        </div>
      </Card>
    </div>
  );
}
