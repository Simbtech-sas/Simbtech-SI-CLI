import { createMMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

/**
 * Two stores, on purpose.
 *
 * MMKV is fast and synchronous but is NOT encrypted at rest by default — it is
 * for cache and preferences. Credentials go to SecureStore, which is the iOS
 * Keychain and Android Keystore. Putting a refresh token in MMKV means anyone
 * with filesystem access to a rooted device has a permanent session.
 */
export const cache = createMMKV({ id: 'simbkit-cache' });

const ACCESS_TOKEN = 'simbkit.accessToken';
const REFRESH_TOKEN = 'simbkit.refreshToken';

export const secureTokens = {
  async get(): Promise<{ access: string | null; refresh: string | null }> {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN),
      SecureStore.getItemAsync(REFRESH_TOKEN),
    ]);
    return { access, refresh };
  },

  async set(access: string, refresh: string): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN, access),
      SecureStore.setItemAsync(REFRESH_TOKEN, refresh),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN),
      SecureStore.deleteItemAsync(REFRESH_TOKEN),
    ]);
  },
};
