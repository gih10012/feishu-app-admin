# Platform support

## Support matrix

| Capability | Linux | macOS | Windows |
| --- | --- | --- | --- |
| CLI, manifests, planning, tests | CI tested | CI tested | CI tested |
| Chrome/Edge discovery | Native paths and `PATH` | App bundles, user apps, and `PATH` | Program Files, Local AppData, and `PATH` |
| Default state directory | XDG state | Application Support | Local AppData |
| Secret protection | `0700`/`0600` | `0700`/`0600` | Restricted Windows ACL |
| Browser process-tree cleanup | POSIX signals | POSIX signals | `taskkill /t` fallback |
| Authenticated portal integration | Verified | Environment validation required | Environment validation required |

The remaining macOS/Windows variability is external: interactive sign-in,
enterprise browser policy, endpoint protection, proxies, and tenant-specific
authentication. The CLI handles known operating-system differences directly.

## Diagnostics

Run:

```text
feishu-app-admin doctor [--chrome <path>] [--profile-dir <path>]
```

The command returns structured JSON and checks:

- Node.js 22+ and required Web APIs
- supported operating system and architecture
- Chrome, Chromium, or Edge discovery
- native state-directory creation and protection
- optional stored-profile presence

It does not start Chrome, inspect cookies, log in, or contact Feishu/Lark.

## Browser discovery

`CHROME_PATH` and `--chrome` take priority on every platform. Automatic
discovery covers common system, user, and `PATH` installations. Portable apps
and enterprise-managed custom locations should use an explicit path.

## Windows

PowerShell example:

```powershell
$profile = Join-Path $env:LOCALAPPDATA "feishu-app-admin\profiles\work"
feishu-app-admin doctor --profile-dir $profile
feishu-app-admin apps --profile-dir $profile --show-browser
```

The npm package creates a `feishu-app-admin.cmd` shim automatically. Secret and
profile directories use `icacls` with SID-based entries, avoiding localized
Windows account names.

## macOS

The CLI checks `/Applications`, the current user's `~/Applications`, and
browser names on `PATH`. A retained Chrome profile may trigger normal macOS
Keychain prompts according to local browser policy; the CLI never reads the
Keychain directly.
