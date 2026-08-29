import { DOMAIN_META } from "@/components/ui/primitives";
import { getCase, listCaseAudit, type AuditEvent, type LiveCaseDetail } from "@/lib/api";
import type { Domain } from "@/lib/types";

/**
 * A case report, shaped as the court report a CASA volunteer already files.
 *
 * The structure follows that document — identifying details, then the activities
 * undertaken, then findings service by service, then recommendations — so a
 * supervisor reads something they recognise rather than a dump of system state.
 *
 * What fills it is unchanged, and is the point: every field here is read off the
 * control plane. Nothing on this type can be written by a language model, so the
 * chat asks for a report and gets the case's own record back rather than a
 * plausible account of it. The model's only job is to hand over the markdown,
 * and it is given no room to embellish because the markdown is already written
 * by the time it sees it.
 *
 * A court report also asks for judgements no system holds: why the child came
 * into care, how they seem, what they want, what should happen next. Those are
 * not guessed and not quietly dropped. They are carried as ADVOCATE_SECTIONS and
 * printed as named blanks, so what comes out is a draft with the verifiable part
 * already filled and the human part visibly still owed.
 */
export interface CaseReport {
  caseId: string;
  childName: string;
  /** ISO-8601 date, or "" where the record carries none. */
  dateOfBirth: string;
  status: string;

  advocate: string;
  supervisor: string;
  docketNumber: string;
  judgeName: string;
  /** ISO-8601. When the volunteer was appointed to the case by the court. */
  appointedAt: string;

  /** The current placement. Null where the packet names none. */
  placement: ReportPlacement | null;

  /** ISO-8601. The period covered: the case opening through to assembly. */
  periodFrom: string;
  generatedAt: string;
  dueAt: string;

  /** What the fleet read, and who it approached on the child's behalf. */
  recordsReviewed: string[];
  contacts: ReportContact[];

  /** One per service the case committed to, in the order a court report runs. */
  findings: ReportFinding[];
  /** Commitments still owed at the close of the period. */
  outstanding: ReportCommitment[];

  organisations: string[];
  commitments: ReportCommitment[];
  grants: ReportGrant[];
  /** Fields the fleet released, and fields it was asked for and refused. */
  disclosed: string[];
  withheld: string[];
  decisions: ReportDecision[];
  counts: {
    commitments: number;
    settled: number;
    grants: number;
    audit: number;
    refusals: number;
  };
}

export interface ReportPlacement {
  household: string;
  caregiver: string;
  /** ISO-8601. */
  placedAt: string;
}

export interface ReportCommitment {
  domain: string;
  /** The service as a person names it, or the raw domain where unrecognised. */
  label: string;
  status: string;
}

/**
 * An organisation approached about this child — the court report's "collateral
 * contacts", which is exactly what the fleet's outreach amounts to.
 */
export interface ReportContact {
  organisation: string;
  /** "Name, role" where the packet carries one, otherwise "". */
  contact: string;
  /** ISO-8601. */
  requestedAt: string;
  dueAt: string;
  outcome: string;
}

/**
 * One service's findings.
 *
 * `notes` are audit explanations scoped to this domain, newest first. They are
 * quoted from the log rather than summarised, so the section says what the
 * record says.
 */
export interface ReportFinding {
  domain: Domain;
  heading: string;
  label: string;
  status: string;
  organisation: string;
  /** ISO-8601. */
  dueAt: string;
  notes: string[];
}

export interface ReportGrant {
  grantedTo: string;
  purpose: string;
  status: string;
}

export interface ReportDecision {
  at: string;
  agent: string;
  type: string;
  verdict: string;
  note: string;
}

/**
 * The order a court report walks the child's life in, and the words it uses.
 *
 * Not derived from DOMAIN_META: that names the service a volunteer contacts
 * ("School", "Clinic"), which is right in a sidebar and wrong in a filing. A
 * court reads about educational issues, not about a school.
 */
const FINDING_ORDER: { domain: Domain; heading: string }[] = [
  { domain: "education", heading: "Educational issues" },
  { domain: "health", heading: "Medical and health issues" },
  { domain: "family_services", heading: "Family and sibling contact" },
  { domain: "shelter", heading: "Placement and housing" },
  { domain: "legal", heading: "Legal representation" },
];

