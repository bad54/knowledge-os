import { ref } from 'vue';
export const apiToken = ref(sessionStorage.getItem('knowledge-api-token') || '');
export function saveToken(value: string) {
  apiToken.value = value.trim();
  if (apiToken.value) sessionStorage.setItem('knowledge-api-token', apiToken.value);
  else sessionStorage.removeItem('knowledge-api-token');
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(apiToken.value ? { authorization: 'Bearer ' + apiToken.value } : {}),
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ message: 'Serveur indisponible' }))) as {
      message?: string;
    };
    throw new Error(body.message || 'Erreur HTTP ' + response.status);
  }
  return response.json() as Promise<T>;
}
export function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value))
    : 'Non renseignée';
}
export function filtersQuery(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== '' && value !== undefined) params.set(key, String(value));
  return params.toString();
}
