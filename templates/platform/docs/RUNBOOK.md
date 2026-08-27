# Runbook

## Restore a database

Backups run nightly to S3/MinIO with WAL archiving, so recovery to any point in
the retention window is possible. **Rehearse this on a throwaway cluster before
you need it** — an untested restore is a hope, not a plan.

```bash
kubectl -n data get backups
# Recover into a NEW cluster; never restore over the running one.
kubectl -n data apply -f - <<'YAML'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: simbkit-pg-restore
  namespace: data
spec:
  instances: 1
  bootstrap:
    recovery:
      source: simbkit-pg
      recoveryTarget:
        targetTime: '2026-08-28 03:00:00'
  externalClusters:
    - name: simbkit-pg
      barmanObjectStore:
        destinationPath: s3://simbkit-backups/postgres
        endpointURL: http://minio.data.svc:9000
        s3Credentials:
          accessKeyId: { name: pg-backup-creds, key: ACCESS_KEY_ID }
          secretAccessKey: { name: pg-backup-creds, key: ACCESS_SECRET_KEY }
YAML
```

## A node is unreachable

```bash
kubectl get nodes -o wide
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
```

If the mesh is the problem rather than the host, `wg show` on any peer tells you
which handshake is stale. Re-running `./cluster/bootstrap-network.sh` rebuilds
every peer's config — including after a node's keys were regenerated.

## Events stopped flowing

In order, because each step rules out the one below it:

1. `kubectl -n data exec simbkit-pg-1 -- psql -c "select * from pg_replication_slots"`
   — an inactive slot means Debezium is not connected. A slot that is active but
   lagging means it is connected and behind, which is a different problem.
2. `kubectl -n kafka logs deploy/debezium-<service>`
3. `kubectl -n kafka get kafkatopics` — the topic must exist before anything can
   publish to it.
4. Check the consumer group lag. Messages piling up in `<topic>.dlq` mean the
   consumer is rejecting them, not that delivery is broken.

**A replication slot that nobody consumes will fill the disk.** If a service is
decommissioned, drop its slot — that is the failure mode that takes the whole
database down, and it takes a service nobody is watching to cause it.

## Rotating the CDC credentials

The `<service>-db` secret is generated once by a PreSync Job. To rotate, delete
the secret and the Job, then sync — a new password is generated and the Debezium
deployment restarts onto it.