/**
 * The parts of a court report that are a person's judgement, not a record.
 *
 * Printed as headed blanks with the prompt the volunteer needs. Two of them are
 * blank for a different reason than the rest — the reason for removal and the
 * placement history are facts, and facts CaseRelay is simply not given — so they
 * say so, rather than implying the volunteer never wrote them down.
 */
export const BACKGROUND_BLANKS: { heading: string; hint: string }[] = [
  {
    heading: "Reason the child came into care",
    hint: "Not held by CaseRelay — this lives in the court file. Summarise it here.",
  },
  {
    heading: "Placement history",
    hint: "Earlier placements and their dates. Only the current placement is recorded above.",
  },
];

export const CLOSING_BLANKS: { heading: string; hint: string }[] = [
  {
    heading: "Impressions of the child",
    hint: "What you have observed of the child across this reporting period.",
  },
  {
    heading: "The child's wishes",
    hint: "What the child has said they want, in their own words where you can.",
  },
  {
    heading: "Recommendations to the court",
    hint: "Yours to make. What is outstanding above is the record; the recommendation is not.",
  },
];

/** Statuses that mean the commitment no longer needs chasing. */
const SETTLED = new Set(["completed", "verified", "closed"]);

/** Verdicts that mean a request for data was turned down. */
const REFUSALS = new Set(["deny", "denied", "quarantine", "quarantined"]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

/**
 * The first of several field names that carries a value.
 *
 * Grant rows are written by more than one agent and the shapes have drifted —
 * `workspace.grant_for` matches on the same fallback chain when it authorises a
 * request, so a report that read only one spelling would show a blank beside a
 * grant the backend considers valid.
 */
function firstOf(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const found = text(row[key]);
    if (found) return found;
  }
  return "";
}

function serviceLabel(domain: string): string {
  return DOMAIN_META[domain as Domain]?.label ?? domain.replace(/_/g, " ");
}

function referrals(detail: LiveCaseDetail): Record<string, unknown>[] {
  return rows(record(detail.case.referral_packet).referrals);
}

function organisationOf(referral: Record<string, unknown>): string {
  return firstOf(referral, "target_org", "target_org_short");
}

function organisations(detail: LiveCaseDetail): string[] {
  const named = referrals(detail).map(organisationOf).filter((name) => name.length > 0);
  return Array.from(new Set(named));
}

/**
 * Who was approached, and what came of it.
 *
 * The outcome is read from the follow-up the escalation workflow writes back
 * onto the referral, falling back to the referral's own status. A partner that
 * was chased and never replied is the single most useful line in a court report,
 * so it is named as such rather than left as "sent".
 */
function contacts(detail: LiveCaseDetail): ReportContact[] {
  return referrals(detail)
    .filter((referral) => organisationOf(referral).length > 0)
    .map((referral) => {
      const person = record(referral.contact);
      const name = text(person.name);
      const role = text(person.role);
      const followup = record(referral.followup);
      const chased = Object.keys(followup).length > 0;

      let outcome = firstOf(referral, "status") || "—";
      if (chased) outcome = followup.answered === true ? "Answered after follow-up" : "No response";

      return {
        organisation: organisationOf(referral),
        contact: name && role ? `${name}, ${role}` : name,
        requestedAt: firstOf(referral, "referral_date"),
        dueAt: firstOf(referral, "due_date"),
        outcome,
      };
    });
}

/**
 * The documents behind the report.
 *
 * A volunteer lists what they read. The fleet's equivalent is the referral packet
 * it was given and the responses that came back, so those are what is named —
 * not the field-level disclosures, which are the appendix's business.
 */
function recordsReviewed(
  detail: LiveCaseDetail,
  seen: ReportContact[],
  auditCount: number,
): string[] {
  const packet = record(detail.case.referral_packet);
  const source = text(packet.source_document_ref);
  const reviewed = [source ? `Referral packet (${source})` : "Referral packet"];

  for (const contact of seen) {
    if (contact.outcome === "No response") continue;
    reviewed.push(`Response from ${contact.organisation}`);
  }
  reviewed.push(`Case audit log (${auditCount} ${auditCount === 1 ? "entry" : "entries"})`);
  return reviewed;
}

/**
 * What the log recorded against one service, newest first and deduplicated.
 *
 * Capped, because a chased partner can generate the same explanation weekly and
 * a court report is not a log. The appendix carries every entry.
 */
