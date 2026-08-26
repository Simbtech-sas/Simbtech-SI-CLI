import { useCallback, useEffect, useRef, useState } from 'react';
import {
  archiveNote,
  createNote,
  exportAll,
  importAll,
  listNotes,
  updateNote,
  type Note,
} from './db/client';

export function App() {
  const [notes, setNotes] = useState<Note[]>();
  const [error, setError] = useState<string>();
  const [title, setTitle] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setNotes(await listNotes());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function download() {
    const blob = await exportAll();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simbkit-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page">
      <header>
        <h1>Simbkit</h1>
        <p className="muted">Everything is stored on this device. Nothing is sent anywhere.</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void createNote(title.trim()).then(() => {
            setTitle('');
            return refresh();
          });
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New note"
          aria-label="New note title"
        />
        <button type="submit" disabled={!title.trim()}>
          Add
        </button>
      </form>

      {error ? <p role="alert" className="error">{error}</p> : null}
      {notes === undefined ? <p className="muted">Opening the local database…</p> : null}
      {notes?.length === 0 ? <p className="muted">No notes yet.</p> : null}

      <ul>
        {notes?.map((note) => (
          <li key={note.id}>
            <input
              defaultValue={note.title}
              aria-label={`Title of ${note.title}`}
              onBlur={(e) => {
                if (e.target.value !== note.title) {
                  void updateNote(note.id, { title: e.target.value }).then(refresh);
                }
              }}
            />
            <button onClick={() => void archiveNote(note.id).then(refresh)}>Archive</button>
          </li>
        ))}
      </ul>

      {/*
        With no server there is no backup. Export is the only way this data
        survives a cleared browser profile, so it is a first-class feature, not
        a settings-page afterthought.
      */}
      <footer>
        <button onClick={() => void download()}>Export all data</button>
        <button onClick={() => fileInput.current?.click()}>Import</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file
              .text()
              .then(importAll)
              .then(refresh)
              .catch((err: unknown) => setError(String(err)));
          }}
        />
      </footer>
    </main>
  );
}
