/**
 * Client for the `model-store` service of the companion ifc-server repo.
 * In dev, Vite proxies `/model-api` to it (see vite.config.ts). Override with
 * VITE_MODEL_STORE_URL for deployed builds.
 */
export const DEFAULT_STORE_URL: string =
  (import.meta.env.VITE_MODEL_STORE_URL as string | undefined) ?? '/model-api';

export interface StoredModel {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

function endpoint(baseUrl: string, suffix = ''): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/models${suffix}`;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  let detail = '';
  try {
    detail = ((await response.json()) as { error?: string }).error ?? '';
  } catch {
    /* body is not JSON */
  }
  throw new Error(detail || `Model store error (HTTP ${response.status})`);
}

export async function listModels(baseUrl: string, token?: string): Promise<StoredModel[]> {
  const response = await ensureOk(await fetch(endpoint(baseUrl), { headers: authHeaders(token) }));
  return (await response.json()) as StoredModel[];
}

export async function saveModel(
  baseUrl: string,
  token: string | undefined,
  name: string,
  content: Blob,
): Promise<StoredModel> {
  const response = await ensureOk(
    await fetch(endpoint(baseUrl), {
      method: 'POST',
      headers: { ...authHeaders(token), 'X-Model-Name': encodeURIComponent(name) },
      body: content,
    }),
  );
  return (await response.json()) as StoredModel;
}

export async function downloadModel(
  baseUrl: string,
  token: string | undefined,
  model: StoredModel,
): Promise<File> {
  const response = await ensureOk(
    await fetch(endpoint(baseUrl, `/${model.id}`), { headers: authHeaders(token) }),
  );
  const fileName = /\.ifc$/i.test(model.name) ? model.name : `${model.name}.ifc`;
  return new File([await response.blob()], fileName, { type: 'application/x-step' });
}

export async function deleteModel(baseUrl: string, token: string | undefined, id: string): Promise<void> {
  await ensureOk(await fetch(endpoint(baseUrl, `/${id}`), { method: 'DELETE', headers: authHeaders(token) }));
}
