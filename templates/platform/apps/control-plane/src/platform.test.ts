import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseAllDocuments } from 'yaml';

import { allocateAddress, intToIp, ipToInt, isWithin, parseCidr } from './cluster/wireguard.ts';
import {
  addNode,
  DEFAULT_SETTINGS,
  disruptionWarning,
  nextNodeName,
  renderInventory,
  type ClusterNode,
} from './cluster/inventory.ts';
import { generateService, generateToolService, generateLoadBalancing } from './services/generate.ts';

const cp: ClusterNode = {
  name: 'simbkit-cp-01',
  ip: '203.0.113.10',
  wireguardIp: '10.89.0.1',
  role: 'control-plane',
};
const wk1: ClusterNode = {
  name: 'simbkit-wk-01',
  ip: '203.0.113.11',
  wireguardIp: '10.89.0.2',
  role: 'worker',
};

// ── WireGuard addressing ────────────────────────────────────────────────────

test('ipv4 conversion survives the high bit', () => {
  // A signed shift makes anything above 127.x negative and inverts every
  // comparison built on it.
  for (const ip of ['0.0.0.0', '10.89.0.1', '192.168.1.1', '203.0.113.10', '255.255.255.255']) {
    assert.equal(intToIp(ipToInt(ip)), ip, ip);
    assert.ok(ipToInt(ip) >= 0, `${ip} must not be negative`);
  }
});

test('allocation returns the lowest free address', () => {
  assert.equal(allocateAddress('10.89.0.0/24', []), '10.89.0.1');
  assert.equal(allocateAddress('10.89.0.0/24', ['10.89.0.1']), '10.89.0.2');
  assert.equal(allocateAddress('10.89.0.0/24', ['10.89.0.1', '10.89.0.2']), '10.89.0.3');
});

test('a freed address is reused, and a taken one never is', () => {
  // Counting nodes instead of reading the set hands two nodes the same address,
  // which breaks the mesh in a way that looks like a firewall problem.
  const taken = ['10.89.0.1', '10.89.0.3'];
  assert.equal(allocateAddress('10.89.0.0/24', taken), '10.89.0.2');
  const next = allocateAddress('10.89.0.0/24', [...taken, '10.89.0.2']);
  assert.equal(next, '10.89.0.4');
  assert.ok(!taken.includes(next));
});

test('network and broadcast addresses are never handed out', () => {
  const used = Array.from({ length: 253 }, (_, i) => `10.89.0.${i + 1}`);
  assert.equal(allocateAddress('10.89.0.0/24', used), '10.89.0.254');
  const full = [...used, '10.89.0.254'];
  assert.throws(() => allocateAddress('10.89.0.0/24', full), /no free address/);
});

test('CIDR parsing rejects what would silently mis-allocate', () => {
  assert.deepEqual(parseCidr('10.89.0.0/24'), { network: '10.89.0.0', prefix: 24 });
  assert.throws(() => parseCidr('10.89.0.0'), /not a CIDR/);
  assert.throws(() => parseCidr('10.89.0.0/33'), /unsupported prefix/);
  assert.throws(() => parseCidr('999.1.1.1/24'), /not a CIDR/);
});

test('membership check respects the prefix', () => {
  assert.ok(isWithin('10.89.0.0/24', '10.89.0.7'));
  assert.ok(!isWithin('10.89.0.0/24', '10.89.1.7'));
  assert.ok(isWithin('10.89.0.0/16', '10.89.1.7'));
});

// ── Inventory ───────────────────────────────────────────────────────────────

test('the first node becomes the control plane, the rest are workers', () => {
  const first = addNode([], { ip: '203.0.113.10' });
  assert.equal(first.role, 'control-plane');
  assert.equal(first.name, 'simbkit-cp-01');
  assert.equal(first.wireguardIp, '10.89.0.1');

  const second = addNode([first], { ip: '203.0.113.11' });
  assert.equal(second.role, 'worker');
  assert.equal(second.name, 'simbkit-wk-01');
  assert.equal(second.wireguardIp, '10.89.0.2');
});

