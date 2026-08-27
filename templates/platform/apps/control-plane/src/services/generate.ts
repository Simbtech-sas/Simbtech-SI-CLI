/**
 * Registering a service in the reference repo meant hand-copying five
 * near-identical files and remembering to change six strings in each. This
 * generates them, so the only way they disagree is a bug here rather than a
 * typo there.
 */
/** A tool deployed as a service, rather than one written from the boilerplate. */
export interface ToolDeploySpec {
  image: string;
  port: number;
  needsDatabase?: boolean;
  env?: Record<string, string>;
  ingress?: boolean;
  storage?: string;
}

/**
 * How traffic is spread across a service's replicas.
 *
 * The default is right for a stateless HTTP service. The others exist because
 * some services are not that, and picking the wrong one is a subtle bug rather
 * than an obvious failure.
 */
export type LoadBalancing =
  /** Even spread. Correct whenever any replica can serve any request. */
  | 'round-robin'
  /** A client keeps hitting one replica. Only for in-memory session state — it
   *  defeats even balancing and turns one replica's death into lost sessions. */
  | 'sticky'
  /** Weighted split across two versions. For a canary, not for steady state. */
  | 'canary';

export interface ServiceSpec {
  /** Service name, e.g. `billing`. Becomes `billing-api` everywhere. */
  name: string;
  brand: string;
  /** Git repo holding the service and its `k8s/` manifests. */
  repoUrl?: string;
  targetRevision?: string;
  /** Aggregate root this service publishes events for, e.g. `invoice`. */
  /**
   * Aggregates this service publishes, one topic each.
   *
   * A service almost never has just one: a billing service publishes
   * `billing` and `payment`, and `allTopics()` in @<brand>/events is the
   * authoritative list. Defaults to the service name.
   */
  aggregates?: string[];
  namespace?: string;
  /**
   * Where this service's database lives.
   *
   * `shared` (default) — a database of its own inside the platform's Postgres
   * cluster. Isolated logically: its own database, its own owner role, no way
   * to read another service's tables.
   *
   * `dedicated` — a Postgres cluster of its own. Isolated physically too: its
   * own CPU, memory, disk, version and backup schedule. Costs another two pods
   * and another thing to upgrade, so it is a decision per service rather than a
   * house style.
   */
  database?: 'shared' | 'dedicated';
  /** Dedicated clusters only. Two survives a node reboot; three allows quorum sync. */
  dbInstances?: number;
  /** Dedicated clusters only. */
  dbStorage?: string;
  /** Set to deploy an open-source tool instead of a service you wrote. */
  tool?: ToolDeploySpec & { id: string };
  /** Root domain for ingress hosts, e.g. `acme.com`. */
  rootDomain?: string;
  /** Defaults to round-robin. */
  loadBalancing?: LoadBalancing;
  /** Replicas. Two is the minimum that survives a node reboot. */
  replicas?: number;
  /** Canary only: share of traffic sent to the new version, 0-100. */
  canaryWeight?: number;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

const NAME_RE = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

export function generateService(spec: ServiceSpec): GeneratedFile[] {
  if (!NAME_RE.test(spec.name)) {
    throw new Error(
      `"${spec.name}" is not a valid service name — lowercase letters, digits and hyphens, ` +
        'because it becomes a Kubernetes object name and a Postgres identifier',
    );
  }

  const { brand } = spec;
  const svc = `${spec.name}-api`;
  const ns = spec.namespace ?? brand;
  const aggregates = spec.aggregates?.length ? spec.aggregates : [spec.name];
  const repo = spec.repoUrl ?? `https://github.com/${brand}/${svc}.git`;
  const rev = spec.targetRevision ?? 'main';
  const topics = aggregates.map((a) => `${spec.name}.${a}.v1`);
  // The database cluster this service talks to. Everything downstream — the
  // Database CR, the credentials secret, Debezium — reads it from here, so the
  // shared/dedicated choice is made once rather than in four places.
  const dedicated = spec.database === 'dedicated';
  const dbCluster = dedicated ? `${spec.name}-pg` : `${brand}-pg`;
  const dbHost = `${dbCluster}-rw.data.svc`;
  const dir = `gitops/apps/${svc}`;

  return [
    {
      path: `${dir}/application.yaml`,
      contents: `# Deploys ${svc} from its own repository. Argo prunes and self-heals, so this
# file is the whole deployment contract.
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${svc}
  namespace: argocd
spec:
  project: ${brand}
  source:
    repoURL: ${repo}
    targetRevision: ${rev}
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: ${ns}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
`,
    },
    {
      path: `${dir}/database.yaml`,
      contents: `# ${dedicated ? 'A database inside this service’s OWN cluster.' : 'A database inside the shared cluster, not a StatefulSet of its own.'}
# The service owns this database and its migrations; it must never read another
# service's tables — that is what the events are for.
apiVersion: postgresql.cnpg.io/v1
kind: Database
metadata:
  name: ${spec.name}
  namespace: data
spec:
  name: ${spec.name}
  owner: ${spec.name}
  cluster:
    name: ${dbCluster}
  ensure: present
`,
    },
    {
      path: `${dir}/db-credentials.yaml`,
      contents: `# Generates the password in-cluster on first run and does nothing on every run
# after. No credential is ever written to git — the pattern the reference repo
# used for two services and should have used for all of them.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${spec.name}-db-bootstrap
  namespace: data
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${spec.name}-db-bootstrap
  namespace: data
rules:
  - apiGroups: ['']
    resources: [secrets]
    verbs: [get, create]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${spec.name}-db-bootstrap
  namespace: data
subjects:
  - kind: ServiceAccount
    name: ${spec.name}-db-bootstrap
    namespace: data
roleRef:
  kind: Role
  name: ${spec.name}-db-bootstrap
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: batch/v1
kind: Job
metadata:
  name: ${spec.name}-db-credentials
  namespace: data
  annotations:
    argocd.argoproj.io/hook: PreSync
spec:
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      serviceAccountName: ${spec.name}-db-bootstrap
      restartPolicy: OnFailure
      containers:
        - name: bootstrap
          image: bitnami/kubectl:1.34
          command: ['/bin/sh', '-c']
          args:
            - |
              set -eu
              if kubectl -n data get secret ${spec.name}-db >/dev/null 2>&1; then
                echo "secret already exists, nothing to do"; exit 0
              fi
              PASSWORD="\$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
              kubectl -n data create secret generic ${spec.name}-db \\
                --from-literal=username=${spec.name} \\
                --from-literal=password="\$PASSWORD" \\
                --from-literal=host=${dbHost} \\
                --from-literal=dbname=${spec.name}
`,
    },
    ...(dedicated
      ? [
          {
            path: `${dir}/postgres-cluster.yaml`,
            contents: `# This service's OWN Postgres cluster.
#
# Chosen over a database in the shared cluster when physical isolation is worth
# the cost. What it buys, and what the shared cluster cannot give:
#
#   - A runaway query starves only this service, not all of them.
#   - Its own Postgres version and upgrade window.
#   - Its own backup schedule and retention.
#   - Its own WAL. On the shared cluster every service's Debezium slot sits on
#     ONE write-ahead log, so a stalled consumer retains WAL for everybody and
#     can fill the shared disk. Here that blast radius is one service.
#
# What it costs: ${spec.dbInstances ?? 2} more pods, another cluster to upgrade, and another
# backup to verify. Do this per service, deliberately — not as a house style.
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: ${dbCluster}
  namespace: data
spec:
  # Two, not one: one instance cannot survive a node reboot. Three only if you
  # want quorum synchronous replication.
  instances: ${spec.dbInstances ?? 2}
  imageName: ghcr.io/cloudnative-pg/postgresql:17.7

  postgresql:
    parameters:
      # Debezium reads the WAL. Without logical decoding the outbox never leaves
      # the database and no service hears about anything.
      wal_level: logical
      # Sized for one service, not for all of them.
      max_replication_slots: '8'
      max_wal_senders: '8'
      max_connections: '100'

  storage:
    size: ${spec.dbStorage ?? '20Gi'}
    storageClass: local-path

  monitoring:
    enablePodMonitor: true

  backup:
    retentionPolicy: 30d
    barmanObjectStore:
      # Its own prefix. A shared prefix means one service's restore can walk
      # over another's base backups.
      destinationPath: s3://${brand}-backups/postgres/${spec.name}
      endpointURL: http://minio.data.svc:9000
      s3Credentials:
        accessKeyId:
          name: pg-backup-creds
          key: ACCESS_KEY_ID
        secretAccessKey:
          name: pg-backup-creds
          key: ACCESS_SECRET_KEY
      wal:
        compression: gzip
---
# A backup nobody scheduled is a backup nobody has.
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: ${dbCluster}-daily
  namespace: data
spec:
  schedule: '0 30 2 * * *'
  backupOwnerReference: self
  cluster:
    name: ${dbCluster}
`,
          },
        ]
      : []),
    {
      path: `${dir}/topic.yaml`,
      // One topic per aggregate, not one per service. The Debezium router below
      // emits `<service>.<aggregatetype>.v1`, and a service publishing billing
      // AND payment events produces two of those. With auto-creation off — which
      // is the safe setting — a topic nobody declared is a message nobody gets.
      contents: topics
        .map(
          (topic) => `# Declared to match what @${brand}/events derives and what the router produces.
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: ${topic}
  namespace: kafka
  labels:
    strimzi.io/cluster: ${brand}-kafka
spec:
  partitions: 3
  replicas: 3
  config:
    retention.ms: 604800000
    min.insync.replicas: 2
---
# Poison messages land here instead of blocking the partition behind them.
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: ${topic}.dlq
  namespace: kafka
  labels:
    strimzi.io/cluster: ${brand}-kafka
spec:
  partitions: 1
  replicas: 3
  config:
    retention.ms: 2592000000
`,
        )
        .join('---\n'),
    },
    {
      path: `${dir}/debezium.yaml`,
      contents: `# Tails this service's WAL and publishes its outbox rows.
#
# The EventRouter settings MUST match the header names the consumer reads in
# apps/server/src/modules/events/application/event-consumer.service.ts. Change
# one side and events arrive that no handler recognises.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: debezium-${spec.name}
  namespace: kafka
spec:
  replicas: 1
  strategy:
    # Two connectors on one replication slot corrupt each other's offsets.
    type: Recreate
  selector:
    matchLabels: { app: debezium-${spec.name} }
  template:
    metadata:
      labels: { app: debezium-${spec.name} }
    spec:
      containers:
        - name: debezium
          image: quay.io/debezium/server:3.2.0.Final
          env:
            - name: DEBEZIUM_SINK_TYPE
              value: kafka
            - name: DEBEZIUM_SINK_KAFKA_PRODUCER_BOOTSTRAP_SERVERS
              value: ${brand}-kafka-kafka-bootstrap.kafka.svc:9092
            - name: DEBEZIUM_SINK_KAFKA_PRODUCER_KEY_SERIALIZER
              value: org.apache.kafka.common.serialization.StringSerializer
            - name: DEBEZIUM_SINK_KAFKA_PRODUCER_VALUE_SERIALIZER
              value: org.apache.kafka.common.serialization.StringSerializer
            - name: DEBEZIUM_SOURCE_CONNECTOR_CLASS
              value: io.debezium.connector.postgresql.PostgresConnector
            - name: DEBEZIUM_SOURCE_OFFSET_STORAGE_FILE_FILENAME
              value: /debezium/data/offsets.dat
            - name: DEBEZIUM_SOURCE_DATABASE_HOSTNAME
              value: ${dbHost}
            - name: DEBEZIUM_SOURCE_DATABASE_PORT
              value: '5432'
            - name: DEBEZIUM_SOURCE_DATABASE_DBNAME
              value: ${spec.name}
            - name: DEBEZIUM_SOURCE_DATABASE_USER
              valueFrom: { secretKeyRef: { name: ${spec.name}-db, key: username } }
            - name: DEBEZIUM_SOURCE_DATABASE_PASSWORD
              valueFrom: { secretKeyRef: { name: ${spec.name}-db, key: password } }
            - name: DEBEZIUM_SOURCE_TOPIC_PREFIX
              value: ${spec.name}
            - name: DEBEZIUM_SOURCE_PLUGIN_NAME
              value: pgoutput
            - name: DEBEZIUM_SOURCE_PUBLICATION_NAME
              value: ${spec.name}_outbox
            - name: DEBEZIUM_SOURCE_PUBLICATION_AUTOCREATE_MODE
              value: disabled
            - name: DEBEZIUM_SOURCE_TABLE_INCLUDE_LIST
              value: public.outbox_events
            - name: DEBEZIUM_SOURCE_SLOT_NAME
              value: ${spec.name}_outbox_slot
            - name: DEBEZIUM_TRANSFORMS
              value: outbox
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TYPE
              value: io.debezium.transforms.outbox.EventRouter
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_FIELD_EVENT_ID
              value: id
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_FIELD_EVENT_KEY
              value: aggregateid
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_FIELD_EVENT_TYPE
              value: type
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_FIELD_EVENT_TIMESTAMP
              value: created_at
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_FIELD_EVENT_PAYLOAD
              value: payload
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_EXPAND_JSON_PAYLOAD
              value: 'true'
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_TABLE_FIELDS_ADDITIONAL_PLACEMENT
              value: type:header:eventType,tenant_id:header:tenantId
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_ROUTE_BY_FIELD
              value: aggregatetype
            - name: DEBEZIUM_TRANSFORMS_OUTBOX_ROUTE_TOPIC_REPLACEMENT
              value: ${spec.name}.\${routedByValue}.v1
          volumeMounts:
            - name: data
              mountPath: /debezium/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: debezium-${spec.name}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: debezium-${spec.name}
  namespace: kafka
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
`,
    },
  ];
}

/**
 * Generate the manifests for an open-source tool running as a cluster service.
 *
 * The difference from a service you wrote: there is no repository to sync, so
 * the workload is declared here rather than pulled from a `k8s/` directory. It
 * still gets a database in the shared cluster and a generated credential — the
 * same treatment, so nothing about it is a special case at operations time.
 */
export function generateToolService(spec: ServiceSpec & { tool: ToolDeploySpec & { id: string } }): GeneratedFile[] {
  if (!NAME_RE.test(spec.name)) {
    throw new Error(`"${spec.name}" is not a valid service name`);
  }
  const { brand, tool } = spec;
  const name = spec.name;
  const ns = spec.namespace ?? brand;
  const dir = `gitops/apps/${name}`;
  const files: GeneratedFile[] = [];

  // `{{db.*}}` is resolved by envFrom + a secret reference, never by writing the
  // password into a manifest.
  const env = Object.entries(tool.env ?? {}).map(([key, value]) => {
    const resolved = value
      .replaceAll('{{brand}}', brand)
      .replaceAll('{{db.name}}', name)
      // Resolved from the SECRET, not from the brand: a service on a dedicated
      // cluster that still points at `<brand>-pg` creates its database in one
      // cluster and connects to another, where it does not exist.
      .replaceAll('{{db.host}}', `$(DB_HOST)`)
      .replaceAll('{{db.username}}', `$(DB_USERNAME)`)
      .replaceAll('{{db.password}}', `$(DB_PASSWORD)`);
    return `            - name: ${key}\n              value: "${resolved}"`;
  });

  const dbEnv = tool.needsDatabase
    ? `            - name: DB_HOST
              valueFrom: { secretKeyRef: { name: ${name}-db, key: host } }
            - name: DB_USERNAME
              valueFrom: { secretKeyRef: { name: ${name}-db, key: username } }
            - name: DB_PASSWORD
              valueFrom: { secretKeyRef: { name: ${name}-db, key: password } }
`
    : '';

  const volume = tool.storage
    ? `          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: ${name}
`
    : '';

  files.push({
    path: `${dir}/deployment.yaml`,
    contents: `# ${tool.id}, deployed as a service. Generated — regenerate rather than editing,
# or the next \`service add\` will disagree with what is running.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
  labels: { app: ${name}, ${brand}.io/source: ${tool.id} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${name} }
  template:
    metadata:
      labels: { app: ${name} }
    spec:
      containers:
        - name: ${name}
          image: ${tool.image}
          ports:
            - containerPort: ${tool.port}
          env:
${dbEnv}${env.join('\n')}
          readinessProbe:
            tcpSocket: { port: ${tool.port} }
            initialDelaySeconds: 10
          livenessProbe:
            tcpSocket: { port: ${tool.port} }
            initialDelaySeconds: 30
${volume}---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  selector: { app: ${name} }
  ports:
    - port: ${tool.port}
      targetPort: ${tool.port}
`,
  });

  if (tool.storage) {
    files.push({
      path: `${dir}/storage.yaml`,
      contents: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: ${tool.storage}
`,
    });
  }

  if (tool.needsDatabase) {
    // Same cluster choice, same generated-in-cluster credential as a service you
    // wrote. A bought-in tool is not a reason to keep a password in git — nor a
    // reason it cannot have a cluster of its own.
    const written = generateService({ ...spec, aggregates: spec.aggregates, database: spec.database });
    // `postgres-cluster.yaml` exists only for a dedicated database; without it
    // here, `--database dedicated` on a tool would point its Database CR at a
    // cluster nothing ever created.
    for (const suffix of ['postgres-cluster.yaml', 'database.yaml', 'db-credentials.yaml']) {
      const file = written.find((f) => f.path.endsWith(suffix));
      if (file) files.push({ ...file, path: `${dir}/${suffix}` });
    }
  }

  if (tool.ingress) {
    const host = `${name}.${spec.rootDomain ?? `${brand}.local`}`;
    files.push({
      path: `${dir}/ingress.yaml`,
      contents: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name}
  namespace: ${ns}
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: traefik
  tls:
    - hosts: [${host}]
      secretName: ${name}-tls
  rules:
    - host: ${host}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${name}
                port: { number: ${tool.port} }
`,
    });
  }

  return files;
}

/**
 * Load-balancing configuration for a service.
 *
 * Emitted alongside the Deployment rather than baked into it, so changing the
 * strategy is a small reviewable diff instead of a rewrite of the workload.
 */
export function generateLoadBalancing(spec: ServiceSpec, workloadName?: string): GeneratedFile[] {
  // The workload name differs by generator — a written service is `<name>-api`,
  // a bought-in tool is `<name>`. Both must land in the SAME directory as the
  // workload they configure, or Argo syncs two half-services.
  const name = workloadName ?? spec.name;
  const ns = spec.namespace ?? spec.brand;
  const strategy = spec.loadBalancing ?? 'round-robin';
  const dir = `gitops/apps/${name}`;

  if (strategy === 'round-robin') {
    // Kubernetes Services already round-robin across ready endpoints. Emitting a
    // config object to say "do the default" is noise that later reads as intent.
    return [];
  }

  if (strategy === 'sticky') {
    return [
      {
        path: `${dir}/load-balancing.yaml`,
        contents: `# Sticky sessions: a client returns to the same replica.
#
# Only correct when a replica holds state a request needs — an in-memory session,
# a websocket, a long upload. The costs are real: traffic stops being evenly
# spread, one replica's death drops its clients' sessions, and a rolling deploy
# reshuffles everyone at once.
#
# If the state can live in Redis instead, put it there and use round-robin.
apiVersion: traefik.io/v1alpha1
kind: ServersTransport
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  # A replica that has stopped responding should be abandoned, not waited on.
  forwardingTimeouts:
    dialTimeout: 5s
    responseHeaderTimeout: 30s
---
apiVersion: traefik.io/v1alpha1
kind: TraefikService
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  weighted:
    services:
      - name: ${name}
        port: 8080
    sticky:
      cookie:
        name: ${name}_affinity
        secure: true
        httpOnly: true
        sameSite: lax
`,
      },
    ];
  }

  // canary
  const weight = Math.min(100, Math.max(0, spec.canaryWeight ?? 10));
  return [
    {
      path: `${dir}/load-balancing.yaml`,
      contents: `# Canary: ${weight}% of traffic to the new version, ${100 - weight}% to the stable one.
#
# A temporary state, not a resting place. Watch the canary's error rate and
# latency against the stable version, then move the weight to 100 or back to 0.
# A canary left at 10% forever is two versions in production and two sets of bugs.
#
# Both Deployments must exist: \`${name}\` and \`${name}-canary\`.
apiVersion: traefik.io/v1alpha1
kind: TraefikService
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  weighted:
    services:
      - name: ${name}
        port: 8080
        weight: ${100 - weight}
      - name: ${name}-canary
        port: 8080
        weight: ${weight}
`,
    },
  ];
}
