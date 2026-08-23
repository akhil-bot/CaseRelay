# CaseRelay Portal — UI prototype

Front-end only. Every case, child, partner organization, court order, agent, and trace on these
screens is synthetic and hard-coded in `src/lib/mock/`. There is no backend, no network call, and
no deployed agent behind this build.

## Run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4. No component library, no icon
library, no other runtime dependencies.

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
  explicit "what CaseRelay will not do" list, and the synthetic-data notice. Collapses into a
  drawer below `lg`.
- **Header** (`shell/Header.tsx`) — page title and subtitle derived from the route, search, the
  scenario clock, notifications, an activity-panel toggle, and the profile menu.
- **Body** — the routed page, keyed on pathname so tab switches animate in.
- **Activity panel** (`shell/ActivityPanel.tsx`) — agent spans, trace ID, and capability proof,
  dismissible from the header.

## Screens

| Route            | Screen       | What it shows                                                             |
| ---------------- | ------------ | ------------------------------------------------------------------------- |
| `/`              | Overview     | Greeting, four metrics, what needs attention, what the fleet did unprompted |
| `/cases`         | Cases        | Searchable, filterable, sortable caseload with progress per case          |
| `/cases/:caseId` | Case detail  | Commitments, owners, evidence, authority grant, gateway projection        |
| `/approvals`     | Approvals    | Recipient, disclosed and withheld fields, evidence, policy basis, draft   |
| `/registry`      | Agents       | Eight agent cards with owner, version, tools, scopes, health              |
| `/audit`         | Activity log | One correlated trace of spans plus the policy decision log                |

## Scenario clock

The whole portal is driven by one number: the active demo step. The clock in the header steps
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
