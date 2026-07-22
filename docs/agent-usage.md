# Agent integration

The repository ships a Markdown-only skill at
`skills/feishu-app-admin`. It is intentionally separate from the executable.

## Install the CLI

```bash
npm install --global github:gih10012/feishu-app-admin
command -v feishu-app-admin
```

Use `--prefix ~/.local` when the system npm prefix is not writable and confirm
that `~/.local/bin` is on `PATH`. On hardened npm 12 configurations that return
`EALLOWGIT`, add `--allow-git=all` for this explicit repository install.

## Install the optional Codex skill

Ask Codex to install the skill from this repository and select the
`skills/feishu-app-admin` subdirectory, or copy that directory to:

```text
${CODEX_HOME:-~/.codex}/skills/feishu-app-admin
```

The skill expects `feishu-app-admin` to be available on `PATH`. Updating the npm
package updates the executable independently from the skill instructions.

## Authorization model

The agent determines authorization from the user's request and established
workflow. When authorization already exists, it supplies `--yes` itself. It
must ask again only for material scope expansion such as a new production app,
broader permissions, destructive removal, or publication not previously
authorized.

The CLI itself remains deterministic: any manifest containing writes exits with
code `10` unless `--yes` is present.
