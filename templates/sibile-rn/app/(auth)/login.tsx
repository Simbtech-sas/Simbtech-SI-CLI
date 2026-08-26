import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { useSession } from '@/store/session';
import { ApiError } from '@/api/client';

export default function Login() {
  const router = useRouter();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/(tabs)');
    } catch (err) {
      // Never say which half was wrong — that turns the form into an account
      // enumeration oracle.
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Incorrect email or password'
          : 'Could not sign in. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white dark:bg-neutral-950"
    >
      <ScrollView contentContainerClassName="flex-1 justify-center gap-6 px-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">Simbkit</Text>
          <Text className="text-neutral-500">Sign in to continue</Text>
        </View>

        <View className="gap-4">
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            error={error}
          />
        </View>

        <Button label="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
