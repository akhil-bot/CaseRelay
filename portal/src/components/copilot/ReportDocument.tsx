"use client";

import {
  BACKGROUND_BLANKS,
  CLOSING_BLANKS,
  formatReportDate,
  formatReportDay,
  sectionNumbers,
} from "@/lib/copilot/report";
import type { CaseReport } from "@/lib/copilot/report";
import { useReportStore } from "@/lib/copilot/report-store";

/**
 * A named blank, for the parts of a court report only the volunteer can write.
 *
 * On paper it gets ruled lines, because the likeliest thing to happen to a
 * printed draft is that someone completes it by hand on the way to a hearing.
 */
function Blank({
  heading,
  hint,
  level = 3,
}: {
  heading: string;
  hint: string;
  level?: 3 | 4;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <section className="print-blank">
      <Heading>{heading}</Heading>
      <p className="print-hint">{hint}</p>
      <p className="print-owed">To be completed by the CASA volunteer.</p>
      <div className="print-rule" />
      <div className="print-rule" />
      <div className="print-rule" />
    </section>
  );
}

/**
 * The report as a printable court document.
 *
 * Deliberately styled from `globals.css` rather than with the design tokens.
 * Everything else in the product is drawn for a screen — tinted surfaces,
 * hairlines at a fraction of a pixel, colour carrying meaning — and none of that
 * survives a printer. Paper gets black text, real margins and rules that are
 * actually visible, which is a different design rather than a variant of the
 * screen one. It also means the output does not change if the palette does.
 *
 * The order, the numbering and the omissions all come from `report.ts`, so this
 * and the `.md` download carry the same content in the same sequence.
 */
