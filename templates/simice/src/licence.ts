import { invoke } from '@tauri-apps/api/core';

export interface LicenceReport {
  state: 'valid' | 'grace' | 'denied';
  customer: string | null;
  expiresAt: number | null;
  daysRemaining: number | null;
  features: string[];
  message: string;
}

interface RawReport {
  state: LicenceReport['state'];
  customer: string | null;
  expires_at: number | null;
  days_remaining: number | null;
  features: string[];
  message: string;
}

function normalise(raw: RawReport): LicenceReport {
  return {
    state: raw.state,
    customer: raw.customer,
    expiresAt: raw.expires_at,
    daysRemaining: raw.days_remaining,
    features: raw.features,
    message: raw.message,
  };
}

export async function licenceStatus(): Promise<LicenceReport> {
  return normalise(await invoke<RawReport>('licence_status'));
}

export async function installLicence(token: string): Promise<LicenceReport> {
  return normalise(await invoke<RawReport>('install_licence', { token }));
}

export function machineFingerprint(): Promise<string | null> {
  return invoke<string | null>('machine_fingerprint');
}

export function deploymentMode(): Promise<'standalone' | 'lan-server' | 'cloud-sync'> {
  return invoke('deployment_mode');
}

/**
 * Ask the Rust side whether a feature is licensed.
 *
 * Hiding a button in the UI is presentation. This is the check that matters,
 * and it is also enforced inside every command that does the work — a renderer
 * is not a trust boundary.
 */
export async function requireFeature(feature: string): Promise<boolean> {
  try {
    await invoke('require_feature', { feature });
    return true;
  } catch {
    return false;
  }
}

// si:modules
