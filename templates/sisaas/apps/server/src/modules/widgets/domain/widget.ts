import type { widgets } from '../../../database/schema';

export type Widget = typeof widgets.$inferSelect;
export type NewWidget = { name: string; description?: string; quantity?: number };
export type WidgetPatch = Partial<NewWidget>;
