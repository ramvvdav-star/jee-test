import React from 'react';
import { useExam } from '../context/ExamContext';
import {
  BookOpen,
  ShieldCheck,
  GraduationCap,
  Award,
  LayoutDashboard,
  Zap,
  Bookmark,
  Search,
  Moon,
  Sun,
  Wifi,
  WifiOff,
  LogOut,
  Users,
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const {
    currentView,
    setCurrentView,
    authProfile,
    isAuthenticated,
    logout,
    theme,
    toggleTheme,
    setIsCommandPaletteOpen,
    isOnline,
    bookmarks,
    mistakeQuestions,
  } = useExam();

  // Hide standard navigation during active full-screen CBT examination or Login screens
  if (
    currentView === 'cbt-exam' ||
    currentView === 'login' ||
    currentView === 'first-login-reset' ||
    !isAuthenticated ||
    !authProfile
  ) {
    return null;
  }

  const role = authProfile.role;
  const studentCourse =
    authProfile.courseType ||
    (authProfile.examCategory === 'NEET'
      ? 'NEET'
      : authProfile.examCategory === 'JEE_ADVANCED'
      ? 'JEE_ADVANCED'
      : 'JEE');
  const coursePrefix = studentCourse === 'NEET' ? 'NEET' : 'JEE';

  return (
    <header className="sticky top-0 z-40 bg-slate-900 dark:bg-slate-950 text-white shadow-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Brand Logo */}
        <div
          onClick={() => {
            if (role === 'ADMIN') setCurrentView('admin-dashboard');
            else if (role === 'TEACHER') setCurrentView('teacher-dashboard');
            else setCurrentView('student-dashboard');
          }}
          className="flex items-center gap-3 cursor-pointer group shrink-0"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-inner shadow-indigo-400/30 group-hover:bg-indigo-500 transition-colors">
            <GraduationCap className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black tracking-tight text-lg text-white">NTA-PULSE</span>
              <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {role === 'STUDENT' ? `${studentCourse} CBT` : 'CBT 2026'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              {role === 'STUDENT'
                ? studentCourse === 'NEET'
                  ? 'National Eligibility cum Entrance Test (NEET UG) Portal'
                  : 'Joint Entrance Examination (JEE) Candidate Portal'
                : 'National Competitive Examination Portal'}
            </p>
          </div>
        </div>

        {/* Center Navigation Links — Strictly Scoped by Authenticated Role & Enrolled Course */}
        <nav className="hidden lg:flex items-center gap-1">
          {role === 'STUDENT' && (
            <>
              <button
                onClick={() => setCurrentView('student-dashboard')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'student-dashboard'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
                <span>{coursePrefix} Dashboard</span>
              </button>

              <button
                onClick={() => setCurrentView('tests')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'tests' || currentView === 'test-details'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span>{coursePrefix} Mock Tests</span>
              </button>

              <button
                onClick={() => setCurrentView('practice-engine')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'practice-engine'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>{coursePrefix} Practice</span>
              </button>

              <button
                onClick={() => setCurrentView('bookmarks-mistakes')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'bookmarks-mistakes'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5 text-rose-400" />
                <span>Saved &amp; Mistakes</span>
                {bookmarks.length + mistakeQuestions.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-rose-500/20 text-rose-300">
                    {bookmarks.length + mistakeQuestions.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setCurrentView('result')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'result'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Award className="w-3.5 h-3.5 text-sky-400" />
                <span>{coursePrefix} Results</span>
              </button>
            </>
          )}

          {role === 'TEACHER' && (
            <>
              <button
                onClick={() => setCurrentView('teacher-dashboard')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'teacher-dashboard'
                    ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/50'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Faculty Dashboard ({authProfile.courseType || 'JEE'})</span>
              </button>

              <button
                onClick={() => setCurrentView('tests')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'tests' || currentView === 'test-details'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span>Course Mock Library</span>
              </button>
            </>
          )}

          {role === 'ADMIN' && (
            <>
              <button
                onClick={() => setCurrentView('admin-dashboard')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView.startsWith('admin')
                    ? 'bg-purple-950/90 text-purple-300 border border-purple-700/50'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                <span>Admin Control Center</span>
              </button>

              <button
                onClick={() => setCurrentView('teacher-dashboard')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'teacher-dashboard'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Faculty View</span>
              </button>

              <button
                onClick={() => setCurrentView('tests')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'tests' || currentView === 'test-details'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span>Test Library</span>
              </button>
            </>
          )}
        </nav>

        {/* Right Controls: Search, Online Badge, Theme, Authenticated Role Badge & Logout */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 transition-colors cursor-pointer"
            title="Quick Command Search (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline text-[11px]">Search...</span>
            <kbd className="hidden md:inline px-1.5 py-0.2 text-[10px] font-mono bg-slate-900 text-slate-400 rounded border border-slate-700">
              ⌘K
            </kbd>
          </button>

          <div
            className={`hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold border ${
              isOnline
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                : 'bg-rose-950/80 text-rose-300 border-rose-700 animate-pulse'
            }`}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{isOnline ? 'SYNCED' : 'OFFLINE'}</span>
          </div>

          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

          {/* Authenticated Identity & Enrolled Course Badge */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border flex items-center gap-1.5 ${
                role === 'ADMIN'
                  ? 'bg-purple-950/80 border-purple-700 text-purple-300'
                  : role === 'TEACHER'
                  ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                  : 'bg-indigo-950/80 border-indigo-700 text-indigo-300'
              }`}
            >
              <span>{role}</span>
              {role === 'STUDENT' && (
                <span className="text-emerald-300">
                  · {studentCourse} ({authProfile.studentId})
                </span>
              )}
              {role === 'TEACHER' && (
                <span className="text-emerald-200">
                  · {authProfile.assignedCourses?.join(', ') || authProfile.courseType || 'JEE'}
                </span>
              )}
            </div>

            <span className="text-xs font-bold text-slate-200 hidden md:inline max-w-[140px] truncate">
              {authProfile.fullName}
            </span>

            <button
              onClick={logout}
              className="p-2 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-800/70 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
