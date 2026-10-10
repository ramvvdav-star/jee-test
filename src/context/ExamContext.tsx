import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  TestDefinition,
  Question,
  TestAttemptResult,
  UserProfile,
  UserExamResponse,
  PaletteStatus,
  ExamType,
  ExamMode,
  ExamIntegrityEvent,
  QuestionBookmark,
  QuestionReport,
  AuditLog,
  SystemSettings,
  ActiveExamSession,
  ExamBlueprint,
} from '../types/exam';
import {
  AuthProfile,
  UserRole,
  CourseType,
  EnrollmentStatus,
  CourseRecord,
  EnrollmentRecord,
  StudyMaterialRecord,
  BatchRecord,
  TestAssignmentRecord,
  AnnouncementRecord,
  PasswordRecoveryRecord,
  StudentIdConfig,
} from '../types/auth';
import { SEED_TESTS } from '../data/seedTests';
import { getCentralizedQuestionBank } from '../data/fullLengthPapersGenerator';
import { OFFICIAL_EXAM_BLUEPRINTS } from '../data/officialExamPatterns';
import {
  computeQuestionFingerprint,
  enrichQuestionRecord,
  formatCanonicalQuestionId,
  selectQuestionsIntelligent,
  selectQuestionsForBlueprint,
  createOrResolveAttemptSnapshot,
  generateUniqueTestId,
  validateGeneratedTestQuestions,
  buildTestQuestionMappings,
} from '../data/questionBankEngine';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';

let inMemoryExamSessionToken: string | null = null;

export type AppView =
  | 'login'
  | 'first-login-reset'
  | 'access-denied'
  | 'landing'
  | 'tests'
  | 'test-details'
  | 'instructions'
  | 'system-check'
  | 'cbt-exam'
  | 'result'
  | 'admin-dashboard'
  | 'admin-questions'
  | 'admin-paper-builder'
  | 'teacher-dashboard'
  | 'student-custom-test'
  | 'student-dashboard'
  | 'practice-engine'
  | 'bookmarks-mistakes'
  | 'profile';

export function isCourseMatchForUser(
  profile: AuthProfile | null,
  targetCourseOrExam?: string | null
): boolean {
  if (!profile) return false;
  if (profile.role === 'ADMIN') return true;
  if (!targetCourseOrExam || targetCourseOrExam === 'ALL') return true;

  const upper = targetCourseOrExam.toUpperCase();
  const normTarget: CourseType =
    upper === 'NEET' || upper === 'COURSE_NEET'
      ? 'NEET'
      : upper === 'JEE_ADVANCED' || upper === 'COURSE_JEE_ADV'
      ? 'JEE_ADVANCED'
      : 'JEE';

  if (profile.role === 'TEACHER') {
    const assigned = profile.assignedCourses?.length
      ? profile.assignedCourses
      : [profile.courseType || 'JEE'];
    if (normTarget === 'NEET') return assigned.includes('NEET');
    if (normTarget === 'JEE_ADVANCED') return assigned.includes('JEE_ADVANCED');
    return assigned.includes('JEE') || assigned.includes('JEE_ADVANCED');
  }

  // STUDENT strict enrollment check
  if (profile.enrollmentStatus && profile.enrollmentStatus !== 'ACTIVE') return false;
  const studentCourse: CourseType =
    profile.courseType ||
    (profile.examCategory === 'NEET'
      ? 'NEET'
      : profile.examCategory === 'JEE_ADVANCED'
      ? 'JEE_ADVANCED'
      : 'JEE');

  if (studentCourse === 'NEET') return normTarget === 'NEET';
  if (studentCourse === 'JEE_ADVANCED') return normTarget === 'JEE' || normTarget === 'JEE_ADVANCED';
  return normTarget === 'JEE';
}

// URL Path <-> AppView helpers with course-aware student paths
function viewToPath(view: AppView, profile?: AuthProfile | null): string {
  const courseSlug =
    profile?.role === 'STUDENT'
      ? profile.courseType === 'NEET' || profile.examCategory === 'NEET'
        ? 'neet'
        : 'jee'
      : null;

  switch (view) {
    case 'login':
      return '/login';
    case 'first-login-reset':
      return '/student/first-login';
    case 'access-denied':
      return '/access-denied';
    case 'student-dashboard':
      return courseSlug ? `/student/${courseSlug}/dashboard` : '/student/dashboard';
    case 'teacher-dashboard':
      return '/teacher/dashboard';
    case 'admin-dashboard':
    case 'admin-questions':
    case 'admin-paper-builder':
      return '/admin/dashboard';
    case 'tests':
      return courseSlug ? `/student/${courseSlug}/mock-tests` : '/tests';
    case 'test-details':
      return '/tests/details';
    case 'instructions':
      return '/tests/instructions';
    case 'system-check':
      return '/tests/system-check';
    case 'cbt-exam':
      return '/exam/live';
    case 'result':
      return courseSlug ? `/student/${courseSlug}/results` : '/results';
    case 'student-custom-test':
      return courseSlug ? `/student/${courseSlug}/custom-test` : '/student/custom-test';
    case 'practice-engine':
      return courseSlug ? `/student/${courseSlug}/practice` : '/student/practice';
    case 'bookmarks-mistakes':
      return courseSlug ? `/student/${courseSlug}/bookmarks` : '/student/bookmarks';
    case 'profile':
      return '/profile';
    case 'landing':
    default:
      return '/portal';
  }
}

function checkCoursePathViolation(pathname: string, profile: AuthProfile | null): string | null {
  if (!profile) return null;
  const clean = pathname.toLowerCase();
  if (profile.role === 'STUDENT') {
    const isNeetStudent = profile.courseType === 'NEET' || profile.examCategory === 'NEET';
    if (clean.startsWith('/student/jee') && isNeetStudent) {
      return 'Course Authorization Violation — Your account is enrolled in NEET UG. You cannot access JEE course routes (/student/jee/*).';
    }
    if (clean.startsWith('/student/neet') && !isNeetStudent) {
      return `Course Authorization Violation — Your account is enrolled in ${
        profile.courseType || 'JEE'
      }. You cannot access NEET course routes (/student/neet/*).`;
    }
  }
  return null;
}

function pathToView(pathname: string): AppView {
  const clean = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (clean === '/login') return 'login';
  if (clean === '/student/first-login') return 'first-login-reset';
  if (clean.startsWith('/admin')) return 'admin-dashboard';
  if (clean.startsWith('/teacher')) return 'teacher-dashboard';
  if (
    clean === '/student' ||
    clean === '/student/dashboard' ||
    clean === '/student/jee/dashboard' ||
    clean === '/student/neet/dashboard' ||
    clean === '/dashboard'
  ) {
    return 'student-dashboard';
  }
  if (
    clean === '/student/custom-test' ||
    clean === '/student/jee/custom-test' ||
    clean === '/student/neet/custom-test'
  ) {
    return 'student-custom-test';
  }
  if (
    clean === '/student/practice' ||
    clean === '/student/jee/practice' ||
    clean === '/student/neet/practice'
  ) {
    return 'practice-engine';
  }
  if (
    clean === '/student/bookmarks' ||
    clean === '/student/jee/bookmarks' ||
    clean === '/student/neet/bookmarks'
  ) {
    return 'bookmarks-mistakes';
  }
  if (
    clean === '/tests' ||
    clean === '/mock-tests' ||
    clean === '/student/jee/mock-tests' ||
    clean === '/student/neet/mock-tests'
  ) {
    return 'tests';
  }
  if (clean === '/tests/details') return 'test-details';
  if (clean === '/tests/instructions') return 'instructions';
  if (clean === '/tests/system-check') return 'system-check';
  if (clean === '/exam/live') return 'cbt-exam';
  if (
    clean === '/results' ||
    clean === '/result' ||
    clean === '/student/jee/results' ||
    clean === '/student/neet/results'
  ) {
    return 'result';
  }
  if (clean === '/profile') return 'student-dashboard';
  if (clean === '/portal') return 'landing';
  return 'student-dashboard';
}

interface ExamContextType {
  // Navigation & User
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  currentUser: UserProfile;
  toggleUserRole: () => void;
  setCurrentUser: React.Dispatch<React.SetStateAction<UserProfile>>;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  login: (email: string, password?: string) => Promise<boolean>;
  register: (data: { name: string; email: string; targetExam: ExamType; targetYear: number }) => Promise<boolean>;
  logout: () => void;
  updateProfile: (profile: Partial<UserProfile>) => void;

  // Enterprise RBAC Authentication State
  authProfile: AuthProfile | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  accessDeniedMessage: string | null;
  clearAccessDenied: () => void;
  redirectTarget: string | null;
  loginWithCredentials: (params: {
    role: UserRole;
    identifier: string;
    password: string;
    rememberMe?: boolean;
  }) => Promise<{ success: boolean; error?: string; accountStatus?: string }>;
  loginWithGoogle: (preferredCourse?: CourseType) => Promise<{ success: boolean; error?: string }>;
  completeFirstLoginPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordRecovery: (params: {
    role: UserRole;
    identifier: string;
    reason?: string;
  }) => Promise<{ success: boolean; message: string }>;

