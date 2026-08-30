// API client for the authed app.
// The access token lives in localStorage; the refresh token is an httpOnly
// cookie (path=/auth) the browser sends automatically to /auth/refresh.

import { ApiError, apiErrorMessage, networkErrorMessage } from './errors';

const API = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:8080';

const TOKEN_KEY = 'simbkit_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

/** Try to mint a fresh access token from the refresh cookie. Returns it or null. */
async function tryRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken: string };
    saveToken(data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

/**
 * Core fetch wrapper: attaches the bearer token, transparently refreshes once on
 * a 401, and normalizes every failure into an `ApiError` carrying a user-safe
 * message (the raw backend text stays in `.detail`, console-only).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        // Only set JSON content-type when there's a body — some servers reject an
        // empty body sent with content-type application/json.
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // Network/DNS/CORS failure — no response reached us.
    throw new ApiError(0, networkErrorMessage());
  }

  if (res.status === 401 && retry) {
    const fresh = await tryRefresh();
    if (fresh) return apiFetch<T>(path, init, false);
    // Session fully expired (refresh failed): drop the stale token so the app
    // shell can bounce to sign-in rather than looping on 401s.
    clearToken();
  }

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) {
        detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      }
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, apiErrorMessage(res.status, detail), detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth (example endpoints) ────────────────────────────────────────────────

export interface Session {
  user: { id: string; email: string };
  tenant: { id: string; slug: string; name: string }; // si:when multi-tenant
  role: 'owner' | 'admin' | 'member';
}
interface AuthResponse extends Session {
  accessToken: string;
}

/** POST /auth/login — persists the access token, returns the session. */
export async function login(email: string, password: string): Promise<Session> {
  const data = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  saveToken(data.accessToken);
  return { user: data.user, tenant: data.tenant, role: data.role }; // si:when multi-tenant
  return { user: data.user, role: data.role }; // si:when single-tenant
}

/** GET /auth/me — the current session, or throws ApiError(401) if signed out. */
export const me = () => apiFetch<Session>('/auth/me');

/** POST /auth/logout — best-effort server revoke, then clears the local token. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    /* best effort */
  }
  clearToken();
}
