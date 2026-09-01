import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '../hooks/use-toast';
import { Toaster } from '../components/ui/toaster';
import { AuthProvider } from '../lib/auth-context';
import { WorkspaceProvider } from '../lib/workspace-context';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import DashboardLayout from '../layouts/DashboardLayout';
import LoginPage from '../pages/LoginPage';
import OverviewPage from '../pages/OverviewPage';
import CheckInsPage from '../pages/CheckInsPage';
import CheckInHistoryPage from '../pages/CheckInHistoryPage';
import TeamsPage from '../pages/TeamsPage';
import ReportsPage from '../pages/ReportsPage';
import ReportDetailPage from '../pages/ReportDetailPage';
import CheckInReportsHistoryPage from '../pages/CheckInReportsHistoryPage';
import SettingsPage from '../pages/SettingsPage';
import JiraHubPage from '../pages/JiraHubPage';
import AiWorkspacePage from '../pages/AiWorkspacePage';
import AiEvaluationPage from '../pages/AiEvaluationPage';
import BlockersPage from '../pages/BlockersPage';
import DailyStandupPage from '../pages/DailyStandupPage';

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <Router>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<DashboardLayout />}>
                  <Route path="/" element={<Navigate to="/overview" replace />} />
                  <Route path="/overview" element={<OverviewPage />} />
                  <Route path="/checkins" element={<CheckInsPage />} />
                  <Route path="/checkins/standup" element={<DailyStandupPage />} />
                  <Route path="/checkins/history" element={<CheckInHistoryPage />} />
                  <Route path="/teams" element={<TeamsPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route
                    path="/reports/checkins/:checkInId/history"
                    element={<CheckInReportsHistoryPage />}
                  />
                  <Route path="/reports/run/:runId" element={<ReportDetailPage />} />
                  <Route path="/reports/:id" element={<ReportDetailPage />} />
                  <Route path="/jira" element={<JiraHubPage />} />
                  <Route path="/blockers" element={<BlockersPage />} />
                  <Route path="/ai-workspace" element={<AiWorkspacePage />} />
                  <Route path="/ai-evaluation" element={<AiEvaluationPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Router>
          <Toaster />
        </WorkspaceProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
