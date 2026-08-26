import { readFile, writeFile } from 'node:fs/promises';
import type { Tool } from './schema.ts';

/**
 * Append a tool's environment keys to `.env.example`.
 *
 * Appends rather than rewrites, and skips keys already present, so running
 * `si add` twice does not duplicate a block or clobber a value someone edited.
 */
export async function appendEnv(envPath: string, tool: Tool): Promise<string[]> {
  if (tool.env.length === 0) return [];

  const contents = await readFile(envPath, 'utf8');
  const present = new Set(
    contents
      .split('\n')
      .map((l) => /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
      .filter((k): k is string => k !== undefined),
  );

  const missing = tool.env.filter((e) => !present.has(e.key));
  if (missing.length === 0) return [];

  const lines = [
    '',
    `# ── ${tool.name} ${'─'.repeat(Math.max(0, 68 - tool.name.length))}`,
    `# ${tool.summary}`,
    `# ${tool.repo}`,
  ];
  for (const e of missing) {
    if (e.comment) lines.push(`# ${e.comment}`);
    lines.push(e.value === undefined ? `# ${e.key}=` : `${e.key}=${e.value}`);
  }

  await writeFile(envPath, contents.trimEnd() + '\n' + lines.join('\n') + '\n', 'utf8');
  return missing.map((e) => e.key);
}
