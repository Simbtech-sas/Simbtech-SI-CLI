import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSession } from '@/store/session';

/** Splash + router. Holds the UI until the stored session has been resolved. */
export default function Index() {
  const status = useSession((s) => s.status);

  if (status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={status === 'authenticated' ? '/(tabs)' : '/(auth)/login'} />;
}
