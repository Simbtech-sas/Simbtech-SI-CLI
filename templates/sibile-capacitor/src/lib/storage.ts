import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

/**
 * Two stores, on purpose.
 *
 * `Preferences` is UserDefaults / SharedPreferences — a plain readable file, fine
 * for cache and settings. Credentials go to `SecureStoragePlugin`, which is the
 * iOS Keychain and Android EncryptedSharedPreferences. A refresh token in
 * Preferences is a permanent session for anyone with filesystem access.
 *
 * On the web build neither is encrypted (it is localStorage underneath), which is
 * one more reason the browser target is for development, not distribution.
 */
export const prefs = {
  async get(key: string): Promise<string | null> {
    return (await Preferences.get({ key })).value;
  },
  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
};

const ACCESS = 'simbkit.accessToken';
const REFRESH = 'simbkit.refreshToken';

async function readSecure(key: string): Promise<string | null> {
  try {
    return (await SecureStoragePlugin.get({ key })).value;
  } catch {
    // The plugin throws when a key is absent rather than returning null.
    return null;
  }
}

export const secureTokens = {
  async get(): Promise<{ access: string | null; refresh: string | null }> {
    const [access, refresh] = await Promise.all([readSecure(ACCESS), readSecure(REFRESH)]);
    return { access, refresh };
  },

  async set(access: string, refresh: string): Promise<void> {
    await Promise.all([
      SecureStoragePlugin.set({ key: ACCESS, value: access }),
      SecureStoragePlugin.set({ key: REFRESH, value: refresh }),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStoragePlugin.remove({ key: ACCESS }).catch(() => undefined),
      SecureStoragePlugin.remove({ key: REFRESH }).catch(() => undefined),
    ]);
  },
};
