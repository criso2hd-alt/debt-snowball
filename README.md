# Debt Snowball

Debt Snowball is a privacy-first payoff-planning dashboard. It helps someone
track credit-card balances, visualize a debt-snowball plan, compare additional
monthly payments, and celebrate payoff milestones.

New installations start with a blank plan and contain no personal balances.
The hosted browser version stores edits with `localStorage`; the Windows LAN
executable stores one shared plan for authenticated users. Neither version
connects to banks or transmits card details.

## Current capabilities

- Dashboard summary with total debt, payoff progress, and the next focus debt
- Monthly balance check-in saved on the current device
- Snowball payoff and interest projections
- Adjustable extra-payment simulator
- Debt, goal, report, reminder, and settings views
- Responsive custom interface with no external component library

Some secondary controls are currently visual placeholders. Account creation,
full account editing, reminder delivery, authentication, and server-side data
persistence are not implemented yet.

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

- `app/page.tsx` — state, account editing, calculations, and interactions
- `app/globals.css` — visual system, animation, and responsive styling
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

The `test` command performs the production build and then verifies the rendered
Cloudflare Worker output.

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
