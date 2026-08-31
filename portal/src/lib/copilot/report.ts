import { DOMAIN_META } from "@/components/ui/primitives";
import { getCase, listAllCaseAudit, type AuditEvent, type LiveCaseDetail } from "@/lib/api";
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
 *
 * What is deliberately absent is the machinery. How CaseRelay reached a partner,
 * which agent held which grant, what a policy engine released or refused at the
 * field level — none of that goes to a judge. It is real and it is worth being
 * able to produce, but its reader is a supervisor auditing the system, and the
 * audit screen is where it lives. A filing that carries it teaches the court to
 * read past the parts that matter.
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

  /** What was read, and who was approached on the child's behalf. */
  recordsReviewed: string[];
  contacts: ReportContact[];

  /** One per service the case committed to, in the order a court report runs. */
  findings: ReportFinding[];
  /** Commitments still owed at the close of the period. */
  outstanding: ReportCommitment[];

  commitments: ReportCommitment[];
  counts: {
    commitments: number;
    settled: number;
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

/**
 * The footnote at the end of the filing.
 *
 * The claim worth making to a court is that nobody wrote this on the
 * volunteer's behalf, and that is said in those words. How the record was
 * gathered is a separate assurance, owed to a supervisor rather than a judge,
 * and the audit screen is where it is given.
 */
export const PROVENANCE =
  "Sections A and B are taken from the case record. Nothing in this report has been written on the volunteer's behalf; the sections marked for the CASA volunteer are deliberately left blank.";

/** Statuses that mean the commitment no longer needs chasing. */
const SETTLED = new Set(["completed", "verified", "closed"]);

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
 * Referral rows are written by more than one agent and the spellings have
 * drifted, so a report that read only one of them would print a blank beside a
 * fact the record actually holds.
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
 * A volunteer lists what they read, and this is the same list: the referral
 * packet the case began from and the replies that came back to it. Documents,
 * named the way a person would name them — not the log of how they were
 * obtained, which is a different question, asked by a different reader.
 */
function recordsReviewed(detail: LiveCaseDetail, seen: ReportContact[]): string[] {
  const packet = record(detail.case.referral_packet);
  const source = text(packet.source_document_ref);
  const reviewed = [source ? `Referral packet (${source})` : "Referral packet"];

  for (const contact of seen) {
    if (contact.outcome === "No response") continue;
    reviewed.push(`Response from ${contact.organisation}`);
  }
  return reviewed;
}

/**
 * What the log recorded against one service, newest first and deduplicated.
 *
 * Capped, because a chased partner can generate the same explanation weekly and
 * a court report is not a log. The audit screen carries every entry.
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
 * Assemble a report for one case. Two requests, in parallel: the case aggregate
 * and its audit log. Neither is cached — a report carries a generation time and
 * has to mean it.
 *
 * The log is read for what it says happened to each service, in the sentences
 * it recorded at the time. Its other half — who asked, under whose authority,
 * what was allowed — is not read here at all.
 */
export async function buildReport(caseId: string): Promise<CaseReport> {
  const [detail, events] = await Promise.all([getCase(caseId), listAllCaseAudit(caseId)]);

  const caseRecord = detail.case;
  const packet = record(caseRecord.referral_packet);
  const child = record(packet.child);
  const court = record(packet.court);

  const commitments: ReportCommitment[] = Object.entries(detail.commitments).map(
    ([domain, status]) => ({ domain, label: serviceLabel(domain), status }),
  );

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

    recordsReviewed: recordsReviewed(detail, seen),
    contacts: seen,
    findings: findings(detail, events),
    outstanding: commitments.filter((item) => !SETTLED.has(item.status)),

    commitments,
    counts: {
      commitments: commitments.length,
      settled: commitments.filter((item) => SETTLED.has(item.status)).length,
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

/**
 * The line under the header: where the case stands, in one sentence.
 *
 * It counts what was promised to a child and who was asked for it. Counting
 * events or refusals instead would answer a question about CaseRelay, and this
 * document is about a child.
 *
 * Shared by both renderers for the same reason the numbering is.
 */
export function summaryLine(report: CaseReport): string {
  const { settled, commitments } = report.counts;
  const owed = report.outstanding.length;
  const asked = report.contacts.length;

  const settledPart =
    `${settled} of ${commitments} ${commitments === 1 ? "commitment" : "commitments"} settled` +
    (owed > 0 ? `, ${owed} still owed at the close of this period.` : ".");

  if (asked === 0) return settledPart;
  return `${settledPart} ${asked} ${asked === 1 ? "organisation" : "organisations"} contacted.`;
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
 * legitimately has nobody to name yet.
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
    summaryLine(report),
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
    "Your visits with the child and your contacts with the family. Only the requests made to services are recorded above.",
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
    `*${PROVENANCE}*`,
  );

  return lines.join("\n");
}

/**
 * What a saved report is called: `<caseId>_<child>_court-report_<date>`.
 *
 * The case id leads so that a folder of these sorts by case, and the child's
 * name comes next because that is what the person hunting for the file actually
 * remembers. Anything a filesystem or a court's document store might refuse in
 * a name is replaced rather than dropped, so two children cannot quietly end up
 * sharing a filename.
 */
export function reportFileStem(report: CaseReport): string {
  const child = report.childName
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return [report.caseId, child || "child", "court-report", report.generatedAt.slice(0, 10)].join(
    "_",
  );
}

/** The same name, with the extension the download needs. */
export function reportFilename(report: CaseReport, extension: string): string {
  return `${reportFileStem(report)}.${extension}`;
}

export { when as formatReportDate, day as formatReportDay };
