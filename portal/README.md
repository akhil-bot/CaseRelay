# CaseRelay Portal

The portal runs locally via `npm run dev` and is not deployed (`caserelay-portal.web.app` is not
live). It reaches the deployed control plane through a BFF proxy
(`src/app/api/control-plane/[...path]/route.ts`) that mints Google-signed ID tokens server-side —
no credential is exposed to the browser. SSE endpoints are proxied with incremental delivery.

Some screens still render from `src/lib/mock/` for layout prototyping. The chat panel requires a
configured agent backend — see "Chat: CopilotKit and the ADK agent" below.

Persona switching (advocate vs. platform view) is UI-only and carries no authentication or
access-control implications. There is no end-user authentication.

## Run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4. No component library and no icon
library; the only runtime dependencies are CopilotKit and the AG-UI client that back the chat panel.

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

- **Sidebar** (`shell/Sidebar.tsx`) — logo, primary nav with icons and an approval count badge, the
  explicit "what CaseRelay will not do" list, and the demo scaffolding at the foot: the scenario
  clock and the synthetic-data notice. Collapses into a drawer below `lg`.
- **Header** (`shell/Header.tsx`) — page title and subtitle derived from the route, search,
  notifications, an activity-panel toggle, and the profile menu. Switching between the advocate and
  platform views lives inside the profile menu.
- **Body** — the routed page, keyed on pathname so tab switches animate in.
- **Activity panel** (`shell/ActivityPanel.tsx`) — agent spans, trace ID, and capability proof,
  dismissible from the header.
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

## Chat: CopilotKit and the ADK agent

The chat panel is wired with [CopilotKit](https://copilotkit.ai), which speaks
[AG-UI](https://docs.ag-ui.com/) — the same protocol Google ADK exposes through the `ag_ui_adk`
middleware.

| Mode             | When                            | Path                                                             |
| ---------------- | ------------------------------- | ---------------------------------------------------------------- |
| **ADK**          | `NEXT_PUBLIC_ADK_AGENT_URL` set | Browser → `/api/copilotkit` → `HttpAgent` → the control plane's `/agui` endpoint |
| **Unconfigured** | Not set                         | Disabled indicator; no input box, no agent                        |

- `src/lib/copilot/config.ts` — agent id and whether the runtime is available
- `src/app/api/copilotkit/route.ts` — `CopilotRuntime` forwarding to the ADK endpoint
- `src/components/copilot/` — the provider, the sidebar, and the slot overrides

To connect the backend, copy `.env.local.example` to `.env.local` and set
`NEXT_PUBLIC_ADK_AGENT_URL` to the control plane's `/agui` endpoint. No API key required.

What the agent can see is deliberately narrow. `useAgentContext` publishes three one-way values —
the current route and role, a caseload count summary, and the scenario clock position — so a
question like "what is overdue here" resolves without restating it. No narrative detail from a
child's record crosses that channel.

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

The whole portal is driven by one number: the active demo step. The clock in the sidebar footer steps
through the eight beats of the demo script (Day 0 intake → Day 17 wake → quarantine → approval →
Day 18 callback), and each screen derives what it renders from that step.

- `src/lib/mock/steps.ts` — the eight steps and their narration
- `src/lib/derive.ts` — pure functions mapping a step to cases, commitments, activity, policy
  decisions, capability proofs, and pending approvals
- `src/lib/demo-store.tsx` — client-side step state, autoplay, and supervisor approval decisions

Approving `AP-8802` in Approvals advances the clock to the callback step, so the human-in-the-loop
moment drives the rest of the scenario.

## Boundaries baked into the UI

CaseRelay tracks whether an authorized next step has an owner. It makes no placement,
reunification, custody, safety-risk, legal, clinical, treatment, or eligibility decisions, and
every outbound action is gated on a human. The screens state this rather than implying it.
