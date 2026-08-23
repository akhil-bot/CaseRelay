# CaseRelay

**No child's next step should disappear between systems.**

CaseRelay is a governed multi-agent fleet that helps CASA/GAL programs detect stalled services, coordinate minimum-necessary follow-up across agencies, and escalate missing handoffs — without making decisions about children.

Built for the [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com/) using Google ADK, Vertex AI Gemini, and the Gemini Enterprise Agent Platform (GEAP).

---

## The Problem

When a child in foster care is referred to a school, a healthcare provider, a shelter, and a legal-aid organization simultaneously, no single system tracks whether all of those commitments were actually acted on. A referral can sit unowned for weeks. A court-appointed volunteer manually chases down each partner. Handoffs disappear not through negligence, but through lack of coordination infrastructure.

CaseRelay closes that gap with an accountable, audited agent fleet — one where every agent has a visible owner, a bounded data scope, and a human-in-the-loop for consequential decisions.

---

## Hackathon Track

**Fortified Enterprise Fleet** — demonstrating Agent Registry, Agent Runtime, Memory Bank, Agent Identity, Agent Gateway, Model Armor, and Agent Observability running together on Google Cloud.

---

## Architecture

```
CASA Volunteer / Supervisor
        │
        ▼
  CaseRelay Portal (Next.js)
        │
        ▼
  Cloud Run API (FastAPI / Python)
        │
        ├─► Intake & Authority Agent  ──► Firestore (case state)
        │                                       │
        │                              Pub/Sub Events ◄── Cloud Tasks (scheduler)
        │                                       │
        ▼                                       ▼
  Continuity Orchestrator ◄────────── Agent Registry
        │
        ▼
  Agent Gateway  ──► Education Agent ──┐
                 ──► Health Agent     ──┤
                 ──► Legal Agent      ──┼──► Model Armor ──► Safeguarding Verifier
                 ──► Shelter Agent    ──┤                          │
                 ──► Family Services  ──┘                          ▼
                                                        Human Approval Queue
                                                                   │
                                                          Firestore / Audit Log
```

**Technology stack:**

| Layer | Technology |
|---|---|
| Agent runtime | Google ADK, Gemini 2.5 Flash (Vertex AI) |
| Backend API | Python, FastAPI, Cloud Run |
| Portal | Next.js, TypeScript |
| State | Firestore |
| Events / scheduling | Pub/Sub, Cloud Tasks |
| Secrets | Secret Manager |
| Storage | Cloud Storage |
| Observability | Cloud Logging, Cloud Trace, GEAP Agent Observability |
| Security | GEAP Model Armor, Safeguarding Verifier (deterministic policy) |

---

## Agent Fleet

Eight agents, each with a distinct Google service-account identity and a scoped data projection:

| Agent | Owner | Scope |
|---|---|---|
| Continuity Orchestrator | CASA program | Operational facts only; never raw partner records |
| Intake & Authority Agent | CASA program | Extracts commitments; cannot activate without supervisor |
| Education Liaison Agent | Simulated school district | Enrollment status only; no health/legal/family data |
| Health Coordination Agent | Simulated healthcare provider | Appointment status only; no diagnoses or clinical notes |
| Legal Aid Agent | Simulated legal-aid org | Referral/status only; no legal advice or strategy |
| Shelter Status Agent | Simulated shelter | Availability/status only; cannot rank placements |
| Family Services Agent | Simulated child-welfare agency | Scheduling/status only; no risk scores or findings |
| Safeguarding Verifier | CASA compliance | Policy enforcement; cannot approve its own actions |

---

## Core Scenario

**Case CR-1042 — Maya's stalled school enrollment**

1. Supervisor activates monitoring after verifying court authority.
2. Orchestrator discovers partner agents through the Registry and delegates scoped tasks.
3. Legal completes. Healthcare schedules. Education goes 17 days without a verified owner.
4. A Cloud Tasks event wakes the dormant workflow — no user prompt, no open browser.
5. The Education Agent requests only enrollment-status fields through the Gateway.
6. A malicious school response tries to retrieve medical notes; Model Armor quarantines it.
7. The Safeguarding Verifier creates a safe retry and records every withheld field.
8. CaseRelay drafts an escalation showing evidence, recipient, policy basis, and withheld fields. A supervisor approves.
9. The school confirms enrollment. The same workflow resumes idempotently, closes the commitment, and updates Maya's timeline.

---

## GEAP Capabilities Demonstrated

- **Agent Registry** — versioned cards and live discovery for all eight agents
- **Agent Runtime** — durable execution with checkpoint, sleep, and deadline-triggered resume
- **Memory Bank** — scoped cross-session operational memory keyed by case and purpose
- **Agent Identity** — distinct service account per organizational agent; cross-scope request denied
- **Agent Gateway** — caller authentication, registry routing, purpose-bound field projection
- **Model Armor** — prompt-injection quarantine and safe retry on poisoned partner payload
- **Agent Observability** — one trace ID connects Registry, Runtime, Memory, Identity, Gateway, Model Armor, approval, and completion

---

## Portal Screens

1. **Case Inbox** — overdue, blocked, approval-needed, and recently completed cases
2. **Continuity Timeline** — commitments, owners, evidence, deadlines, handoffs
3. **Approval Center** — proposed action, evidence, disclosed/withheld fields, policy basis
4. **Agent Registry** — owner, version, purpose, tools, scopes, endpoint, health
5. **Audit Trace** — correlated delegation, access, model/tool calls, retry, approval, completion events

---

## Boundaries (What CaseRelay Does Not Do)

- No placement, custody, safety-risk, clinical, or eligibility decisions
- No real child data and no claim of CASA endorsement
- No replacement for existing case-management systems (Optima, Casebook, state systems)
- No unrestricted cross-agency child profile
- No autonomous emergency response

---

## Local Setup

**Prerequisites:** Python 3.12+, `uv`, Google Cloud project with GEAP access, `gcloud` CLI authenticated.

```bash
git clone https://github.com/<your-org>/caserelay.git
cd caserelay
uv sync                       # installs from pyproject.toml into .venv
source .venv/bin/activate
```

Set the required environment variables (see `.env.example`), then run the full local journey:

```python
# In a Python shell with PYTHONPATH=.
from backend.runtime.fleet import run_maya
out = run_maya()
```

For cloud testing, source the fleet endpoints and use the CLI:

```bash
source infra/fleet_endpoints.env
python infra/case_cli.py ls
```

Full instructions, expected outputs, and the deploy procedure are in **[docs/caserelay-walkthrough.md](docs/caserelay-walkthrough.md)**.

---

## Submission Details

| Field | Value |
|---|---|
| Project name | CaseRelay |
| Hackathon | All Things Agentic (Google) |
| Track | Fortified Enterprise Fleet |
| Demo duration | ≤ 3:50 |
| Demo language | English (with captions) |
| Cloud platform | Google Cloud (Cloud Run, Firestore, Pub/Sub, Vertex AI, GEAP) |

Official rules, submission checklist, scoring mechanism, and judging criteria are mirrored in
[docs/hackathon-rulebook.md](docs/hackathon-rulebook.md).

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
