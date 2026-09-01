import { getStoredWorkspaceId } from '@/lib/workspace-storage';
import { apiUrl } from '@/lib/api-config';

export { API_BASE_URL, apiUrl } from '@/lib/api-config';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function formatApiErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const raw = (body as { message: unknown }).message;
    if (Array.isArray(raw)) {
      return raw.map(String).filter(Boolean).join('; ') || `Request failed (${status})`;
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw;
    }
  }
  return `Request failed (${status})`;
}

export async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const workspaceId = getStoredWorkspaceId();

  const response = await fetch(apiUrl(url), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(formatApiErrorMessage(body, response.status), response.status);
  }

  return body as T;
}
