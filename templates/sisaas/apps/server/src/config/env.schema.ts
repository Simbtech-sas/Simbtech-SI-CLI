import { z } from 'zod';

/**
 * Validated environment. Missing/invalid vars crash the app at boot (fail fast)
 * rather than surfacing as confusing runtime errors later. Add new vars here and
 * expose them through AppConfigService — never read process.env elsewhere.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  // Postgres — three roles (see infra/postgres/initdb/01-init.sql).
  DATABASE_URL: z.string().min(1), // runtime: RLS-constrained `simbkit_app`
  MIGRATION_DATABASE_URL: z.string().min(1).optional(), // owner role for migrations
  ADMIN_DATABASE_URL: z.string().min(1).optional(), // BYPASSRLS super-admin realm

  // Redis — cache + BullMQ. Unset → cache no-ops, single-node sockets.
  REDIS_URL: z.string().min(1).optional(),

  // Kafka — inter-service events. Unset → the consumer does not start. The
  // outbox still records events either way; publishing is Debezium's job, not
  // this process's, so a missing broker never blocks a domain write.
  SERVICE_NAME: z.string().min(1).default('simbkit'),
  KAFKA_BROKERS: z.string().min(1).optional(), // comma-separated host:port
  KAFKA_CONSUMER_GROUP: z.string().min(1).optional(), // defaults to SERVICE_NAME
  KAFKA_SSL: z.coerce.boolean().default(false),
  KAFKA_SASL_USERNAME: z.string().min(1).optional(),
  KAFKA_SASL_PASSWORD: z.string().min(1).optional(),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  // si:when-begin auth-oidc
  // External OIDC provider (Keycloak / ZITADEL). The tenant claim must be mapped
  // in the provider — a token without it is rejected, not defaulted.
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_TENANT_CLAIM: z.string().min(1).default('tenant_id'),
  OIDC_ROLE_CLAIM: z.string().min(1).default('role'),
  // si:when-end

  // KPay — Mobile Money, card and PayPal. The API KEY PREFIX selects the
  // environment (kpay_test_ / kpay_live_); the base URL is the same for both.
  // Temporal — durable workflows. Unset means no workflow runs here; the app
  // still boots, because an optional dependency must not be a boot dependency.
  TEMPORAL_ADDRESS: z.string().min(1).optional(),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).optional(),

  // Whose name goes on an invoice, and who a suspended customer writes to.
  // A blank seller block prints an invoice nobody can file.
  SUPPORT_EMAIL: z.string().email().optional(),
  SELLER_NAME: z.string().min(1).optional(),
  /** One line per address line, separated by `|`. */
  SELLER_ADDRESS: z.string().optional(),
  SELLER_TAX_ID: z.string().optional(),
  SELLER_EMAIL: z.string().email().optional(),
  /** Percentage, e.g. 19.25 for Cameroon's TVA. Unset prints no tax line at all. */
  SELLER_TAX_RATE: z.coerce.number().min(0).max(100).optional(),

  // Gotenberg — HTML to PDF, for invoices and receipts. Unset means documents
  // are attached as HTML instead of skipped.
  GOTENBERG_URL: z.string().url().optional(),

  KPAY_BASE_URL: z.string().url().default('https://admin.kpay.site'),
  KPAY_API_KEY: z.string().min(1).optional(),
  KPAY_SECRET_KEY: z.string().length(64).optional(),
  KPAY_WEBHOOK_SECRET: z.string().min(16).optional(),
  KPAY_GATEWAY_SECRET: z.string().min(16).optional(),
  KPAY_DEFAULT_MODE: z.enum(['ussd', 'gateway']).default('ussd'),

  // JoonaPay — hosted checkout (Mobile Money, cards, Wave) plus payouts, West
  // Africa. Same trap as KPay: the CLIENT KEY prefix selects the environment,
  // there is one production base URL.
  JOONAPAY_BASE_URL: z.string().url().default('https://apis.joonapay.com/api/v1/developer'),
  JOONAPAY_CLIENT_KEY: z.string().min(1).optional(),
  JOONAPAY_PRIVATE_KEY: z.string().min(1).optional(),
  JOONAPAY_WEBHOOK_SECRET: z.string().min(16).optional(),
  JOONAPAY_COUNTRY_UUID: z.string().uuid().optional(),
  JOONAPAY_CURRENCIES: z.string().min(3).default('XOF'),
  // https only. An http:// callback is redirected, the POST becomes a GET, and
  // deliveries silently stop arriving.
  JOONAPAY_WEBHOOK_URL: z.string().url().startsWith('https://').optional(),
  JOONAPAY_DUE_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  // Field-level encryption at rest (EncryptionService). Separate from the JWT
  // secrets on purpose: one key, one job — rotating a signing secret should not
  // make every encrypted column unreadable.
  ENCRYPTION_KEY: z.string().min(32),

  // Object storage (MinIO / S3). No endpoint+keys → an in-memory stub is used.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).default('simbkit'),
  S3_PUBLIC_URL: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // Platform SMTP (optional). No host/user/pass → the mailer is a no-op.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.string().email().default('no-reply@simbkit.local'),
  SMTP_FROM_NAME: z.string().min(1).default('Simbkit'),

  // Web Push (VAPID) — optional.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default('mailto:admin@simbkit.local'),

  // Public web base URL + the root domain tenant subdomains live under.
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3100'),
  ROOT_DOMAIN: z.string().min(1).default('simbkit.local'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
