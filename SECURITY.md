# Security Policy

## Supported versions

Senri is before 1.0. Security fixes are made for the latest minor version only.

| Version | Supported |
| --- | --- |
| 0.3.x | ✅ |
| < 0.3 | ❌ |

Please upgrade to the latest version before reporting, if you can.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:
[Report a vulnerability](https://github.com/Senrijs/Senri/security/advisories/new)

Please include:

- The affected version and runtime (Bun, Node.js, Deno, Cloudflare Workers or browser)
- What an attacker can do, and under what conditions
- Steps or a small piece of code that shows the problem

Reports in English or Japanese are welcome. 日本語での報告も歓迎します。

## What happens next

Senri is maintained by one person, so these are goals, not promises:

- We aim to reply within **7 days** to confirm we received your report.
- We will tell you whether we consider it a vulnerability, and keep you updated while we fix it.
- When a fix is released, we publish a GitHub Security Advisory and request a CVE when it applies.
- We credit the reporter in the advisory, unless you ask us not to.

Please give us a reasonable time to release a fix before you disclose the problem publicly.

## Scope

In scope:

- `@senrijs/senri` (npm and JSR), including all of its entry points
- `create-senri`

Out of scope:

- The documentation site (senri.skyia.jp), unless the problem affects users of the package
- Problems that need an attacker to already control the app's code or configuration
- Denial of service that needs an unrealistic amount of traffic, rather than a cheap request
