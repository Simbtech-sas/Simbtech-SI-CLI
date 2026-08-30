# `_journal.json`

`drizzle-kit migrate` reads this, not the directory listing. Without it the
command exits 1 printing **nothing at all** — no error, no hint, just a non-zero
status — which is how `pnpm db:migrate` came to be broken in every scaffolded
project while every check still passed: the checks applied the SQL with `psql`.

<!-- si:when-begin multi-tenant -->
The migrations here are hand-written rather than generated, because the RLS
policies and the `FORCE ROW LEVEL SECURITY` they install are not something
`drizzle-kit generate` produces from a schema. So the journal is maintained
<!-- si:when-end -->
The migrations here are hand-written rather than generated, so that what runs
against production is the SQL you read rather than a diff. The journal is kept <!-- si:when single-tenant -->
alongside them: `si add` appends an entry whenever it writes a migration, and
`idx` must stay contiguous and match the file order.
