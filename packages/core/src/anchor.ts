import { readFile, writeFile } from 'node:fs/promises';

/**
 * Templates carry marker comments (`// si:modules`) at every place a generated
 * addition belongs. Inserting above a marker keeps the generators free of any
 * AST parser and works identically in TypeScript, YAML, Dart and Rust.
 */
export interface InsertResult {
  inserted: boolean;
  /** Why nothing happened, when `inserted` is false. */
  reason?: 'already-present' | 'anchor-not-found';
}

export async function insertAtAnchor(
  file: string,
  anchor: string,
  snippet: string,
): Promise<InsertResult> {
  const content = await readFile(file, 'utf8');
  const trimmed = snippet.trim();
  if (trimmed.length === 0) return { inserted: false, reason: 'already-present' };
  if (content.includes(trimmed)) return { inserted: false, reason: 'already-present' };

  const lines = content.split('\n');
  const at = lines.findIndex((line) => line.includes(anchor));
  if (at === -1) return { inserted: false, reason: 'anchor-not-found' };

  const indent = /^[ \t]*/.exec(lines[at]!)![0];
  const block = trimmed.split('\n').map((line) => (line ? indent + line : line));
  lines.splice(at, 0, ...block);
  await writeFile(file, lines.join('\n'), 'utf8');
  return { inserted: true };
}
