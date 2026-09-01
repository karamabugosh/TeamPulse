import { useState, useEffect } from 'react';

import { apiFetch } from '@/lib/api';

const QUESTIONS_API = '/api/questions';

export function useQuestions() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const data = await apiFetch<any[]>(QUESTIONS_API);
      setQuestions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  const addQuestion = async (data: any) => {
    try {
      await apiFetch(QUESTIONS_API, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const updateQuestion = async (id: string, data: any) => {
    try {
      await apiFetch(`${QUESTIONS_API}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const removeQuestion = async (id: string) => {
    try {
      await apiFetch(`${QUESTIONS_API}/${id}`, { method: 'DELETE' });
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleActive = async (id: string) => {
    try {
      await apiFetch(`${QUESTIONS_API}/${id}/toggle`, { method: 'PATCH' });
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const reorderQuestions = async (updates: { id: string; order: number }[]) => {
    // Optimistic update
    setQuestions(prev => {
        const next = [...prev];
        updates.forEach(u => {
            const idx = next.findIndex(q => q.id === u.id);
            if(idx > -1) next[idx] = { ...next[idx], order: u.order };
        });
        return next.sort((a,b) => a.order - b.order);
    });

    try {
      await apiFetch(`${QUESTIONS_API}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ updates }),
      });
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
      fetchQuestions(); // rollback
    }
  };

  return { questions, loading, error, addQuestion, updateQuestion, removeQuestion, toggleActive, reorderQuestions };
}
