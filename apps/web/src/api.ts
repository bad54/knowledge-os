import { ref } from 'vue';
export const apiToken = ref(sessionStorage.getItem('knowledge-api-token') || '');
export const accessRequired = ref(false);
export function saveToken(value: string) {
  apiToken.value = value.trim();
  if (apiToken.value) sessionStorage.setItem('knowledge-api-token', apiToken.value);
  else sessionStorage.removeItem('knowledge-api-token');
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestToken = apiToken.value;
  const response = await fetch('/api' + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(requestToken ? { authorization: 'Bearer ' + requestToken } : {}),
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(120000),
  });
  if (requestToken === apiToken.value) {
    if (response.status === 401) accessRequired.value = true;
    else if (response.ok) accessRequired.value = false;
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new Error('Accès privé verrouillé : une clé valide est nécessaire.');
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
