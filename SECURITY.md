# Security

## Sensitive data

The CLI obtains developer-console cookies and CSRF material from a dedicated
Chrome profile. Never report these values in an issue. App Secrets are written
outside the repository with directory mode `0700` and file mode `0600`.

Do not use your normal Chrome profile with this project. Assign one dedicated
`--profile-dir` per Feishu/Lark account and keep profile directories out of Git.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for this repository. Include
reproduction steps with credentials, cookies, tokens, tenant names, and app
secrets removed.

## Unsupported internal API

Feishu/Lark does not publish a complete developer-console administration API.
This project calls the same undocumented `/developers/v1` backend as the web
console. Endpoint changes are expected. Stop after an unexpected write error;
do not repeatedly retry a non-idempotent operation.