function ReportDocument({ report }: { report: CaseReport }) {
  const { counts } = report;
  const n = sectionNumbers(report);

  return (
    <article className="print-doc">
      <header>
        <h1>CASA court report — {report.childName}</h1>
        <dl className="print-meta">
          <div>
            <dt>Child</dt>
            <dd>{report.childName}</dd>
          </div>
          {report.dateOfBirth && (
            <div>
              <dt>Date of birth</dt>
              <dd>{formatReportDay(report.dateOfBirth)}</dd>
            </div>
          )}
          <div>
            <dt>Case</dt>
            <dd>{report.caseId}</dd>
          </div>
          {report.docketNumber && (
            <div>
              <dt>Docket</dt>
              <dd>{report.docketNumber}</dd>
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>{report.status}</dd>
          </div>
          <div>
            <dt>CASA volunteer</dt>
            <dd>{report.advocate}</dd>
          </div>
          <div>
            <dt>CASA supervisor</dt>
            <dd>{report.supervisor}</dd>
          </div>
          {report.judgeName && (
            <div>
              <dt>Judge</dt>
              <dd>{report.judgeName}</dd>
            </div>
          )}
          {report.appointedAt && (
            <div>
              <dt>CASA appointed</dt>
              <dd>{formatReportDay(report.appointedAt)}</dd>
            </div>
          )}
          <div>
            <dt>Reporting period</dt>
            <dd>
              {formatReportDay(report.periodFrom)} to {formatReportDay(report.generatedAt)}
            </dd>
          </div>
          {report.dueAt && (
            <div>
              <dt>Next deadline</dt>
              <dd>{formatReportDate(report.dueAt)}</dd>
            </div>
          )}
          <div>
            <dt>Report completed</dt>
            <dd>{formatReportDate(report.generatedAt)}</dd>
          </div>
        </dl>
        <p>
          {counts.settled} of {counts.commitments} commitments settled. {counts.grants} authority{" "}
          {counts.grants === 1 ? "grant" : "grants"} on file. {counts.audit} audit{" "}
          {counts.audit === 1 ? "event" : "events"} recorded, including {counts.refusals}{" "}
          {counts.refusals === 1 ? "refusal" : "refusals"}.
        </p>
      </header>

      <section className="print-part">
        <h2>A. CASA activities</h2>
      </section>

      <section>
        <h3>Records reviewed</h3>
        <ul>
          {report.recordsReviewed.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      {report.contacts.length > 0 && (
        <section>
          <h3>Collateral contacts</h3>
          <table>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Contact</th>
                <th>Requested</th>
                <th>Due</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {report.contacts.map((item, index) => (
                <tr key={`${item.organisation}-${index}`}>
                  <td>{item.organisation}</td>
                  <td>{item.contact || "—"}</td>
                  <td>{formatReportDay(item.requestedAt)}</td>
                  <td>{formatReportDay(item.dueAt)}</td>
                  <td>{item.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Blank
        heading="Child and family contacts"
        hint="Your visits with the child and contacts with the family. CaseRelay records agent outreach only."
      />

      <section className="print-part">
        <h2>B. Findings</h2>
      </section>

      <section>
        <h3>{n.background}. Background</h3>
        <p>
          {report.childName}
          {report.dateOfBirth && <>, born {formatReportDay(report.dateOfBirth)}</>}
          {report.docketNumber && <>, docket {report.docketNumber}</>}.
        </p>
        {report.placement && (
          <p>
            <strong>Current placement</strong>{" "}
            {[
              report.placement.household && `${report.placement.household} household`,
              report.placement.caregiver && `caregiver ${report.placement.caregiver}`,
              report.placement.placedAt && `placed ${formatReportDay(report.placement.placedAt)}`,
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </p>
        )}
      </section>

      {BACKGROUND_BLANKS.map((item) => (
        <Blank key={item.heading} heading={item.heading} hint={item.hint} level={4} />
      ))}

      {report.findings.map((finding, index) => (
        <section key={finding.domain}>
          <h3>
            {n.findings[index]}. {finding.heading}
          </h3>
          <p>
            <strong>Status</strong> {finding.status}
            {finding.organisation && (
              <>
                {" · "}
                <strong>Service</strong> {finding.organisation}
              </>
            )}
            {finding.dueAt && (
              <>
                {" · "}
                <strong>Due</strong> {formatReportDay(finding.dueAt)}
              </>
            )}
          </p>
          {finding.notes.length > 0 && (
            <ul>
              {finding.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {n.outstanding !== null && (
        <section>
          <h3>{n.outstanding}. Outstanding at the close of this period</h3>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.outstanding.map((item) => (
                <tr key={item.domain}>
                  <td>{item.label}</td>
                  <td>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {CLOSING_BLANKS.map((item, index) => (
        <Blank
          key={item.heading}
          heading={`${n.closing[index]}. ${item.heading}`}
          hint={item.hint}
        />
      ))}

      <section className="print-signatures">
        <h2>Respectfully submitted</h2>
        {[
          { role: "CASA volunteer", name: report.advocate },
          { role: "CASA supervisor", name: report.supervisor },
        ].map((signatory) => (
          <div key={signatory.role} className="print-signature">
            <p className="print-sign-role">
              {signatory.role} — {signatory.name}
            </p>
            <div className="print-sign-lines">
              <span>Signature</span>
              <span className="print-sign-date">Date</span>
            </div>
          </div>
        ))}
      </section>

      <section className="print-appendix">
        <h2>Appendix — CaseRelay accountability record</h2>
        <p>
          What the agent fleet was permitted to do on this case, and what it was refused.
        </p>
      </section>

      {report.organisations.length > 0 && (
        <section>
          <h3>A1. Organisations contacted</h3>
          <ul>
            {report.organisations.map((org) => (
              <li key={org}>{org}</li>
            ))}
          </ul>
        </section>
      )}

      {report.grants.length > 0 && (
        <section>
          <h3>A2. Authority granted</h3>
          <table>
            <thead>
              <tr>
                <th>Granted to</th>
                <th>Purpose</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.grants.map((item, index) => (
                <tr key={`${item.grantedTo}-${item.purpose}-${index}`}>
                  <td>{item.grantedTo}</td>
                  <td>{item.purpose}</td>
                  <td>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(report.disclosed.length > 0 || report.withheld.length > 0) && (
        <section>
          <h3>A3. Data handling</h3>
          {report.disclosed.length > 0 && (
            <p>
              <strong>Released</strong> {report.disclosed.join(", ")}
            </p>
          )}
          {report.withheld.length > 0 && (
            <p>
              <strong>Refused</strong> {report.withheld.join(", ")}
            </p>
          )}
        </section>
      )}

      {report.decisions.length > 0 && (
        <section>
          <h3>A4. Decisions</h3>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Agent</th>
                <th>Event</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {report.decisions.map((item, index) => (
                <tr key={`${item.at}-${index}`}>
                  <td>{formatReportDate(item.at)}</td>
                  <td>{item.agent}</td>
                  <td>{item.type}</td>
                  <td>{item.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer>
        Sections A and B are assembled from recorded case state. No part of this report is
        generated prose; the sections marked for the CASA volunteer are deliberately left blank.
      </footer>
    </article>
  );
}

/**
 * Where the printable document mounts.
 *
 * Present in the tree at all times and hidden on screen, so printing is a state
 * change rather than a window the browser might block. `@media print` in
 * `globals.css` then inverts the page: this node becomes the only thing on it.
 * `aria-hidden` because on screen it is not there — a screen reader should never
 * encounter a second copy of a report the person cannot see.
 */
export function ReportPrintRoot() {
  const { printing } = useReportStore();

  return (
    <div id="caserelay-print-root" aria-hidden="true">
      {printing && <ReportDocument report={printing} />}
    </div>
  );
}
