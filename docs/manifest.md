# Manifest Reference

## Contents

1. [Top-level shape](#top-level-shape)
2. [Templates](#templates)
3. [Actions](#actions)
4. [Complete examples](#complete-examples)
5. [CLI behavior](#cli-behavior)

## Top-level shape

Use JSON. The CLI intentionally has no YAML dependency.

```json
{
  "platform": "feishu",
  "app_id": "cli_existing_app",
  "vars": {
    "callback_url": "https://example.com/feishu/events"
  },
  "operations": [
    {
      "id": "callback",
      "action": "webhook.set",
      "url": "${vars.callback_url}"
    }
  ]
}
```

- `platform`: `feishu` (default) or `lark`.
- `app_id`: optional default target for all later operations.
- `vars`: optional template values.
- `operations`: non-empty ordered list. IDs must be unique.

Operations execute sequentially. A newly created app becomes the default `app_id` for subsequent operations.

## Templates

Reference top-level variables or prior results with `${...}`:

```json
[
  { "id": "create", "action": "app.create", "name": "Automation Bot" },
  {
    "id": "publish",
    "action": "version.publish",
    "version_id": "${release.version_id}"
  }
]
```

Available forms include `${app_id}`, `${vars.callback_url}`, and `${operation_id.field}`. An unresolved template fails before that operation is sent.

## Actions

### `app.list`

Read applications visible to the logged-in developer.

```json
{ "id": "apps", "action": "app.list", "count": 50, "cursor": 0 }
```

### `app.inspect`

Read the common developer settings for one application without using
`raw.request`:

```json
{
  "id": "inspect",
  "action": "app.inspect",
  "sections": ["event", "callback", "bot", "external-sharing"]
}
```

`sections` is optional and defaults to all four values. Portal business errors
for an unavailable section are returned as structured `ok: false` results so
the remaining settings can still be inspected. Event output is normalized and
concise; add `"event_details": true` to include the complete portal event
catalog.

### `apps.inspect`

List all applications and inspect selected settings for each one:

```json
{
  "id": "inventory",
  "action": "apps.inspect",
  "sections": ["event", "bot", "external-sharing"]
}
```

This is the manifest equivalent of `feishu-app-admin apps --inspect`. Set
`"full_app_records": true` only when complete portal application records are
required; the default contains a stable summary.

### `app.create`

Create a custom application and make it the current target.

```json
{
  "id": "create",
  "action": "app.create",
  "name": "Release Assistant",
  "description": "Internal release workflow bot",
  "primary_language": "zh_cn",
  "icon_path": "assets/app-icon.png",
  "fetch_secret": true
}
```

- `name` is required.
- `description` defaults to `name`.
- `icon_path` must be inside the current working directory and at most 5 MiB. A small placeholder is uploaded when omitted.
- `avatar_url` can replace `icon_path` when an existing portal image URL is available.
- `fetch_secret` defaults to true. The CLI stores the secret securely and redacts it from output.

### `secret.get`

Fetch the current App Secret and save it in the protected CLI state directory.

```json
{ "id": "credentials", "action": "secret.get" }
```

### `bot.set`

Enable or disable the bot capability.

```json
{ "id": "bot", "action": "bot.set", "enabled": true }
```

### `bot.get`

Read the current bot configuration:

```json
{ "id": "bot", "action": "bot.get" }
```

### `scope.catalog`

Return the portal's scope data for an app. Use it when a scope name cannot be mapped automatically or when numeric IDs are required.

```json
{ "id": "scope_catalog", "action": "scope.catalog" }
```

### `scopes.update`

Add or remove only the specified scopes.

```json
{
  "id": "scopes",
  "action": "scopes.update",
  "operation": "add",
  "tenant_scopes": [
    "im:message:send_as_bot",
    "im:message.p2p_msg:readonly"
  ],
  "user_scopes": [],
  "tenant_ids": [],
  "user_ids": []
}
```

- `operation`: `add` (default) or `remove`.
- `tenant_scopes` / `user_scopes`: public scope names. The CLI tries to resolve them from `/scope/applied/<app-id>`.
- `tenant_ids` / `user_ids`: portal numeric IDs as strings. Use these when name resolution is unavailable.
- `scope_ids`: optional legacy/general numeric IDs.

Do not copy the 103-scope lists found in community bot creators. Request the smallest set needed by the intended API and events.

### `events.update`

Add or remove event subscriptions.

```json
{
  "id": "events",
  "action": "events.update",
  "operation": "add",
  "app_events": ["im.message.receive_v1"],
  "user_events": [],
  "events": [],
  "event_mode": 1
}
```

The three arrays correspond to portal event identity categories. Most bot events belong in `app_events`. Use the portal's current event record when uncertain.

### `event.get`

Read subscribed events, event mode, verification state, and any event callback
configuration returned by the portal:

```json
{ "id": "event", "action": "event.get" }
```

Set `"need_event_detail": true` to include the portal's verbose event catalog
and dependent scope metadata.

### `event.mode`

Set an event mode by name or portal numeric value.

```json
{ "id": "mode", "action": "event.mode", "event_mode": "websocket" }
```

Supported names are `webhook`, `cloud-function`, `apaas-cloud-function`, and
`websocket`. They currently map to portal values `1`, `2`, `3`, and `4`.
Numeric values remain accepted for compatibility. These values are not a stable
public contract.

### `callback.get`

Read the portal callback configuration that is separate from event delivery:

```json
{ "id": "callback", "action": "callback.get" }
```

### `webhook.set`

Fetch the app verification token, verify and save a callback URL, then switch to HTTP callback mode.

```json
{
  "id": "callback",
  "action": "webhook.set",
  "url": "https://example.com/feishu/events",
  "warmup": true,
  "retries": 5
}
```

The endpoint must already be reachable and return `{"challenge":"..."}` for Feishu URL-verification requests. HTTPS is required unless `allow_insecure: true` is explicitly set for a development environment.

### `external-sharing.get`

Read whether the app is available outside its owning organization and return
the current external-sharing configuration:

```json
{ "id": "external", "action": "external-sharing.get" }
```

### `version.create`

Create a release version. Creation and publication can be combined when already authorized.

```json
{
  "id": "release",
  "action": "version.create",
  "version": "1.2.0",
  "changelog": "Add automated incident handling",
  "visibility": "creator",
  "mobile_default_ability": "bot",
  "pc_default_ability": "bot",
  "publish": false
}
```

- `visibility`: `creator` (default) or `all`.
- `publish: true` immediately submits the created version.
- `payload`: optional complete portal request body for advanced release settings. When supplied, it replaces all generated defaults.

### `version.publish`

Submit a version created earlier or supplied by ID.

```json
{
  "id": "publish",
  "action": "version.publish",
  "version_id": "${release.version_id}"
}
```

### `raw.request`

Call a developer-console endpoint not covered by a high-level action. Check
`feishu-app-admin actions` first and prefer a named action whenever possible.

```json
{
  "id": "custom_setting",
  "action": "raw.request",
  "method": "POST",
  "path": "/some/setting/cli_app_id",
  "body": { "enabled": true },
  "allow_nonzero": false
}
```

Only relative `/developers/v1` paths are accepted. Full URLs, path traversal, and non-portal hosts are rejected. `raw.request` is always treated as high risk because its semantics are unknown to the CLI.

## Complete examples

### Create and publish a minimal long-connection bot

Do not set a callback mode for a long-connection bot. Add only the needed event and scopes.

```json
{
  "platform": "feishu",
  "operations": [
    {
      "id": "create",
      "action": "app.create",
      "name": "Ops Assistant",
      "description": "Handles direct-message operations"
    },
    { "id": "bot", "action": "bot.set", "enabled": true },
    {
      "id": "scopes",
      "action": "scopes.update",
      "operation": "add",
      "tenant_scopes": [
        "im:message:send_as_bot",
        "im:message.p2p_msg:readonly"
      ]
    },
    {
      "id": "events",
      "action": "events.update",
      "operation": "add",
      "app_events": ["im.message.receive_v1"]
    },
    {
      "id": "release",
      "action": "version.create",
      "version": "0.1.0",
      "changelog": "Initial release",
      "visibility": "creator",
      "publish": true
    }
  ]
}
```

### Configure and release an existing Webhook app

```json
{
  "platform": "feishu",
  "app_id": "cli_existing",
  "vars": {
    "callback_url": "https://example.com/feishu/events"
  },
  "operations": [
    {
      "id": "events",
      "action": "events.update",
      "operation": "add",
      "app_events": ["im.message.receive_v1"]
    },
    {
      "id": "callback",
      "action": "webhook.set",
      "url": "${vars.callback_url}"
    },
    {
      "id": "release",
      "action": "version.create",
      "version": "1.0.1",
      "changelog": "Configure production event callback"
    },
    {
      "id": "publish",
      "action": "version.publish",
      "version_id": "${release.version_id}"
    }
  ]
}
```

## CLI behavior

`validate` checks structure and required fields without a browser or network. `plan` reports ordered actions, targets, and risk classes without logging in. `apply` uses a dedicated Chrome/Edge profile, obtains developer-console cookies in memory, runs operations in order, redacts output, and closes the browser process.

Any write manifest exits with code `10` without `--yes`. The Skill may add `--yes` automatically when user authorization already exists. This gate prevents accidental direct invocation; it is not a requirement to repeatedly interrupt an authorized workflow.

By default, browser state is deleted after each run. `--reuse-session` retains one default automation profile. `--profile-dir <path>` retains a separate profile for a specific account. Existing profiles run headlessly and do not show a browser window; use `--show-browser` only for the first login or explicit re-authentication. Run different profiles sequentially rather than concurrently. App Secrets are stored under `${XDG_STATE_HOME:-~/.local/state}/feishu-app-admin/apps` with restrictive permissions. Set `FEISHU_APP_ADMIN_HOME` to override the state root.
