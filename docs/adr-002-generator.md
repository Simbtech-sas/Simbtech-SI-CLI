# ADR-002 — Replacing the nestjs-ddd-cli templates rather than adapting them

Status: accepted · 2026-08-28

## Context

The plan was to hard-fork `eshe-huli/nestjs-ddd-cli` (52,669 lines TS, 56
Handlebars templates) and extend it. Reading the templates against the SiSAAS
target changed the picture:

| | nestjs-ddd-cli emits | SiSAAS needs |
|---|---|---|
| ORM | TypeORM `@InjectRepository` + ORM-entity + mapper, or Prisma | Drizzle, no mappers |
| Layout | `application/domain/entities/`, `application/controllers/` | `domain/`, `application/`, `infrastructure/`, `interface/` |
| DTOs | class-validator + `@ApiProperty` | nestjs-zod `createZodDto` |
| CQRS | mandatory in module and controller | opt-in per module |
| Tenancy | none | `runInTenantContext`, RLS with FORCE |
| Events | none | transactional outbox |

Measured across the 56 templates: **0** mention `drizzle`, **0** mention
`nestjs-zod`, **0** mention `runInTenantContext`. Adapting them would have been a
rewrite wearing a fork's clothes.

## Decision

Take the parts with real domain knowledge, write the templates.

**Ported** (~615 lines, now under test):
- `naming.ts` — casings and pluralisation, including the path-traversal guard on
  entity names, which reach the filesystem.
- `fields.ts` — the `name:type:modifier` spec parser: money, `serverOwned`,
  relations, enums, arrays, uniqueness. Extended with a `drizzleType` mapping.

**Written fresh**: 13 templates emitting the SiSAAS shape, plus one
`resolveTemplate` — replacing the 30 hardcoded `__dirname` joins that made every
new output variant multiply by 30.

**Dropped**: the 54-command surface, the 4,195-line `recipe.ts` with its 31-arm
switch, and ~2,900 lines with zero importers. The 31 recipes remain a candidate
source for Milestone 4's tool registry, where they fit the manifest format.

## Consequences

- `si scaffold` produces code that compiles into a scaffolded project on the first
  try — verified for both the plain-DDD and CQRS shapes.
- Generated code imports only what the project has, or the generator installs it.
  A generated module importing a missing package is a broken tree, so
  `TEMPLATE_DEPENDENCIES` declares what each shape needs (`--cqrs` pulls
  `@nestjs/cqrs`).
- Losing upstream updates costs nothing here: no upstream template was usable.
- If a non-Drizzle ORM is ever needed, it is a new set of templates behind the
  same resolver, not a rework of these.
