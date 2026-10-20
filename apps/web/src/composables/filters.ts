import { reactive } from 'vue';
import type { FilterValues } from '../components/Filters.vue';
export function useFilters() {
  const values = reactive<FilterValues>({ source: '', topic: '', minScore: '', from: '', to: '' });
  const query = () => ({
    ...values,
    from: values.from ? new Date(values.from + 'T00:00:00').toISOString() : '',
    to: values.to ? new Date(values.to + 'T23:59:59.999').toISOString() : '',
  });
  return { values, query };
}
