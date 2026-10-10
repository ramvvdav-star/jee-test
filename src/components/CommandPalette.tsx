import React, { useState, useEffect, useMemo } from 'react';
import { useExam } from '../context/ExamContext';
import {
  Search,
  BookOpen,
  LayoutDashboard,
  Sliders,
  RotateCcw,
  Bookmark,
  Moon,
  Sun,
  ShieldCheck,
  Clock,
  Zap,
} from 'lucide-react';

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    accessibleTests: tests,
    setCurrentView,
    setActiveTest,
    inProgressSession,
    resumeExam,
    theme,
    toggleTheme,
    authProfile,
    startMistakePractice,
  } = useExam();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isCommandPaletteOpen]);

  const coursePrefix =
    authProfile?.role === 'STUDENT'
      ? authProfile.courseType === 'NEET' || authProfile.examCategory === 'NEET'
        ? 'NEET'
        : 'JEE'
      : 'Course';

  // Actions list strictly scoped to role & enrolled course
  const staticActions = useMemo(
    () => [
      {
        id: 'act-library',
        title: `Open ${coursePrefix} Examination Library`,
        subtitle: `Browse all authorized ${coursePrefix} full-length mock and chapter papers`,
        category: 'Navigation',
        icon: BookOpen,
        run: () => setCurrentView('tests'),
      },
      {
        id: 'act-dashboard',
        title: `${coursePrefix} Performance Dashboard`,
        subtitle: 'Analyze your scores, attempt history, speed, and accuracy trends',
        category: 'Navigation',
        icon: LayoutDashboard,
        run: () => setCurrentView('student-dashboard'),
      },
      {
        id: 'act-practice',
        title: `${coursePrefix} Interactive Practice Engine`,
        subtitle: 'Practice by weak areas, chapter drills, or PYQ workouts',
        category: 'Practice',
        icon: Zap,
        run: () => setCurrentView('practice-engine'),
      },
      {
        id: 'act-mistakes',
        title: `${coursePrefix} Mistake Book & Revision`,
        subtitle: 'Review and re-attempt all questions missed in previous tests',
        category: 'Practice',
        icon: RotateCcw,
        run: () => {
          startMistakePractice();
        },
      },
      {
        id: 'act-bookmarks',
        title: 'Saved Questions & Bookmarks',
        subtitle: 'View your bookmarked high-yield questions with personal notes',
        category: 'Revision',
        icon: Bookmark,
        run: () => setCurrentView('bookmarks-mistakes'),
      },
      {
        id: 'act-custom-test',
        title: `Build Custom ${coursePrefix} Sprint Test`,
        subtitle: 'Configure your own chapter test with custom duration and difficulty',
        category: 'Practice',
        icon: Sliders,
        run: () => setCurrentView('student-custom-test'),
      },
      ...(inProgressSession
        ? [
            {
              id: 'act-resume',
              title: 'Resume Unfinished Examination',
              subtitle: `Resume test session with remaining time and saved answers`,
              category: 'Active Test',
              icon: Clock,
              run: () => resumeExam(),
            },
          ]
        : []),
      {
        id: 'act-theme',
        title: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        subtitle: 'Toggle platform appearance between day and night contrast',
        category: 'Preferences',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => toggleTheme(),
      },
      ...(authProfile?.role === 'ADMIN'
        ? [
            {
              id: 'act-admin',
              title: 'Open Admin Command Center',
              subtitle: 'Manage courses, enrollments, question bank, and blueprints',
              category: 'Administration',
              icon: ShieldCheck,
              run: () => setCurrentView('admin-dashboard'),
            },
          ]
        : []),
    ],
    [
      coursePrefix,
      inProgressSession,
      theme,
      authProfile?.role,
      setCurrentView,
      resumeExam,
      toggleTheme,
      startMistakePractice,
    ]
  );

  // Matching tests strictly from accessibleTests
  const matchingTests = useMemo(() => {
    if (!query.trim()) return tests.slice(0, 5);
    const q = query.toLowerCase();
    return tests
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.subjects.some((s) => s.toLowerCase().includes(q)) ||
          t.examType.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [tests, query]);

  const filteredActions = useMemo(() => {
    if (!query.trim()) return staticActions;
    const q = query.toLowerCase();
    return staticActions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.subtitle.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [staticActions, query]);

  const allItems = useMemo(() => {
    const list: Array<{ type: 'action'; item: any } | { type: 'test'; item: any }> = [];
    filteredActions.forEach((a) => list.push({ type: 'action', item: a }));
    matchingTests.forEach((t) => list.push({ type: 'test', item: t }));
    return list;
  }, [filteredActions, matchingTests]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, allItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + allItems.length) % Math.max(1, allItems.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = allItems[selectedIndex];
        if (selected) {
          if (selected.type === 'action') {
            selected.item.run();
          } else {
            setActiveTest(selected.item);
            setCurrentView('test-details');
          }
          setIsCommandPaletteOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    isCommandPaletteOpen,
    allItems,
    selectedIndex,
    setActiveTest,
    setCurrentView,
    setIsCommandPaletteOpen,
  ]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-950/70 backdrop-blur-xs">
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 bg-slate-50 dark:bg-slate-950">
          <Search className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={`Search ${coursePrefix} commands, tests, subjects, or chapters... (Esc to exit)`}
            autoFocus
            className="flex-1 bg-transparent border-none text-sm font-medium text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
          />
          <kbd className="hidden sm:inline px-2 py-0.5 text-[10px] font-mono font-bold text-slate-500 bg-slate-200 dark:bg-slate-800 rounded">
            ESC
          </kbd>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {allItems.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-xs">
              No matching authorized commands or tests found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            allItems.map((entry, idx) => {
              const isSelected = idx === selectedIndex;
              if (entry.type === 'action') {
                const act = entry.item;
                const Icon = act.icon;
                return (
                  <button
                    key={act.id}
                    onClick={() => {
                      act.run();
                      setIsCommandPaletteOpen(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full p-3 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate">{act.title}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {act.subtitle}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono uppercase font-bold text-slate-400 shrink-0">
                      {act.category}
                    </span>
                  </button>
                );
              } else {
                const t = entry.item;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setActiveTest(t);
                      setCurrentView('test-details');
                      setIsCommandPaletteOpen(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full p-3 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                      {t.examType === 'NEET' ? 'NEET' : 'JEE'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate text-slate-900 dark:text-slate-100">
                        {t.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {t.questionsCount} Qs · {t.durationMinutes} mins · {t.subjects.join(', ')}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold shrink-0">
                      Launch Test →
                    </span>
                  </button>
                );
              }
            })
          )}
        </div>

        <div className="p-2.5 px-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-4">
            <span>
              Use{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">
                ↑
              </kbd>{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">
                ↓
              </kbd>{' '}
              to navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">
                Enter
              </kbd>{' '}
              to select
            </span>
          </div>
          <span>NTA-PULSE Course-Scoped Command System</span>
        </div>
      </div>
    </div>
  );
};
