import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.simbkit.app',
  appName: 'Simbkit',
  webDir: 'dist',
  server: {
    // Live reload against a dev server: run `cap run android -l --external`.
    androidScheme: 'https',
  },
};

export default config;
