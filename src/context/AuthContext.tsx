import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  UserRole,
  UserProfile,
  BatchRecord,
  AnnouncementItem,
  TestAssignmentRule,
  PasswordRecoveryRequest,
  AuditLogEntry,
  StudentIdGeneratorConfig,
  ExamCategory,
  TeacherPermissionMatrix,
  CourseRecord,
  CourseEnrollmentRecord,
  StudyMaterialRecord,
  CourseType,
} from '../types/auth';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';

// In-memory session token (no localStorage usage for auth or database state)
let memorySessionToken: string | null = null;

export function getAuthSessionToken(): string | null {
  return memorySessionToken;
}

export function setAuthSessionToken(token: string | null): void {
  memorySessionToken = token;
}

interface LoginResponse {
  success: boolean;
  error?: string;
  accountStatus?: string;
  profile?: UserProfile;
}

interface AuthContextType {
  currentUser: UserProfile | null;
  sessionToken: string | null;
  isLoadingAuth: boolean;
  users: UserProfile[];
  batches: BatchRecord[];
  announcements: AnnouncementItem[];
  testAssignments: TestAssignmentRule[];
  recoveryRequests: PasswordRecoveryRequest[];
  auditLogs: AuditLogEntry[];
  studentIdConfig: StudentIdGeneratorConfig;
  courses: CourseRecord[];
  enrollments: CourseEnrollmentRecord[];
  studyMaterials: StudyMaterialRecord[];

  // Actions
  login: (params: {
    role: UserRole;
    identifier: string;
    password: string;
    rememberMe?: boolean;
  }) => Promise<LoginResponse>;
  loginWithGoogle: (preferredCourse?: CourseType) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  completeFirstLoginPasswordChange: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordRecovery: (params: {
    role: UserRole;
    identifier: string;
    reason?: string;
  }) => Promise<{ success: boolean; message: string }>;
  refreshPlatformData: () => Promise<void>;

  // Staff Management
  createTeacher: (params: {
    fullName: string;
    email: string;
    phone: string;
    department: string;
    subjects: string[];
    assignedCourses?: CourseType[];
    assignedClasses: string[];
    temporaryPassword?: string;
    permissions?: Partial<TeacherPermissionMatrix>;
  }) => Promise<{ success: boolean; profile?: UserProfile; temporaryPassword?: string; error?: string }>;

  createStudent: (params: {
    fullName: string;
    email?: string;
    phone?: string;
    classStandard: string;
    examCategory: ExamCategory;
    courseType?: CourseType;
    includeJeeAdvanced?: boolean;
    batchId: string | null;
    teacherId?: string | null;
    temporaryPassword?: string;
    idGenerationMode?: 'SEQUENTIAL' | 'RANDOM';
    validityUntil?: string | null;
    remarks?: string;
  }) => Promise<{ success: boolean; profile?: UserProfile; temporaryPassword?: string; error?: string }>;

  previewGeneratedStudentId: (
    examCategory: ExamCategory,
    mode?: 'SEQUENTIAL' | 'RANDOM'
  ) => Promise<string>;

  updateUser: (
    targetUserId: string,
    patch: Partial<UserProfile>
  ) => Promise<{ success: boolean; profile?: UserProfile; error?: string }>;

  deleteUser: (targetUserId: string) => Promise<{ success: boolean; error?: string }>;

  resetUserPassword: (
    targetUserId: string,
    newTemporaryPassword: string,
    forceChangeOnNextLogin?: boolean
  ) => Promise<{ success: boolean; temporaryPassword?: string; error?: string }>;

  forceLogoutUserSessions: (targetUserId: string) => Promise<{ success: boolean; revokedCount?: number }>;

  // Batches
  createBatch: (params: {
    name: string;
    code: string;
    examCategory: ExamCategory;
    classStandard: string;
    teacherId: string | null;
    description: string;
    schedule: string;
  }) => Promise<{ success: boolean; batch?: BatchRecord; error?: string }>;

  updateBatch: (
    batchId: string,
    patch: Partial<BatchRecord>
  ) => Promise<{ success: boolean; batch?: BatchRecord; error?: string }>;

  deleteBatch: (batchId: string) => Promise<boolean>;

  // Announcements
  publishAnnouncement: (params: {
    title: string;
    message: string;
    batchId: string | null;
    courseType?: CourseType | 'ALL';
    priority: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  }) => Promise<boolean>;

  deleteAnnouncement: (id: string) => Promise<boolean>;

