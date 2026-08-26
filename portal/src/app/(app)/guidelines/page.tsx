"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, Group, Rows, cx } from "@/components/ui/primitives";
import { ruleCopy } from "@/design/copy";
import { layout, row, type as type_ } from "@/design/tokens";
import { AUTHORITY_GRANT, PLAIN_SCOPES } from "@/lib/mock/cases";
import { POLICY_RULES } from "@/lib/mock/policy";
import { useViewer } from "@/lib/viewer";

/**
 * What CaseRelay is for, what it refuses, the rules that enforce the refusals,
 * and how to work each screen — on one tab.
 */
export default function GuidelinesPage() {
  const { copy } = useViewer();
  const { label, intro, footnote, permitted, excluded, howTo, rules, limits } = copy.guidelines;

  return (
    <div className={layout.stack}>
      <Card icon="book" title={label} subtitle={intro}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Group variant="brand" icon="check" label={permitted.title}>
            <p className={cx("mb-2.5", type_.meta)}>{permitted.subtitle}</p>
            <Scopes scopes={AUTHORITY_GRANT.scope} icon="check" />
          </Group>
          <Group variant="danger" icon="close" label={excluded.title}>
            <p className={cx("mb-2.5", type_.meta)}>{excluded.subtitle}</p>
            <Scopes scopes={AUTHORITY_GRANT.excluded} icon="close" />
          </Group>
        </div>

        <p className={cx("mt-5 flex items-start gap-2.5 border-t border-line pt-4", type_.meta)}>
          <Icon name="shield" size={15} className="mt-px shrink-0" />
          <span className={cx("leading-relaxed", layout.measure)}>{footnote}</span>
        </p>
      </Card>

      <Card icon="list" title={howTo.title} subtitle={howTo.subtitle} flush>
        <Rows>
          {howTo.items.map((item) => (
            <li key={item.title} className={cx(row.pad, "flex flex-wrap items-start gap-4")}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand">
                <Icon name={item.icon} size={16} />
              </span>

              <div className="min-w-0 flex-1">
                <h3 className={type_.cardTitle}>{item.title}</h3>
                <ol className="mt-2.5 space-y-2">
                  {item.steps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3">
                      <span className="mt-px w-4 shrink-0 text-right font-mono text-[11px] text-ink-muted">
                        {index + 1}
                      </span>
                      <span className={cx(layout.measure, type_.small)}>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {item.href && (
                <Link
                  href={item.href}
                  className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-brand-deep transition-colors hover:text-brand"
                >
                  Open
                  <Icon name="arrowRight" size={14} />
                </Link>
              )}
            </li>
          ))}
        </Rows>
      </Card>

      <Card icon="shield" title={rules.title} subtitle={rules.subtitle}>
        <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
          {POLICY_RULES.map((rule) => {
            const text = ruleCopy(rule);
            return (
              <li key={rule.id} className="min-w-0">
                <span className="text-[12.5px] font-medium text-ink">{text.title}</span>
                <p className={cx("mt-1", type_.meta)}>{text.summary}</p>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card icon="lock" title={limits.title} subtitle={limits.subtitle}>
        <ul className="grid gap-x-6 gap-y-5 lg:grid-cols-3">
          {limits.items.map((limit) => (
            <li key={limit.title} className="min-w-0">
              <p className="flex items-start gap-2 text-[12.5px] font-medium text-ink">
                <Icon name={limit.icon} size={14} className="mt-0.5 shrink-0 text-ink-muted" />
                {limit.title}
              </p>
              <p className={cx("mt-1.5", type_.meta)}>{limit.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Scopes({
  scopes,
  icon,
}: {
  scopes: string[];
  icon: "check" | "close";
}) {
  return (
    <ul className="space-y-1.5">
      {scopes.map((scope) => (
        <li key={scope} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink">
          <Icon
            name={icon}
            size={13}
            className={cx("mt-1 shrink-0", icon === "check" ? "text-brand" : "text-danger")}
          />
          {PLAIN_SCOPES[scope] ?? scope.replace(/_/g, " ")}
        </li>
      ))}
    </ul>
  );
}
