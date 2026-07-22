# Architecture

## CLI first

`src/cli.mjs` contains the executable implementation. `bin/feishu-app-admin.mjs`
is a small package entry point. The CLI does not import, discover, or depend on
anything under `skills/`.

The optional skill is an adapter in the other direction: it teaches an agent to
locate the installed `feishu-app-admin` command, choose high-level actions, and
honor the CLI's authorization and browser-profile rules.

## Execution flow

1. Parse a direct command or JSON manifest.
2. Validate operations and classify their risk without opening a browser.
3. Require `--yes` when a manifest contains writes.
4. Launch Chrome/Edge with a dedicated user-data directory.
5. Capture the authenticated developer-console request headers through Chrome
   DevTools Protocol.
6. Execute high-level operations sequentially through the portal client.
7. Redact structured output and close the browser process.

## Authentication

No password, cookie, or CSRF value is accepted as a CLI argument. A first login
uses one visible browser window. A retained profile runs with `--headless=new`
unless `--show-browser` is explicitly supplied.

The script implements the required Chrome DevTools Protocol subset directly and
uses only Node.js standard APIs. It does not depend on Puppeteer or Playwright.

## API boundary

All developer-console requests are restricted to the selected Feishu/Lark host
and `/developers/v1`. High-level actions cover known operations. `raw.request`
rejects absolute URLs and path traversal and remains a last-resort escape hatch.