function notesFor(events: AuditEvent[], domain: Domain): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.commitment_type !== domain) continue;
    const note = event.explanation ?? "";
    if (note) seen.add(note);
  }
  return [...seen].slice(0, 4);
}

function findings(detail: LiveCaseDetail, events: AuditEvent[]): ReportFinding[] {
  const byDomain = new Map(
    referrals(detail).map((referral) => [firstOf(referral, "type"), referral]),
  );

  return FINDING_ORDER.filter((entry) => entry.domain in detail.commitments).map((entry) => ({
    domain: entry.domain,
    heading: entry.heading,
    label: serviceLabel(entry.domain),
    status: detail.commitments[entry.domain],
    organisation: organisationOf(byDomain.get(entry.domain) ?? {}),
    dueAt: firstOf(byDomain.get(entry.domain) ?? {}, "due_date"),
    notes: notesFor(events, entry.domain),
  }));
}

function placement(detail: LiveCaseDetail): ReportPlacement | null {
  const foster = record(record(detail.case.referral_packet).foster_family);
  const household = text(foster.household_name);
  const caregiver = text(foster.caregiver_name);
  const placedAt = text(foster.placement_date);
  if (!household && !caregiver && !placedAt) return null;
  return { household, caregiver, placedAt };
}

/**
 * What the fleet released and what it refused, gathered across the whole log.
 *
 * Deduplicated, because a field asked for by four specialists is one disclosure
 * as far as a supervisor reviewing the case is concerned. A field that appears
 * in both lists stays in both: it was released to one caller and refused to
 * another, and that difference is the case for having an audit log at all.
 */
function disclosure(events: AuditEvent[]): { disclosed: string[]; withheld: string[] } {
  const disclosed = new Set<string>();
  const withheld = new Set<string>();
  for (const event of events) {
    for (const field of event.disclosed_fields ?? []) disclosed.add(field);
    for (const field of event.withheld_fields ?? []) withheld.add(field);
    if (event.denied_field) withheld.add(event.denied_field);
  }
  return { disclosed: [...disclosed].sort(), withheld: [...withheld].sort() };
}

/**
 * The log entries that record a judgement, newest first.
 *
 * An audit log is mostly movement — a wake fired, a phase opened — and none of
 * that is what a report is for. Only entries carrying a verdict are kept, so
 * what survives is the set of moments where the fleet allowed, refused or
 * escalated something, which is the part a person is accountable for.
 */
