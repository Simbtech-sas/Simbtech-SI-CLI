import { create } from 'zustand';
import { login as apiLogin, logout as apiLogout, me, type Principal } from '../api/auth';
import { secureTokens } from '../lib/storage';
import { setSessionExpiredHandler } from '../api/client';

interface SessionState {
  principal: Principal | null;
  /** Null until the stored token has been checked — the app shows a splash. */
  status: 'loading' | 'authenticated' | 'anonymous';
  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  principal: null,
  status: 'loading',

  /** Runs once at startup: a stored token means the user is already signed in. */
  restore: async () => {
    const { access } = await secureTokens.get();
    if (!access) {
      set({ status: 'anonymous', principal: null });
      return;
    }
    try {
      set({ principal: await me(), status: 'authenticated' });
    } catch {
      await secureTokens.clear();
      set({ status: 'anonymous', principal: null });
    }
  },

  signIn: async (email, password) => {
    await apiLogin(email, password);
    set({ principal: await me(), status: 'authenticated' });
  },

  signOut: async () => {
    await apiLogout();
    set({ principal: null, status: 'anonymous' });
  },
}));

// The API client cannot import the store (that would be a cycle), so it calls
// back here when a refresh fails.
setSessionExpiredHandler(() => {
  useSession.setState({ principal: null, status: 'anonymous' });
});
