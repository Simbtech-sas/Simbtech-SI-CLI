import { api } from './client';
import { secureTokens } from '../lib/storage';

export interface Principal {
  sub: string;
  email: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'member';
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<void> {
  const tokens = await api<TokenPair>('/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });
  await secureTokens.set(tokens.accessToken, tokens.refreshToken);
}

export async function register(input: {
  email: string;
  password: string;
  tenantName: string;
  slug: string;
}): Promise<void> {
  const tokens = await api<TokenPair>('/auth/register', {
    method: 'POST',
    body: input,
    anonymous: true,
  });
  await secureTokens.set(tokens.accessToken, tokens.refreshToken);
}

export function me(): Promise<Principal> {
  return api<Principal>('/auth/me');
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    // Clear locally even if the call failed — the user asked to be logged out.
    await secureTokens.clear();
  }
}
