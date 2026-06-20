# Security Policy

Claude Code Studio (`cc-studio`) is a local tool that reads and writes your real
Claude Code configuration. It's designed to be safe to run against that config, and
security reports are taken seriously.

## Supported versions

Only the latest version published to npm receives security fixes. Update with:

```sh
npx cc-studio@latest
```

| Version            | Supported |
| ------------------ | --------- |
| Latest npm release | ✅        |
| Older releases     | ❌        |

## Security model

`cc-studio` runs entirely on your machine. The guarantees it's built around:

- **Local only.** The server binds to `127.0.0.1` on a random port — never to a
  public interface. Every request's `Host` header must be a loopback name
  (`127.0.0.1`, `localhost`, `::1`), which blocks DNS-rebinding attacks, and any
  `Origin` header must also be loopback (there is no CORS).
- **Per-session token.** Every `/api/*` call requires a bearer token minted at
  launch and delivered through the URL fragment (`…/#token=…`). The token check is
  scoped to the API routes, so it can't be bypassed with URL-encoding tricks.
- **No telemetry, no accounts, no cloud.** Nothing is sent off your machine. The
  only outbound network calls are ones you trigger — e.g. the `claude` CLI cloning
  a marketplace or installing a plugin.
- **Scoped file access.** The API reads and writes a fixed set of Claude config
  artifacts (settings files, `.mcp.json`, `CLAUDE.md`, `agents/`, `skills/`, hooks,
  and plugin state) — not arbitrary paths — so it can't be aimed at unrelated
  secrets on disk, and sensitive values are never echoed back wholesale.
- **Safe writes.** Edits go through the `claude` CLI where it exists, and otherwise
  fall back to atomic, hash-guarded file writes that back up the previous version
  first — so a write can't silently clobber an out-of-band change.

Because the tool edits real config and can invoke `claude` subcommands, run it only
on a machine you trust, and don't expose its port (it isn't exposed by default).

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab:
   <https://github.com/msiShariful/claude-code-studio/security/advisories>
2. Click **Report a vulnerability**, and include steps to reproduce and the
   `cc-studio` version you're running (shown in the launch output).

You'll get an acknowledgement, an investigation, and updates on the fix and
disclosure timeline. Thanks for helping keep `cc-studio` users safe.
