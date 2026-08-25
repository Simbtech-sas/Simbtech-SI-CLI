/**
 * The project shapes si can scaffold. Each maps to a real runnable project under
 * `templates/` in this repo; the id is the template directory name unless
 * `template` says otherwise.
 *
 * Two flavors sharing one template is deliberate. SiAPP is SiSAAS without
 * tenancy — copying 142 files to remove `tenant_id` would produce a second tree
 * that drifts from the first within a month, and the composition engine already
 * removes files and prunes marked blocks. So SiAPP is the same template with
 * `single-tenant` composed in.
 *
 * Which toolchain a flavor requires is declared on the tool in `toolchain.ts`,
 * not here — one source of truth, so `si doctor` cannot disagree with itself.
 */
export const FLAVORS = [
  {
    id: 'sisaas',
    label: 'SiSAAS',
    summary: 'Multi-tenant SaaS — NestJS + Postgres RLS, Next.js, worker, Kafka events',
    choices: { tenancy: 'multi' },
  },
  {
    id: 'siapp',
    label: 'SiAPP',
    summary: 'A normal web app — the SiSAAS stack without tenancy: NestJS, Next.js, worker, events',
    template: 'sisaas',
    // Drops the tenant column, the RLS policies, memberships and the subdomain
    // middleware. Everything else — DDD, outbox, audit, jobs, media, realtime —
    // is identical, which is the reason it is one template and not two trees.
    choices: { tenancy: 'single' },
  },
  {
    id: 'simice',
    label: 'SiMICE',
    summary: 'On-premise desktop — Tauri v2, licence keys, standalone / LAN / cloud-sync',
  },
  {
    id: 'sibile-rn',
    label: 'SiBILE (React Native)',
    summary: 'Mobile — Expo, expo-router, NativeWind, TanStack Query',
  },
  {
    id: 'sibile-flutter',
    label: 'SiBILE (Flutter)',
    summary: 'Mobile — feature-first, Riverpod, go_router, Drift',
  },
  {
    id: 'sibile-capacitor',
    label: 'SiBILE (Capacitor)',
    summary: 'Mobile — Vite + Capacitor, web stack shipped as an app',
  },
  {
    id: 'sical',
    label: 'SiCAL',
    summary: 'Fully local — web tech, no network at all, local-first storage',
  },
  {
    id: 'platform',
    label: 'Platform',
    summary: 'Infra control plane — k3s over WireGuard, ArgoCD, VPS and service onboarding',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  summary: string;
  /** The template directory, when it is not the id. */
  template?: string;
  /** Composition features forced by this flavor, before any choice is applied. */
  features?: readonly string[];
  /** Choice values this flavor fixes, so the user is not asked. */
  choices?: Readonly<Record<string, string>>;
}>;

export type FlavorId = (typeof FLAVORS)[number]['id'];

/**
 * The shape the helpers work against.
 *
 * Written out rather than derived from `typeof FLAVORS`: `as const` narrows each
 * entry to exactly the keys it has, so `flavor.features` is `never` on the ones
 * that do not declare it and every helper needs a cast.
 */
export interface Flavor {
  id: string;
  label: string;
  summary: string;
  template?: string;
  features?: readonly string[];
  choices?: Readonly<Record<string, string>>;
}

export function findFlavor(id: string): (typeof FLAVORS)[number] | undefined {
  return FLAVORS.find((f) => f.id === id);
}

/** The template directory a flavor is built from. */
export function flavorTemplate(flavor: Flavor): string {
  return flavor.template ?? flavor.id;
}

/** Composition features the flavor itself forces, before profiles and choices. */
export function flavorFeatures(flavor: Flavor): string[] {
  return flavor.features ? [...flavor.features] : [];
}

/**
 * Choices the flavor decides on the user's behalf.
 *
 * SiAPP is SiSAAS with `tenancy: single`. Expressing it as a fixed CHOICE
 * rather than a second removal mechanism means the composition engine needs no
 * new concept: choices already carry features, removals and replacements.
 */
export function flavorChoices(flavor: Flavor): Record<string, string> {
  return flavor.choices ? { ...flavor.choices } : {};
}
