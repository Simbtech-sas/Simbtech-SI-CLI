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
  user: { id: string; email: string; name: string | null };
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

/** POST /auth/register — creates the account and signs it in. */
export async function register(input: {
  email: string;
  password: string;
  name?: string;
  tenantName: string; // si:when multi-tenant
  slug: string; // si:when multi-tenant
}): Promise<Session> {
  const data = await apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  saveToken(data.accessToken);
  return { user: data.user, tenant: data.tenant, role: data.role }; // si:when multi-tenant
  return { user: data.user, role: data.role }; // si:when single-tenant
}

// si:when-begin multi-tenant
/** GET /auth/available — is this email / workspace address free? */
export const checkAvailability = (q: { email?: string; slug?: string }) =>
  apiFetch<{ emailAvailable?: boolean; slugAvailable?: boolean }>(
    `/auth/available?${new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    )}`,
  );
// si:when-end
// si:when-begin single-tenant
/** GET /auth/available — is this email free? */
export const checkAvailability = (q: { email?: string }) =>
  apiFetch<{ emailAvailable?: boolean }>(
    `/auth/available?${new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    )}`,
  );
// si:when-end

/** GET /auth/me — the current session, or throws ApiError(401) if signed out. */
export const me = () => apiFetch<Session>('/auth/me');

export interface Profile {
  id: string;
  email: string;
  name: string | null;
}

export const getProfile = () => apiFetch<Profile>('/auth/profile');

export const updateProfile = (patch: { name?: string }) =>
  apiFetch<void>('/auth/profile', { method: 'PATCH', body: JSON.stringify(patch) });

export const changePassword = (currentPassword: string, newPassword: string) =>
  apiFetch<{ ok: true }>('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

/** POST /auth/logout — best-effort server revoke, then clears the local token. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    /* best effort */
  }
  clearToken();
}

// ── Widgets (the reference feature) ─────────────────────────────────────────
//
// Copy this block alongside the module you copy from `modules/widgets` on the
// server. The shapes mirror the DTOs, so a change there fails here at compile
// time rather than at runtime in a form.

export interface Widget {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetInput {
  name: string;
  description?: string;
  quantity?: number;
}

export const listWidgets = () => apiFetch<Widget[]>('/widgets');

export const getWidget = (id: string) => apiFetch<Widget>(`/widgets/${id}`);

/**
 * The Idempotency-Key is not optional: the endpoint requires it, because a
 * create that times out and is retried must not make a second widget. One key
 * per logical operation — generated when the form opens, not per attempt.
 */
export const createWidget = (input: WidgetInput, idempotencyKey: string) =>
  apiFetch<Widget>('/widgets', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });

export const updateWidget = (id: string, patch: Partial<WidgetInput>) =>
  apiFetch<Widget>(`/widgets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteWidget = (id: string) =>
  apiFetch<void>(`/widgets/${id}`, { method: 'DELETE' });

// ── Audit log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  seq: number;
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  phase: 'intent' | 'committed' | 'failed' | 'event';
  correlationId: string | null;
  hash: string;
  createdAt: string;
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  brokenAtSeq?: number;
  reason?: string;
}

/** `before` is a cursor on `seq`, not an offset — the table only grows at the head. */
export const listAudit = (before?: number) =>
  apiFetch<AuditEntry[]>(`/audit${before ? `?before=${before}` : ''}`);

export const verifyAudit = () => apiFetch<ChainVerification>('/audit/verify');

// ── Media ───────────────────────────────────────────────────────────────────

export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  publicUrl: string;
}

export const createUpload = (contentType: UploadContentType) =>
  apiFetch<PresignedUpload>('/media/uploads', {
    method: 'POST',
    body: JSON.stringify({ contentType }),
  });

/**
 * Upload straight to storage, not through the API.
 *
 * That is the whole point of a presigned URL: the bytes never touch the API,
 * so a 200MB upload does not occupy a Node process for its duration. Note the
 * bare `fetch` — `apiFetch` would attach our bearer token to a third-party
 * host, which is how a credential ends up in someone else's access log.
 */
export async function uploadFile(file: File): Promise<PresignedUpload> {
  const presigned = await createUpload(file.type as UploadContentType);
  const res = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!res.ok) throw new ApiError(res.status, 'The upload was rejected by storage.');
  return presigned;
}
