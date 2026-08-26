import { parseFields, type FieldDefinition } from './fields.ts';
import {
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toPlural,
  toSnakeCase,
} from './naming.ts';

export interface GenerateOptions {
  /** npm scope of the target project, used for `@<brand>/events` imports. */
  brand?: string;
  /** Entity name as typed, e.g. `Product` or `order-item`. */
  entity: string;
  /** Module folder the entity lives in. Defaults to the pluralised entity. */
  module?: string;
  /** `--fields "name:string price:money:optional"` */
  fields?: string;
  /**
   * Emit a tenant-scoped resource: `tenant_id` column, FK, RLS policy with FORCE,
   * and repository calls routed through runInTenantContext. On by default —
   * a SaaS table that forgets this is a data leak.
   */
  tenantScoped?: boolean;
  /** Emit CQRS command/query handlers instead of a plain service. */
  cqrs?: boolean;
  /** Publish domain events to the transactional outbox on create/update/delete. */
  events?: boolean;
  /** Sequence number for the generated migration file. */
  migrationNumber?: number;
}

/** A field, pre-rendered for every target language. Templates interpolate, never compute. */
export interface FieldContext {
  name: string;
  camel: string;
  snake: string;
  tsType: string;
  optional: boolean;
  /** Drizzle pg-core column expression, e.g. `text('name').notNull()` */
  drizzle: string;
  /** SQL column definition, e.g. `"name" text NOT NULL` */
  sql: string;
  /** Zod schema for a create DTO */
  zodCreate: string;
  /** Zod schema for an update DTO (always optional) */
  zodUpdate: string;
}

export interface TemplateContext {
  brand: string;
  entity: string;
  entityCamel: string;
  entityKebab: string;
  entitySnake: string;
  entityPlural: string;
  entityPluralCamel: string;
  entityPluralKebab: string;
  table: string;
  module: string;
  moduleKebab: string;
  modulePascal: string;
  fields: FieldContext[];
  hasFields: boolean;
  tenantScoped: boolean;
  cqrs: boolean;
  events: boolean;
  migrationNumber: string;
  /** Depth-correct relative path from a module subfolder up to `src/`. */
  srcUp: string;
  /** Drizzle pg-core imports the generated schema file needs. */
  drizzleImports: string[];
}

function drizzleColumn(f: FieldDefinition): string {
  const args = f.drizzleType === 'numeric' ? `('${f.snakeCase}', { precision: 20, scale: 4 })` : `('${f.snakeCase}')`;
  let expr = `${f.drizzleType}${args}`;
  if (!f.isOptional) expr += '.notNull()';
  if (f.isUnique) expr += '.unique()';
  return expr;
}

function sqlColumn(f: FieldDefinition): string {
  const sqlTypes: Record<string, string> = {
    text: 'text',
    integer: 'integer',
    doublePrecision: 'double precision',
    numeric: 'numeric(20, 4)',
    boolean: 'boolean',
    date: 'date',
    timestamp: 'timestamp with time zone',
    uuid: 'uuid',
    jsonb: 'jsonb',
  };
  const type = sqlTypes[f.drizzleType] ?? 'text';
  let col = `"${f.snakeCase}" ${type}`;
  if (!f.isOptional) col += ' NOT NULL';
  if (f.isUnique) col += ' UNIQUE';
  return col;
}

/**
 * Zod schema for a field. `money` is a decimal STRING, validated by pattern —
 * `z.number()` would route money through IEEE-754, which is the bug this whole
 * type exists to prevent.
 */
function zodSchema(f: FieldDefinition): string {
  if (f.isMoney) return "z.string().regex(/^-?\\d+(\\.\\d{1,4})?$/, 'must be a decimal amount')";
  if (f.enumValues && f.enumValues.length > 0) {
    return `z.enum([${f.enumValues.map((v) => `'${v}'`).join(', ')}])`;
  }
  switch (f.drizzleType) {
    case 'integer':
      return 'z.coerce.number().int()';
    case 'doublePrecision':
    case 'numeric':
      return 'z.coerce.number()';
    case 'boolean':
      return 'z.coerce.boolean()';
    case 'uuid':
      return 'z.string().uuid()';
    case 'timestamp':
    case 'date':
      return 'z.coerce.date()';
    case 'jsonb':
      return 'z.record(z.unknown())';
    default:
      return 'z.string().trim().min(1)';
  }
}

export function buildContext(options: GenerateOptions): TemplateContext {
  const entity = toPascalCase(options.entity);
  const moduleName = options.module ?? toPlural(entity);
  const parsed = parseFields(options.fields ?? '');

  const fields: FieldContext[] = parsed.fields
    // Relations need a FK column and a join; out of scope for a generated CRUD
    // stack, and a half-generated relation is worse than none.
    .filter((f) => !f.isRelation)
    .map((f) => {
      const zod = zodSchema(f);
      return {
        name: f.name,
        camel: f.camelCase,
        snake: f.snakeCase,
        tsType: f.tsType,
        optional: f.isOptional,
        drizzle: drizzleColumn(f),
        sql: sqlColumn(f),
        zodCreate: f.isOptional ? `${zod}.optional()` : zod,
        zodUpdate: `${zod}.optional()`,
      };
    });

  // Every generated schema needs these; the field types add to them.
  const imports = new Set(['timestamp', 'uuid']);
  for (const f of fields) imports.add(f.drizzle.split('(')[0]!);

  return {
    brand: options.brand ?? 'app',
    entity,
    entityCamel: toCamelCase(entity),
    entityKebab: toKebabCase(entity),
    entitySnake: toSnakeCase(entity),
    entityPlural: toPlural(entity),
    entityPluralCamel: toCamelCase(toPlural(entity)),
    entityPluralKebab: toKebabCase(toPlural(entity)),
    table: toSnakeCase(toPlural(entity)),
    module: moduleName,
    moduleKebab: toKebabCase(moduleName),
    modulePascal: toPascalCase(moduleName),
    fields,
    hasFields: fields.length > 0,
    tenantScoped: options.tenantScoped ?? true,
    cqrs: options.cqrs ?? false,
    events: options.events ?? true,
    migrationNumber: String(options.migrationNumber ?? 1).padStart(4, '0'),
    srcUp: '../../..',
    drizzleImports: [...imports].sort(),
  };
}
