import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Handlebars from 'handlebars';

/**
 * The one place a template path is built.
 *
 * The CLI this replaces resolved templates with 30 separate hardcoded
 * `path.join(__dirname, '../templates/...')` calls, so every new output shape
 * multiplied them. One resolver means adding a variant is adding a file.
 */
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const cache = new Map<string, Handlebars.TemplateDelegate>();

export function templatePath(name: string): string {
  if (name.includes('..') || path.isAbsolute(name)) {
    throw new Error(`illegal template name: ${name}`);
  }
  return path.join(TEMPLATE_DIR, `${name}.hbs`);
}

export async function render(name: string, context: unknown): Promise<string> {
  let compiled = cache.get(name);
  if (!compiled) {
    const source = await readFile(templatePath(name), 'utf8');
    // noEscape: we emit TypeScript and SQL, never HTML. Escaping would corrupt
    // generics, quotes and comparison operators.
    compiled = Handlebars.compile(source, { noEscape: true, strict: true });
    cache.set(name, compiled);
  }
  return compiled(context);
}

/** Test seam — templates are cached by name for the process lifetime. */
export function clearTemplateCache(): void {
  cache.clear();
}
