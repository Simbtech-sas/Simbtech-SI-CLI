import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Typed, autocomplete-friendly accessor over the validated environment. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get adminDatabaseUrl(): string | undefined {
    return this.config.get('ADMIN_DATABASE_URL', { infer: true });
  }

  get redisUrl(): string | undefined {
    return this.config.get('REDIS_URL', { infer: true });
  }

  get serviceName(): string {
    return this.config.get('SERVICE_NAME', { infer: true });
  }

  /**
   * Kafka settings, or null when no brokers are configured (→ the event consumer
   * never starts). Producing is not affected: services write to the outbox table
   * and Debezium publishes, so a broker outage cannot fail a domain write.
   */
  get kafka(): {
    brokers: string[];
    clientId: string;
    groupId: string;
    ssl: boolean;
    sasl?: { username: string; password: string };
  } | null {
    const brokers = this.config.get('KAFKA_BROKERS', { infer: true });
    if (!brokers) return null;
    const username = this.config.get('KAFKA_SASL_USERNAME', { infer: true });
    const password = this.config.get('KAFKA_SASL_PASSWORD', { infer: true });
    return {
      brokers: brokers.split(',').map((b) => b.trim()).filter(Boolean),
      clientId: this.serviceName,
      groupId: this.config.get('KAFKA_CONSUMER_GROUP', { infer: true }) ?? this.serviceName,
      ssl: this.config.get('KAFKA_SSL', { infer: true }),
      ...(username && password ? { sasl: { username, password } } : {}),
    };
  }

  get jwtAccessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  // si:when-begin auth-oidc
  /** External OIDC provider settings, or null when auth is built in. */
  get oidc(): {
    issuer: string;
    audience: string;
    jwksUri: string;
    tenantClaim: string;
    roleClaim: string;
  } | null {
    const issuer = this.config.get('OIDC_ISSUER', { infer: true });
    const audience = this.config.get('OIDC_AUDIENCE', { infer: true });
    if (!issuer || !audience) return null;
    return {
      issuer,
      audience,
      // Standard discovery path; override only for a provider that differs.
      jwksUri:
        this.config.get('OIDC_JWKS_URI', { infer: true }) ??
        `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`,
      tenantClaim: this.config.get('OIDC_TENANT_CLAIM', { infer: true }),
      roleClaim: this.config.get('OIDC_ROLE_CLAIM', { infer: true }),
    };
  }
  // si:when-end

  /**
   * KPay settings, or null when unconfigured (→ the module is not usable).
   *
   * `defaultMode` is the merchant's choice between a direct USSD prompt and a
   * hosted payment link. Card and PayPal ignore it — they have no USSD form.
   */
  get temporal(): { address: string; namespace: string; taskQueue: string } | null {
    const address = this.config.get('TEMPORAL_ADDRESS', { infer: true });
    if (!address) return null;
    return {
      address,
      namespace: this.config.get('TEMPORAL_NAMESPACE', { infer: true }),
      // One task queue per service by default. A shared queue means one
      // service's workers picking up another's workflow tasks and failing to
      // find the code for them.
      taskQueue: this.config.get('TEMPORAL_TASK_QUEUE', { infer: true }) ?? this.serviceName,
    };
  }

  get supportEmail(): string {
    // Falls back to the From address: an email telling a suspended customer to
    // contact "undefined" is worse than one pointing at the mailbox we do have.
    return (
      this.config.get('SUPPORT_EMAIL', { infer: true }) ??
      this.config.get('SMTP_FROM', { infer: true })
    );
  }

  get seller(): {
    name: string;
    address?: string[];
    taxId?: string;
    email?: string;
    taxRate?: number;
  } {
    const address = this.config.get('SELLER_ADDRESS', { infer: true });
    return {
      name: this.config.get('SELLER_NAME', { infer: true }) ?? this.config.get('SMTP_FROM_NAME', { infer: true }),
      address: address ? address.split('|').map((l) => l.trim()).filter(Boolean) : undefined,
      taxId: this.config.get('SELLER_TAX_ID', { infer: true }),
      email: this.config.get('SELLER_EMAIL', { infer: true }),
      taxRate: this.config.get('SELLER_TAX_RATE', { infer: true }),
    };
  }

  get gotenbergUrl(): string | undefined {
    return this.config.get('GOTENBERG_URL', { infer: true });
  }

  get kpay(): {
    baseUrl: string;
    apiKey: string;
    secretKey: string;
    webhookSecret?: string;
    gatewaySecret?: string;
    defaultMode: 'ussd' | 'gateway';
  } | null {
    const apiKey = this.config.get('KPAY_API_KEY', { infer: true });
    const secretKey = this.config.get('KPAY_SECRET_KEY', { infer: true });
    if (!apiKey || !secretKey) return null;
    return {
      baseUrl: this.config.get('KPAY_BASE_URL', { infer: true }),
      apiKey,
      secretKey,
      webhookSecret: this.config.get('KPAY_WEBHOOK_SECRET', { infer: true }),
      gatewaySecret: this.config.get('KPAY_GATEWAY_SECRET', { infer: true }),
      defaultMode: this.config.get('KPAY_DEFAULT_MODE', { infer: true }),
    };
  }

  get joonapay(): {
    baseUrl: string;
    clientKey: string;
    privateKey: string;
    webhookSecret?: string;
    countryUuid?: string;
    currencies: string[];
    webhookUrl?: string;
    dueDays: number;
  } | null {
    const clientKey = this.config.get('JOONAPAY_CLIENT_KEY', { infer: true });
    const privateKey = this.config.get('JOONAPAY_PRIVATE_KEY', { infer: true });
    if (!clientKey || !privateKey) return null;
    return {
      baseUrl: this.config.get('JOONAPAY_BASE_URL', { infer: true }),
      clientKey,
      privateKey,
      webhookSecret: this.config.get('JOONAPAY_WEBHOOK_SECRET', { infer: true }),
      countryUuid: this.config.get('JOONAPAY_COUNTRY_UUID', { infer: true }),
      // Drives which requests route here when both providers are configured.
      currencies: this.config
        .get('JOONAPAY_CURRENCIES', { infer: true })
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
      webhookUrl: this.config.get('JOONAPAY_WEBHOOK_URL', { infer: true }),
      dueDays: this.config.get('JOONAPAY_DUE_DAYS', { infer: true }),
    };
  }

  /** Master key for field-level encryption. Never the JWT secret. */
  get encryptionKey(): string {
    return this.config.get('ENCRYPTION_KEY', { infer: true });
  }

  get jwtRefreshSecret(): string {
    return this.config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  get webPublicUrl(): string {
    return this.config.get('WEB_PUBLIC_URL', { infer: true });
  }

  get rootDomain(): string {
    return this.config.get('ROOT_DOMAIN', { infer: true });
  }

  /** S3/MinIO settings, or null when storage isn't configured (→ in-memory stub). */
  get s3(): {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    forcePathStyle: boolean;
    publicUrl: string;
  } | null {
    const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    const accessKey = this.config.get('S3_ACCESS_KEY', { infer: true });
    const secretKey = this.config.get('S3_SECRET_KEY', { infer: true });
    if (!endpoint || !accessKey || !secretKey) return null;
    const bucket = this.config.get('S3_BUCKET', { infer: true });
    return {
      endpoint,
      accessKey,
      secretKey,
      bucket,
      region: this.config.get('S3_REGION', { infer: true }),
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      publicUrl:
        this.config.get('S3_PUBLIC_URL', { infer: true }) ??
        `${endpoint}/${bucket}`,
    };
  }

  /** Platform SMTP transport, or null when unconfigured (→ mailer no-ops). */
  get smtp(): {
    host: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
    fromName: string;
  } | null {
    const host = this.config.get('SMTP_HOST', { infer: true });
    if (!host) return null;
    return {
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      user: this.config.get('SMTP_USER', { infer: true }),
      pass: this.config.get('SMTP_PASS', { infer: true }),
      from: this.config.get('SMTP_FROM', { infer: true }),
      fromName: this.config.get('SMTP_FROM_NAME', { infer: true }),
    };
  }

  get vapid(): { publicKey: string; privateKey: string; subject: string } | null {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = this.config.get('VAPID_PRIVATE_KEY', { infer: true });
    if (!publicKey || !privateKey) return null;
    return {
      publicKey,
      privateKey,
      subject: this.config.get('VAPID_SUBJECT', { infer: true }),
    };
  }
}
