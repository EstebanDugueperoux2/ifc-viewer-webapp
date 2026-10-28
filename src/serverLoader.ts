import { IfcServerClient, type MeshData as ServerMeshData } from '@ifc-lite/server-client';
import type { MeshData } from '@ifc-lite/geometry';

/**
 * Default server base URL. Override with VITE_IFC_SERVER_URL (e.g. http://localhost:3001)
 * for direct requests to the backend server. In production builds, this should point
 * to your deployed ifc-server instance.
 */
export const DEFAULT_SERVER_URL: string =
  (import.meta.env.VITE_IFC_SERVER_URL as string | undefined) ?? 'http://localhost:3001';

export function createServerClient(baseUrl: string, token?: string): IfcServerClient {
  return new IfcServerClient({
    baseUrl: baseUrl.replace(/\/+$/, ''),
    timeout: 600_000,
    ...(token ? { token } : {}),
  });
}

/** Returns a human-readable error, or null when the server is usable. */
export async function checkServer(client: IfcServerClient): Promise<string | null> {
  try {
    await client.health();
  } catch (error) {
    return error instanceof Error ? error.message : 'Server not reachable.';
  }
  try {
    if (!(await client.isParquetSupported())) {
      return 'Server reachable, but parquet-wasm / apache-arrow are not available in the app.';
    }
  } catch (error) {
    return error instanceof Error ? error.message : 'Parquet support check failed.';
  }
  return null;
}

/** Server meshes use snake_case; the renderer expects the geometry package's shape. */
export function toRendererMesh(mesh: ServerMeshData): MeshData {
  return {
    expressId: mesh.express_id,
    ifcType: mesh.ifc_type,
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    color: mesh.color,
    origin: mesh.origin,
  } as MeshData;
}

/** Streams geometry from the server and hands each decoded batch to `onBatch`. */
export async function streamFromServer(
  client: IfcServerClient,
  buffer: ArrayBuffer,
  onBatch: (meshes: MeshData[], totalSoFar: number) => void,
): Promise<number> {
  let total = 0;
  const result = await client.parseParquetStream(buffer, (batch) => {
    total += batch.meshes.length;
    onBatch(batch.meshes.map(toRendererMesh), total);
  });
  return result.total_meshes;
}
