import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The control plane is TypeScript source in a sibling workspace, imported by
  // server actions. Without this Next hands its `.ts` files to Node untranspiled.
  transpilePackages: ['@simbkit/control-plane'],
  // Types are checked by `npm run typecheck`, not by the production build.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
