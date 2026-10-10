import React from 'react';
import { ExamProvider, useExam } from './context/ExamContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CommandPalette } from './components/CommandPalette';

import { LoginView } from './views/LoginView';
import { FirstLoginResetView } from './views/FirstLoginResetView';
import { AccessDeniedView } from './views/AccessDeniedView';
import { TeacherDashboardView } from './views/TeacherDashboardView';
import { LandingPage } from './views/LandingPage';
import { TestLibraryView } from './views/TestLibraryView';
import { TestDetailsView } from './views/TestDetailsView';
import { ExamInstructionsView } from './views/ExamInstructionsView';
import { SystemCheckView } from './views/SystemCheckView';
import { CbtExamView } from './views/CbtExamView';
import { ResultDashboardView } from './views/ResultDashboardView';
import { StudentDashboardView } from './views/StudentDashboardView';
import { StudentCustomTestView } from './views/StudentCustomTestView';
import { PracticeEngineView } from './views/PracticeEngineView';
import { BookmarksMistakeView } from './views/BookmarksMistakeView';
import { AdminDashboardView } from './views/AdminDashboardView';
import { ShieldCheck } from 'lucide-react';

const MainRouter: React.FC = () => {
  const {
    currentView,
    isAuthenticated,
    isAuthLoading,
    authProfile,
  } = useExam();

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center animate-pulse">
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <div className="text-xs font-mono uppercase tracking-widest text-slate-400">
          Verifying Examination Session &amp; Role Permissions...
        </div>
      </div>
    );
  }

  // STRICT LOGIN GATE (Section 5): Nobody can access any website route without logging in first
  if (!isAuthenticated || !authProfile || currentView === 'login') {
    return <LoginView />;
  }

  // MANDATORY FIRST-LOGIN PASSWORD CREATION GATE (Section 4)
  if (authProfile.mustChangePassword || currentView === 'first-login-reset') {
    return <FirstLoginResetView />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      <Navbar />

      <main className="flex-1">
        {currentView === 'access-denied' && <AccessDeniedView />}
        {currentView === 'landing' && <LandingPage />}
        {currentView === 'tests' && <TestLibraryView />}
        {currentView === 'test-details' && <TestDetailsView />}
        {currentView === 'instructions' && <ExamInstructionsView />}
        {currentView === 'system-check' && <SystemCheckView />}
        {currentView === 'cbt-exam' && <CbtExamView />}
        {currentView === 'result' && <ResultDashboardView />}
        {currentView === 'student-dashboard' && <StudentDashboardView />}
        {currentView === 'profile' && <StudentDashboardView />}
        {currentView === 'student-custom-test' && <StudentCustomTestView />}
        {currentView === 'practice-engine' && <PracticeEngineView />}
        {currentView === 'bookmarks-mistakes' && <BookmarksMistakeView />}
        {currentView === 'teacher-dashboard' &&
          (authProfile.role === 'TEACHER' || authProfile.role === 'ADMIN' ? (
            <TeacherDashboardView />
          ) : (
            <AccessDeniedView />
          ))}
        {currentView.startsWith('admin') &&
          (authProfile.role === 'ADMIN' ? (
            <AdminDashboardView />
          ) : (
            <AccessDeniedView />
          ))}
      </main>

      {currentView !== 'cbt-exam' && <Footer />}

      {/* Global Command Palette */}
      <CommandPalette />
    </div>
  );
};

export default function App() {
  return (
    <ExamProvider>
      <MainRouter />
    </ExamProvider>
  );
}
