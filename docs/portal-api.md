# Developer Portal API Notes

## Contents

1. [Support status](#support-status)
2. [Current endpoint map](#current-endpoint-map)
3. [Authentication model](#authentication-model)
4. [Troubleshooting](#troubleshooting)
5. [Extending with raw requests](#extending-with-raw-requests)

## Support status

The normal Feishu OpenAPI manages business resources after an app exists. It does not expose a complete supported API for developer-console administration. This Skill therefore uses the same `/developers/v1` browser backend used by the web console.

These endpoints are undocumented and can change without notice. Prefer high-level actions, keep manifests declarative, and verify results after important writes. Do not retry non-idempotent creation blindly.

The official `@larksuite/cli` can register its own `PersonalAgent` application, but it does not replace the general developer-console operations covered here.

## Current endpoint map

The bundled CLI currently uses:

| Operation | Method and path |
| --- | --- |
| List apps | `POST /developers/v1/app/list` |
| Upload app image | `POST /developers/v1/app/upload/image` |
| Create app | `POST /developers/v1/app/create` |
| Read App Secret | `POST /developers/v1/secret/{appId}` |
| Enable/disable bot | `POST /developers/v1/robot/switch/{appId}` |
| Initialize bot | `POST /developers/v1/robot/{appId}` |
| Read callback config | `POST /developers/v1/callback/{appId}` |
| Read external-sharing config | `POST /developers/v1/b2c_share/{appId}` |
| Read scope catalog/state | `POST /developers/v1/scope/applied/{appId}` |
| Add/remove scopes | `POST /developers/v1/scope/update/{appId}` |
| Read event config | `POST /developers/v1/event/{appId}` |
| Add/remove subscriptions | `POST /developers/v1/event/update/{appId}` |
| Verify/save callback | `POST /developers/v1/event/check_url/{appId}` |
| Switch callback mode | `POST /developers/v1/event/switch/{appId}` |
| Create version | `POST /developers/v1/app_version/create/{appId}` |
| Submit version | `POST /developers/v1/publish/commit/{appId}/{versionId}` |

Successful JSON responses normally contain `code: 0`. A transport success with a nonzero `code` is still a failed portal operation.

## Authentication model

The script launches Chrome or Edge with a separate user-data directory and remote debugging enabled. After the user signs in, it reads the portal session and CSRF cookies through Chrome DevTools Protocol. Cookies remain in memory unless `--reuse-session` or `--profile-dir` is selected. A retained profile launches headlessly by default; `--show-browser` is the explicit one-time login/re-authentication path.

Keep one profile directory per account and execute accounts sequentially. Do not run two automation profiles concurrently because the installed Chrome launcher may merge or terminate browser instances.

The script restricts raw calls to the configured Feishu/Lark developer host. It does not accept arbitrary URLs and never forwards portal cookies to callback endpoints. Callback warmup requests contain only a temporary challenge and the app verification token. Common event, callback, bot, and external-sharing reads have dedicated high-level actions and do not require `raw.request`.

Do not paste Cookie or CSRF values into manifests, shell history, logs, or chat. Do not add diagnostic logging that serializes request headers.

## Troubleshooting

### Login succeeds but the CLI times out

For a new profile, add `--show-browser` and confirm the browser reached the developer app page, not only the account page. Re-run with a longer `--login-timeout`. If using Lark, confirm `platform` is `lark`; Feishu and Lark use different page/API hosts. Never loop interactive retries.

### Portal returns HTTP 401/403 or a CSRF error

Re-authenticate the retained automation profile once with `--show-browser`. Do not copy cookies from the user's normal browser. A portal change may have renamed the CSRF cookie; inspect the current web request without printing its value.

### Scope name cannot be resolved

Run a read-only manifest containing `scope.catalog`. Inspect field names and numeric IDs in the redacted JSON. Retry `scopes.update` with `tenant_ids` or `user_ids`. Confirm identity type: current portal records use `2` for tenant/application scopes and `1` for user scopes.

### Callback verification fails

Before retrying, send a test POST matching Feishu's URL-verification payload. The callback must return HTTP 200 and JSON containing the identical `challenge`. Confirm TLS, public reachability, routing, and any gateway authentication bypass for verification requests.

### Version creation succeeds but publication is not visible

The publish endpoint submits the version. Tenant policy may require administrator review. Check version status instead of creating another version with the same number.

### An endpoint returns 404 or a new validation error

Stop repeated writes. Open the developer console in the dedicated automation profile, perform or preview the setting once, and inspect the current `/developers/v1` request path and body. Update a manifest with a narrow `raw.request`; update the high-level script only after confirming the new contract.

## Extending with raw requests

Use `raw.request` for a setting with no high-level action:

```json
{
  "id": "setting",
  "action": "raw.request",
  "method": "POST",
  "path": "/developers/v1/current/path/cli_app_id",
  "body": {
    "exactPortalField": "value"
  }
}
```

The CLI accepts paths both with and without the `/developers/v1` prefix. Preserve exact field casing from the current portal request. Never put cookies, CSRF tokens, App Secrets, or arbitrary third-party URLs in `raw.request`.
