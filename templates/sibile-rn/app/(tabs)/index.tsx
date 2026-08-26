import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { widgets, type Widget } from '@/api/widgets';

/**
 * The reference list screen: loading, error, empty and populated are all handled.
 * Copy this rather than the happy path alone — the other three states are where
 * a mobile app actually spends its time.
 */
export default function Widgets() {
  const query = useQuery({ queryKey: ['widgets'], queryFn: widgets.list });

  if (query.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-white px-6 dark:bg-neutral-950">
        <Text className="text-center text-neutral-900 dark:text-neutral-50">
          Could not load widgets.
        </Text>
        <Text className="text-center text-sm text-neutral-500">Pull down to try again.</Text>
      </View>
    );
  }

  return (
    <FlatList<Widget>
      data={query.data}
      keyExtractor={(w) => w.id}
      className="bg-white dark:bg-neutral-950"
      contentContainerClassName="p-4 gap-3"
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
      ListEmptyComponent={
        <View className="items-center gap-1 py-16">
          <Text className="text-neutral-900 dark:text-neutral-50">No widgets yet</Text>
          <Text className="text-sm text-neutral-500">They will show up here once created.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <Text className="font-semibold text-neutral-900 dark:text-neutral-50">{item.name}</Text>
          {item.description ? (
            <Text className="mt-1 text-sm text-neutral-500">{item.description}</Text>
          ) : null}
          <Text className="mt-2 text-xs text-neutral-400">Quantity {item.quantity}</Text>
        </View>
      )}
    />
  );
}
