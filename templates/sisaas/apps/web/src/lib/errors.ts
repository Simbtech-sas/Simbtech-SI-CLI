// Central error → user-message mapper.
//
// Rule: the UI never shows a raw backend/technical string. API clients throw an
// `ApiError` whose `.message` is ALREADY a clear message (produced here); the
// raw backend text is kept in `.detail` for the console only. Any `catch` that
// shows `error.message` therefore shows a clean message for free.

/** Thrown by every API client. `.message` is user-safe; `.detail` is raw (console only). */
export class ApiError extends Error {
  constructor(
    public status: number,
    userMessage: string,
    public detail?: string,
  ) {
    super(userMessage);
    this.name = 'ApiError';
  }
}

const SERVER =
  'Something went wrong on our side. Please try again in a moment — if it persists, contact support.';
const NETWORK = 'Cannot connect. Check your internet connection and try again.';

// Generic, clear fallbacks keyed by HTTP status — used when no specific message
// matches. Never technical.
const BY_STATUS: Record<number, string> = {
  400: 'Some information is invalid. Check the fields and try again.',
  401: 'Your session has expired. Sign in again to continue.',
  403: "You don't have permission to do that.",
  404: 'Not found. This item may have been moved or deleted.',
  408: 'The request took too long. Try again.',
  409: 'Conflict: this operation contradicts data already saved.',
  413: 'The file is too large.',
  415: 'This file type is not supported.',
  422: 'Some information is invalid. Check the fields and try again.',
  429: 'Too many attempts. Wait a moment before trying again.',
};

// Business/domain messages you deliberately surface go here, matched against the
// lowercased raw backend message. An empty string ('') means "pass the original
// through" — for messages already written as a clean sentence (often carrying
// dynamic detail you want to keep).
const KNOWN: Array<[RegExp, string]> = [
  [/invalid credentials/, 'Incorrect email or password.'],
  [
    /invalid session|session expired|no session|invalid (access|refresh) token|missing access token|token expired|^unauthorized$/,
    'Your session has expired. Sign in again to continue.',
  ],
  [/missing permission|insufficient role/, "You don't have permission to do that."],
  [/already exists/, 'This item already exists.'],
];

// Technical/opaque backend strings that must never reach the user, even on a
// status where we'd otherwise pass a message through.
const TECHNICAL =
  /validation failed|bad request|internal server|cannot read|undefined|null|econnrefused|timeout|exception|\bstack\b|https?:|[{}[\]<>]|^\d+$|_/i;

/** Build a clean user message from an HTTP status + the raw backend message. */
export function apiErrorMessage(status: number, backendMessage?: string): string {
  const raw = backendMessage?.trim();
  if (raw) {
    const m = raw.toLowerCase();
    for (const [re, msg] of KNOWN) {
      if (re.test(m)) return msg === '' ? raw : msg; // '' → pass the original through
    }
  }
  // Families where a generic status message is always appropriate — never leak
  // the raw text for these.
  if (status >= 500 || status === 0) return SERVER;
  if ([401, 403, 404, 408, 413, 415, 422, 429].includes(status)) {
    return BY_STATUS[status] ?? SERVER;
  }
  // Remaining 400/409: show the backend text only if it reads like a clean
  // sentence; otherwise fall back to the generic status message.
  if (raw && raw.length <= 160 && raw.includes(' ') && !TECHNICAL.test(raw)) {
    return raw;
  }
  return BY_STATUS[status] ?? SERVER;
}

/** Message for a fetch that threw before a response (offline, DNS, CORS…). */
export const networkErrorMessage = () => NETWORK;

/**
 * Safe message for a `catch (e)` display site. API clients already produce
 * clean `ApiError.message`; component-thrown `Error`s are expected to already
 * hold a user-safe message. Anything else falls back to a generic message.
 */
export function toUserMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
