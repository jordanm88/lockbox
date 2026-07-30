Playwright catalog resolver

This folder contains a Playwright script to attempt automated discovery of direct archive URLs and SHA256 checksums for apps listed in `src-tauri/Resources/catalog.json`.

Prerequisites

- Node.js (16+)
- Install Playwright and its browsers:

```bash
npm i -D playwright
npx playwright install
```

Run

```bash
node scripts/playwright/resolve_catalog.js
```

Notes

- This script uses heuristics and may fail for sites that require interactive flows, CAPTCHAs, or blocked automation.
- Always verify computed SHA256 values before trusting them in the catalog.