function decisions(events: AuditEvent[]): ReportDecision[] {
  return events
    .filter((event) => !!event.verdict)
    .map((event) => ({
      at: event.timestamp,
      agent: event.agent_identity ?? "—",
      type: event.event_type,
      verdict: event.verdict ?? "",
      note: event.explanation ?? event.purpose ?? "",
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Assemble a report for one case. Two requests, in parallel: the case aggregate
 * and its audit log. Neither is cached — a report carries a generation time and
 * has to mean it.
 */
export async function buildReport(caseId: string): Promise<CaseReport> {
  const [detail, events] = await Promise.all([getCase(caseId), listCaseAudit(caseId)]);

  const caseRecord = detail.case;
  const packet = record(caseRecord.referral_packet);
  const child = record(packet.child);
  const court = record(packet.court);

  const commitments: ReportCommitment[] = Object.entries(detail.commitments).map(
    ([domain, status]) => ({ domain, label: serviceLabel(domain), status }),
  );

  const grants: ReportGrant[] = detail.grants.map((raw) => {
    const row = record(raw);
    return {
      grantedTo: firstOf(row, "granted_to", "identity", "agent") || "—",
      purpose: firstOf(row, "purpose", "authorized_purpose") || "—",
      status: firstOf(row, "status") || "—",
    };
  });

  const { disclosed, withheld } = disclosure(events);
  const seen = contacts(detail);

  return {
    caseId,
    childName: text(caseRecord.child_name) || text(child.name) || caseId,
    dateOfBirth: text(caseRecord.dob) || text(child.dob),
    status: text(caseRecord.status) || "unknown",

    advocate: text(caseRecord.volunteer_name) || text(packet.volunteer_name) || "—",
    supervisor: text(packet.supervisor_name) || text(caseRecord.supervisor_id) || "—",
    docketNumber: text(court.docket_number),
    judgeName: text(court.judge_name),
    appointedAt: text(court.appointment_date),

    placement: placement(detail),

    periodFrom: text(caseRecord.created_at),
    generatedAt: new Date().toISOString(),
    dueAt: text(caseRecord.due_at) || text(packet.due_at),

    recordsReviewed: recordsReviewed(detail, seen, events.length),
    contacts: seen,
    findings: findings(detail, events),
    outstanding: commitments.filter((item) => !SETTLED.has(item.status)),

    organisations: organisations(detail),
    commitments,
    grants,
    disclosed,
    withheld,
    decisions: decisions(events),
    counts: {
      commitments: commitments.length,
      settled: commitments.filter((item) => SETTLED.has(item.status)).length,
      grants: grants.length,
      audit: events.length,
      refusals: events.filter((event) => REFUSALS.has(event.verdict ?? "")).length,
    },
  };
}

// ─── Serialisation ───────────────────────────────────────────────────────────

/** A date a person can read, or an em dash where the record carries nothing. */
function when(iso: string): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A calendar date, for the facts that are one.
 *
 * A birthday and a hearing date have no time of day, and printing "00:00" beside
 * them invents a precision the record does not have.
 */
function day(iso: string): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Where each part-B section sits in the numbering.
 *
 * Computed once and read by both renderers, so the markdown and the printable
 * copy cannot drift into disagreeing about which finding is number 4. Sections
 * that are empty are dropped rather than printed hollow, which is why the
 * numbers have to be worked out rather than written down.
 */
export function sectionNumbers(report: CaseReport): {
  background: number;
  findings: number[];
  outstanding: number | null;
  closing: number[];
} {
  const findingNumbers = report.findings.map((_, index) => 2 + index);
  let next = 2 + report.findings.length;
  const outstanding = report.outstanding.length > 0 ? next++ : null;
  return {
    background: 1,
    findings: findingNumbers,
    outstanding,
    closing: CLOSING_BLANKS.map((_, index) => next + index),
  };
}

/** Pipes would end the cell they sit in, so they are escaped before a row is built. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function table(headers: string[], body: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

/** A blank the volunteer fills, named so it cannot be filed unnoticed. */
function blank(lines: string[], heading: string, hint: string, prefix = "### "): void {
  lines.push("", `${prefix}${heading}`, "", `> _${hint}_`, ">", "> _To be completed by the CASA volunteer._");
}

/**
 * The report as markdown.
 *
 * This is what the chat shows, what the `.md` download contains, and what the
 * agent is handed — one text, so the three can never disagree. Sections with
 * nothing in them are dropped rather than printed empty: a report that says
 * "None" four times reads as a broken template, and a case early in its life
 * legitimately has no grants and no decisions yet.
 */
export function reportToMarkdown(report: CaseReport): string {
  const n = sectionNumbers(report);

  const lines: string[] = [
    `# CASA court report — ${report.childName}`,
    "",
    `**Child** ${report.childName}${report.dateOfBirth ? ` · **Date of birth** ${day(report.dateOfBirth)}` : ""}`,
    `**Case** ${report.caseId}${report.docketNumber ? ` · **Docket** ${report.docketNumber}` : ""} · **Status** ${report.status}`,
    `**CASA volunteer** ${report.advocate} · **CASA supervisor** ${report.supervisor}`,
  ];

  if (report.judgeName || report.appointedAt) {
    const court = [
      report.judgeName ? `**Judge** ${report.judgeName}` : "",
      report.appointedAt ? `**CASA appointed** ${day(report.appointedAt)}` : "",
    ].filter(Boolean);
    lines.push(court.join(" · "));
  }

  lines.push(
    `**Reporting period** ${day(report.periodFrom)} to ${day(report.generatedAt)}${report.dueAt ? ` · **Next deadline** ${when(report.dueAt)}` : ""}`,
    `**Report completed** ${when(report.generatedAt)}`,
    "",
    `${report.counts.settled} of ${report.counts.commitments} commitments settled. ` +
      `${report.counts.grants} authority ${report.counts.grants === 1 ? "grant" : "grants"} on file. ` +
      `${report.counts.audit} audit ${report.counts.audit === 1 ? "event" : "events"} recorded, ` +
      `including ${report.counts.refusals} ${report.counts.refusals === 1 ? "refusal" : "refusals"}.`,
    "",
    "## A. CASA activities",
  );

  lines.push("", "### Records reviewed", "");
  for (const item of report.recordsReviewed) lines.push(`- ${item}`);

  if (report.contacts.length > 0) {
    lines.push("", "### Collateral contacts", "");
    lines.push(
      ...table(
        ["Organisation", "Contact", "Requested", "Due", "Outcome"],
        report.contacts.map((item) => [
          item.organisation,
          item.contact || "—",
          day(item.requestedAt),
          day(item.dueAt),
          item.outcome,
        ]),
      ),
    );
  }

  blank(
    lines,
    "Child and family contacts",
    "Your visits with the child and contacts with the family. CaseRelay records agent outreach only.",
  );

  lines.push("", "## B. Findings", "", `### ${n.background}. Background`, "");
  lines.push(
    `${report.childName}${report.dateOfBirth ? `, born ${day(report.dateOfBirth)}` : ""}` +
      `${report.docketNumber ? `, docket ${report.docketNumber}` : ""}.`,
  );
  if (report.placement) {
    const { household, caregiver, placedAt } = report.placement;
    const parts = [
      household ? `${household} household` : "",
      caregiver ? `caregiver ${caregiver}` : "",
      placedAt ? `placed ${day(placedAt)}` : "",
    ].filter(Boolean);
    lines.push("", `**Current placement** ${parts.join(", ")}.`);
  }
  for (const item of BACKGROUND_BLANKS) blank(lines, item.heading, item.hint, "#### ");

  report.findings.forEach((finding, index) => {
    lines.push("", `### ${n.findings[index]}. ${finding.heading}`, "");
    const facts = [
      `**Status** ${finding.status}`,
      finding.organisation ? `**Service** ${finding.organisation}` : "",
      finding.dueAt ? `**Due** ${day(finding.dueAt)}` : "",
    ].filter(Boolean);
    lines.push(facts.join(" · "));
    if (finding.notes.length > 0) {
      lines.push("");
      for (const note of finding.notes) lines.push(`- ${note}`);
    }
  });

  if (n.outstanding !== null) {
    lines.push("", `### ${n.outstanding}. Outstanding at the close of this period`, "");
    lines.push(
      ...table(
        ["Service", "Status"],
        report.outstanding.map((item) => [item.label, item.status]),
      ),
    );
  }

  CLOSING_BLANKS.forEach((item, index) => {
    blank(lines, `${n.closing[index]}. ${item.heading}`, item.hint);
  });

  lines.push(
    "",
    "## Respectfully submitted",
    "",
    `**CASA volunteer** ${report.advocate} — signature ______________________ date __________`,
    "",
    `**CASA supervisor** ${report.supervisor} — signature ______________________ date __________`,
    "",
    "---",
    "",
    "## Appendix — CaseRelay accountability record",
    "",
    "*What the agent fleet was permitted to do on this case, and what it was refused.*",
  );

  if (report.organisations.length > 0) {
    lines.push("", "### A1. Organisations contacted", "");
    for (const org of report.organisations) lines.push(`- ${org}`);
  }

  if (report.grants.length > 0) {
    lines.push("", "### A2. Authority granted", "");
    lines.push(
      ...table(
        ["Granted to", "Purpose", "Status"],
        report.grants.map((item) => [item.grantedTo, item.purpose, item.status]),
      ),
    );
  }

  if (report.disclosed.length > 0 || report.withheld.length > 0) {
    lines.push("", "### A3. Data handling", "");
    if (report.disclosed.length > 0) lines.push(`**Released** ${report.disclosed.join(", ")}`);
    if (report.withheld.length > 0) {
      if (report.disclosed.length > 0) lines.push("");
      lines.push(`**Refused** ${report.withheld.join(", ")}`);
    }
  }

  if (report.decisions.length > 0) {
    lines.push("", "### A4. Decisions", "");
    lines.push(
      ...table(
        ["When", "Agent", "Event", "Verdict"],
        report.decisions.map((item) => [when(item.at), item.agent, item.type, item.verdict]),
      ),
    );
  }

  lines.push(
    "",
    "---",
    "",
    "*Sections A and B above are assembled from recorded case state. No part of this report is generated prose; the sections marked for the CASA volunteer are deliberately left blank.*",
  );

  return lines.join("\n");
}

/** A filename that sorts by case and says what it is. */
export function reportFilename(report: CaseReport, extension: string): string {
  const day = report.generatedAt.slice(0, 10);
  return `${report.caseId}-court-report-${day}.${extension}`;
}

export { when as formatReportDate, day as formatReportDay };
