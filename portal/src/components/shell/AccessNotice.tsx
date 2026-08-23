"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card } from "@/components/ui/primitives";
import { control } from "@/design/tokens";
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
    <Card icon="eyeOff" title="This is not part of your view">
      <p className="text-[13.5px] leading-relaxed text-ink-soft">
        {what} is technical detail for whoever runs the platform. Your view is deliberately
        narrower: the children you advocate for, what their next step is, and anything waiting on
        your approval.
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
        Nothing is hidden from you that affects a decision you are asked to make. Every message
        CaseRelay wants to send is shown to you in full, in plain language, before it goes anywhere.
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
  );
}
