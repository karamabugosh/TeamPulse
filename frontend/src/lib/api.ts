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
  const resolvedUrl = apiUrl(url);

  let response: Response;
  try {
    response = await fetch(resolvedUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
        ...(options?.headers ?? {}),
      },
    });
  } catch (error) {
    const message =
      error instanceof TypeError
        ? `Network error — could not reach ${resolvedUrl}. Check VITE_API_BASE_URL and that FRONTEND_URL on the backend matches this site.`
        : error instanceof Error
          ? error.message
          : 'Network request failed';
    throw new ApiError(message, 0);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const rawText = await response.text();
  const isJson = contentType.includes('application/json');
  let body: unknown = null;

  if (rawText) {
    if (isJson) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = null;
      }
    } else if (rawText.trimStart().startsWith('<!')) {
      throw new ApiError(
        `API returned HTML instead of JSON (${response.status}). Set VITE_API_BASE_URL to the backend URL (not the frontend static site).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new ApiError(formatApiErrorMessage(body, response.status), response.status);
  }

  return body as T;
}
