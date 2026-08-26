import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { useSession } from '@/store/session';

export default function Settings() {
  const router = useRouter();
  const { principal, signOut } = useSession();

  return (
    <View className="flex-1 gap-6 bg-white p-6 dark:bg-neutral-950">
      <View className="gap-1">
        <Text className="text-sm text-neutral-500">Signed in as</Text>
        <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {principal?.email ?? '—'}
        </Text>
        <Text className="text-sm text-neutral-500">Role: {principal?.role ?? '—'}</Text>
      </View>

      <Button
        label="Sign out"
        variant="ghost"
        onPress={() => {
          void signOut().then(() => router.replace('/(auth)/login'));
        }}
      />
    </View>
  );
}
