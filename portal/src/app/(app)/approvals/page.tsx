"use client";

import { Icon } from "@/components/icons";
import { SupervisorGate } from "@/components/live/SupervisorGate";
import { Card, EmptyState, cx } from "@/components/ui/primitives";
import { layout, type as type_ } from "@/design/tokens";
import { useLiveApprovals } from "@/lib/live-approvals";
import { useViewer } from "@/lib/viewer";

/**
 * Everything on the control plane that has stopped and is waiting on a person.
 *
 * There is nothing scripted on this screen. What it shows is what the backend
 * is actually holding, so an empty queue here means the agents are genuinely
 * unblocked rather than that a walkthrough has not reached the right step.
 */
export default function ApprovalsPage() {
  const { copy, profile, role } = useViewer();
  const { gates, decidingKey, decideError, decide } = useLiveApprovals();

  // The queue belongs to the supervisor. It is not in anyone else's sidebar, but
  // a link or an old bookmark can still land here, and a blank screen would read
  // as "nothing is waiting" rather than "this is not yours".
  if (role !== "supervisor") {
    return (
      <Card
        icon="approvals"
        title={copy.approvals.gates.title}
        fill
        className={layout.fillHeight}
        bodyClassName="flex flex-col justify-center"
      >
        <EmptyState
          icon="users"
          title="Your supervisor decides these"
          hint="A case that cannot start, or one a guardrail has stopped, waits on your program supervisor. You will see the gate on the case itself, and the case will move on as soon as they decide."
        />
      </Card>
    );
  }

  // An empty queue is the ordinary state of this screen, not a momentary gap, so
  // it takes the window rather than sitting as a short strip above a field of
  // grey. The notice centres in that space instead of clinging to the top of it.
  if (gates.length === 0) {
    return (
      <Card
        icon="approvals"
        title={copy.approvals.gates.title}
        fill
        className={layout.fillHeight}
        bodyClassName="flex flex-col justify-center"
      >
        <EmptyState
          icon="checkCircle"
          title={copy.approvals.empty.title}
          hint={copy.approvals.empty.hint}
        />
      </Card>
    );
  }

  return (
    <div className={layout.stack}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-warn-soft text-warn">
          <Icon name="lock" size={17} />
        </span>
        <div className="min-w-0">
          <h2 className={type_.sectionTitle}>{copy.approvals.gates.title}</h2>
          <p className={cx("mt-1", layout.measure, type_.small)}>{copy.approvals.gates.subtitle}</p>
        </div>
      </div>

      {gates.map((gate) => (
        <SupervisorGate
          key={gate.key}
          kind={gate.kind}
          childName={gate.childName}
          reason={gate.reason}
          caseId={gate.caseId}
          advocateName={gate.advocateName}
          commitmentCount={gate.commitmentCount}
          grantCount={gate.grantCount}
          organisations={gate.organisations}
          openedAt={gate.openedAt}
          actionType={gate.actionType}
          decidingAs={profile.name}
          busy={decidingKey === gate.key}
          error={decideError?.key === gate.key ? decideError.message : null}
          onApprove={() => void decide(gate, "approve", profile.id)}
          onReject={
            gate.kind === "escalation" ? () => void decide(gate, "reject", profile.id) : undefined
          }
        />
      ))}
    </div>
  );
}
