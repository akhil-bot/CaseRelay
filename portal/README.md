# CaseRelay Portal

The portal runs locally via `npm run dev` and is deployed to Cloud Run as `caserelay-portal` by
`infra/deploy_portal.sh` (Firebase Hosting is not used — `caserelay-portal.web.app` is not live).
It reaches the control plane through a BFF proxy
(`src/app/api/control-plane/[...path]/route.ts`) that mints Google-signed ID tokens server-side —
no credential is exposed to the browser. SSE endpoints are proxied with incremental delivery.

Some screens still render from `src/lib/mock/` for layout prototyping. The chat panel requires a
configured agent backend — see "Chat: CopilotKit and the ADK agent" below.

Persona switching between the three views (advocate, supervisor, admin) is UI-only and carries no
authentication or access-control implications. The sign-in screen under `/login` has no auth backend
in this tree — `src/components/auth/useSignIn.ts` says so — it writes the chosen persona to
`sessionStorage`/`localStorage` and navigates.

`src/middleware.ts` is an HTTP Basic gate for restricted deployments: one shared credential, no
session store, and a matcher covering `/api` as well as the pages so the BFF proxy is not left
outside it. `infra/deploy_portal.sh` sets `PORTAL_AUTH_USER` and mounts `PORTAL_AUTH_PASSWORD` from
Secret Manager. Per the root [README](../README.md#submission-at-a-glance) it is not enabled on the
judging revision, which serves a session login page instead — so check the README before telling
anyone how to get in.

## Run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`. Run them from this directory.
The npm scripts resolve the wrong `package.json` when invoked from a workspace rooted above
`portal/`, so for static checks call the binaries directly instead:
`./node_modules/.bin/tsc --noEmit` and `npx eslint .`.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4. No component library and no icon
library. Runtime dependencies are CopilotKit and the AG-UI client behind the chat panel, plus
`google-auth-library` and `@vercel/oidc` for the BFF's token minting and `rxjs`.

## Design tokens

Styling has exactly two sources of truth and components read from them rather than inventing values.

1. **`src/app/globals.css`** — the `@theme` block holds every raw value: colours, radii, shadows,
   fonts. It is the only place a literal hex or pixel radius appears.
2. **`src/design/tokens.ts`** — the semantic layer. It maps those values onto UI roles: `surface`
   (card, inset, pop), `type` (the whole type scale), `control` (button, chip, input recipes), and
   `tone` (the six semantic tones every status, flag, and outcome resolves to).

Palette rule: two accent families only — brand blue for identity, navigation, and progress; amber
and red for attention and refusal — plus a deep navy "seal" for finished work. No greens, no
purples. Changing a colour anywhere in the product means editing one of those two files.

Icons are inline stroked SVG in `src/components/icons.tsx`, inheriting `currentColor` so they always
pick up the token colour of whatever they sit in.

## Layout

`src/components/AppShell.tsx` composes the chrome:

- **Sidebar** (`shell/Sidebar.tsx`) — logo, then the nav for every persona in `src/design/personas.ts`
  with CSS revealing the one signed in, icons, and an approval count badge fed by
  `useLiveApprovals`. At the foot, the standing "why you're here" note from `src/design/copy.ts`.
  Collapses into a drawer below `lg`.
- **Header** (`shell/Header.tsx`) — page title and subtitle derived from the route, notifications,
  and the profile menu. Switching persona lives inside the profile menu.
- **Body** — the routed page.
- **Chat panel** (`copilot/CaseRelayCopilot.tsx`) — CopilotKit sidebar, opened from its own toggle.

## Screens

| Route            | Screen       | What it shows                                                             |
| ---------------- | ------------ | ------------------------------------------------------------------------- |
| `/`              | Overview     | Greeting, four metrics, what needs attention, what the fleet did unprompted |
| `/cases`         | Cases        | Searchable, filterable, sortable caseload with progress per case          |
| `/cases/:caseId` | Case detail  | Commitments, owners, evidence, authority grant, gateway projection        |
| `/approvals`     | Approvals    | Recipient, disclosed and withheld fields, evidence, policy basis, draft   |
| `/registry`      | Agents       | Eight agent cards with owner, version, tools, scopes, health              |
| `/audit`         | Activity log | One correlated trace of spans plus the policy decision log                |
| `/admin`         | Synthetic data lab | Create a case from a named scenario, run the fleet, watch the event stream |
| `/guidelines`    | Guidelines   | What CaseRelay is for and what it will not decide                          |
| `/login`         | Sign in      | Persona picker; no auth backend in this tree (see the note above)          |

`/cases`, `/cases/:caseId`, `/approvals`, `/registry`, `/audit` and `/admin` read the control plane
through the BFF proxy. `/` and `/guidelines` render from `src/lib/mock/`, and `/cases/:caseId` mixes
live run data with mock policy fixtures.

## Chat: CopilotKit and the ADK agent

The chat panel is wired with [CopilotKit](https://copilotkit.ai), which speaks
[AG-UI](https://docs.ag-ui.com/) — the same protocol Google ADK exposes through the `ag_ui_adk`
middleware.

| Mode             | When                                    | Path                                                             |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------- |
| **ADK**          | `NEXT_PUBLIC_COPILOT_ENABLED=true`      | Browser → `/api/copilotkit` → `HttpAgent` → the control plane's `/agui` endpoint |
| **Unconfigured** | Any other value, or unset               | Disabled indicator; no input box, no agent                        |

- `src/lib/copilot/config.ts` — agent id and whether the runtime is available
- `src/app/api/copilotkit/route.ts` — `CopilotRuntime` forwarding to the ADK endpoint
- `src/components/copilot/` — the provider, the sidebar, and the slot overrides

To connect the backend, copy `.env.local.example` to `.env.local` and set
`NEXT_PUBLIC_COPILOT_ENABLED=true`. The agent URL is derived from `CONTROL_PLANE_URL` server-side
in the route handler, so the browser never sees it and no API key is required.

What the agent can see is deliberately narrow. `useAgentContext` publishes four one-way values —
the current view and signed-in role, a caseload count summary, where the caseload stands on the
timeline, and a name-to-case-id map for cases opened in this conversation so pronouns resolve — so
a question like "what is overdue here" works without restating it. Nothing else from a child's
record crosses that channel.

### Why the chat looks like the rest of the app

CopilotKit is used for transport and message state only; everything visible is replaced. Its v2
components take a slot per sub-element, and a slot accepts a className, a props object, or a whole
component — that is the seam `src/components/copilot/chat-parts.tsx` works through.

- **Theme** — CopilotKit is styled by a shadcn-style token set (`--primary`, `--muted`, `--border`)
  plus the raw `--cpk-*` palette its utilities compile against. `globals.css` repoints both at the
  CaseRelay tokens under `html [data-copilotkit]`, a selector chosen to outrank the package's own
  declarations regardless of stylesheet order. The emerald ramp maps onto `seal`: the two-accent
  palette rule holds inside the panel too.
- **Removed** — file attachments, the microphone and transcription, thumbs-up/down feedback,
  read-aloud, regenerate, and the CopilotKit inspector and intelligence indicator. What is left is
  a message list, a copy button, and a text box.
- **Avatar** — the CaseRelay shield, not a face. A person doodle would imply someone is answering,
  and the claim here is the opposite: the agents carry paperwork forward and a human still decides.
- **Header** — the mark, who is answering, and a standing "decides nothing" line. That bound is
  chrome rather than a one-time greeting so it is still on screen at the tenth question.

## Scenario clock

The scripted screens are driven by one number: the active demo step. It walks the eight beats of
the demo script (Day 0 intake → Day 17 wake → quarantine → approval → Day 18 callback), and the
overview and case detail pages derive part of what they render from it.

- `src/lib/mock/steps.ts` — the eight steps and their narration
- `src/lib/derive.ts` — pure functions mapping a step to cases, commitments and activity
- `src/lib/demo-store.tsx` — client-side step state and autoplay
- `src/components/shell/ScenarioControl.tsx` — the stepper UI, currently not mounted in the shell,
  so the clock stays on step 0 unless a caller advances it

Approvals are not part of this: pending approvals and the supervisor decision come from the control
plane through `src/lib/live-approvals.tsx`, so the human-in-the-loop moment is a real API call and
not a clock advance.

## Boundaries baked into the UI

CaseRelay tracks whether an authorized next step has an owner. It makes no placement,
reunification, custody, safety-risk, legal, clinical, treatment, or eligibility decisions, and
every outbound action is gated on a human. The screens state this rather than implying it.
