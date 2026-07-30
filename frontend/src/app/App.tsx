import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AdminQuestions from '../pages/AdminQuestions';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/admin/questions" element={<AdminQuestions />} />
        <Route path="*" element={<Navigate to="/admin/questions" replace />} />
      </Routes>
    </Router>
  );
}

export default App;