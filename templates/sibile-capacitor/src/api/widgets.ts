import { api } from './client';

export interface Widget {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  createdAt: string;
}

export const widgets = {
  list: () => api<Widget[]>('/widgets'),
  get: (id: string) => api<Widget>(`/widgets/${id}`),
  create: (input: { name: string; description?: string; quantity?: number }) =>
    api<Widget>('/widgets', { method: 'POST', body: input }),
  remove: (id: string) => api<{ ok: true }>(`/widgets/${id}`, { method: 'DELETE' }),
};
