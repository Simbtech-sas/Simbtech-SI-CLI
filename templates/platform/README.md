# Simbkit — platform

The infrastructure the services run on: a k3s cluster over a WireGuard mesh,
ArgoCD for deployment, one Postgres cluster serving every service, and Kafka for
events between them.

```bash
npm --prefix apps/control-plane install
npm run verify                        # everything checkable without a cluster
npm run node:add -- --ip 203.0.113.10 # first node becomes the control plane
./cluster/bootstrap-network.sh        # WireGuard mesh + firewall
./cluster/bootstrap-k3s.sh            # install k3s, join workers
```

## Adding a VPS

```bash
npm run node:add -- --ip 203.0.113.11
```

The control plane allocates the mesh address, names the node, and regenerates
`cluster/inventory.env`. Then re-run both bootstrap scripts: the network script
is fleet-wide (that is how existing peers learn about the new node), the k3s
script only touches nodes that have not joined.

It will warn you first that rebuilding the mesh restarts `wg-quick` on every
existing node. That is a few seconds of paused cluster traffic, and you should
know before it happens rather than after.

**One control plane only.** Multi-master k3s needs an HA datastore and a load
balancer in front of the API server; adding a second server without them
produces a split cluster, so `node add --role control-plane` refuses rather than
half-supporting it.

## Adding a service

```bash
npm run service:add -- billing --aggregate invoice
```

Five files in `gitops/apps/billing-api/`: the ArgoCD `Application`, a `Database`
in the shared cluster, a Job that generates the DB credentials in-cluster, the
Kafka topic and its DLQ, and the Debezium connector. Commit and push — Argo does
the rest.

## Data: one cluster, many databases

A single CloudNativePG cluster (`simbkit-pg`, 3 instances, nightly backups, PITR)
serves every service at `simbkit-pg-rw.data.svc:5432`. Each service owns its own
database and migrations inside it.

Not a StatefulSet per service: that is N single-instance databases, none
replicated, none backed up. Not one shared schema either — services reach each
other's data through events, never through each other's tables. Reasoning in
`docs/adr-001-events-and-data.md` of the SiSAAS template.

Consolidating does concentrate risk, which is why `instances: 3` and the
`ScheduledBackup` are not optional. A backup nobody has restored is not a backup.

## Edge: TLS, ingress and the gateway

- **cert-manager** (`gitops/apps/cert-manager.yaml`) with three ClusterIssuers.
  Use `letsencrypt-staging` first, always: production Let's Encrypt allows 5
  failures per hour and 50 certificates per domain per week, and debugging an
  HTTP-01 challenge against it locks you out for a week with no certificate.
- **Traefik** is both the ingress controller and the API gateway. k3s bundles it,
  so `gitops/edge/traefik.yaml` *configures the existing release* — installing a
  second Traefik makes two of them fight over :80 and :443.
- **Gateway middleware**: HTTPS redirect, HSTS and security headers, and an
  edge rate limit that keeps a single source from reaching the application at
  all. Access logs drop headers by default — an Authorization header in a log
  aggregator is a credential in a lower-trust store.

## Load balancing

```bash
service add api    --balancing round-robin          # default
service add chat   --balancing sticky               # websockets, in-memory session
service add billing --balancing canary --canary-weight 20
```

| Strategy | When | Cost |
|---|---|---|
| `round-robin` | any replica can serve any request | none — this is what Kubernetes already does, so nothing is generated |
| `sticky` | a replica holds state the request needs | uneven load; one replica's death drops its clients' sessions |
| `canary` | validating a new version | two versions in production at once — a temporary state, not a resting place |

Sticky affinity cookies are `secure`, `httpOnly` and `sameSite=lax`. If the state
can live in Redis, put it there and stay on round-robin.

## Secrets

Generated in-cluster by a PreSync Job, or read from a `secretKeyRef`. Nothing is
written to git, and `npm run verify` fails the build if something that looks like
a credential appears in `gitops/` or `cluster/`.

## What `npm run verify` covers

Bash syntax and shellcheck, every manifest parsing with a `kind`, no committed
credentials, and the control plane's own 23 tests — the WireGuard allocator, the
index-alignment of the inventory lists, and the generated manifests including
the check that the Kafka topic name and the Debezium router agree.

What it cannot cover is a real cluster. Provision a throwaway VPS and run the two
bootstrap scripts before trusting a change to them.
