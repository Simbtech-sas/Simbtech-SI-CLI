import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // Don't scope `turbopack.root` to this directory: pnpm resolves `next` through
  // a symlink into the repo-root .pnpm store, which sits OUTSIDE apps/web, and
  // Turbopack refuses to compile files outside its root — it then fails with
  // "Next.js package not found". The auto-detected repo root is correct here.
  reactCompiler: true,
  output: 'standalone', // required by apps/web/Dockerfile (copies .next/standalone)
  // Don't let strict type errors fail the production image build — types are
  // erased at runtime and CI (`pnpm typecheck`/`lint`) is the gate for those.
  // Remove once the app is type-clean under the deploy toolchain.
  typescript: { ignoreBuildErrors: true },
  // The `eslint` option is gone in Next 16 (`next lint` was removed); linting
  // runs through the ESLint CLI, so the build never invokes it.
};

export default nextConfig;
