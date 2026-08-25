/**
 * Directories that are build output or installed artifacts, never template
 * content. Shared by the copier and the rebrander so a template cannot be
 * copied with something the rebrander would then refuse to walk.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.turbo',
  'dist',
  'build',
  '.next',
  'coverage',
  '.svelte-kit',
  'target', // Rust / Tauri
  '.dart_tool', // Flutter
  'Pods', // iOS
]);
