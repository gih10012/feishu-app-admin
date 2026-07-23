---
name: feishu-app-admin
description: Manage Feishu/Lark Open Platform developer applications with the standalone feishu-app-admin CLI. Use when an agent needs to list or inspect apps, retrieve credentials securely, configure bot capabilities, permissions, events, callbacks, external availability, versions, or publication. Do not use for ordinary Feishu business data such as messages, documents, calendars, or Base records.
---

# Feishu App Admin

Use the installed `feishu-app-admin` command. Treat the CLI as an independent
tool: this skill contains operating guidance and does not bundle its executable.

## Preflight

Locate the CLI before doing any portal work:

```bash
command -v feishu-app-admin
feishu-app-admin --version
feishu-app-admin doctor
```

If it is absent, report that the CLI must be installed from
`https://github.com/gih10012/feishu-app-admin`. Do not improvise browser-console
requests from this skill.

Run `doctor` before the first login on a machine. It must not open a browser or
contact Feishu/Lark. Resolve failed Node, browser, state-directory, or native
permission checks before attempting authentication. Use `--chrome` for a
nonstandard browser installation.

Read [references/actions.md](references/actions.md) completely before creating
or changing a manifest.

## Authorization

Infer authorization from the full conversation.

- Execute directly when the user explicitly requested the operation, approved
  it at the beginning, or established it as a repeated workflow.
- Add `--yes` when authorization for the requested writes already exists.
- Ask again only for a material expansion: another tenant or production app,
  broader permissions, destructive removal, publication not previously
  authorized, or an unknown raw endpoint.
- Do not infer standing authorization from a manifest alone.

Do not force the user to review an internal plan when intent is already clear.
Run `plan` for templates, removals, publication, or `raw.request`, and surface it
only when it reveals ambiguity or the user asks for it.

## Browser profiles

Assign one stable `--profile-dir` to each account and process accounts
sequentially. Never use the user's normal Chrome profile.

Reuse a stored profile headlessly. Add `--show-browser` only for a first login
or explicit re-authentication. Open exactly one window, tell the user to leave
it open, and let the CLI close it automatically. If a stored login is expired,
stop after the error instead of launching repeated windows.

## Workflow

1. Identify platform, account profile, target app, desired end state, and
   whether publication is included.
2. Prefer direct read commands such as `apps --inspect` and `inspect`.
3. For changes, create a narrow JSON manifest in the task workspace or a
   temporary directory.
4. Run `validate`; run `plan` when risk or interpolation warrants it.
5. Run `apply --yes` when the requested writes are authorized.
6. Verify important state with a named read action.
7. Report IDs and operation status without revealing sensitive values.

Prefer named actions over `raw.request`. Use the fallback only after
`feishu-app-admin actions` confirms that no high-level action covers the setting
and the current portal request shape has been verified.

## Secrets and failures

Allow the CLI to store App Secrets unless the user explicitly requests a
disposable app without credentials. Reference the protected file path; never
print or copy secret contents into chat, logs, or a repository.

Preserve existing state with precise add/remove operations. Do not blindly
retry non-idempotent app or version creation. On partial failure, report the
completed and failed operation IDs and inspect current state before retrying.
