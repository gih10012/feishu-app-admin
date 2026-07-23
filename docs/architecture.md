# Architecture

## CLI first

`bin/feishu-app-admin.mjs` is a small package entry point. `src/cli.mjs` only
parses commands and routes them to focused modules. The CLI does not import,
discover, or depend on anything under `skills/`.

The optional skill is an adapter in the other direction: it teaches an agent to
locate the installed `feishu-app-admin` command, choose high-level actions, and
honor the CLI's authorization and browser-profile rules.

## Modules

| Module | Responsibility |
| --- | --- |
| `constants.mjs` | Portal hosts, versions, actions, and risk metadata |
| `manifest.mjs` | Validation, planning, and template resolution |
| `platform.mjs` | Native paths, browser discovery, permissions, and process cleanup |
| `browser.mjs` | Chrome lifecycle, CDP, login detection, and session capture |
| `portal-client.mjs` | Restricted `/developers/v1` HTTP client and uploads |
| `operations.mjs` | High-level developer-console actions |
| `runner.mjs` | Ordered manifest execution and partial-failure reporting |
| `doctor.mjs` | Offline environment diagnostics |
| `output.mjs` | Structured output and recursive redaction |
| `cli.mjs` | User-facing command routing |

## Execution flow

1. Parse a direct command or JSON manifest.
2. Validate operations and classify their risk without opening a browser.
3. Require `--yes` when a manifest contains writes.
4. Launch Chrome/Edge with a dedicated user-data directory.
5. Capture the authenticated developer-console request headers through Chrome
   DevTools Protocol.
6. Execute high-level operations sequentially through the portal client.
7. Redact structured output and close the browser process.

Platform-specific behavior stays in `platform.mjs`. Operations and portal
request shapes do not branch on the host operating system.

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
