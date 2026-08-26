import { secureTokens } from '../lib/storage';

export const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:8080';

// Tells the API this client has no cookie jar, so the refresh token comes back
// in the BODY instead of as an httpOnly Set-Cookie it could never read. A
// browser deliberately does not send this — there the cookie is the only thing
// keeping the token away from XSS.
const NATIVE_HEADERS = { 'x-client-type': 'native' } as const;


export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Called when refresh fails — the session is gone and the UI must react. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => {};
export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

/**
 * A single in-flight refresh, shared by every caller.
 *
 * Without this, a screen that fires five queries on mount produces five parallel
 * refreshes. The server rotates the refresh token on each one, so four of them
 * present an already-rotated token — which the API correctly treats as reuse and
 * revokes the whole family, logging the user out.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const { refresh } = await secureTokens.get();
      if (!refresh) return null;

      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...NATIVE_HEADERS },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      await secureTokens.set(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      // Clear on the next tick so concurrent callers all observe this attempt.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the Authorization header (login, register). */
  anonymous?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anonymous, headers, ...rest } = options;

  const send = async (token: string | null): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...NATIVE_HEADERS,
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const { access } = anonymous ? { access: null } : await secureTokens.get();
  let res = await send(access);

  // One retry, and only for 401 — a 403 means authenticated but not allowed, and
  // refreshing would not change that.
  if (res.status === 401 && !anonymous) {
    const fresh = await refreshAccessToken();
    if (!fresh) {
      await secureTokens.clear();
      onSessionExpired();
      throw new ApiError(401, 'session expired');
    }
    res = await send(fresh);
  }

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, `${rest.method ?? 'GET'} ${path} failed (${res.status})`, parsed);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
