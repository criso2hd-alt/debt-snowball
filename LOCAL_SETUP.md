# Debt Snowball — Local Setup

This package contains the complete source for the Debt Snowball app.

## Recommended environment

- Node.js 22.13 or newer
- npm
- Linux, WSL 2, or Git Bash
- Codex opened from the project folder

## Start locally

1. Extract the ZIP.
2. Open a terminal in the extracted `debt-snowball-source` folder.
3. Install the locked dependencies:

   ```bash
   npm ci
   ```

4. Start the local development server:

   ```bash
   npm run dev
   ```

5. Open the local address printed by the development server.

If the shell-specific `npm run dev` command does not work in Windows
PowerShell, use WSL 2 or run:

```bash
npx vite
```

## Open with Codex

Open this extracted folder as the working project for Codex. The main app files
are:

- `app/page.tsx` — application UI, account editing, calculations, and interactions
- `app/globals.css` — complete visual design, animation, and responsive styling
- `app/layout.tsx` — page metadata and shared layout

Ask Codex to inspect the project before making changes, preserve the existing
visual system, and run the relevant checks after each coherent feature.

## Useful checks

```bash
npm run lint
npm test
npm run build
```

## Data and privacy

The current app stores its editable dashboard state in the browser on the local
device. It does not connect to banks or store card credentials.

## Hosting identity

The included `.openai/hosting.json` identifies the existing ChatGPT Site. Keep
it if you want Codex to recognize and update that same hosted project. Remove
the file only if you intentionally want to turn this into a separate,
unconnected project.