  // Test Assignments
  saveTestAssignment: (params: {
    testId: string;
    batchIds?: string[];
    studentIds?: string[];
    availableFrom?: string | null;
    availableUntil?: string | null;
    maxAttempts?: number;
    isPublished?: boolean;
  }) => Promise<boolean>;

  // Recovery Requests
  resolveRecoveryRequest: (
    requestId: string,
    newTemporaryPassword: string
  ) => Promise<{ success: boolean; error?: string }>;

  // Student ID Generator Config
  saveStudentIdConfig: (patch: Partial<StudentIdGeneratorConfig>) => Promise<boolean>;

  // Course Enrollments & Study Materials
  updateCourseEnrollment: (params: {
    studentId: string;
    courseType: CourseType;
    enrollmentStatus?: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
    includeJeeAdvanced?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;

  createStudyMaterial: (params: {
    courseType: CourseType;
    subject: string;
    chapter: string;
    title: string;
    description: string;
    materialType: 'FORMULA_SHEET' | 'CONCEPT_NOTES' | 'PYQ_BOOKLET' | 'VIDEO_LECTURE';
    durationOrPages?: string;
  }) => Promise<boolean>;

  deleteStudyMaterial: (id: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_ID_CONFIG: StudentIdGeneratorConfig = {
  jeeMainPrefix: 'JEE26',
  jeeAdvancedPrefix: 'JEE26',
  neetPrefix: 'NEET26',
  nextJeeMainSeq: 10004,
  nextJeeAdvancedSeq: 10002,
  nextNeetSeq: 20003,
  mode: 'SEQUENTIAL',
  defaultMode: 'SEQUENTIAL',
  nextSequentialNumber: 10004,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [testAssignments, setTestAssignments] = useState<TestAssignmentRule[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<PasswordRecoveryRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [studentIdConfig, setStudentIdConfig] = useState<StudentIdGeneratorConfig>(DEFAULT_ID_CONFIG);
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [enrollments, setEnrollments] = useState<CourseEnrollmentRecord[]>([]);
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterialRecord[]>([]);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}, overrideToken?: string | null) => {
      const tokenToUse = overrideToken !== undefined ? overrideToken : sessionToken || memorySessionToken;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };
      if (tokenToUse) {
        headers['Authorization'] = `Bearer ${tokenToUse}`;
      }
      return fetch(url, {
        ...options,
        headers,
      });
    },
    [sessionToken]
  );

  const refreshPlatformData = useCallback(
    async (tokenOverride?: string | null, userOverride?: UserProfile | null) => {
      const token = tokenOverride !== undefined ? tokenOverride : sessionToken || memorySessionToken;
      const activeUser = userOverride !== undefined ? userOverride : currentUser;
      if (!token || !activeUser) return;

      try {
        const [batchesRes, annRes, assignRes, coursesRes, enrollRes, matRes] = await Promise.all([
          authFetch('/api/auth/batches', {}, token),
          authFetch('/api/auth/announcements', {}, token),
          authFetch('/api/auth/test-assignments', {}, token),
          authFetch('/api/courses', {}, token),
          authFetch('/api/enrollments', {}, token),
          authFetch('/api/study-materials', {}, token),
        ]);

        if (batchesRes.ok) setBatches(await batchesRes.json());
        if (annRes.ok) setAnnouncements(await annRes.json());
        if (assignRes.ok) setTestAssignments(await assignRes.json());
        if (coursesRes.ok) setCourses(await coursesRes.json());
        if (enrollRes.ok) setEnrollments(await enrollRes.json());
        if (matRes.ok) setStudyMaterials(await matRes.json());

        if (activeUser.role === 'ADMIN' || activeUser.role === 'TEACHER') {
          const [usersRes, recRes, idCfgRes] = await Promise.all([
            authFetch('/api/auth/users', {}, token),
            authFetch('/api/auth/recovery-requests', {}, token),
            authFetch('/api/auth/student-id-config', {}, token),
          ]);
          if (usersRes.ok) setUsers(await usersRes.json());
          if (recRes.ok) setRecoveryRequests(await recRes.json());
          if (idCfgRes.ok) setStudentIdConfig(await idCfgRes.json());
        }

        if (activeUser.role === 'ADMIN') {
          const logsRes = await authFetch('/api/auth/audit-logs', {}, token);
          if (logsRes.ok) setAuditLogs(await logsRes.json());
        }
      } catch (err) {
        console.warn('Error refreshing platform RBAC data:', err);
      }
    },
    [authFetch, sessionToken, currentUser]
  );

  // Listen for Firebase Auth state changes & synchronize with PostgreSQL
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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
          if (res.ok) {
            const data = await res.json();
            setAuthSessionToken(idToken);
            setSessionToken(idToken);
            setCurrentUser(data.profile);
            await refreshPlatformData(idToken, data.profile);
          }
        } catch (err) {
          console.warn('Firebase auth sync note:', err);
        }
      }
      setIsLoadingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (params: {
    role: UserRole;
    identifier: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<LoginResponse> => {
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
          error: data.error || 'Invalid credentials.',
          accountStatus: data.accountStatus,
        };
      }
      setAuthSessionToken(data.token);
      setSessionToken(data.token);
      setCurrentUser(data.profile);
      await refreshPlatformData(data.token, data.profile);
      return { success: true, profile: data.profile };
    } catch {
      return {
        success: false,
        error: 'Unable to reach authentication server. Please try again.',
      };
    }
  };

  const loginWithGoogle = async (preferredCourse?: CourseType): Promise<LoginResponse> => {
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
        return {
          success: false,
          error: data.error || 'Google authentication failed.',
        };
      }
      setAuthSessionToken(idToken);
      setSessionToken(idToken);
      setCurrentUser(data.profile);
      await refreshPlatformData(idToken, data.profile);
      return { success: true, profile: data.profile };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Google Sign-In was cancelled or failed.',
      };
    }
  };

  const logout = async () => {
    try {
      if (sessionToken) {
        await authFetch('/api/auth/logout', { method: 'POST' });
      }
      await firebaseSignOut(auth).catch(() => {});
    } catch {}
    setAuthSessionToken(null);
    setSessionToken(null);
    setCurrentUser(null);
    setUsers([]);
  };

  const completeFirstLoginPasswordChange = async (newPassword: string) => {
    try {
      const res = await authFetch('/api/auth/first-login-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to update password.' };
      }
      setCurrentUser(data.profile);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error while updating password.' };
    }
  };

  const requestPasswordRecovery = async (params: {
    role: UserRole;
    identifier: string;
    reason?: string;
  }) => {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      return {
        success: Boolean(data.success),
        message:
          data.message ||
          'Password recovery request submitted. Please contact your assigned Teacher or Administrator.',
      };
    } catch {
      return {
        success: false,
        message: 'Failed to submit recovery request.',
      };
    }
  };

  const createTeacher = async (params: {
    fullName: string;
    email: string;
    phone: string;
    department: string;
    subjects: string[];
    assignedCourses?: CourseType[];
    assignedClasses: string[];
    temporaryPassword?: string;
    permissions?: Partial<TeacherPermissionMatrix>;
  }) => {
    const res = await authFetch('/api/auth/teachers', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to create teacher.' };
    }
    await refreshPlatformData();
    return {
      success: true,
      profile: data.profile,
      temporaryPassword: data.temporaryPassword,
    };
  };

  const createStudent = async (params: {
    fullName: string;
    email?: string;
    phone?: string;
    classStandard: string;
    examCategory: ExamCategory;
    courseType?: CourseType;
    includeJeeAdvanced?: boolean;
    batchId: string | null;
    teacherId?: string | null;
    temporaryPassword?: string;
    idGenerationMode?: 'SEQUENTIAL' | 'RANDOM';
    validityUntil?: string | null;
    remarks?: string;
  }) => {
    const res = await authFetch('/api/auth/students', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to create student.' };
    }
    await refreshPlatformData();
    return {
      success: true,
      profile: data.profile,
      temporaryPassword: data.temporaryPassword,
    };
  };

  const previewGeneratedStudentId = async (
    examCategory: ExamCategory,
    mode?: 'SEQUENTIAL' | 'RANDOM'
  ): Promise<string> => {
    const res = await authFetch('/api/auth/generate-student-id-preview', {
      method: 'POST',
      body: JSON.stringify({ examCategory, mode }),
    });
    if (!res.ok) return 'JEE26-10005';
    const data = await res.json();
    return data.studentId;
  };

  const updateUser = async (targetUserId: string, patch: Partial<UserProfile>) => {
    const res = await authFetch(`/api/auth/users/${targetUserId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to update user.' };
    }
    if (currentUser && currentUser.id === targetUserId && data.profile) {
      setCurrentUser(data.profile);
    }
    await refreshPlatformData();
    return { success: true, profile: data.profile };
  };

  const deleteUser = async (targetUserId: string) => {
    const res = await authFetch(`/api/auth/users/${targetUserId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to delete user.' };
    }
    await refreshPlatformData();
    return { success: true };
  };

  const resetUserPassword = async (
    targetUserId: string,
    newTemporaryPassword: string,
    forceChangeOnNextLogin = true
  ) => {
    const res = await authFetch(`/api/auth/users/${targetUserId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newTemporaryPassword, forceChangeOnNextLogin }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to reset password.' };
    }
    await refreshPlatformData();
    return { success: true, temporaryPassword: data.temporaryPassword };
  };

  const forceLogoutUserSessions = async (targetUserId: string) => {
    const res = await authFetch(`/api/auth/users/${targetUserId}/revoke-sessions`, {
      method: 'POST',
    });
    const data = await res.json();
    await refreshPlatformData();
    return { success: res.ok, revokedCount: data.revokedCount };
  };

  const createBatch = async (params: {
    name: string;
    code: string;
    examCategory: ExamCategory;
    classStandard: string;
    teacherId: string | null;
    description: string;
    schedule: string;
  }) => {
    const res = await authFetch('/api/auth/batches', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to create batch.' };
    }
    await refreshPlatformData();
    return { success: true, batch: data };
  };

  const updateBatch = async (batchId: string, patch: Partial<BatchRecord>) => {
    const res = await authFetch(`/api/auth/batches/${batchId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to update batch.' };
    }
    await refreshPlatformData();
    return { success: true, batch: data };
  };

  const deleteBatch = async (batchId: string) => {
    const res = await authFetch(`/api/auth/batches/${batchId}`, {
      method: 'DELETE',
    });
    await refreshPlatformData();
    return res.ok;
  };

  const publishAnnouncement = async (params: {
    title: string;
    message: string;
    batchId: string | null;
    courseType?: CourseType | 'ALL';
    priority: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  }) => {
    const res = await authFetch('/api/auth/announcements', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    await refreshPlatformData();
    return res.ok;
  };

  const deleteAnnouncement = async (id: string) => {
    const res = await authFetch(`/api/auth/announcements/${id}`, {
      method: 'DELETE',
    });
    await refreshPlatformData();
    return res.ok;
  };

  const saveTestAssignment = async (params: {
    testId: string;
    batchIds?: string[];
    studentIds?: string[];
    availableFrom?: string | null;
    availableUntil?: string | null;
    maxAttempts?: number;
    isPublished?: boolean;
  }) => {
    const res = await authFetch('/api/auth/test-assignments', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    await refreshPlatformData();
    return res.ok;
  };

  const resolveRecoveryRequest = async (requestId: string, newTemporaryPassword: string) => {
    const res = await authFetch(`/api/auth/recovery-requests/${requestId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ newTemporaryPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to resolve request.' };
    }
    await refreshPlatformData();
    return { success: true };
  };

  const saveStudentIdConfig = async (patch: Partial<StudentIdGeneratorConfig>) => {
    const res = await authFetch('/api/auth/student-id-config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setStudentIdConfig(await res.json());
    }
    await refreshPlatformData();
    return res.ok;
  };

  const updateCourseEnrollment = async (params: {
    studentId: string;
    courseType: CourseType;
    enrollmentStatus?: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
    includeJeeAdvanced?: boolean;
  }) => {
    const res = await authFetch('/api/enrollments', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to update enrollment.' };
    }
    await refreshPlatformData();
    return { success: true };
  };

  const createStudyMaterial = async (params: {
    courseType: CourseType;
    subject: string;
    chapter: string;
    title: string;
    description: string;
    materialType: 'FORMULA_SHEET' | 'CONCEPT_NOTES' | 'PYQ_BOOKLET' | 'VIDEO_LECTURE';
    durationOrPages?: string;
  }) => {
    const res = await authFetch('/api/study-materials', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    await refreshPlatformData();
    return res.ok;
  };

  const deleteStudyMaterial = async (id: string) => {
    const res = await authFetch(`/api/study-materials/${id}`, {
      method: 'DELETE',
    });
    await refreshPlatformData();
    return res.ok;
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        sessionToken,
        isLoadingAuth,
        users,
        batches,
        announcements,
        testAssignments,
        recoveryRequests,
        auditLogs,
        studentIdConfig,
        courses,
        enrollments,
        studyMaterials,
        login,
        loginWithGoogle,
        logout,
        completeFirstLoginPasswordChange,
        requestPasswordRecovery,
        refreshPlatformData,
        createTeacher,
        createStudent,
        previewGeneratedStudentId,
        updateUser,
        deleteUser,
        resetUserPassword,
        forceLogoutUserSessions,
        createBatch,
        updateBatch,
        deleteBatch,
        publishAnnouncement,
        deleteAnnouncement,
        saveTestAssignment,
        resolveRecoveryRequest,
        saveStudentIdConfig,
        updateCourseEnrollment,
        createStudyMaterial,
        deleteStudyMaterial,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
