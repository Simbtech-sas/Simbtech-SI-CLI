import { PGlite } from '@electric-sql/pglite';
import schema from './schema.sql?raw';

/**
 * Postgres, compiled to WebAssembly, running in the page.
 *
 * Real SQL — the same queries and the same migration files a server build would
 * use — with the data in IndexedDB. Nothing crosses a network because there is
 * nothing on the other side.
 */
let instance: Promise<PGlite> | undefined;

export function db(): Promise<PGlite> {
  instance ??= (async () => {
    // `idb://` persists to IndexedDB. An in-memory database would lose
    // everything on refresh, which for a local-only app is the whole dataset.
    const pg = await PGlite.create('idb://simbkit');
    await pg.exec(schema);
    return pg;
  })();
  return instance;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export async function listNotes(): Promise<Note[]> {
  const pg = await db();
  const result = await pg.query<Note>(
    'select * from notes where archived = false order by updated_at desc',
  );
  return result.rows;
}

export async function createNote(title: string): Promise<Note> {
  const pg = await db();
  // Parameterised, not interpolated. SQL injection does not stop being a bug
  // because the database is local — a pasted note title is still untrusted input.
  const result = await pg.query<Note>('insert into notes (title) values ($1) returning *', [title]);
  return result.rows[0]!;
}

export async function updateNote(id: string, patch: { title?: string; body?: string }): Promise<void> {
  const pg = await db();
  await pg.query(
    `update notes
        set title = coalesce($2, title),
            body = coalesce($3, body),
            updated_at = now()
      where id = $1`,
    [id, patch.title ?? null, patch.body ?? null],
  );
}

export async function archiveNote(id: string): Promise<void> {
  const pg = await db();
  await pg.query('update notes set archived = true, updated_at = now() where id = $1', [id]);
}

/**
 * Everything the user has, as a file they can keep.
 *
 * With no server there is no backup, so export is not a nice-to-have — it is the
 * only way a user's data survives a wiped browser profile.
 */
export async function exportAll(): Promise<Blob> {
  const pg = await db();
  const { rows } = await pg.query<Note>('select * from notes order by created_at');
  const payload = { exportedAt: new Date().toISOString(), version: 1, notes: rows };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

export async function importAll(json: string): Promise<number> {
  const parsed: unknown = JSON.parse(json);
  const notes = (parsed as { notes?: Note[] }).notes;
  if (!Array.isArray(notes)) throw new Error('Not a Simbkit export file.');

  const pg = await db();
  let imported = 0;
  // One transaction: a partial import is worse than a failed one.
  await pg.transaction(async (tx) => {
    for (const note of notes) {
      await tx.query(
        `insert into notes (id, title, body, archived, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update set
           title = excluded.title, body = excluded.body,
           archived = excluded.archived, updated_at = excluded.updated_at`,
        [note.id, note.title, note.body, note.archived, note.created_at, note.updated_at],
      );
      imported++;
    }
  });
  return imported;
}

// si:modules
