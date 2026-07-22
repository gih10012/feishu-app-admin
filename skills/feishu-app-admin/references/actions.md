# Agent action reference

## Contents

1. [Direct reads](#direct-reads)
2. [Manifest lifecycle](#manifest-lifecycle)
3. [High-level actions](#high-level-actions)
4. [Profiles and state](#profiles-and-state)
5. [Fallback policy](#fallback-policy)

## Direct reads

List applications:

```bash
feishu-app-admin apps --profile-dir <account-profile>
```

List and inspect every application:

```bash
feishu-app-admin apps --inspect --profile-dir <account-profile>
```

Inspect one application:

```bash
feishu-app-admin inspect \
  --app-id <app-id> \
  --sections event,callback,bot,external-sharing \
  --profile-dir <account-profile>
```

Inspection output is concise by default. Add `--event-details` only when the
full event catalog is needed, and add `--full` to `apps --inspect` only when
complete portal app records are necessary.

## Manifest lifecycle

Use ordered JSON operations:

```json
{
  "platform": "feishu",
  "app_id": "cli_example",
  "vars": {},
  "operations": [
    { "id": "inspect", "action": "app.inspect" }
  ]
}
```

Commands:

```bash
feishu-app-admin validate --manifest manifest.json
feishu-app-admin plan --manifest manifest.json
feishu-app-admin apply --manifest manifest.json --profile-dir <path> --yes
```

Reference prior results with `${operation_id.field}` and variables with
`${vars.name}`. A newly created app becomes the default target for later
operations.

## High-level actions

| Intent | Action |
| --- | --- |
| List apps | `app.list` |
| Inspect one/all apps | `app.inspect`, `apps.inspect` |
| Create an app | `app.create` |
| Store an App Secret | `secret.get` |
| Read or switch bot capability | `bot.get`, `bot.set` |
| Read scope state | `scope.catalog` |
| Add/remove exact scopes | `scopes.update` |
| Read event configuration | `event.get` |
| Add/remove subscriptions | `events.update` |
| Set delivery mode | `event.mode` |
| Read other callback config | `callback.get` |
| Verify/save an HTTP event URL | `webhook.set` |
| Read external availability | `external-sharing.get` |
| Create/submit a release | `version.create`, `version.publish` |
| Unsupported portal setting | `raw.request` |

Use event mode names `webhook`, `cloud-function`, `apaas-cloud-function`, or
`websocket`. Prefer scope names over portal numeric IDs. Keep permission and
event updates additive unless removal is explicitly requested.

Run `feishu-app-admin actions` to obtain the machine-readable current catalog.

## Profiles and state

The default state root is
`${XDG_STATE_HOME:-~/.local/state}/feishu-app-admin`; the
`FEISHU_APP_ADMIN_HOME` environment variable overrides it. Use explicit profile
paths for multiple accounts and run them sequentially.

Existing profiles run headlessly. Add `--show-browser` only for a first or
expired login. The CLI closes the interactive window itself.

## Fallback policy

Use `raw.request` only for a developer-console setting with no named action. It
accepts only relative `/developers/v1` paths and is always classified as high
risk. Keep exact request fields in a manifest. Never include cookies, CSRF
values, App Secrets, verification tokens, or encryption keys.
