/**
 * Backend base URL for production (Render). Leave unset in local dev so Vite's
 * `/api` proxy handles relative paths.
 */
const rawBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim();

export const API_BASE_URL = rawBase.replace(/\/+$/, '');

/** Resolve `/api/...` to `${API_BASE_URL}/api/...` when configured. */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE_URL) {
    return normalized;
  }
  return `${API_BASE_URL}${normalized}`;
}
