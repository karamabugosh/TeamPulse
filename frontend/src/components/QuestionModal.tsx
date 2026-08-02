import React, { useState, useEffect } from 'react';

export default function QuestionModal({ initialData, onClose, onSave }: any) {
  const [question, setQuestion] = useState(initialData?.question || '');
  const [order, setOrder] = useState(initialData?.order || 1);
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question || question.trim().length < 5 || question.trim().length > 255) {
      setError('Question must be between 5 and 255 characters.');
      return;
    }
    onSave({ question, order: Number(order), isActive });
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center'
    }}>
      <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '400px' }}>
        <h2>{initialData ? 'Edit Question' : 'Add Question'}</h2>
        {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Question</label>
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Order</label>
            <input
              type="number"
              value={order}
              onChange={e => setOrder(e.target.value)}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              id="isActive"
            />
            <label htmlFor="isActive">Active</label>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px' }}>Cancel</button>
            <button type="submit" style={{ padding: '8px 16px', background: '#0070f3', color: 'white', border: 'none' }}>Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
