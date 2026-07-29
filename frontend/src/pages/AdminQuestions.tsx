import React, { useState } from 'react';
import { useQuestions } from '../hooks/useQuestions';
import QuestionModal from '../components/QuestionModal';
import { Trash2, Edit, ChevronUp, ChevronDown, CheckCircle, XCircle } from 'lucide-react';

export default function AdminQuestions() {
  const { questions, loading, error, addQuestion, updateQuestion, removeQuestion, toggleActive, reorderQuestions } = useQuestions();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);

  const handleAdd = () => {
    setEditingQuestion(null);
    setIsModalOpen(true);
  };

  const handleEdit = (q: any) => {
    setEditingQuestion(q);
    setIsModalOpen(true);
  };

  const handleSave = async (data: { question: string; order: number; isActive: boolean }) => {
    if (editingQuestion) {
      await updateQuestion(editingQuestion.id, data);
    } else {
      await addQuestion(data);
    }
    setIsModalOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this question?')) {
      await removeQuestion(id);
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const items = [...questions];
    const prev = items[index - 1];
    const current = items[index];

    // Swap order values
    const updates = [
      { id: current.id, order: prev.order },
      { id: prev.id, order: current.order },
    ];
    await reorderQuestions(updates);
  };

  const handleMoveDown = async (index: number) => {
    if (index === questions.length - 1) return;
    const items = [...questions];
    const next = items[index + 1];
    const current = items[index];

    // Swap order values
    const updates = [
      { id: current.id, order: next.order },
      { id: next.id, order: current.order },
    ];
    await reorderQuestions(updates);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Questions Management</h1>
        <button
          onClick={handleAdd}
          style={{
            background: '#0070f3',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '5px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          + Add Question
        </button>
      </div>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}
      
      {loading ? (
        <p>Loading questions...</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <thead style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <tr>
              <th style={{ padding: '12px', borderBottom: '2px solid #ddd' }}>Order</th>
              <th style={{ padding: '12px', borderBottom: '2px solid #ddd' }}>Question</th>
              <th style={{ padding: '12px', borderBottom: '2px solid #ddd' }}>Status</th>
              <th style={{ padding: '12px', borderBottom: '2px solid #ddd', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q: any, idx: number) => (
              <tr key={q.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {q.order}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} style={{ border: 'none', background: 'transparent', cursor: idx === 0 ? 'not-allowed' : 'pointer' }}>
                        <ChevronUp size={16} color={idx === 0 ? '#ccc' : '#333'} />
                      </button>
                      <button onClick={() => handleMoveDown(idx)} disabled={idx === questions.length - 1} style={{ border: 'none', background: 'transparent', cursor: idx === questions.length - 1 ? 'not-allowed' : 'pointer' }}>
                        <ChevronDown size={16} color={idx === questions.length - 1 ? '#ccc' : '#333'} />
                      </button>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px' }}>{q.question}</td>
                <td style={{ padding: '12px' }}>
                  <button
                    onClick={() => toggleActive(q.id)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: q.isActive ? 'green' : 'gray'
                    }}
                  >
                    {q.isActive ? <CheckCircle size={18} /> : <XCircle size={18} />}
                    {q.isActive ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  <button onClick={() => handleEdit(q)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', marginRight: '8px', color: '#0070f3' }}>
                    <Edit size={18} />
                  </button>
                  <button onClick={() => handleDelete(q.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'red' }}>
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {questions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '20px', textAlign: 'center' }}>No questions found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {isModalOpen && (
        <QuestionModal
          initialData={editingQuestion}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
