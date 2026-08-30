const STORAGE_KEY = 'pulse.activeWorkspaceId';

export function getStoredWorkspaceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredWorkspaceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
