export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `Service error ${response.status}`);
  return value;
}
