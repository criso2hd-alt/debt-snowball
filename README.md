# Debt Snowball

Debt Snowball is a privacy-first payoff-planning dashboard. It helps someone
track credit-card balances, visualize a debt-snowball plan, compare additional
monthly payments, and celebrate payoff milestones.

New installations start with a blank plan and contain no personal balances.
The hosted browser version stores edits with `localStorage`; the Windows LAN
executable stores one shared plan for authenticated users. Neither version
connects to banks or transmits card details.

## Current capabilities

- **This month's payment list** — exactly what to send to each account, ordered
  by due date, split into required minimum and rolled-up extra
- **Full amortization schedule** — every month to payoff, with interest,
  principal, and remaining balance per account, expandable and exportable to CSV
- **Snowball or avalanche**, switchable, with a plain-English comparison of what
  the other order would cost or save
- **Payoff timeline** showing the attack order, when each account clears, the
  interest it costs, and what its payment rolls into next
- **Cardholders** — assign an owner to each account and report either as one
  household total or split per person: cards held, balance, share of the total,
  minimums, interest, and when that person's last card clears
- **Balance-over-time chart** comparing minimums-only, your current plan, and a
  larger payment, with labelled axes, a hover readout, and a marker on the month
  each account disappears
- Adjustable extra-payment simulator with the resulting date and interest
- Warnings when a payment level can never clear the debt, or when an account's
  minimum does not cover its own interest
- Account creation and editing, monthly balance check-in, due-date list
- Responsive custom interface with no external component library

Reminder delivery is a local display preference only — nothing is emailed or
texted. Authentication and shared persistence exist in the LAN executable, not
in the hosted browser build.

## How the projections are calculated

`app/lib/plan.ts` builds one complete month-by-month schedule and every figure
in the interface is read back out of it, so the headline numbers and the
schedule table can never disagree. Per month, in order:

1. Interest posts on the balance carried into the month at `APR ÷ 12`.
2. Each account receives its required minimum.
3. Everything left over goes to the current target; when a target clears
   mid-month, the remainder spills to the next one.

The attack order is fixed once at the start of the plan rather than re-sorted
each month, so the target does not flip mid-payoff. Arithmetic runs in whole
cents. A plan whose payments cannot outpace its interest is reported as such
instead of being silently truncated.

Per-cardholder figures are read out of that same shared schedule rather than
simulated per person. A household runs one snowball across everybody's cards,
so simulating each owner alone would describe a plan nobody is following.

Assumptions: fixed minimums, fixed APRs, monthly compounding, on-time payments,
and no new charges. Issuers commonly recalculate minimums as balances fall and
may compound daily, so real statements can differ slightly month to month.

`npm run test:plan` checks the engine against a closed-form amortization
result, verifies that total paid equals starting balance plus interest, and
covers the strategy ordering and edge cases.

## Technology

- Next.js 16 and React 19
- TypeScript
- Vinext and Vite
- Cloudflare Workers/Sites runtime
- Optional Cloudflare D1 support through Drizzle ORM

## Repository map

```text
app/                  Application UI, metadata, and styles
build/                Source for the Sites Vite integration (tracked)
db/                   Optional D1 database adapter and schema
drizzle/              Tracked database migration metadata
examples/d1/          Optional D1 example implementation
public/               Static assets
scripts/              Install, build, environment, and artifact helpers
tests/                Rendered-worker smoke tests
worker/               Cloudflare Worker entry point
.openai/hosting.json  Existing OpenAI Sites project identity
```

The main product code is currently concentrated in:

- `app/lib/plan.ts` — the payoff engine: amortization, strategies, due dates
- `app/components/TrajectoryChart.tsx` — the balance-over-time chart
- `app/components/Schedule.tsx` — the month-by-month amortization table
- `app/page.tsx` — state, account editing, views, and interactions
- `app/globals.css` — visual system, type scale, and responsive styling
- `app/layout.tsx` — document metadata and shared layout

## Local development

### Requirements

- Node.js 22.13 or newer
- npm
- Linux, WSL 2, or Git Bash for the repository's shell-based lifecycle scripts

Install the locked dependencies:

```bash
npm ci
```

Start the development server:

```bash
npm run dev
```

On Windows PowerShell without a Bash environment, start Vite directly:

```powershell
npx vite
```

See [LOCAL_SETUP.md](LOCAL_SETUP.md) for more local setup details.

## Windows LAN executable

Build the standalone Windows server:

```powershell
npm run build:exe
```

The resulting `release\DebtSquasher.exe` contains the browser application and
Node.js runtime. It starts a password-protected server on the local computer and
private network. See [LOCAL_EXECUTABLE.md](LOCAL_EXECUTABLE.md) for first-run
credentials, account management, data storage, recovery, and security notes.

## macOS LAN executables

Build both Mac architectures:

```powershell
npm run build:mac
```

This produces Apple Silicon and Intel `.tar.gz` packages under `release/`.
See [MAC_EXECUTABLE.md](MAC_EXECUTABLE.md) for architecture selection,
first-launch signing steps, storage locations, and network usage.

## Quality checks

```bash
npm run lint
npm test
npm run build
```

The `test` command runs the payoff-engine tests, performs the production build,
and then verifies the rendered Cloudflare Worker output. To run only the
calculation tests while iterating:

```bash
npm run test:plan
```

## Data and privacy

Dashboard changes use the browser key `debt-snowball-state`. The app currently
has no bank integration, card credential storage, analytics, or remote user
database.

Payoff figures are planning estimates. Actual interest and payoff timing can
vary by issuer, statement cycle, fees, and payment date.

## Hosting notes

The `.openai/hosting.json` file associates this checkout with its existing
OpenAI Sites project. Keep it when updating that project. Remove it only when
intentionally creating a separate, unconnected site.

The app runs on Vinext with a Cloudflare Worker entry point. Optional D1 and R2
bindings are declared through `.openai/hosting.json` and mirrored for local
development by `vite.config.ts`. The generated `.sites-runtime/`, `.wrangler/`,
`dist/`, and other output directories are disposable and ignored by Git.

The lifecycle helpers under `scripts/` target Linux and use tools such as GNU
`timeout` and `flock`. They provide bounded, validated dependency installation
and build behavior for the hosted environment.

## License

No open-source license has been selected. All rights are reserved unless a
license is added later.
