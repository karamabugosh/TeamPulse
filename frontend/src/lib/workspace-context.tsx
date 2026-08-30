import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getStoredWorkspaceId, setStoredWorkspaceId } from '@/lib/workspace-storage';
import { apiFetch } from '@/lib/api';

export type WorkspaceOption = {
  id: string;
  name: string;
  slackWorkspaceId: string;
  plan: string;
  userCount: number;
  teamCount: number;
};

type WorkspaceContextValue = {
  workspaces: WorkspaceOption[];
  activeWorkspace: WorkspaceOption | null;
  workspaceId: string | null;
  loading: boolean;
  setActiveWorkspaceId: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() =>
    getStoredWorkspaceId(),
  );
  const [loading, setLoading] = useState(true);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const data = await apiFetch<WorkspaceOption[]>('/api/admin/workspaces');
      const list = Array.isArray(data) ? data : [];
      setWorkspaces(list);

      setActiveWorkspaceIdState((current) => {
        if (current && list.some((w) => w.id === current)) return current;
        // Prefer earliest installed workspace (same ordering as the API list)
        const nextId = list[0]?.id ?? null;
        setStoredWorkspaceId(nextId);
        return nextId;
      });
    } catch (error) {
      console.error('Failed to load workspaces', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setStoredWorkspaceId(id);
    setActiveWorkspaceIdState(id);
  }, []);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const value = useMemo(
    () => ({
      workspaces,
      activeWorkspace,
      workspaceId: activeWorkspaceId,
      loading,
      setActiveWorkspaceId,
      refreshWorkspaces,
    }),
    [
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      loading,
      setActiveWorkspaceId,
      refreshWorkspaces,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return ctx;
}
