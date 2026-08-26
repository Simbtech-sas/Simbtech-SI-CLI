# Instructions for AI agents

The rules live in **[AGENTS.md](./AGENTS.md)** — one file, so five copies cannot
drift apart and leave a stale security rule somewhere.

Read it before your first edit. The short version, which is not a substitute for
reading it:

1. **Do not build what exists.** `si list features`, `si list tools`, `si add <id>`.
2. **Simplest thing that works.** No abstraction for one caller, none "for later".
3. **One file, one thing.** A feature is a directory with domain/application/
   infrastructure/interface. Nothing over ~300 lines.
4. **Security is not negotiable.** Tenant id from the verified token only. FORCE
   RLS. Raw-body signature checks. Constant-time compares with a length guard.
   Money in decimals. Fail closed.
5. **Finish means tested.** `nest build`, `si start dev`, smoke-test it by hand,
   and leave a test that fails without your change.
6. **Then check for regressions** — the whole suite, not your file, and every
   caller of anything you changed.
7. **Then hunt the edge cases you created** — second call, empty, boundary,
   concurrent, dependency down, hostile input. Say which ones you accepted.
