# feishu-app-admin

An unofficial, declarative CLI for administering Feishu and Lark developer
applications without repeatedly clicking through the developer console.

The CLI is the product. It runs directly from a terminal and has no dependency
on Codex or any agent framework. An optional Markdown-only agent skill is
included under [`skills/feishu-app-admin`](skills/feishu-app-admin).

> [!WARNING]
> Feishu/Lark does not expose a complete supported API for developer-console
> administration. This project uses the same undocumented `/developers/v1`
> backend as the web console. Review manifests carefully and expect upstream
> endpoint changes.

## Features

- List and inspect applications, including event, callback, bot, and external
  sharing settings.
- Create apps, upload icons, retrieve App Secrets, and enable bot capability.
- Add or remove precise tenant/user permissions and event subscriptions.
- Configure webhook or WebSocket delivery, create versions, and submit them.
- Keep multiple browser-authenticated accounts in separate persistent profiles.
- Auto-detect Chrome/Edge and protect local state on Linux, macOS, and Windows.
- Diagnose Node, browser, state, and profile readiness without opening a browser.
- Plan declarative changes before execution and redact sensitive output.
- Use `raw.request` only as a restricted fallback for unsupported settings.

## Requirements

- Node.js 22 or later
- Google Chrome, Chromium, or Microsoft Edge
- A Feishu or Lark developer account

There are no runtime npm dependencies.

Pure CLI behavior is tested on Linux, macOS, and Windows in GitHub Actions.
Authenticated browser integration is verified on Linux; platform-specific
browser policies, proxies, and enterprise security software can still require
`--chrome` or `FEISHU_APP_ADMIN_HOME`. Run `feishu-app-admin doctor` first. See
[Platform support](docs/platform-support.md) for details.

## Install

Install directly from GitHub:

```bash
npm install --global github:gih10012/feishu-app-admin
feishu-app-admin --version
```

On Linux/macOS, if the system npm prefix is not writable, install without sudo:

```bash
npm install --global github:gih10012/feishu-app-admin --prefix ~/.local
```

Ensure `~/.local/bin` is on `PATH`.

Hardened npm 12 installations may disable Git dependencies by default and
return `EALLOWGIT`. Allow this explicit GitHub install for that invocation:

```bash
npm install --global github:gih10012/feishu-app-admin --allow-git=all
```

For development:

```bash
git clone https://github.com/gih10012/feishu-app-admin.git
cd feishu-app-admin
npm install
npm link
```

## Environment check

Run this before the first login:

```bash
feishu-app-admin doctor
```

`doctor` checks the Node runtime, browser discovery, native state directory,
and its protection model. It does not launch a browser, log in, or contact
Feishu/Lark. Pass `--chrome <path>` when using a portable or enterprise-managed
browser, and optionally pass `--profile-dir <path>` to inspect an existing
profile.

For a deeper local check, run `feishu-app-admin doctor --browser-smoke`. This
launches one temporary headless browser, verifies the DevTools Protocol, closes
the entire browser process tree, and deletes the temporary profile. It still
does not log in or contact Feishu/Lark.

## First login

Use a dedicated profile. The CLI opens one browser window for interactive login
and closes it automatically after capturing the portal session:

```bash
feishu-app-admin apps \
  --profile-dir ~/.local/state/feishu-app-admin/profiles/work \
  --show-browser
```

Later commands reuse that profile headlessly and do not open a visible window:

```bash
feishu-app-admin apps \
  --profile-dir ~/.local/state/feishu-app-admin/profiles/work
```

Use a different directory for every account. Do not run multiple profile-backed
Chrome instances concurrently.

On Windows PowerShell:

```powershell
$profile = Join-Path $env:LOCALAPPDATA "feishu-app-admin\profiles\work"
feishu-app-admin doctor --profile-dir $profile
feishu-app-admin apps --profile-dir $profile --show-browser
```

## Direct commands

```bash
# List apps
feishu-app-admin apps --reuse-session

# List and inspect every app without raw.request
feishu-app-admin apps --inspect --reuse-session

# Include complete portal app records when needed
feishu-app-admin apps --inspect --full --reuse-session

# Inspect selected settings for one app
feishu-app-admin inspect \
  --app-id cli_xxx \
  --sections event,callback,bot,external-sharing \
  --reuse-session

# Discover manifest actions and risk classes
feishu-app-admin actions
```

Inspection output is normalized and concise by default. Add `--event-details`
only when the complete event catalog and scope metadata are needed.

## Declarative changes

Write an ordered JSON manifest, validate it, inspect its plan, then apply it:

```bash
feishu-app-admin validate --manifest examples/create-websocket-bot.json
feishu-app-admin plan --manifest examples/create-websocket-bot.json
feishu-app-admin apply \
  --manifest examples/create-websocket-bot.json \
  --profile-dir ~/.local/state/feishu-app-admin/profiles/work \
  --yes
```

`--yes` is required for manifests containing writes. It means the caller has
already reviewed and authorized those writes; the CLI does not prompt
interactively.

See [Manifest reference](docs/manifest.md) for every high-level action and
[Portal API notes](docs/portal-api.md) for endpoint status and troubleshooting.

## State and secrets

Default state directories follow each operating system:

| Platform | Directory |
| --- | --- |
| Linux | `${XDG_STATE_HOME:-~/.local/state}/feishu-app-admin` |
| macOS | `~/Library/Application Support/feishu-app-admin` |
| Windows | `%LOCALAPPDATA%\feishu-app-admin` |

Set `FEISHU_APP_ADMIN_HOME` to override it. `--reuse-session` uses a dedicated
profile below this directory. App Secrets are stored under `apps/<app-id>.json`.
Linux/macOS use directory mode `0700` and file mode `0600`; Windows removes ACL
inheritance and grants full control to the current user, SYSTEM, and local
Administrators. Secrets, cookies, CSRF values, verification tokens, and
encryption keys are redacted from JSON output.

## Agent use

The optional skill contains instructions and safety rules, not a second copy of
the CLI. Install the CLI first, then copy or install
[`skills/feishu-app-admin`](skills/feishu-app-admin) into the agent's skill
directory. See [Agent integration](docs/agent-usage.md).

To let Codex perform the complete installation, paste this prompt into a Codex
session:

> Install `feishu-app-admin` and its optional Codex skill from
> `https://github.com/gih10012/feishu-app-admin` at tag `v0.4.0`. Detect the
> operating system and shell first, verify Node.js 22 or later and a supported
> Chrome/Chromium/Edge installation, then install the CLI with
> `npm install --global github:gih10012/feishu-app-admin#v0.4.0`. If the npm
> global prefix is not writable, choose a user-writable prefix appropriate for
> this Linux, macOS, or Windows environment and ensure its executable directory
> is on `PATH`; if npm reports `EALLOWGIT`, retry this explicit repository
> install with `--allow-git=all`. Use the `skill-installer` skill to install the
> Codex skill from repository `gih10012/feishu-app-admin`, ref `v0.4.0`, path
> `skills/feishu-app-admin`. Finally verify `feishu-app-admin --version`, run
> `feishu-app-admin doctor --browser-smoke`, confirm the skill files are present,
> and tell me whether Codex must be restarted to discover the new skill. Resolve
> ordinary platform and `PATH` compatibility issues yourself. Do not delete or
> overwrite existing profiles, do not print secrets, and do not open a login
> browser unless I explicitly ask you to authenticate.

## Status

This project is experimental because the developer-console backend is private
and unstable. Read operations are safer than writes. Never blindly retry app or
version creation after a partial failure.

## License

[MIT](LICENSE)
