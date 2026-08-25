/** Parse the first `major.minor.patch` looking thing out of a `--version` blob. */
export function parseVersion(output: string): string | undefined {
  return /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output)?.[0];
}

/** True when `version` is at least `min`. Numeric-segment compare, no semver dep. */
export function atLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return true;
}
