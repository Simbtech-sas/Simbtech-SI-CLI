# `_journal.json`

`drizzle-kit migrate` reads this, not the directory listing. Without it the
command exits 1 printing **nothing at all** — no error, no hint, just a non-zero
status — which is how `pnpm db:migrate` came to be broken in every scaffolded
project while every check still passed: the checks applied the SQL with `psql`.

The migrations here are hand-written rather than generated, because the RLS
policies and the `FORCE ROW LEVEL SECURITY` they install are not something
`drizzle-kit generate` produces from a schema. So the journal is maintained
alongside them: `si add` appends an entry whenever it writes a migration, and
`idx` must stay contiguous and match the file order.
