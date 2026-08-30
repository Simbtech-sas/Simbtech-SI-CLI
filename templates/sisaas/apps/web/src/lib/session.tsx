'use client';

import { createContext, useContext } from 'react';
import type { Session } from './api';

/**
 * The session, resolved once by the dashboard shell.
 *
 * The shell already has to fetch it to decide whether to render at all, so a
 * page that fetches it again is a second request for an answer we hold. Two
 * were enough to trip the credential throttle and tell a freshly registered
 * user to come back later.
 *
 * It lives here rather than in the layout so pages import a module, not a route.
 */
const SessionContext = createContext<Session | null>(null);

export const SessionProvider = SessionContext.Provider;

/** The signed-in session. Only valid inside the dashboard route group. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside the dashboard layout');
  return session;
}
