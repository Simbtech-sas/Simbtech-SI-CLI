# `@simbtech/si`

One CLI that scaffolds every shape of project we build, wires in vetted
open-source tools on demand, and generates the infrastructure to run them.

```bash
pnpm add -g @simbtech/si     # or npm i -g @simbtech/si
si new my-app
```

Four questions and you have a running project:

```
  What are you building?        → SiSAAS
  Single deployable or…?        → one app
  Open-source tools             → [grouped; nothing preselected]

  Defaults   auth Built-in · storage MinIO · uploads Presigned · …
  Change any of these?          → no
```

Then:

```bash
cd my-app
si start dev        # Postgres, Redis, Kafka, storage, mail, gateway — and the app
```

That one command brings the stack up, waits for Postgres to actually accept a
connection, applies the migrations and runs the app. `si stop` takes it down.

---

## The flavors

| | What it is | Use it when |
|---|---|---|
| **SiSAAS** | Multi-tenant SaaS. NestJS + Fastify, Postgres with row-level security, Next.js, a worker, Kafka events | Many customer organisations share one deployment |
| **SiAPP** | The same stack **without tenancy** — no tenant column, no RLS, no memberships | One organisation. A normal web app |
| **SiMICE** | On-premise desktop. Tauri v2, SQLite or Postgres, offline licence keys, optional cloud sync | It runs on a machine you do not control |
| **SiBILE** | Mobile — React Native, Flutter or Capacitor, your choice | A phone app against a SiSAAS backend |
| **SiCAL** | Fully local. Web technology, **no network at all**, enforced by a build check | The data must never leave the machine |
| **Platform** | The infrastructure control plane. k3s over WireGuard, ArgoCD, VPS onboarding | You are running the above in production |

### What SiSAAS gives you on day one

Tenant isolation enforced by Postgres itself (`ENABLE` **and** `FORCE ROW LEVEL
SECURITY`, proven by `pnpm verify:rls` against a real database), JWT access
tokens with rotating refresh tokens and reuse detection, argon2id passwords, a
transactional outbox so an event and the change it describes commit together, a
tamper-evident audit log with a SHA-256 hash chain, BullMQ jobs in a separate
worker process, presigned S3 uploads, and a Next.js app.

### SiAPP — the same thing, for one organisation

SiAPP is SiSAAS with tenancy composed out of the same template, not a second
tree. Everything above is still there — outbox, audit chain, worker, uploads,
Next.js — minus the tenant column, the RLS policies, the memberships table and
the subdomain routing. `role` (`owner` / `admin` / `member`) and its permission
overrides move onto the user row, and the **first account to register becomes
the owner**.

Say so out loud, because it is the one thing that changes how you write code:
**there is no database-level boundary behind your controllers.** In SiSAAS a
missing `where` clause is caught by a policy. Here the guard on the route is the
whole of it, so `pnpm verify:security` fails the build on a controller with no
`@UseGuards`.

Going multi-tenant later is a migration, not a flag — the scaffolded
`docs/ARCHITECTURE.md` spells out exactly what it costs.

---

## The commands

```
si new [dir]              scaffold a project
si api <name>             add another service, reusing the project's decisions
si add <tool...>          wire in an open-source tool
si list tools|features    browse the registry
si scaffold <Entity>      generate a feature module: schema, migration, service, DTOs, controller
si start dev              bring everything up and run the app
si stop                   stop the stack (--volumes drops the data)
si compliance             report against a framework — and `--fix` installs what is missing
si doctor                 check the local toolchain
```

### Adding tools

40 self-hostable services, each wired in one command — dependencies, compose
service, environment keys and module registration:

```bash
si add livekit meilisearch temporal
si list tools --category finance
```

Nothing is installed that you did not ask for. Payments (KPay, JoonaPay),
subscriptions with dunning, email notifications with invoices and receipts, a
webhook bridge that puts any tool's events on Kafka — all opt-in.

### Compliance

```bash
si compliance --fix
```

Reports the project against a public-sector security framework: 109
requirements across security, identity, cryptography, data protection and
sovereignty, auditability, ACID guarantees, architecture, availability and
DevOps. Every line is a path the tool found, or a statement that it found
nothing. `--fix` installs every feature that closes a gap.

Roughly a fifth of the requirements are organisational — continuity plans,
penetration tests, hosting location, contractual clauses — and the report says
so on every run rather than counting them as done.

---

## Local development

`si start dev` runs the app on your host against containerised dependencies, so
a save reloads in a second. Traefik runs alongside as the gateway, so cookies,
CORS and redirects behave the way they will behind the cluster's ingress.

```
:8080  the API          :8090  through the gateway    :8025  Mailpit
:3100  the web app      :8091  Traefik dashboard      :9001  MinIO console
```

This is docker compose, not the cluster. The platform flavor runs k3s and Argo;
reproducing that locally costs minutes per iteration, and testing ingress rules
or database failover belongs in the ops repo.

## For AI agents

Every scaffolded project ships `AGENTS.md`, plus `CLAUDE.md` and `.clinerules`
pointing at it. Cursor, Codex, Antigravity and Cline read `AGENTS.md` natively.

The rules are specific to the codebase, not generic advice: do not rebuild what
`si list tools` already has, take the simplest approach that works, one file one
thing, be disproportionate about security, and a feature is not finished until
it has been built, started and smoke-tested by hand.

## Requirements

Node 22+, pnpm, Docker. `si doctor` tells you what a given flavor needs — Rust
for SiMICE, Flutter for that SiBILE variant, kubectl for the platform.

## Repository layout

```
packages/si/       the CLI
packages/core/     composition engine — templates, branding, profiles
packages/tools/    the registry: 40 tools, 10 features, compliance datasets
packages/nest/     the DDD generator behind `si scaffold`
templates/         one real, runnable project per flavor
docs/              STATUS.md is what exists; FOLLOW-UPS.md is what does not
```

`docs/FOLLOW-UPS.md` is deliberately blunt about the gaps. Read it before
promising anything to a customer.