  // RBAC & Course Separation Managed Entities
  courses: CourseRecord[];
  enrollments: EnrollmentRecord[];
  studyMaterials: StudyMaterialRecord[];
  managedUsers: AuthProfile[];
  batches: BatchRecord[];
  announcements: AnnouncementRecord[];
  testAssignments: TestAssignmentRecord[];
  recoveryRequests: PasswordRecoveryRecord[];
  studentIdConfig: StudentIdConfig | null;
  allAttempts: TestAttemptResult[];
  refreshRbacData: () => Promise<void>;
  createTeacher: (data: any) => Promise<{ success: boolean; error?: string; profile?: AuthProfile }>;
  createStudent: (data: any) => Promise<{
    success: boolean;
    error?: string;
    profile?: AuthProfile;
    generatedStudentId?: string;
    temporaryPassword?: string;
  }>;
  updateUserAccount: (userId: string, patch: any) => Promise<{ success: boolean; error?: string }>;
  updateStudentEnrollment: (params: {
    studentId: string;
    courseType: CourseType;
    status?: EnrollmentStatus;
    enrollmentStatus?: EnrollmentStatus;
    includeJeeAdvanced?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  createStudyMaterial: (data: any) => Promise<StudyMaterialRecord | null>;
  deleteStudyMaterial: (id: string) => Promise<boolean>;
  fetchRlsSecurityAudit: () => Promise<any>;
  generateCourseAwareTest: (params: {
    courseType?: CourseType;
    examType?: ExamType;
    subject: string;
    chapters?: string[];
    difficulty?: string;
    questionCount?: number;
    durationMinutes?: number;
    title?: string;
  }) => Promise<{ success: boolean; test?: TestDefinition; error?: string }>;
  deleteUserAccount: (userId: string) => Promise<{ success: boolean; error?: string }>;
  resetUserPassword: (
    userId: string,
    newTemporaryPassword: string,
    forceChange?: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  revokeUserSessions: (userId: string) => Promise<{ success: boolean; revokedCount?: number }>;
  createBatch: (data: any) => Promise<{ success: boolean; error?: string }>;
  updateBatch: (batchId: string, patch: any) => Promise<{ success: boolean; error?: string }>;
  deleteBatch: (batchId: string) => Promise<boolean>;
  publishAnnouncement: (data: any) => Promise<boolean>;
  removeAnnouncement: (id: string) => Promise<void>;
  saveTestAssignment: (data: any) => Promise<boolean>;
  resolveRecovery: (
    requestId: string,
    newTemporaryPassword: string
  ) => Promise<{ success: boolean; error?: string }>;
  saveStudentIdConfig: (patch: Partial<StudentIdConfig>) => Promise<void>;
  updateTestDefinition: (testId: string, patch: Partial<TestDefinition>) => Promise<void>;
  deleteTestDefinition: (testId: string) => Promise<void>;

  // Theme
  theme: 'light' | 'dark';
  toggleTheme: () => void;

  // Command Palette
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;

  // Network & Integrity
  isOnline: boolean;
  integrityEvents: ExamIntegrityEvent[];
  logIntegrityEvent: (type: ExamIntegrityEvent['type'], details: string) => void;

  // Tests & Question Bank
  tests: TestDefinition[];
  accessibleTests: TestDefinition[];
  questions: Question[];
  activeTest: TestDefinition | null;
  setActiveTest: (test: TestDefinition | null) => void;
  loadTests: () => Promise<void>;
  totalQuestionsInBank: number;
  questionBankPage: number;
  questionBankTotalPages: number;
  loadQuestions: (params?: {
    page?: number;
    limit?: number;
    examType?: string;
    subject?: string;
    difficulty?: string;
    search?: string;
  }) => Promise<void>;
  addQuestion: (q: Partial<Question>) => Promise<Question>;
  deleteQuestion: (id: string) => Promise<void>;
  updateQuestion: (id: string, q: Partial<Question>) => Promise<void>;
  publishTest: (newTest: Partial<TestDefinition>) => Promise<TestDefinition>;

  // Configurable Official Exam Blueprints & Snapshot Generator
  examBlueprints: Record<string, ExamBlueprint>;
  updateExamBlueprint: (key: string, blueprint: ExamBlueprint) => void;
  generateBlueprintMockTest: (blueprintKey: string, customTitle?: string) => Promise<TestDefinition>;

  // CBT Exam Execution State
  currentQuestionIdx: number;
  setCurrentQuestionIdx: (idx: number) => void;
  responses: Record<string, UserExamResponse>;
  timerSecondsLeft: number;
  isExamRunning: boolean;
  examMode: ExamMode;
  setExamMode: (mode: ExamMode) => void;
  hasAutoSubmitted: boolean;
  startCbtExam: (test: TestDefinition, mode?: ExamMode, attemptNumber?: number) => void;
  recordAnswer: (questionId: string, option?: string, numerical?: string) => void;
  markForReview: (questionId: string) => void;
  saveAndMarkForReview: (questionId: string) => void;
  clearResponse: (questionId: string) => void;
  saveAndNext: () => void;
  submitExam: () => Promise<TestAttemptResult | null>;
  lastSavedText: string;

  // Session Recovery & Resume
  inProgressSession: ActiveExamSession | null;
  resumeExam: () => void;
  discardExamSession: () => void;

  // Attempts & Results
  currentAttemptResult: TestAttemptResult | null;
  setCurrentAttemptResult: (res: TestAttemptResult | null) => void;
  attemptHistory: TestAttemptResult[];
  loadAttempts: () => Promise<void>;
  viewAttemptResult: (attempt: TestAttemptResult) => void;

  // Bookmarks
  bookmarks: QuestionBookmark[];
  addBookmark: (questionId: string, collection?: string, note?: string) => void;
  removeBookmark: (questionId: string) => void;
  isBookmarked: (questionId: string) => boolean;

  // Mistake Book & Practice
  mistakeQuestions: Question[];
  startMistakePractice: (subjectFilter?: string) => void;
  startCustomPractice: (questionsList: Question[], title: string, durationMinutes?: number) => void;

  // Reports
  reports: QuestionReport[];
  reportQuestion: (
    questionId: string,
    reason: QuestionReport['reason'],
    description: string,
    testId?: string
  ) => void;
  resolveReport: (reportId: string, status: 'RESOLVED' | 'DISMISSED') => void;

  // Audit Logs & Settings
  auditLogs: AuditLog[];
  logAdminAction: (action: string, target: string, details?: string) => void;
  systemSettings: SystemSettings;
  updateSystemSettings: (newSettings: Partial<SystemSettings>) => void;
}

const defaultUser: UserProfile = {
  id: 'usr-student-rahul',
  name: 'Rahul Verma',
  email: 'rahul.verma@student.ntapulse.edu.in',
  role: 'student',
  targetExam: 'JEE_MAIN',
  targetYear: 2026,
  totalTestsAttempted: 0,
  averageScore: 0,
  bestScore: 0,
  averageAccuracy: 0,
  practiceStreakDays: 1,
};

const defaultSettings: SystemSettings = {
  defaultNegativeMarking: true,
  enableLeaderboard: true,
  maintenanceMode: false,
  allowRegistration: false, // Controlled by Admin/Teacher only
  strictIntegrityLogging: true,
  autoSubmitOnTimeout: true,
};

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    actor: 'Dr. Rajeshwar Rao (Chief Controller)',
    action: 'PUBLISHED_PATTERN',
    target: 'JEE Main 2026 Information Bulletin Scheme',
    timestamp: '2026-02-15T10:00:00Z',
    details: 'Verified Section A (20 MCQ) + Section B (5 Numerical) regulation',
  },
];

const INITIAL_REPORTS: QuestionReport[] = [
  {
    id: 'rep-01',
    questionId: 'phy-001',
    studentName: 'Rahul Verma',
    reason: 'TYPO',
    description: 'LaTeX subscript missing in the dielectric capacitor formula description.',
    status: 'PENDING',
    createdAt: '2026-02-28T09:15:00Z',
    questionSnippet: 'A parallel-plate capacitor with plate area A and separation d...',
  },
];

const ExamContext = createContext<ExamContextType | undefined>(undefined);

export const ExamProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Authentication & Session State (in-memory token + Firebase Auth listener)
  const [sessionToken, setSessionToken] = useState<string | null>(inMemoryExamSessionToken);
  const [authProfile, setAuthProfile] = useState<AuthProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);
  const [redirectTarget, setRedirectTarget] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('redirect');
      if (r) return r;
      const p = window.location.pathname;
      if (p && p !== '/' && p !== '/login') return p;
    } catch {}
    return null;
  });

  const [currentView, setCurrentViewInternal] = useState<AppView>('login');
  const [currentUser, setCurrentUser] = useState<UserProfile>(defaultUser);

  // RBAC & Course Managed Collections
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([]);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterialRecord[]>([]);
  const [managedUsers, setManagedUsers] = useState<AuthProfile[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [testAssignments, setTestAssignments] = useState<TestAssignmentRecord[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<PasswordRecoveryRecord[]>([]);
  const [studentIdConfig, setStudentIdConfig] = useState<StudentIdConfig | null>(null);
  const [allAttempts, setAllAttempts] = useState<TestAttemptResult[]>([]);

  // Sync legacy currentUser whenever authProfile or attempts change
  useEffect(() => {
    if (!authProfile) return;
    const myAttempts = allAttempts.filter((a) => a.userId === authProfile.id);
    const totalAttempted = myAttempts.length;
    const avgScore =
      totalAttempted > 0
        ? Math.round(myAttempts.reduce((s, a) => s + a.totalScore, 0) / totalAttempted)
        : 0;
    const bestScore =
      totalAttempted > 0 ? Math.max(...myAttempts.map((a) => a.totalScore)) : 0;
    const avgAcc =
      totalAttempted > 0
        ? Math.round(myAttempts.reduce((s, a) => s + a.accuracy, 0) / totalAttempted)
        : 0;

    setCurrentUser({
      id: authProfile.id,
      name: authProfile.fullName,
      email: authProfile.email || authProfile.studentId || '',
      role: authProfile.role === 'ADMIN' ? 'admin' : 'student',
      targetExam: authProfile.examCategory || 'JEE_MAIN',
      targetYear: authProfile.targetYear || 2026,
      totalTestsAttempted: totalAttempted,
      averageScore: avgScore,
      bestScore: bestScore,
      averageAccuracy: avgAcc,
      practiceStreakDays: Math.max(1, totalAttempted * 2),
    });
  }, [authProfile, allAttempts]);

  // Role-checked view navigation with URL synchronization
  const setCurrentView = useCallback(
    (targetView: AppView) => {
      if (!authProfile) {
        const requestedPath = viewToPath(targetView);
        if (requestedPath !== '/login') {
          setRedirectTarget(requestedPath);
          try {
            window.history.replaceState(
              {},
              '',
              `/login?redirect=${encodeURIComponent(requestedPath)}`
            );
          } catch {}
        }
        setCurrentViewInternal('login');
        return;
      }

      // Enforce First-Login Password Creation Gate
      if (authProfile.mustChangePassword && targetView !== 'first-login-reset') {
        setCurrentViewInternal('first-login-reset');
        try {
          window.history.replaceState({}, '', '/student/first-login');
        } catch {}
        return;
      }

      // Enforce Role-Based Routing (Section 6 & 19)
      if (targetView.startsWith('admin') && authProfile.role !== 'ADMIN') {
        setAccessDeniedMessage('Access Denied — Administrator privileges required.');
        setCurrentViewInternal('access-denied');
        try {
          window.history.pushState({}, '', '/admin');
        } catch {}
        return;
      }

      if (targetView === 'teacher-dashboard' && authProfile.role === 'STUDENT') {
        setAccessDeniedMessage('Access Denied — Faculty / Teacher privileges required.');
        setCurrentViewInternal('access-denied');
        try {
          window.history.pushState({}, '', '/teacher/dashboard');
        } catch {}
        return;
      }

      setAccessDeniedMessage(null);
      setCurrentViewInternal(targetView);
      try {
        const nextPath = viewToPath(targetView, authProfile);
        if (window.location.pathname !== nextPath) {
          window.history.pushState({}, '', nextPath);
        }
      } catch {}
    },
    [authProfile]
  );

  const clearAccessDenied = useCallback(() => {
    setAccessDeniedMessage(null);
    if (!authProfile) {
      setCurrentViewInternal('login');
      return;
    }
    if (authProfile.role === 'ADMIN') setCurrentView('admin-dashboard');
    else if (authProfile.role === 'TEACHER') setCurrentView('teacher-dashboard');
    else setCurrentView('student-dashboard');
  }, [authProfile, setCurrentView]);

  // Handle browser Back/Forward buttons and direct URL entry with course route protection
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (!authProfile) {
        if (path !== '/login') {
          setRedirectTarget(path);
          try {
            window.history.replaceState({}, '', `/login?redirect=${encodeURIComponent(path)}`);
          } catch {}
        }
        setCurrentViewInternal('login');
        return;
      }
      const courseViolation = checkCoursePathViolation(path, authProfile);
      if (courseViolation) {
        setAccessDeniedMessage(courseViolation);
        setCurrentViewInternal('access-denied');
        return;
      }
      const targetView = pathToView(path);
      setCurrentView(targetView);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [authProfile, setCurrentView]);

  // Fetch RBAC & Course-Scoped Data
  const refreshRbacData = useCallback(async () => {
    if (!sessionToken) return;
    const headers = { Authorization: `Bearer ${sessionToken}` };
    try {
      const [batchesRes, annRes, assignRes, attRes, coursesRes, enrRes, matRes] = await Promise.all([
        fetch('/api/auth/batches', { headers }),
        fetch('/api/auth/announcements', { headers }),
        fetch('/api/auth/test-assignments', { headers }),
        fetch('/api/attempts', { headers }),
        fetch('/api/courses', { headers }),
        fetch('/api/enrollments', { headers }),
        fetch('/api/study-materials', { headers }),
      ]);

      if (batchesRes.ok) setBatches(await batchesRes.json());
      if (annRes.ok) setAnnouncements(await annRes.json());
      if (assignRes.ok) setTestAssignments(await assignRes.json());
      if (coursesRes.ok) setCourses(await coursesRes.json());
      if (enrRes.ok) setEnrollments(await enrRes.json());
      if (matRes.ok) setStudyMaterials(await matRes.json());
      if (attRes.ok) {
        const allAtt: TestAttemptResult[] = await attRes.json();
        setAllAttempts(allAtt);
        if (authProfile) {
          const mine = allAtt.filter(
            (a) =>
              a.userId === authProfile.id &&
              isCourseMatchForUser(authProfile, a.courseType || a.courseId || a.examType)
          );
          setAttemptHistory(mine);
        }
      }

      if (authProfile && (authProfile.role === 'ADMIN' || authProfile.role === 'TEACHER')) {
        const [usersRes, recRes, idCfgRes] = await Promise.all([
          fetch('/api/auth/users', { headers }),
          fetch('/api/auth/recovery-requests', { headers }),
          fetch('/api/auth/student-id-config', { headers }),
        ]);
        if (usersRes.ok) setManagedUsers(await usersRes.json());
        if (recRes.ok) setRecoveryRequests(await recRes.json());
        if (idCfgRes.ok) setStudentIdConfig(await idCfgRes.json());
      }

      if (authProfile && authProfile.role === 'ADMIN') {
        const auditRes = await fetch('/api/auth/audit-logs', { headers });
        if (auditRes.ok) {
          const dbLogs = await auditRes.json();
          setAuditLogs(
            dbLogs.map((l: any) => ({
              id: l.id,
              actor: `${l.actorName} (${l.actorRole})`,
              action: l.action,
              target: l.target,
              timestamp: l.createdAt,
              details: l.details,
            }))
          );
        }
      }
    } catch (err) {
      console.warn('Error refreshing RBAC data:', err);
    }
  }, [sessionToken, authProfile]);

  // Verify in-memory session or Firebase Auth state on mount
  useEffect(() => {
    let mounted = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!mounted) return;
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              idToken,
              displayName: firebaseUser.displayName,
            }),
          });
          if (res.ok && mounted) {
            const data = await res.json();
            const profile: AuthProfile = data.profile;
            inMemoryExamSessionToken = idToken;
            setSessionToken(idToken);
            setAuthProfile(profile);
            setIsAuthLoading(false);
            const defaultView: AppView =
              profile.role === 'ADMIN'
                ? 'admin-dashboard'
                : profile.role === 'TEACHER'
                ? 'teacher-dashboard'
                : 'student-dashboard';
            setCurrentViewInternal(defaultView);
            return;
          }
        } catch {}
      }

      if (!inMemoryExamSessionToken) {
        setAuthProfile(null);
        setIsAuthLoading(false);
        setCurrentViewInternal('login');
      } else {
        setIsAuthLoading(false);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authProfile && sessionToken) {
      refreshRbacData();
    }
  }, [authProfile, sessionToken, refreshRbacData]);

  // Login with Role (STUDENT / TEACHER / ADMIN)
  const loginWithCredentials = async (params: {
    role: UserRole;
    identifier: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<{ success: boolean; error?: string; accountStatus?: string }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Authentication failed.',
          accountStatus: data.accountStatus,
        };
      }

      const token: string = data.token;
      const profile: AuthProfile = data.profile;

      inMemoryExamSessionToken = token;
      setSessionToken(token);
      setAuthProfile(profile);
      setAccessDeniedMessage(null);

      // Check First Login Password Change requirement (Section 4)
      if (profile.mustChangePassword) {
        setCurrentViewInternal('first-login-reset');
        try {
          window.history.pushState({}, '', '/student/first-login');
        } catch {}
        return { success: true };
      }

      // Check redirect target (Section 5, 6 & 19)
      if (redirectTarget && redirectTarget !== '/' && redirectTarget !== '/login') {
        const targetPath = redirectTarget;
        setRedirectTarget(null);
        const courseViolation = checkCoursePathViolation(targetPath, profile);
        if (courseViolation) {
          setAccessDeniedMessage(courseViolation);
          setCurrentViewInternal('access-denied');
          try {
            window.history.pushState({}, '', targetPath);
          } catch {}
          return { success: true };
        }
        const targetView = pathToView(targetPath);
        if (targetView.startsWith('admin') && profile.role !== 'ADMIN') {
          setAccessDeniedMessage('Access Denied — Administrator privileges required.');
          setCurrentViewInternal('access-denied');
          try {
            window.history.pushState({}, '', '/admin');
          } catch {}
          return { success: true };
        }
        if (targetView === 'teacher-dashboard' && profile.role === 'STUDENT') {
          setAccessDeniedMessage('Access Denied — Faculty / Teacher privileges required.');
          setCurrentViewInternal('access-denied');
          try {
            window.history.pushState({}, '', '/teacher/dashboard');
          } catch {}
          return { success: true };
        }
        setCurrentViewInternal(targetView);
        try {
          window.history.pushState({}, '', viewToPath(targetView, profile));
        } catch {}
        return { success: true };
      }

      // Default role landing route
      const nextView: AppView =
        profile.role === 'ADMIN'
          ? 'admin-dashboard'
          : profile.role === 'TEACHER'
          ? 'teacher-dashboard'
          : 'student-dashboard';
      setCurrentViewInternal(nextView);
      try {
        window.history.pushState({}, '', viewToPath(nextView, profile));
      } catch {}
      return { success: true };
    } catch {
      return { success: false, error: 'Network error while signing in.' };
    }
  };

  // Login with Google (Firebase Auth + PostgreSQL users/profiles synchronization)
  const loginWithGoogle = async (
    preferredCourse?: CourseType
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          idToken,
          displayName: cred.user.displayName,
          courseType: preferredCourse,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Google authentication failed.' };
      }
      const profile: AuthProfile = data.profile;
      inMemoryExamSessionToken = idToken;
      setSessionToken(idToken);
      setAuthProfile(profile);
      setAccessDeniedMessage(null);
      const nextView: AppView =
        profile.role === 'ADMIN'
          ? 'admin-dashboard'
          : profile.role === 'TEACHER'
          ? 'teacher-dashboard'
          : 'student-dashboard';
      setCurrentViewInternal(nextView);
      try {
        window.history.pushState({}, '', viewToPath(nextView, profile));
      } catch {}
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Google Sign-In failed.' };
    }
  };

  // Complete First Login Password Creation
  const completeFirstLoginPassword = async (
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!sessionToken) return { success: false, error: 'Not authenticated.' };
    try {
      const res = await fetch('/api/auth/first-login-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to update password.' };
      }
      setAuthProfile(data.profile);
      setCurrentViewInternal('student-dashboard');
      try {
        window.history.pushState({}, '', '/student/dashboard');
      } catch {}
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to save new password.' };
    }
  };

  const requestPasswordRecovery = async (params: {
    role: UserRole;
    identifier: string;
    reason?: string;
  }): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      return {
        success: res.ok,
        message: data.message || data.error || 'Password recovery request logged.',
      };
    } catch {
      return { success: false, message: 'Failed to submit recovery request.' };
    }
  };

  const logout = useCallback(async () => {
    if (sessionToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
      } catch {}
    }
    await firebaseSignOut(auth).catch(() => {});
    inMemoryExamSessionToken = null;
    setSessionToken(null);
    setAuthProfile(null);
    setAccessDeniedMessage(null);
    setRedirectTarget(null);
    setCurrentViewInternal('login');
    try {
      window.history.pushState({}, '', '/login');
    } catch {}
  }, [sessionToken]);

  // Staff RBAC Mutations
  const createTeacher = async (data: any) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch('/api/auth/teachers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(data),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true, profile: out.profile };
  };

  const createStudent = async (data: any) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch('/api/auth/students', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(data),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return {
      success: true,
      profile: out.profile,
      generatedStudentId: out.generatedStudentId,
      temporaryPassword: out.temporaryPassword,
    };
  };

  const updateUserAccount = async (userId: string, patch: any) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch(`/api/auth/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(patch),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const deleteUserAccount = async (userId: string) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch(`/api/auth/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const resetUserPassword = async (
    userId: string,
    newTemporaryPassword: string,
    forceChange = true
  ) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch(`/api/auth/users/${userId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        newTemporaryPassword,
        forceChangeOnNextLogin: forceChange,
      }),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const revokeUserSessions = async (userId: string) => {
    if (!sessionToken) return { success: false };
    const res = await fetch(`/api/auth/users/${userId}/revoke-sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const out = await res.json();
    await refreshRbacData();
    return { success: res.ok, revokedCount: out.revokedCount };
  };

  const createBatch = async (data: any) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch('/api/auth/batches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(data),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const updateBatch = async (batchId: string, patch: any) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch(`/api/auth/batches/${batchId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(patch),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const deleteBatch = async (batchId: string) => {
    if (!sessionToken) return false;
    await fetch(`/api/auth/batches/${batchId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    await refreshRbacData();
    return true;
  };

  const publishAnnouncement = async (data: any) => {
    if (!sessionToken) return false;
    const res = await fetch('/api/auth/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(data),
    });
    if (res.ok) await refreshRbacData();
    return res.ok;
  };

  const removeAnnouncement = async (id: string) => {
    if (!sessionToken) return;
    await fetch(`/api/auth/announcements/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    await refreshRbacData();
  };

  const saveTestAssignment = async (data: any) => {
    if (!sessionToken) return false;
    const res = await fetch('/api/auth/test-assignments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(data),
    });
    if (res.ok) await refreshRbacData();
    return res.ok;
  };

  const resolveRecovery = async (requestId: string, newTemporaryPassword: string) => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch(`/api/auth/recovery-requests/${requestId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ newTemporaryPassword }),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const saveStudentIdConfig = async (patch: Partial<StudentIdConfig>) => {
    if (!sessionToken) return;
    const res = await fetch('/api/auth/student-id-config', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setStudentIdConfig(await res.json());
      await refreshRbacData();
    }
  };

  const updateStudentEnrollment = async (params: {
    studentId: string;
    courseType: CourseType;
    status?: EnrollmentStatus;
    enrollmentStatus?: EnrollmentStatus;
    includeJeeAdvanced?: boolean;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    const res = await fetch('/api/enrollments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        ...params,
        enrollmentStatus: params.enrollmentStatus || params.status || 'ACTIVE',
      }),
    });
    const out = await res.json();
    if (!res.ok) return { success: false, error: out.error };
    await refreshRbacData();
    return { success: true };
  };

  const createStudyMaterial = async (data: any): Promise<StudyMaterialRecord | null> => {
    if (!sessionToken) return null;
    const res = await fetch('/api/study-materials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        ...data,
        materialType: data.materialType || data.resourceType || 'NOTES',
        contentBody: data.contentBody || data.contentSummary || data.content || '',
      }),
    });
    if (!res.ok) return null;
    const created: StudyMaterialRecord = await res.json();
    await refreshRbacData();
    return created;
  };

  const deleteStudyMaterial = async (id: string): Promise<boolean> => {
    if (!sessionToken) return false;
    const res = await fetch(`/api/study-materials/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) await refreshRbacData();
    return res.ok;
  };

  const fetchRlsSecurityAudit = async (): Promise<any> => {
    if (!sessionToken) return null;
    try {
      const res = await fetch('/api/security/rls-audit', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) return await res.json();
    } catch {}
    return null;
  };

  const generateCourseAwareTest = async (params: {
    courseType?: CourseType;
    examType?: ExamType;
    subject: string;
    chapters?: string[];
    difficulty?: string;
    questionCount?: number;
    durationMinutes?: number;
    title?: string;
  }): Promise<{ success: boolean; test?: TestDefinition; error?: string }> => {
    if (!sessionToken) return { success: false, error: 'Not authenticated' };
    try {
      const res = await fetch('/api/tests/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Course authorization check failed.' };
      }
      setTests((prev) => [data, ...prev]);
      return { success: true, test: data };
    } catch {
      return { success: false, error: 'Failed to generate course-verified test.' };
    }
  };

  const [tests, setTests] = useState<TestDefinition[]>(SEED_TESTS);
  const [questions, setQuestions] = useState<Question[]>(() => getCentralizedQuestionBank());
  const [activeTest, setActiveTest] = useState<TestDefinition | null>(null);
  const [examBlueprints, setExamBlueprints] = useState<Record<string, ExamBlueprint>>(() => {
    try {
      const saved = localStorage.getItem('ntapulse_exam_blueprints');
      return saved ? JSON.parse(saved) : OFFICIAL_EXAM_BLUEPRINTS;
    } catch {
      return OFFICIAL_EXAM_BLUEPRINTS;
    }
  });

  const updateExamBlueprint = (key: string, blueprint: ExamBlueprint) => {
    setExamBlueprints((prev) => {
      const next = { ...prev, [key]: blueprint };
      try {
        localStorage.setItem('ntapulse_exam_blueprints', JSON.stringify(next));
      } catch {}
      return next;
    });
    logAdminAction('UPDATE_BLUEPRINT', blueprint.name, `Updated ${blueprint.exam} pattern (${blueprint.totalQuestions} Qs, ${blueprint.totalMarks} Marks)`);
  };

  const generateBlueprintMockTest = async (
    blueprintKey: string,
    customTitle?: string
  ): Promise<TestDefinition> => {
    const bp = examBlueprints[blueprintKey] || OFFICIAL_EXAM_BLUEPRINTS.JEE_MAIN_2026;
    if (authProfile && !isCourseMatchForUser(authProfile, bp.exam)) {
      throw new Error(`Course Security Error: Your account is not authorized to generate ${bp.exam} papers.`);
    }
    const testId = generateUniqueTestId(`test_${bp.exam.toLowerCase()}`);
    const selectedQuestions = selectQuestionsForBlueprint(questions, bp, testId);
    validateGeneratedTestQuestions(selectedQuestions);
    const snapshotIds = selectedQuestions.map((q) => q.questionId || q.id);
    const testQuestions = buildTestQuestionMappings(testId, selectedQuestions);

    const newTestPayload: Partial<TestDefinition> = {
      id: testId,
      testId,
      title:
        customTitle ||
        `${bp.exam.replace('_', ' ')} Official Blueprint Mock (${new Date().toLocaleDateString()})`,
      subtitle: `${bp.totalQuestions} Compulsory Questions • ${bp.totalMarks} Marks • ${bp.durationMinutes} Minutes`,
      courseId: bp.exam === 'NEET' ? 'course_neet' : bp.exam === 'JEE_ADVANCED' ? 'course_jee_adv' : 'course_jee',
      courseType: bp.exam === 'NEET' ? 'NEET' : bp.exam === 'JEE_ADVANCED' ? 'JEE_ADVANCED' : 'JEE',
      examType: bp.exam,
      testType: 'FULL_MOCK',
      patternYear: 2026,
      blueprintId: bp.id,
      patternSource: bp.sourceDocument,
      durationMinutes: bp.durationMinutes,
      totalMarks: bp.totalMarks,
      positiveMarks: bp.markingScheme.mcq.positive,
      negativeMarks: bp.markingScheme.mcq.negative,
      subjects: bp.subjects,
      questionsCount: selectedQuestions.length,
      difficulty: 'MEDIUM',
      syllabus: bp.sections.map(
        (s) => `${s.subject} — ${s.sectionName}: ${s.totalQuestions} Questions (+${s.positiveMarks}, -${s.negativeMarks})`
      ),
      description: `Generated via 10-step intelligent question rotation engine using ${bp.name}. Saved snapshot with zero duplicate questions.`,
      published: true,
      sections: bp.sections,
      questions: selectedQuestions,
      snapshotQuestionIds: snapshotIds,
      testQuestions,
      attemptSnapshots: [
        {
          attemptNumber: 1,
          setLabel: 'Set A',
          questionIds: snapshotIds,
          testQuestions,
          createdAt: new Date().toISOString(),
        },
      ],
      activeAttemptSet: 'Set A',
    };

    return await publishTest(newTestPayload);
  };

  const updateTestDefinition = async (testId: string, patch: Partial<TestDefinition>) => {
    try {
      await fetch(`/api/tests/${testId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(patch),
      });
    } catch {}
    setTests((prev) => prev.map((t) => (t.id === testId ? { ...t, ...patch } : t)));
  };

  const deleteTestDefinition = async (testId: string) => {
    try {
      await fetch(`/api/tests/${testId}`, {
        method: 'DELETE',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
    } catch {}
    setTests((prev) => prev.filter((t) => t.id !== testId));
  };

  // Compute accessible tests based on strict Course Separation AND Test Access Control
  const accessibleTests = React.useMemo(() => {
    if (!authProfile) return [];
    if (authProfile.role === 'ADMIN') {
      return tests;
    }

    const courseFilteredTests = tests.filter((test) =>
      isCourseMatchForUser(authProfile, test.courseType || test.courseId || test.examType)
    );

    if (authProfile.role === 'TEACHER') {
      return courseFilteredTests;
    }

    // Student filtering: check course match + testAssignments + batch assigned tests + direct student testAccess
    const assignmentMap = new Map<string, TestAssignmentRecord>();
    testAssignments.forEach((a) => assignmentMap.set(a.testId, a));

    return courseFilteredTests.filter((test) => {
      if (!test.published) return false;
      const rule = assignmentMap.get(test.id);
      if (!rule || rule.visibility === 'PUBLIC') {
        return true;
      }
      // Visibility is ASSIGNED_ONLY
      if (rule.assignedStudentIds.includes(authProfile.id)) return true;
      if (authProfile.batchId && rule.assignedBatchIds.includes(authProfile.batchId)) return true;
      if (authProfile.teacherId && rule.assignedTeacherIds.includes(authProfile.teacherId)) return true;
      if (authProfile.testAccess.includes(test.id)) return true;
      return false;
    });
  }, [tests, authProfile, testAssignments]);

  // Strictly course-filtered question bank for the authenticated user
  const accessibleQuestions = React.useMemo(() => {
    if (!authProfile) return [];
    if (authProfile.role === 'ADMIN') return questions;
    return questions.filter((q) =>
      isCourseMatchForUser(authProfile, q.courseType || q.courseId || q.examType)
    );
  }, [questions, authProfile]);

  // Theme
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('ntapulse_theme');
      return saved === 'dark' || saved === 'light' ? saved : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('ntapulse_theme', theme);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {}
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Auth modal
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Command palette
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Global keydown for Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (authProfile) {
          setIsCommandPaletteOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authProfile]);

  // Network online/offline tracking
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine ?? true);

  // CBT Exam State
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [responses, setResponses] = useState<Record<string, UserExamResponse>>({});
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(180 * 60);
  const [isExamRunning, setIsExamRunning] = useState<boolean>(false);
  const [examMode, setExamMode] = useState<ExamMode>('SIMULATION');
  const [hasAutoSubmitted, setHasAutoSubmitted] = useState<boolean>(false);
  const [lastSavedText, setLastSavedText] = useState<string>('All responses saved');
  const [examStartTime, setExamStartTime] = useState<number>(0);
  const [integrityEvents, setIntegrityEvents] = useState<ExamIntegrityEvent[]>([]);

  const logIntegrityEvent = useCallback((type: ExamIntegrityEvent['type'], details: string) => {
    const event: ExamIntegrityEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      timestamp: new Date().toISOString(),
      details,
    };
    setIntegrityEvents((prev) => [...prev, event]);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      logIntegrityEvent('NETWORK_RECONNECTED', 'Client restored network connection to server');
    };
    const handleOffline = () => {
      setIsOnline(false);
      logIntegrityEvent('NETWORK_OFFLINE', 'Client network connection dropped');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [logIntegrityEvent]);

  // Results & History (loaded from PostgreSQL /api/attempts)
  const [currentAttemptResult, setCurrentAttemptResult] = useState<TestAttemptResult | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<TestAttemptResult[]>([]);

  // Bookmarks (loaded and saved via PostgreSQL /api/bookmarks)
  const [bookmarks, setBookmarks] = useState<QuestionBookmark[]>([]);

  // Reports (loaded and saved via PostgreSQL /api/question-reports)
  const [reports, setReports] = useState<QuestionReport[]>(INITIAL_REPORTS);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);

  // System Settings
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(defaultSettings);

  const logAdminAction = (action: string, target: string, details?: string) => {
    const entry: AuditLog = {
      id: `audit-${Date.now()}`,
      actor: authProfile ? `${authProfile.fullName} (${authProfile.role})` : currentUser.name,
      action,
      target,
      timestamp: new Date().toISOString(),
      details,
    };
    setAuditLogs((prev) => [entry, ...prev]);
  };

  const updateSystemSettings = (newSettings: Partial<SystemSettings>) => {
    setSystemSettings((prev) => ({ ...prev, ...newSettings }));
    logAdminAction('UPDATE_SETTINGS', 'System Configuration', JSON.stringify(newSettings));
  };

  // Active Session Persistence (backed by PostgreSQL /api/active-session)
  const [inProgressSession, setInProgressSession] = useState<ActiveExamSession | null>(null);

  useEffect(() => {
    if (!authProfile || !sessionToken) return;
    const headers = { Authorization: `Bearer ${sessionToken}` };

    // Load active exam session from PostgreSQL
    fetch(`/api/active-session?userId=${encodeURIComponent(authProfile.id)}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((parsed: ActiveExamSession | null) => {
        if (parsed && parsed.testId && parsed.timerSecondsLeft > 0) {
          setInProgressSession(parsed);
          if (window.location.pathname.toLowerCase().startsWith('/exam/live') && parsed.testSnapshot) {
            setActiveTest(parsed.testSnapshot);
            setResponses(parsed.responses || {});
            setTimerSecondsLeft(parsed.timerSecondsLeft);
            setExamStartTime(parsed.examStartTime || Date.now());
            setCurrentQuestionIdx(parsed.currentQuestionIdx || 0);
            setExamMode(parsed.examMode || 'SIMULATION');
            setIntegrityEvents(parsed.integrityEvents || []);
            setIsExamRunning(true);
            setHasAutoSubmitted(false);
          }
        }
      })
      .catch(() => {});

    // Load user bookmarks from PostgreSQL
    fetch(`/api/bookmarks?userId=${encodeURIComponent(authProfile.id)}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.bookmarkedQuestionIds)) {
          const loaded: QuestionBookmark[] = data.bookmarkedQuestionIds.map((qId: string) => ({
            id: `bm_${authProfile.id}_${qId}`,
            questionId: qId,
            collection: 'General Revision',
            note: data.questionNotes?.[qId] || '',
            createdAt: new Date().toISOString(),
            question: questions.find((q) => q.id === qId || q.questionId === qId),
          }));
          setBookmarks(loaded);
        }
      })
      .catch(() => {});

    // Load question reports from PostgreSQL
    fetch('/api/question-reports', { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setReports(
            data.map((r: any) => ({
              id: r.id,
              questionId: r.questionId,
              testId: r.testId,
              studentName: r.userName || 'Student',
              reason: r.reason || 'OTHER',
              description: r.comment || '',
              status: r.status === 'RESOLVED' ? 'RESOLVED' : 'PENDING',
              createdAt: r.createdAt || new Date().toISOString(),
            }))
          );
        }
      })
      .catch(() => {});
  }, [authProfile, sessionToken]);

  useEffect(() => {
    if (!isExamRunning || !activeTest || !authProfile) return;

    const sessionData: ActiveExamSession = {
      testId: activeTest.id,
      attemptSetLabel: activeTest.activeAttemptSet,
      snapshotQuestionIds: activeTest.snapshotQuestionIds,
      testQuestions: activeTest.testQuestions,
      testSnapshot: activeTest,
      responses,
      timerSecondsLeft,
      examStartTime,
      currentQuestionIdx,
      examMode,
      integrityEvents,
      lastSavedTimestamp: Date.now(),
    };

    const timer = setTimeout(() => {
      fetch('/api/active-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          userId: authProfile.id,
          session: sessionData,
        }),
      }).catch(() => {});
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    isExamRunning,
    activeTest,
    responses,
    timerSecondsLeft,
    currentQuestionIdx,
    examMode,
    integrityEvents,
    examStartTime,
    authProfile,
    sessionToken,
  ]);

  useEffect(() => {
    if (!isExamRunning) return;

    const handleVisibility = () => {
      if (document.hidden) {
        logIntegrityEvent('TAB_HIDDEN', 'Candidate navigated away or minimized test browser tab');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isExamRunning, logIntegrityEvent]);

  const loadTests = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/tests?customOnly=true', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        const customTests: TestDefinition[] = await res.json();
        const allowedSeed = SEED_TESTS.filter((t) =>
          authProfile
            ? isCourseMatchForUser(authProfile, t.courseType || t.courseId || t.examType)
            : true
        );
        if (Array.isArray(customTests) && customTests.length > 0) {
          const customIds = new Set(customTests.map((t) => t.id));
          setTests([...customTests, ...allowedSeed.filter((t) => !customIds.has(t.id))]);
        } else {
          setTests(allowedSeed);
        }
      }
    } catch {}
  }, [sessionToken, authProfile]);

  const [totalQuestionsInBank, setTotalQuestionsInBank] = useState<number>(50000);
  const [questionBankPage, setQuestionBankPage] = useState<number>(1);
  const [questionBankTotalPages, setQuestionBankTotalPages] = useState<number>(1000);

  const loadQuestions = useCallback(
    async (params?: {
      page?: number;
      limit?: number;
      examType?: string;
      subject?: string;
      difficulty?: string;
      search?: string;
    }) => {
      if (!sessionToken) return;
      try {
        const qPage = params?.page || 1;
        const qLimit = params?.limit || 50;
        let url = `/api/questions?page=${qPage}&limit=${qLimit}`;
        if (params?.examType && params.examType !== 'ALL')
          url += `&examType=${encodeURIComponent(params.examType)}`;
        if (params?.subject && params.subject !== 'ALL')
          url += `&subject=${encodeURIComponent(params.subject)}`;
        if (params?.difficulty && params.difficulty !== 'ALL')
          url += `&difficulty=${encodeURIComponent(params.difficulty)}`;
        if (params?.search) url += `&search=${encodeURIComponent(params.search)}`;

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          const central = getCentralizedQuestionBank().filter((q) =>
            authProfile
              ? isCourseMatchForUser(authProfile, q.courseType || q.courseId || q.examType)
              : true
          );
          if (data.items && Array.isArray(data.items)) {
            const map = new Map<string, Question>();
            data.items.forEach((q: Question) => {
              const enriched = enrichQuestionRecord(q);
              if (
                !authProfile ||
                isCourseMatchForUser(
                  authProfile,
                  enriched.courseType || enriched.courseId || enriched.examType
                )
              ) {
                map.set(enriched.questionId || enriched.id, enriched);
              }
            });
            central.forEach((q) => {
              const key = q.questionId || q.id;
              if (!map.has(key)) map.set(key, q);
            });
            setQuestions(Array.from(map.values()));
            setTotalQuestionsInBank(Math.max(data.total || map.size, map.size));
            setQuestionBankPage(data.page || 1);
            setQuestionBankTotalPages(data.totalPages || 1);
          } else if (Array.isArray(data) && data.length > 0) {
            const map = new Map<string, Question>();
            data.forEach((q: Question) => {
              const enriched = enrichQuestionRecord(q);
              if (
                !authProfile ||
                isCourseMatchForUser(
                  authProfile,
                  enriched.courseType || enriched.courseId || enriched.examType
                )
              ) {
                map.set(enriched.questionId || enriched.id, enriched);
              }
            });
            central.forEach((q) => {
              const key = q.questionId || q.id;
              if (!map.has(key)) map.set(key, q);
            });
            setQuestions(Array.from(map.values()));
            setTotalQuestionsInBank(map.size);
          }
        }
      } catch {}
    },
    [sessionToken, authProfile]
  );

  const loadAttempts = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/attempts', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        const data: TestAttemptResult[] = await res.json();
        if (Array.isArray(data)) {
          setAllAttempts(data);
          if (authProfile) {
            const mine = data.filter(
              (a) =>
                a.userId === authProfile.id &&
                isCourseMatchForUser(authProfile, a.courseType || a.courseId || a.examType)
            );
            setAttemptHistory(mine);
          }
        }
      }
    } catch {}
  }, [authProfile, sessionToken]);

  useEffect(() => {
    if (sessionToken && authProfile) {
      loadTests();
      loadQuestions();
      loadAttempts();
    }
  }, [sessionToken, authProfile, loadTests, loadQuestions, loadAttempts]);

  // Legacy shims
  const login = async (_email: string): Promise<boolean> => {
    setIsAuthModalOpen(false);
    return true;
  };

  const register = async (): Promise<boolean> => {
    setIsAuthModalOpen(false);
    return true;
  };

  const updateProfile = (profile: Partial<UserProfile>) => {
    setCurrentUser((prev) => ({ ...prev, ...profile }));
  };

  const toggleUserRole = () => {
    // Role switching is strictly controlled by real login credentials now
  };

  // Add Question with Normalized Fingerprint Duplicate Detection (Part 1 & Part 2)
  const addQuestion = async (q: Partial<Question>): Promise<Question> => {
    const candidateText = q.questionText || '';
    const candidateSubj = q.subject || 'Physics';
    const candidateType = q.type || 'MCQ';
    const candidateExam = q.examType || 'JEE_MAIN';
    const fp = computeQuestionFingerprint(candidateText, candidateSubj, candidateType);

    // Check if an identical fingerprint already exists in the centralized question bank
    const existingDuplicate = questions.find(
      (item) =>
        (item.fingerprint ||
          computeQuestionFingerprint(item.questionText, item.subject, item.type)) === fp
    );
    if (existingDuplicate) {
      return existingDuplicate;
    }

    const canonicalId =
      q.questionId ||
      formatCanonicalQuestionId(candidateExam, candidateSubj, questions.length + 1);

    const enrichedPayload = enrichQuestionRecord(
      {
        id: canonicalId,
        questionId: canonicalId,
        examType: candidateExam,
        subject: candidateSubj,
        chapter: q.chapter || 'General',
        topic: q.topic || 'General Topic',
        difficulty: q.difficulty || 'MEDIUM',
        type: candidateType,
        questionText: candidateText,
        latex: q.latex,
        diagramSvg: q.diagramSvg,
        image: q.image,
        hasImage: Boolean(q.hasImage || q.diagramSvg || q.image),
        options: q.options || [
          { id: 'A', text: 'Option A' },
          { id: 'B', text: 'Option B' },
          { id: 'C', text: 'Option C' },
          { id: 'D', text: 'Option D' },
        ],
        correctAnswer: q.correctAnswer || 'A',
        explanation: q.explanation || '',
        positiveMarks: q.positiveMarks || 4,
        negativeMarks: q.negativeMarks || 1,
        source: q.source || 'ADMIN',
        status: q.status || 'PUBLISHED',
        createdAt: new Date().toISOString(),
        fingerprint: fp,
      },
      questions.length + 1
    );

    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(enrichedPayload),
      });
      if (res.ok) {
        const created = enrichQuestionRecord(await res.json(), questions.length + 1);
        setQuestions((prev) => [created, ...prev]);
        logAdminAction('CREATE_QUESTION', created.id, `${created.subject} - ${created.chapter}`);
        return created;
      }
    } catch {}

    setQuestions((prev) => [enrichedPayload, ...prev]);
    return enrichedPayload;
  };

  const deleteQuestion = async (id: string): Promise<void> => {
    try {
      await fetch(`/api/questions/${id}`, {
        method: 'DELETE',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
    } catch {}
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    logAdminAction('DELETE_QUESTION', id);
  };

  const updateQuestion = async (id: string, q: Partial<Question>): Promise<void> => {
    try {
      await fetch(`/api/questions/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(q),
      });
    } catch {}
    setQuestions((prev) => prev.map((item) => (item.id === id ? { ...item, ...q } : item)));
    logAdminAction('UPDATE_QUESTION', id);
  };

  const publishTest = async (newTest: Partial<TestDefinition>): Promise<TestDefinition> => {
    // Deduplicate questions inside newTest before saving snapshot
    const usedQuestionIds = new Set<string>();
    const usedFingerprints = new Set<string>();
    const deduplicatedQuestions: Question[] = [];

    for (const q of newTest.questions || []) {
      const qid = q.questionId || q.id;
      const fp = q.fingerprint || computeQuestionFingerprint(q.questionText, q.subject, q.type);
      if (!usedQuestionIds.has(qid) && !usedFingerprints.has(fp)) {
        usedQuestionIds.add(qid);
        usedFingerprints.add(fp);
        deduplicatedQuestions.push(enrichQuestionRecord(q));
      }
    }

    if (deduplicatedQuestions.length > 0) {
      validateGeneratedTestQuestions(deduplicatedQuestions);
    }

    const assignedTestId =
      newTest.testId && newTest.testId !== 'mock-test'
        ? newTest.testId
        : newTest.id && newTest.id !== 'mock-test'
        ? newTest.id
        : generateUniqueTestId('test');

    const snapshotIds = deduplicatedQuestions.map((q) => q.questionId || q.id);
    const testQuestions = buildTestQuestionMappings(assignedTestId, deduplicatedQuestions);

    try {
      const res = await fetch('/api/tests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          ...newTest,
          id: assignedTestId,
          testId: assignedTestId,
          questions: deduplicatedQuestions,
          questionsCount: deduplicatedQuestions.length,
          snapshotQuestionIds: snapshotIds,
          testQuestions,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        const enrichedTest: TestDefinition = {
          ...created,
          id: created.id || assignedTestId,
          testId: created.testId || created.id || assignedTestId,
          questions: deduplicatedQuestions,
          questionsCount: deduplicatedQuestions.length,
          snapshotQuestionIds: snapshotIds,
          testQuestions,
          attemptSnapshots: [
            {
              attemptNumber: 1,
              setLabel: 'Set A',
              questionIds: snapshotIds,
              testQuestions,
              createdAt: created.createdAt || new Date().toISOString(),
            },
          ],
          activeAttemptSet: 'Set A',
        };
        setTests((prev) => [enrichedTest, ...prev]);
        logAdminAction('PUBLISH_TEST', enrichedTest.id, enrichedTest.title);
        return enrichedTest;
      }
    } catch {}
    const localTest: TestDefinition = {
      id: assignedTestId,
      testId: assignedTestId,
      title: newTest.title || 'New Practice Test',
      subtitle: newTest.subtitle || 'Comprehensive Mock',
      examType: newTest.examType || 'JEE_MAIN',
      testType: newTest.testType || 'CUSTOM',
      patternYear: newTest.patternYear || 2026,
      blueprintId: newTest.blueprintId,
      patternSource: newTest.patternSource || 'NTA/JAB Official 2026 Bulletin',
      durationMinutes: newTest.durationMinutes || 60,
      totalMarks: newTest.totalMarks || deduplicatedQuestions.length * 4,
      positiveMarks: newTest.positiveMarks || 4,
      negativeMarks: newTest.negativeMarks || 1,
      subjects: newTest.subjects || ['Physics'],
      questionsCount: deduplicatedQuestions.length,
      difficulty: newTest.difficulty || 'MEDIUM',
      syllabus: newTest.syllabus || [],
      description: newTest.description || '',
      published: true,
      sections: newTest.sections,
      questions: deduplicatedQuestions,
      snapshotQuestionIds: snapshotIds,
      testQuestions,
      attemptSnapshots: [
        {
          attemptNumber: 1,
          setLabel: 'Set A',
          questionIds: snapshotIds,
          testQuestions,
          createdAt: new Date().toISOString(),
        },
      ],
      activeAttemptSet: 'Set A',
      createdAt: new Date().toISOString(),
    };
    setTests((prev) => [localTest, ...prev]);
    return localTest;
  };

  // Start CBT Exam with Course-Authorization Guard, Saved Snapshot & Multi-Attempt Set Support
  const startCbtExam = (
    test: TestDefinition,
    mode: ExamMode = 'SIMULATION',
    attemptNumber?: number
  ) => {
    if (
      authProfile &&
      !isCourseMatchForUser(authProfile, test.courseType || test.courseId || test.examType)
    ) {
      setAccessDeniedMessage(
        `Course Security Violation — You are enrolled in ${
          authProfile.courseType || authProfile.examCategory
        } and cannot launch a ${test.courseType || test.examType} examination.`
      );
      setCurrentViewInternal('access-denied');
      return;
    }

    // Count how many times the current student has already attempted this test
    const myPriorAttemptsCount = attemptHistory.filter((a) => a.testId === test.id).length;
    const effectiveAttemptNum = attemptNumber ?? (myPriorAttemptsCount + 1);

    const resolvedSnapshot = createOrResolveAttemptSnapshot(
      test,
      accessibleQuestions,
      effectiveAttemptNum
    );

    const snapshotBoundTest: TestDefinition = {
      ...test,
      questions: resolvedSnapshot.questions,
      questionsCount: resolvedSnapshot.questions.length,
      snapshotQuestionIds: resolvedSnapshot.snapshotQuestionIds,
      testQuestions: resolvedSnapshot.testQuestions,
      attemptSnapshots: resolvedSnapshot.updatedSnapshots,
      activeAttemptSet: resolvedSnapshot.setLabel,
    };

    // Persist updated attemptSnapshots on the test definition in state
    setTests((prev) =>
      prev.map((t) =>
        t.id === test.id
          ? {
              ...t,
              attemptSnapshots: resolvedSnapshot.updatedSnapshots,
              testQuestions: resolvedSnapshot.testQuestions,
            }
          : t
      )
    );

    setActiveTest(snapshotBoundTest);
    setCurrentQuestionIdx(0);
    setExamMode(mode);
    setIntegrityEvents([]);

    const initialResponses: Record<string, UserExamResponse> = {};
    snapshotBoundTest.questions.forEach((q, idx) => {
      initialResponses[q.id] = {
        questionId: q.id,
        status: idx === 0 ? 'NOT_ANSWERED' : 'NOT_VISITED',
        timeSpentSeconds: 0,
      };
    });
    setResponses(initialResponses);
    const totalSecs = (snapshotBoundTest.durationMinutes || 180) * 60;
    setTimerSecondsLeft(totalSecs);
    setExamStartTime(Date.now());
    setIsExamRunning(true);
    setHasAutoSubmitted(false);
    setInProgressSession(null);
    setCurrentView('cbt-exam');
  };

  const resumeExam = () => {
    if (!inProgressSession) return;
    const foundTest =
      inProgressSession.testSnapshot || tests.find((t) => t.id === inProgressSession.testId);
    if (!foundTest) {
      discardExamSession();
      return;
    }

    setActiveTest(foundTest);
    setResponses(inProgressSession.responses || {});
    setTimerSecondsLeft(inProgressSession.timerSecondsLeft || 3600);
    setExamStartTime(inProgressSession.examStartTime || Date.now());
    setCurrentQuestionIdx(inProgressSession.currentQuestionIdx || 0);
    setExamMode(inProgressSession.examMode || 'SIMULATION');
    setIntegrityEvents(inProgressSession.integrityEvents || []);
    setIsExamRunning(true);
    setHasAutoSubmitted(false);
    setInProgressSession(null);
    setCurrentView('cbt-exam');
  };

  const discardExamSession = () => {
    setInProgressSession(null);
    if (authProfile) {
      fetch(`/api/active-session?userId=${encodeURIComponent(authProfile.id)}`, {
        method: 'DELETE',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      }).catch(() => {});
    }
  };

  // Timer Tick
  useEffect(() => {
    if (!isExamRunning) return;

    const interval = setInterval(() => {
      setTimerSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setHasAutoSubmitted(true);
          return 0;
        }
        return prev - 1;
      });

      if (activeTest && activeTest.questions[currentQuestionIdx]) {
        const qId = activeTest.questions[currentQuestionIdx].id;
        setResponses((prev) => {
          const existing = prev[qId];
          if (!existing) return prev;
          return {
            ...prev,
            [qId]: {
              ...existing,
              timeSpentSeconds: existing.timeSpentSeconds + 1,
            },
          };
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isExamRunning, activeTest, currentQuestionIdx]);

  // Helper to change question index
  const changeQuestionIdx = (newIdx: number) => {
    if (!activeTest || newIdx < 0 || newIdx >= activeTest.questions.length) return;
    const targetQ = activeTest.questions[newIdx];
    setCurrentQuestionIdx(newIdx);

    setResponses((prev) => {
      const existing = prev[targetQ.id];
      if (!existing || existing.status === 'NOT_VISITED') {
        return {
          ...prev,
          [targetQ.id]: {
            questionId: targetQ.id,
            status: 'NOT_ANSWERED',
            timeSpentSeconds: existing ? existing.timeSpentSeconds : 0,
          },
        };
      }
      return prev;
    });
  };

  const recordAnswer = (questionId: string, option?: string, numerical?: string) => {
    setResponses((prev) => {
      const existing = prev[questionId] || {
        questionId,
        status: 'NOT_ANSWERED',
        timeSpentSeconds: 0,
      };
      const isCurrentlyMarked =
        existing.status === 'MARKED_FOR_REVIEW' || existing.status === 'ANSWERED_AND_MARKED';
      const newStatus: PaletteStatus = isCurrentlyMarked ? 'ANSWERED_AND_MARKED' : 'ANSWERED';

      return {
        ...prev,
        [questionId]: {
          ...existing,
          selectedOption: option !== undefined ? option : existing.selectedOption,
          numericalValue: numerical !== undefined ? numerical : existing.numericalValue,
          status: newStatus,
        },
      };
    });
    setLastSavedText('Auto-saved just now');
  };

  const markForReview = (questionId: string) => {
    setResponses((prev) => {
      const existing = prev[questionId] || {
        questionId,
        status: 'NOT_ANSWERED',
        timeSpentSeconds: 0,
      };
      const hasAnswer = !!(existing.selectedOption || existing.numericalValue?.trim());
      const newStatus: PaletteStatus = hasAnswer ? 'ANSWERED_AND_MARKED' : 'MARKED_FOR_REVIEW';

      return {
        ...prev,
        [questionId]: {
          ...existing,
          status: newStatus,
        },
      };
    });

    if (activeTest && currentQuestionIdx < activeTest.questions.length - 1) {
      changeQuestionIdx(currentQuestionIdx + 1);
    }
    setLastSavedText('Marked for review & moved next');
  };

  const saveAndMarkForReview = (questionId: string) => {
    setResponses((prev) => {
      const existing = prev[questionId] || {
        questionId,
        status: 'NOT_ANSWERED',
        timeSpentSeconds: 0,
      };
      const hasAnswer = !!(existing.selectedOption || existing.numericalValue?.trim());
      const newStatus: PaletteStatus = hasAnswer ? 'ANSWERED_AND_MARKED' : 'MARKED_FOR_REVIEW';

      return {
        ...prev,
        [questionId]: {
          ...existing,
          status: newStatus,
        },
      };
    });

    if (activeTest && currentQuestionIdx < activeTest.questions.length - 1) {
      changeQuestionIdx(currentQuestionIdx + 1);
    }
    setLastSavedText('Saved & Marked for Review (Will be evaluated)');
  };

  const clearResponse = (questionId: string) => {
    setResponses((prev) => {
      const existing = prev[questionId] || {
        questionId,
        status: 'NOT_ANSWERED',
        timeSpentSeconds: 0,
      };
      return {
        ...prev,
        [questionId]: {
          ...existing,
          selectedOption: undefined,
          numericalValue: undefined,
          status: 'NOT_ANSWERED',
        },
      };
    });
    setLastSavedText('Response cleared');
  };

  const saveAndNext = () => {
    if (!activeTest) return;
    const currentQ = activeTest.questions[currentQuestionIdx];
    setResponses((prev) => {
      const existing = prev[currentQ.id];
      if (!existing) return prev;
      const hasAnswer = !!(existing.selectedOption || existing.numericalValue?.trim());
      return {
        ...prev,
        [currentQ.id]: {
          ...existing,
          status: hasAnswer ? 'ANSWERED' : 'NOT_ANSWERED',
        },
      };
    });

    if (currentQuestionIdx < activeTest.questions.length - 1) {
      changeQuestionIdx(currentQuestionIdx + 1);
    }
    setLastSavedText('Response saved');
  };

  // Submit Exam
  const submitExam = async (): Promise<TestAttemptResult | null> => {
    if (!activeTest) return null;
    setIsExamRunning(false);

    const timeTakenSeconds = Math.max(1, Math.round((Date.now() - examStartTime) / 1000));
    const uid = authProfile?.id || currentUser.id;
    const uname = authProfile?.fullName || currentUser.name;

    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          testId: activeTest.id,
          testDefinition: activeTest,
          responses,
          timeTakenSeconds,
          userId: uid,
          userName: uname,
          startedAt: new Date(examStartTime).toISOString(),
        }),
      });

      if (res.ok) {
        const attemptResult: TestAttemptResult = await res.json();
        setCurrentAttemptResult(attemptResult);
        setAllAttempts((prev) => [attemptResult, ...prev]);
        setAttemptHistory((prev) => [attemptResult, ...prev]);
        setInProgressSession(null);
        setCurrentView('result');
        return attemptResult;
      }
    } catch {}

    const { evaluateTestAttempt } = await import('../utils/evaluationEngine');
    const localResult = evaluateTestAttempt(
      activeTest,
      responses,
      (activeTest.durationMinutes || 180) * 60,
      timeTakenSeconds,
      uid,
      uname
    );
    setCurrentAttemptResult(localResult);
    setAllAttempts((prev) => [localResult, ...prev]);
    setAttemptHistory((prev) => [localResult, ...prev]);
    setCurrentView('result');
    return localResult;
  };

  // Auto-submit when time reaches zero
  useEffect(() => {
    if (timerSecondsLeft === 0 && isExamRunning && !hasAutoSubmitted) {
      setHasAutoSubmitted(true);
      logIntegrityEvent('TIMEOUT', 'Timer elapsed to 0:00:00. Auto-submitting paper.');
      submitExam();
    }
  }, [timerSecondsLeft, isExamRunning, hasAutoSubmitted]);

  const viewAttemptResult = (attempt: TestAttemptResult) => {
    setCurrentAttemptResult(attempt);
    setCurrentView('result');
  };

  // Bookmarks (persisted in PostgreSQL user_bookmarks)
  const addBookmark = (
    questionId: string,
    collection: string = 'General Revision',
    note?: string
  ) => {
    const qObj =
      questions.find((q) => q.id === questionId) ||
      activeTest?.questions.find((q) => q.id === questionId);
    setBookmarks((prev) => {
      if (prev.some((b) => b.questionId === questionId)) {
        return prev.map((b) =>
          b.questionId === questionId ? { ...b, collection, note } : b
        );
      }
      return [
        {
          id: `bm-${Date.now()}`,
          questionId,
          collection,
          note,
          createdAt: new Date().toISOString(),
          question: qObj,
        },
        ...prev,
      ];
    });

    if (authProfile) {
      fetch('/api/bookmarks/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          userId: authProfile.id,
          questionId,
          bookmarked: true,
          notes: note || '',
        }),
      }).catch(() => {});
    }
  };

  const removeBookmark = (questionId: string) => {
    setBookmarks((prev) => prev.filter((b) => b.questionId !== questionId));
    if (authProfile) {
      fetch('/api/bookmarks/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          userId: authProfile.id,
          questionId,
          bookmarked: false,
        }),
      }).catch(() => {});
    }
  };

  const isBookmarked = (questionId: string) => {
    return bookmarks.some((b) => b.questionId === questionId);
  };

  // Mistake Book
  const mistakeQuestions = React.useMemo(() => {
    const missedMap = new Map<string, Question>();
    attemptHistory.forEach((att) => {
      att.questionReviews?.forEach((rev) => {
        if (!rev.isCorrect && rev.isAttempted) {
          missedMap.set(rev.question.id, rev.question);
        }
      });
    });
    return Array.from(missedMap.values());
  }, [attemptHistory]);

  const startMistakePractice = (subjectFilter?: string) => {
    let targetQuestions = mistakeQuestions;
    if (subjectFilter && subjectFilter !== 'ALL') {
      targetQuestions = targetQuestions.filter((q) => q.subject === subjectFilter);
    }

    const practiceTestId = generateUniqueTestId('mistake_practice');
    if (targetQuestions.length === 0) {
      targetQuestions = selectQuestionsIntelligent(accessibleQuestions, {
        exam: authProfile?.examCategory || 'JEE_MAIN',
        subject:
          subjectFilter && subjectFilter !== 'ALL' ? (subjectFilter as any) : undefined,
        difficulty: 'HARD',
        count: 15,
        testIdForTracking: practiceTestId,
      });
    }

    const testQuestions = buildTestQuestionMappings(practiceTestId, targetQuestions);
    const test: TestDefinition = {
      id: practiceTestId,
      testId: practiceTestId,
      title: 'Mistake Book Revision Sprint',
      subtitle: `Targeted review of ${targetQuestions.length} previously missed questions`,
      examType: authProfile?.examCategory || 'JEE_MAIN',
      testType: 'CUSTOM',
      patternYear: 2026,
      durationMinutes: Math.max(15, Math.round(targetQuestions.length * 2.5)),
      totalMarks: targetQuestions.length * 4,
      positiveMarks: 4,
      negativeMarks: 1,
      subjects: Array.from(new Set(targetQuestions.map((q) => q.subject))),
      questionsCount: targetQuestions.length,
      difficulty: 'HARD',
      syllabus: ['Revision of challenging & previously incorrect questions'],
      description: 'Strengthen weak areas with step-by-step solutions and instant feedback.',
      published: true,
      questions: targetQuestions,
      snapshotQuestionIds: targetQuestions.map((q) => q.questionId || q.id),
      testQuestions,
      createdAt: new Date().toISOString(),
    };

    startCbtExam(test, 'PRACTICE');
  };

  const startCustomPractice = (
    questionsList: Question[],
    title: string,
    durationMinutes: number = 30
  ) => {
    const test: TestDefinition = {
      id: `practice-drill-${Date.now()}`,
      title,
      subtitle: `${questionsList.length} Questions Instant Practice Drill`,
      examType: questionsList[0]?.examType || authProfile?.examCategory || 'JEE_MAIN',
      testType: 'CUSTOM',
      patternYear: 2026,
      durationMinutes,
      totalMarks: questionsList.length * 4,
      positiveMarks: 4,
      negativeMarks: 1,
      subjects: Array.from(new Set(questionsList.map((q) => q.subject))),
      questionsCount: questionsList.length,
      difficulty: 'MEDIUM',
      syllabus: ['Practice Mode Drill'],
      description: 'Interactive practice mode with instant solution verification.',
      published: true,
      questions: questionsList,
      createdAt: new Date().toISOString(),
    };

    startCbtExam(test, 'PRACTICE');
  };

  const reportQuestion = (
    questionId: string,
    reason: QuestionReport['reason'],
    description: string,
    testId?: string
  ) => {
    const qObj =
      questions.find((q) => q.id === questionId) ||
      activeTest?.questions.find((q) => q.id === questionId);
    const newReport: QuestionReport = {
      id: `rep-${Date.now()}`,
      questionId,
      testId,
      studentName: authProfile?.fullName || currentUser.name,
      reason,
      description,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      questionSnippet: qObj?.questionText?.slice(0, 80),
    };
    setReports((prev) => [newReport, ...prev]);

    fetch('/api/question-reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({
        id: newReport.id,
        questionId,
        testId: testId || 'bank',
        userId: authProfile?.id || currentUser.id,
        userName: newReport.studentName,
        reason,
        comment: description,
      }),
    }).catch(() => {});
  };

  const resolveReport = (reportId: string, status: 'RESOLVED' | 'DISMISSED') => {
    setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status } : r)));
    fetch(`/api/question-reports/${reportId}/resolve`, {
      method: 'PATCH',
      headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
    }).catch(() => {});
    logAdminAction('RESOLVE_REPORT', reportId, `Status set to ${status}`);
  };

  return (
    <ExamContext.Provider
      value={{
        currentView,
        setCurrentView,
        currentUser,
        toggleUserRole,
        setCurrentUser,
        isAuthModalOpen,
        setIsAuthModalOpen,
        login,
        register,
        logout,
        updateProfile,

        authProfile,
        sessionToken,
        isAuthenticated: Boolean(authProfile && sessionToken),
        isAuthLoading,
        accessDeniedMessage,
        clearAccessDenied,
        redirectTarget,
        loginWithCredentials,
        loginWithGoogle,
        completeFirstLoginPassword,
        requestPasswordRecovery,

        courses,
        enrollments,
        studyMaterials,
        managedUsers,
        batches,
        announcements,
        testAssignments,
        recoveryRequests,
        studentIdConfig,
        allAttempts,
        refreshRbacData,
        createTeacher,
        createStudent,
        updateUserAccount,
        updateStudentEnrollment,
        createStudyMaterial,
        deleteStudyMaterial,
        fetchRlsSecurityAudit,
        generateCourseAwareTest,
        deleteUserAccount,
        resetUserPassword,
        revokeUserSessions,
        createBatch,
        updateBatch,
        deleteBatch,
        publishAnnouncement,
        removeAnnouncement,
        saveTestAssignment,
        resolveRecovery,
        saveStudentIdConfig,
        updateTestDefinition,
        deleteTestDefinition,

        theme,
        toggleTheme,

        isCommandPaletteOpen,
        setIsCommandPaletteOpen,

        isOnline,
        integrityEvents,
        logIntegrityEvent,

        tests,
        accessibleTests,
        questions: accessibleQuestions,
        activeTest,
        setActiveTest,
        loadTests,
        totalQuestionsInBank,
        questionBankPage,
        questionBankTotalPages,
        loadQuestions,
        addQuestion,
        deleteQuestion,
        updateQuestion,
        publishTest,
        examBlueprints,
        updateExamBlueprint,
        generateBlueprintMockTest,

        currentQuestionIdx,
        setCurrentQuestionIdx: changeQuestionIdx,
        responses,
        timerSecondsLeft,
        isExamRunning,
        examMode,
        setExamMode,
        hasAutoSubmitted,
        startCbtExam,
        recordAnswer,
        markForReview,
        saveAndMarkForReview,
        clearResponse,
        saveAndNext,
        submitExam,
        lastSavedText,

        inProgressSession,
        resumeExam,
        discardExamSession,

        currentAttemptResult,
        setCurrentAttemptResult,
        attemptHistory,
        loadAttempts,
        viewAttemptResult,

        bookmarks,
        addBookmark,
        removeBookmark,
        isBookmarked,

        mistakeQuestions,
        startMistakePractice,
        startCustomPractice,

        reports,
        reportQuestion,
        resolveReport,

        auditLogs,
        logAdminAction,
        systemSettings,
        updateSystemSettings,
      }}
    >
      {children}
    </ExamContext.Provider>
  );
};

export const useExam = (): ExamContextType => {
  const context = useContext(ExamContext);
  if (!context) {
    throw new Error('useExam must be used within an ExamProvider');
  }
  return context;
};
