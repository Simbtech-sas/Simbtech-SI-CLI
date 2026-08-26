import { ActivityIndicator, Pressable, Text } from 'react-native';

interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}

export function Button({ label, onPress, loading, disabled, variant = 'primary' }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      className={[
        'h-12 flex-row items-center justify-center rounded-xl px-5',
        variant === 'primary' ? 'bg-brand' : 'bg-transparent',
        inactive ? 'opacity-50' : 'active:opacity-80',
      ].join(' ')}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : '#2563eb'} />
      ) : (
        <Text className={variant === 'primary' ? 'font-semibold text-brand-fg' : 'font-semibold text-brand'}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