test('a second control plane is refused rather than half-supported', () => {
  // k3s HA needs an embedded etcd and a load balancer in front of the API.
  // "Joining" a second server without them produces a split cluster.
  assert.throws(
    () => addNode([cp], { ip: '203.0.113.99', role: 'control-plane' }),
    /control plane already exists/,
  );
});

test('a duplicate IP or name is refused', () => {
  assert.throws(() => addNode([cp, wk1], { ip: '203.0.113.11' }), /already in the cluster/);
  assert.throws(
    () => addNode([cp, wk1], { ip: '203.0.113.12', name: 'simbkit-wk-01' }),
    /is taken/,
  );
});

test('node names must be valid Kubernetes object names', () => {
  assert.throws(() => addNode([cp], { ip: '203.0.113.12', name: 'Worker_1' }), /not a valid node name/);
  assert.throws(() => addNode([cp], { ip: '203.0.113.12', name: '1worker' }), /not a valid node name/);
});

test('names skip the ones already used', () => {
  assert.equal(nextNodeName('simbkit', 'worker', [cp, wk1]), 'simbkit-wk-02');
});

test('the three worker lists are index-aligned by construction', () => {
  // The reference kept these aligned by care. Every downstream step configures
  // the wrong host the moment they drift.
  let nodes: ClusterNode[] = [];
  for (const ip of ['203.0.113.10', '203.0.113.11', '203.0.113.12', '203.0.113.13']) {
    nodes = [...nodes, addNode(nodes, { ip })];
  }
  const env = renderInventory(nodes);
  const read = (key: string) =>
    /"([^"]*)"/.exec(env.split('\n').find((l) => l.startsWith(key))!)![1]!.split(' ');

  const ips = read('SIMBKIT_WORKER_IPS');
  const names = read('SIMBKIT_WORKER_NAMES');
  const wgs = read('SIMBKIT_WORKER_WG_IPS');
  assert.equal(ips.length, 3);
  assert.equal(names.length, 3);
  assert.equal(wgs.length, 3);
  for (let i = 0; i < ips.length; i++) {
    const node = nodes.find((n) => n.ip === ips[i])!;
    assert.equal(names[i], node.name, `name at index ${i}`);
    assert.equal(wgs[i], node.wireguardIp, `wg ip at index ${i}`);
  }
});

test('inventory refuses an address outside the mesh range', () => {
  const stray: ClusterNode = { ...wk1, wireguardIp: '10.90.0.5' };
  assert.throws(() => renderInventory([cp, stray]), /outside 10\.89\.0\.0\/24/);
});

test('inventory refuses a cluster with no control plane', () => {
  assert.throws(() => renderInventory([wk1]), /no control plane/);
});

test('the operator is warned that adding a node flaps the mesh', () => {
  assert.equal(disruptionWarning([]), null);
  assert.match(disruptionWarning([cp, wk1])!, /2 existing node/);
});

test('inventory uses the brand as the variable prefix', () => {
  const env = renderInventory([cp], { ...DEFAULT_SETTINGS, brand: 'acme' });
  assert.match(env, /ACME_CONTROL_PLANE_IP=203\.0\.113\.10/);
});

// ── Service generation ──────────────────────────────────────────────────────

test('a service generates five files and all of them are valid YAML', () => {
  const files = generateService({ name: 'billing', brand: 'simbkit' });
  assert.equal(files.length, 5);
  for (const file of files) {
    const docs = parseAllDocuments(file.contents);
    assert.ok(docs.length > 0, `${file.path} is empty`);
    for (const doc of docs) {
      assert.deepEqual(doc.errors, [], `${file.path}: ${doc.errors.map((e) => e.message).join(', ')}`);
      const value = doc.toJS() as { kind?: string };
      assert.ok(value.kind, `${file.path}: a document has no kind`);
    }
  }
});

test('the Debezium router and the topic agree on the topic name', () => {
  // These are two halves of one contract in two files. If they disagree, events
  // are published where nothing is listening and nobody sees an error.
  const files = generateService({ name: 'billing', brand: 'simbkit', aggregates: ['invoice'] });
  const topics = parseAllDocuments(files.find((f) => f.path.endsWith('topic.yaml'))!.contents)
    .map((d) => (d.toJS() as { metadata: { name: string } }).metadata.name);
  assert.ok(topics.includes('billing.invoice.v1'));
  assert.ok(topics.includes('billing.invoice.v1.dlq'));

  const debezium = files.find((f) => f.path.endsWith('debezium.yaml'))!.contents;
  assert.match(debezium, /billing\.\$\{routedByValue\}\.v1/);
  assert.match(debezium, /DEBEZIUM_TRANSFORMS_OUTBOX_ROUTE_BY_FIELD\n\s+value: aggregatetype/);
});

