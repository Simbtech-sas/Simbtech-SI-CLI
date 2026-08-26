import { Text, TextInput, View } from 'react-native';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'email-address';
  error?: string;
}

export function TextField({ label, error, ...input }: TextFieldProps) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor="#9ca3af"
        className={[
          'h-12 rounded-xl border px-4 text-base text-neutral-900 dark:text-neutral-50',
          error ? 'border-red-500' : 'border-neutral-300 dark:border-neutral-700',
        ].join(' ')}
      />
      {error ? <Text className="text-sm text-red-500">{error}</Text> : null}
    </View>
  );
}
