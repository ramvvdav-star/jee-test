import React from 'react';
import { useExam } from '../context/ExamContext';
import { ShieldAlert, CheckCircle2, ShieldCheck } from 'lucide-react';

export const Footer: React.FC = () => {
  const { currentView, setCurrentView, authProfile } = useExam();

  if (currentView === 'cbt-exam') return null;

  const isAdmin = authProfile?.role === 'ADMIN';
  const isTeacher = authProfile?.role === 'TEACHER';
  const enrolledCourse = authProfile?.courseType || 'JEE';
  const isNeetStudent = authProfile?.role === 'STUDENT' && enrolledCourse === 'NEET';

  return (
    <footer className="bg-slate-900 text-slate-300 pt-12 pb-8 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">
                <CheckCircle2 className="w-5 h-5 text-white" />
              </div>
              <span className="font-black text-xl text-white tracking-tight">
                NTA<span className="text-indigo-400">Pulse</span>
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 border border-slate-700">
                Course-Isolated CBT System
              </span>
            </div>
            <p className="text-sm text-slate-400 max-w-md leading-relaxed">
              Engineered with strict course separation for{' '}
              {isNeetStudent ? 'NEET UG medical' : 'JEE Main, JEE Advanced, and NEET UG'} aspirants.
              Experience genuine computer-based exam ergonomics, authoritative timing, instant evaluation, and actionable analytics.
            </p>
            <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-xs text-amber-200/90 flex items-start gap-2 max-w-md">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Academic Disclaimer:</strong> CBT practice interface inspired by competitive examination workflows.
                NTA Pulse is an independent preparation and analytics platform and is not affiliated with, authorized, or operated by the National Testing Agency (NTA).
              </span>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
              {authProfile?.role === 'STUDENT' ? `My ${enrolledCourse} Portal` : 'Course Navigation'}
            </h4>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <button
                  onClick={() => setCurrentView('student-dashboard')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {isNeetStudent ? 'NEET UG Dashboard' : 'JEE Course Dashboard'}
                </button>
              </li>
              <li>
                <button
                  onClick={() => setCurrentView('tests')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {isNeetStudent
                    ? 'NEET UG Full Mocks (Phy, Chem, Bot, Zoo)'
                    : 'JEE Mock Tests (Phy, Chem, Math)'}
                </button>
              </li>
              <li>
                <button
                  onClick={() => setCurrentView('practice-engine')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {isNeetStudent ? 'NEET Topic Practice Engine' : 'JEE Topic Practice Engine'}
                </button>
              </li>
              <li>
                <button
                  onClick={() => setCurrentView('student-custom-test')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  Course Custom Sprint Builder
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
              {isAdmin || isTeacher ? 'Staff Controls' : 'Student Resources'}
            </h4>
            {isAdmin ? (
              <ul className="space-y-2 text-sm text-slate-400">
                <li>
                  <button
                    onClick={() => setCurrentView('admin-dashboard')}
                    className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                    Admin Command Center
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setCurrentView('admin-questions')}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    Controlled Question Bank
                  </button>
                </li>
              </ul>
            ) : isTeacher ? (
              <ul className="space-y-2 text-sm text-slate-400">
                <li>
                  <button
                    onClick={() => setCurrentView('teacher-dashboard')}
                    className="hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                    Faculty Command Portal
                  </button>
                </li>
              </ul>
            ) : (
              <ul className="space-y-2 text-sm text-slate-400">
                <li>
                  <button
                    onClick={() => setCurrentView('bookmarks-mistakes')}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    Bookmarks &amp; Mistake Vault
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setCurrentView('result')}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    My Course Results &amp; Analytics
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <p>
            © {new Date().getFullYear()} NTA Pulse. All mock papers, formulas, and CBT analytics are strictly isolated by course enrollment.
          </p>
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Course-Enforced Testing Engine Active
          </span>
        </div>
      </div>
    </footer>
  );
};