test('the Debezium headers match what the service consumer reads', () => {
  const debezium = generateService({ name: 'billing', brand: 'simbkit' }).find((f) =>
    f.path.endsWith('debezium.yaml'),
  )!.contents;
  // The consumer looks for exactly these three.
  assert.match(debezium, /TABLE_FIELD_EVENT_ID\n\s+value: id/);
  assert.match(debezium, /type:header:eventType,tenant_id:header:tenantId/);
});

test('no generated file contains a plaintext credential', () => {
  // Two live passwords were committed in the repo this replaces. Every secret
  // here is generated in-cluster or read from a secretKeyRef.
  for (const file of generateService({ name: 'billing', brand: 'simbkit' })) {
    assert.ok(
      !/password:\s*['"]?[A-Za-z0-9]{8,}/.test(file.contents),
      `${file.path} looks like it contains a literal password`,
    );
  }
});

test('the database points at the shared cluster, not a StatefulSet of its own', () => {
  const db = parse(
    generateService({ name: 'billing', brand: 'simbkit' }).find((f) => f.path.endsWith('database.yaml'))!
      .contents,
  ) as { kind: string; spec: { cluster: { name: string } } };
  assert.equal(db.kind, 'Database');
  assert.equal(db.spec.cluster.name, 'simbkit-pg');
});


test('service names that are not valid Kubernetes names are refused', () => {
  for (const bad of ['Billing', 'billing_api', '1billing', 'billing-']) {
    assert.throws(() => generateService({ name: bad, brand: 'simbkit' }), /not a valid service name/, bad);
  }
});

test('topics are replicated and require a quorum', () => {
  // replicas: 1 means losing one broker loses the topic.
  const topics = parseAllDocuments(
    generateService({ name: 'billing', brand: 'simbkit' }).find((f) => f.path.endsWith('topic.yaml'))!
      .contents,
  ).map((d) => d.toJS() as { spec: { replicas: number; config?: Record<string, unknown> } });
  for (const topic of topics) assert.equal(topic.spec.replicas, 3);
  assert.equal(topics[0]!.spec.config?.['min.insync.replicas'], 2);
});

// ── Tools deployed as services ──────────────────────────────────────────────

const blnk = {
  image: 'jerryenebeli/blnk:0.15.3',
  port: 5001,
  needsDatabase: true,
  env: {
    BLNK_DATA_SOURCE_DNS:
      // {{db.host}}, not {{brand}}-pg: the host follows the service's database
      // choice, and comes from the secret rather than the brand.
      'postgres://{{db.username}}:{{db.password}}@{{db.host}}:5432/{{db.name}}',
  },
};

test('a tool service generates a workload, and every document is valid', () => {
  const files = generateToolService({
    name: 'ledger',
    brand: 'simbkit',
    tool: { id: 'blnk', ...blnk },
  });
  const paths = files.map((f) => f.path.split('/').pop());
  assert.deepEqual(paths.sort(), ['database.yaml', 'db-credentials.yaml', 'deployment.yaml']);

  for (const file of files) {
    for (const doc of parseAllDocuments(file.contents)) {
      assert.deepEqual(doc.errors, [], `${file.path}: ${doc.errors.map((e) => e.message).join(', ')}`);
      assert.ok((doc.toJS() as { kind?: string }).kind, `${file.path}: document without a kind`);
    }
  }
});

test('a tool credential is referenced, never written into the manifest', () => {
  // The whole point of generating this rather than copying a compose file.
  const deployment = generateToolService({
    name: 'ledger',
    brand: 'simbkit',
    tool: { id: 'blnk', ...blnk },
  }).find((f) => f.path.endsWith('deployment.yaml'))!.contents;

  assert.match(deployment, /secretKeyRef: \{ name: ledger-db, key: password \}/);
  // The password reaches the process through an env indirection, so the literal
  // never exists in git.
  assert.match(deployment, /\$\(DB_PASSWORD\)/);
  assert.ok(!/password.*blnk_dev/i.test(deployment));
});

test('a tool service still gets a database in the SHARED cluster', () => {
  // A bought-in tool is not a reason to run a second, unbacked-up Postgres.
  const db = parse(
    generateToolService({ name: 'ledger', brand: 'simbkit', tool: { id: 'blnk', ...blnk } }).find(
      (f) => f.path.endsWith('database.yaml'),
    )!.contents,
  ) as { spec: { cluster: { name: string } } };
  assert.equal(db.spec.cluster.name, 'simbkit-pg');
});


test('a stateless tool gets no PVC, a stateful one does', () => {
  const stateless = generateToolService({
    name: 'pdf',
    brand: 'simbkit',
    tool: { id: 'gotenberg', image: 'gotenberg/gotenberg:8', port: 3000 },
  });
  assert.ok(!stateless.some((f) => f.path.endsWith('storage.yaml')));

  const stateful = generateToolService({
    name: 'search',
    brand: 'simbkit',
    tool: { id: 'meilisearch', image: 'getmeili/meilisearch:v1.24', port: 7700, storage: '20Gi' },
  });
  const pvc = stateful.find((f) => f.path.endsWith('storage.yaml'));
  assert.ok(pvc);
  assert.match(pvc.contents, /storage: 20Gi/);
});

test('ingress is opt-in, and internal-only is the default', () => {
  // A tool exposed by accident is a tool on the public internet.
  const internal = generateToolService({
    name: 'search',
    brand: 'simbkit',
    tool: { id: 'meilisearch', image: 'x', port: 7700 },
  });
  assert.ok(!internal.some((f) => f.path.endsWith('ingress.yaml')));

  const exposed = generateToolService({
    name: 'auth',
    brand: 'simbkit',
    rootDomain: 'acme.com',
    tool: { id: 'keycloak', image: 'x', port: 8080, ingress: true },
  });
  const ingress = exposed.find((f) => f.path.endsWith('ingress.yaml'))!;
  assert.match(ingress.contents, /host: auth\.acme\.com/);
  assert.match(ingress.contents, /cert-manager\.io\/cluster-issuer/);
});

test('tool env placeholders are all resolved', () => {
  const deployment = generateToolService({
    name: 'ledger',
    brand: 'acme',
    tool: { id: 'blnk', ...blnk },
  }).find((f) => f.path.endsWith('deployment.yaml'))!.contents;

  assert.match(deployment, /\$\(DB_HOST\)/);
  // An unresolved {{...}} would reach the container as a literal.
  assert.ok(!deployment.includes('{{'), 'an unresolved placeholder survived');
});

test('a tool service is labelled with what it came from', () => {
  // Six months later, "why is there a deployment called ledger" has an answer.
  const deployment = generateToolService({
    name: 'ledger',
    brand: 'simbkit',
    tool: { id: 'blnk', ...blnk },
  }).find((f) => f.path.endsWith('deployment.yaml'))!.contents;
  assert.match(deployment, /simbkit\.io\/source: blnk/);
});

// ── Load balancing ──────────────────────────────────────────────────────────

test('round-robin emits nothing — it is what Kubernetes already does', () => {
  // A config object that says "do the default" is noise that later reads as
  // deliberate intent.
  assert.deepEqual(generateLoadBalancing({ name: 'api', brand: 'simbkit' }), []);
  assert.deepEqual(
    generateLoadBalancing({ name: 'api', brand: 'simbkit', loadBalancing: 'round-robin' }),
    [],
  );
});

test('sticky sessions produce a secure, httpOnly affinity cookie', () => {
  const files = generateLoadBalancing({ name: 'api', brand: 'simbkit', loadBalancing: 'sticky' });
  const doc = files[0]!.contents;
  for (const d of parseAllDocuments(doc)) {
    assert.deepEqual(d.errors, [], `${files[0]!.path}: ${d.errors.map((e) => e.message).join(', ')}`);
  }
  // An affinity cookie readable by script, or sent over http, is a session
  // fixation primitive.
  assert.match(doc, /secure: true/);
  assert.match(doc, /httpOnly: true/);
  assert.match(doc, /sameSite: lax/);
});

test('a canary splits weights that add to 100', () => {
  const files = generateLoadBalancing({
    name: 'api',
    brand: 'simbkit',
    loadBalancing: 'canary',
    canaryWeight: 20,
  });
  const doc = parseAllDocuments(files[0]!.contents)[0]!.toJS() as {
    spec: { weighted: { services: Array<{ name: string; weight: number }> } };
  };
  const services = doc.spec.weighted.services;
  assert.equal(services.reduce((n, s) => n + s.weight, 0), 100, 'weights must total 100');
  assert.equal(services.find((s) => s.name === 'api-canary')?.weight, 20);
  assert.equal(services.find((s) => s.name === 'api')?.weight, 80);
});

test('a canary weight outside 0-100 is clamped, not emitted as nonsense', () => {
  for (const [given, expected] of [[-10, 0], [150, 100]] as const) {
    const doc = parseAllDocuments(
      generateLoadBalancing({
        name: 'api',
        brand: 'simbkit',
        loadBalancing: 'canary',
        canaryWeight: given,
      })[0]!.contents,
    )[0]!.toJS() as { spec: { weighted: { services: Array<{ name: string; weight: number }> } } };
    assert.equal(doc.spec.weighted.services.find((s) => s.name === 'api-canary')?.weight, expected);
  }
});

test('balancing config lands in the same directory as the workload it configures', () => {
  // A written service is `<name>-api`; a tool service is `<name>`. Two
  // directories for one service means Argo syncs two half-services.
  const written = generateService({ name: 'billing', brand: 'simbkit' });
  const balancing = generateLoadBalancing(
    { name: 'billing', brand: 'simbkit', loadBalancing: 'sticky' },
    'billing-api',
  );
  const dir = (f: { path: string }) => f.path.split('/').slice(0, 3).join('/');
  assert.equal(dir(balancing[0]!), dir(written[0]!));

  const tool = generateToolService({
    name: 'search',
    brand: 'simbkit',
    tool: { id: 'meilisearch', image: 'x', port: 7700 },
  });
  const toolBalancing = generateLoadBalancing(
    { name: 'search', brand: 'simbkit', loadBalancing: 'sticky' },
  );
  assert.equal(dir(toolBalancing[0]!), dir(tool[0]!));
});

test('a service gets one Kafka topic per aggregate, not one per service', () => {
  // The Debezium router emits `<service>.<aggregatetype>.v1`. A billing service
  // publishes billing AND payment events, so both topics must be declared —
  // with auto-creation off, a topic nobody declared is a message nobody gets.
  const files = generateService({ name: 'billing', brand: 'simbkit', aggregates: ['billing', 'payment'] });
  const topics = parseAllDocuments(files.find((f) => f.path.endsWith('topic.yaml'))!.contents)
    .map((d) => (d.toJS() as { metadata: { name: string } }).metadata.name);
  assert.deepEqual(topics.sort(), [
    'billing.billing.v1',
    'billing.billing.v1.dlq',
    'billing.payment.v1',
    'billing.payment.v1.dlq',
  ]);

  // Default stays one topic named after the service.
  const single = parseAllDocuments(
    generateService({ name: 'chat', brand: 'simbkit' }).find((f) => f.path.endsWith('topic.yaml'))!.contents,
  ).map((d) => (d.toJS() as { metadata: { name: string } }).metadata.name);
  assert.deepEqual(single, ['chat.chat.v1', 'chat.chat.v1.dlq']);
});

test('shared is the default: a database of its own inside the platform cluster', () => {
  // Logical isolation is already the floor — its own database, its own owner
  // role, no way to read another service's tables. What `dedicated` adds is
  // physical isolation, and it is not free.
  const files = generateService({ name: 'billing', brand: 'simbkit' });
  const db = files.find((f) => f.path.endsWith('database.yaml'))!.contents;
  assert.match(db, /cluster:\n\s+name: simbkit-pg/);
  assert.equal(files.some((f) => f.path.endsWith('postgres-cluster.yaml')), false);

  // Debezium reads the same cluster the database lives in, or it tails the
  // wrong WAL and no event ever leaves.
  const debezium = files.find((f) => f.path.endsWith('debezium.yaml'))!.contents;
  assert.match(debezium, /value: simbkit-pg-rw\.data\.svc/);
});

test('dedicated gives the service its own cluster, backup and WAL', () => {
  const files = generateService({ name: 'billing', brand: 'simbkit', database: 'dedicated' });
  const cluster = files.find((f) => f.path.endsWith('postgres-cluster.yaml'));
  assert.ok(cluster, 'a dedicated service must get a Cluster of its own');

  const docs = parseAllDocuments(cluster.contents).map((d) => d.toJS() as Record<string, never>);
  const kinds = docs.map((d) => d.kind);
  assert.deepEqual(kinds, ['Cluster', 'ScheduledBackup']);

  const pg = docs[0] as unknown as {
    metadata: { name: string };
    spec: { instances: number; postgresql: { parameters: Record<string, string> }; backup: { barmanObjectStore: { destinationPath: string } } };
  };
  assert.equal(pg.metadata.name, 'billing-pg');
  // One instance cannot survive a node reboot.
  assert.ok(pg.spec.instances >= 2);
  // Without logical decoding the outbox never leaves the database.
  assert.equal(pg.spec.postgresql.parameters.wal_level, 'logical');
  // A shared backup prefix means one restore walking over another's base backups.
  assert.match(pg.spec.backup.barmanObjectStore.destinationPath, /\/billing$/);
});

test('every reference follows the database choice, not just the Database CR', () => {
  // The failure this catches is silent and total: point Debezium at the shared
  // cluster while the tables live in a dedicated one, and the connector tails a
  // WAL that never contains this service's outbox. Nothing errors; no event
  // ever arrives.
  const files = generateService({ name: 'billing', brand: 'simbkit', database: 'dedicated' });
  const db = files.find((f) => f.path.endsWith('database.yaml'))!.contents;
  const debezium = files.find((f) => f.path.endsWith('debezium.yaml'))!.contents;
  const creds = files.find((f) => f.path.endsWith('db-credentials.yaml'))!.contents;

  assert.match(db, /cluster:\n\s+name: billing-pg/);
  assert.match(debezium, /value: billing-pg-rw\.data\.svc/);
  // The service reads its host from the secret rather than hardcoding a cluster
  // name it would get wrong the moment this choice changed.
  assert.match(creds, /--from-literal=host=billing-pg-rw\.data\.svc/);
  for (const file of [db, debezium, creds]) {
    assert.ok(!file.includes('simbkit-pg-rw'), 'a dedicated service still points at the shared cluster');
  }
});

test('a dedicated cluster is still valid YAML and names no plaintext credential', () => {
  const files = generateService({ name: 'billing', brand: 'simbkit', database: 'dedicated' });
  for (const file of files) {
    for (const doc of parseAllDocuments(file.contents)) {
      assert.deepEqual(doc.errors, [], `${file.path}: ${doc.errors.map((e) => e.message).join(', ')}`);
    }
    assert.ok(!/password:\s*['"]?[A-Za-z0-9]{8,}/.test(file.contents), `${file.path} has a literal password`);
  }
});

test('a tool reads its database host from the secret, and can be given its own cluster', () => {
  // The host lives in the secret rather than baked into the workload, so moving
  // a service to a dedicated cluster does not mean editing its deployment.
  const shared = generateToolService({ name: 'ledger', brand: 'simbkit', tool: { id: 'blnk', ...blnk } });
  const workload = shared.find((f) => f.path.endsWith('deployment.yaml'))!.contents;
  assert.match(workload, /name: DB_HOST/);
  assert.match(workload, /key: host/);
  assert.ok(!workload.includes('simbkit-pg-rw'), 'the cluster name is hardcoded into the workload');

  const dedicated = generateToolService({
    name: 'ledger',
    brand: 'simbkit',
    database: 'dedicated',
    tool: { id: 'blnk', ...blnk },
  });
  const db = parse(dedicated.find((f) => f.path.endsWith('database.yaml'))!.contents) as {
    spec: { cluster: { name: string } };
  };
  assert.equal(db.spec.cluster.name, 'ledger-pg');
  assert.ok(dedicated.some((f) => f.path.endsWith('postgres-cluster.yaml')));
});
