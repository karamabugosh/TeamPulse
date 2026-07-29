import { useState, useEffect } from 'react';

const API_URL = 'http://localhost:3000/questions';

export function useQuestions() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error('Failed to fetch questions');
      const data = await res.json();
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
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
         const err = await res.json();
         throw new Error(err.message || 'Failed to add question');
      }
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const updateQuestion = async (id: string, data: any) => {
    try {
      const res = await fetch(`${API_URL}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
         const err = await res.json();
         throw new Error(err.message || 'Failed to update question');
      }
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const removeQuestion = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete question');
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleActive = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/${id}/toggle`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to toggle status');
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
      const res = await fetch(`${API_URL}/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error('Failed to reorder questions');
      fetchQuestions();
    } catch (err: any) {
      setError(err.message);
      fetchQuestions(); // rollback
    }
  };

  return { questions, loading, error, addQuestion, updateQuestion, removeQuestion, toggleActive, reorderQuestions };
}
