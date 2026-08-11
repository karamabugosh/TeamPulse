import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '../hooks/use-toast';
import { Toaster } from '../components/ui/toaster';
import DashboardLayout from '../layouts/DashboardLayout';
import OverviewPage from '../pages/OverviewPage';
import CheckInsPage from '../pages/CheckInsPage';
import CheckInHistoryPage from '../pages/CheckInHistoryPage';
import TeamsPage from '../pages/TeamsPage';
import ReportsPage from '../pages/ReportsPage';
import ReportDetailPage from '../pages/ReportDetailPage';
import CheckInReportsHistoryPage from '../pages/CheckInReportsHistoryPage';
import SettingsPage from '../pages/SettingsPage';

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/checkins" element={<CheckInsPage />} />
            <Route path="/checkins/history" element={<CheckInHistoryPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/checkins/:checkInId/history" element={<CheckInReportsHistoryPage />} />
            <Route path="/reports/:id" element={<ReportDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Router>
      <Toaster />
    </ToastProvider>
  );
}

export default App;