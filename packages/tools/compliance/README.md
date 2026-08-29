# Compliance datasets

One YAML file per framework. Each requirement says how it is *checked*, and the
three kinds are deliberately different:

- `code` — a probe against the project: a file, a pattern, a registry entry.
  Mechanically verifiable, so `si compliance` reports it as fact.
- `manual` — organisational. A penetration test, a continuity plan, a
  contractual clause. **No CLI can satisfy these**, and a tool that pretends
  otherwise is worse than no tool: it produces a green report for a tender the
  organisation would fail.
- `partial` — the codebase provides the mechanism, the organisation must supply
  the policy. MFA is the clean example: the TOTP flow is code, "MFA is mandatory
  for administrators" is a decision somebody signs.

The status a requirement gets is evidence, never assertion. `si compliance`
prints the file it found, or says it found nothing.
