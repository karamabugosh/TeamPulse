import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  DashboardBlocker,
  dedupeBlockersById,
} from './blockers.types';

/**
 * Single source of truth for the Blockers page: the loaded blocker collection.
 * Statistics are NOT stored here — they must be derived from this list in the page.
 */
export function useBlockersDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DashboardBlocker[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<DashboardBlocker[]>('/api/blockers');
      const list = dedupeBlockersById(
        (Array.isArray(data) ? data : []).map((blocker) => ({
          ...blocker,
          updates: Array.isArray(blocker.updates) ? blocker.updates : [],
        })),
      );
      setBlockers(list);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load blockers');
      setBlockers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(interval);
  }, [load]);

  return { loading, error, blockers, reload: load };
}
