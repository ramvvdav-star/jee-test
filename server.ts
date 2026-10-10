import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { SEED_TESTS } from './src/data/seedTests';
import { getCentralizedQuestionBank } from './src/data/fullLengthPapersGenerator';
import { OFFICIAL_EXAM_BLUEPRINTS } from './src/data/officialExamPatterns';
import {
  selectQuestionsIntelligent,
  selectQuestionsForBlueprint,
  validateGeneratedTestQuestions,
  buildTestQuestionMappings,
  generateUniqueTestId,
  createOrResolveAttemptSnapshot,
  auditQuestionBankAndTests,
  normalizeQuestion,
} from './src/data/questionBankEngine';
import {
  Question,
  TestDefinition,
  TestAttemptResult,
  SubjectName,
  ExamType,
  QuestionType,
  Difficulty,
} from './src/types/exam';
import { evaluateTestAttempt } from './src/utils/evaluationEngine';
import {
  ensureDatabaseSeeded,
  getAllTestsFromDb,
  saveTestToDb,
  saveTestSnapshotMappingsToDb,
  persistQuestionUsageToDb,
  deleteTestFromDb,
  getQuestionsPaginated,
  createQuestionInDb,
  updateQuestionInDb,
  deleteQuestionFromDb,
  saveAttemptToDb,
  getAttemptsFromDb,
  getActiveSessionFromDb,
  saveActiveSessionToDb,
  deleteActiveSessionFromDb,
  getUserBookmarksFromDb,
  toggleUserBookmarkInDb,
  getQuestionReportsFromDb,
  createQuestionReportInDb,
  resolveQuestionReportInDb,
} from './src/db/repository.ts';
import {
  ensureAuthSeeded,
  authenticateUser,
  verifySessionToken,
  revokeSessionByToken,
  revokeAllUserSessions,
  completeFirstLoginPasswordChange,
  resetUserPasswordByStaff,
  getAllProfiles,
  getProfileById,
  createTeacherAccount,
  createStudentAccount,
  updateProfileByStaff,
  deleteProfileByAdmin,
  getAllBatches,
  createBatchRecord,
  updateBatchRecord,
  deleteBatchRecord,
  getAllAnnouncements,
  createAnnouncementRecord,
  deleteAnnouncementRecord,
  createPasswordRecoveryRequest,
  getPasswordRecoveryRequests,
  resolvePasswordRecoveryRequest,
  getAllTestAssignments,
  upsertTestAssignment,
  getAuditLogs,
  getStudentIdConfig,
  updateStudentIdConfig,
  generateUniqueStudentId,
  createAuditLog,
  getAllCourses,
  getAllEnrollments,
  updateStudentCourseEnrollment,
  getStudyMaterialsForUser,
  createStudyMaterialRecord,
  deleteStudyMaterialRecord,
  isCourseAuthorizedForUser,
  getAuthorizedCourseIds,
  getAuthorizedCourseTypes,
  getAuthorizedSubjectsForUser,
  resolveCourseFromExam,
  getOrCreateFirebaseProfile,
} from './src/db/authRepository.ts';
import {
  AuthenticatedRequest,
  attachOptionalSessionAuth,
  requireSessionAuth,
  requireRoles,
  validateCourseAccessOrReject,
} from './src/middleware/auth.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json({ limit: '15mb' }));

// Runtime test definitions and attempts backed by PostgreSQL
let testsDB: TestDefinition[] = [...SEED_TESTS];
let attemptsDB: TestAttemptResult[] = [];
let dbInitPromise: Promise<void> | null = null;

async function ensureServerDataInitialized(): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = Promise.all([
      ensureDatabaseSeeded(),
      ensureAuthSeeded(),
      getAllTestsFromDb().then((loadedTests) => {
        if (loadedTests.length > 0) {
          testsDB = loadedTests;
        }
      }),
      getAttemptsFromDb().then((loaded) => {
        if (loaded.length > 0) {
          attemptsDB = loaded;
        }
      }),
    ])
      .then(() => undefined)
      .catch((err) => {
        dbInitPromise = null;
        console.warn('Database initialization note:', err);
      });
  }
  return dbInitPromise;
}

app.use('/api', async (_req, _res, next) => {
  await ensureServerDataInitialized();
  next();
});

// ----------------- AUTHENTICATION & RBAC API ROUTES -----------------

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', database: 'cloudsql-postgresql', time: new Date().toISOString() });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { role, identifier, password, rememberMe } = req.body;
    if (!role || !identifier || !password) {
      return res.status(400).json({
        error: 'Please provide your role, login identifier, and password.',
      });
    }

    const result = await authenticateUser({
      role,
      identifier,
      password,
      rememberMe: Boolean(rememberMe),
      userAgent: req.headers['user-agent'] || 'Web Client',
      ipAddress: req.ip || '127.0.0.1',
    });

    if (!result.success) {
      return res.status(result.statusCode).json({
        error: result.error,
        accountStatus: result.accountStatus,
      });
    }

    return res.json({
      token: result.token,
      profile: result.profile,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Authentication service error.' });
  }
});

// POST /api/auth/google - Exchange Firebase ID token and synchronize user in PostgreSQL
app.post('/api/auth/google', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : req.body.idToken;
    if (!token) {
      return res.status(400).json({ error: 'Missing Firebase ID token.' });
    }
    const decoded = await adminAuth.verifyIdToken(token);
    const profile = await getOrCreateFirebaseProfile({
      uid: decoded.uid,
      email: decoded.email || `${decoded.uid}@firebase.user`,
      displayName: decoded.name || req.body.displayName,
      preferredRole: req.body.role,
      preferredCourse: req.body.courseType,
    });
    return res.json({
      token,
      profile,
    });
  } catch (err) {
    console.error('Firebase Google auth error:', err);
    return res.status(401).json({ error: 'Invalid or expired Firebase ID token.' });
  }
});

// GET /api/auth/session - Verify active session token or Firebase ID token
app.get('/api/auth/session', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false, error: 'No session token provided.' });
  }
  const rawToken = authHeader.slice(7).trim();
  const verification = await verifySessionToken(rawToken);
  if (verification.valid && verification.profile) {
    return res.json({ valid: true, profile: verification.profile });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(rawToken);
    const profile = await getOrCreateFirebaseProfile({
      uid: decoded.uid,
      email: decoded.email || `${decoded.uid}@firebase.user`,
      displayName: decoded.name,
    });
    return res.json({ valid: true, profile });
  } catch {
    return res.status(verification.accountStatus ? 403 : 401).json(verification);
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7).trim();
    await revokeSessionByToken(rawToken);
  }
  return res.json({ success: true });
});

// POST /api/auth/first-login-password - Forced password creation on 1st student login
app.post(
  '/api/auth/first-login-password',
  requireSessionAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { newPassword } = req.body;
      if (!req.authProfile) {
        return res.status(401).json({ error: 'Not authenticated.' });
      }
      const result = await completeFirstLoginPasswordChange({
        userId: req.authProfile.id,
        newPassword,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ success: true, profile: result.profile });
    } catch (err) {
      console.error('First login password change error:', err);
      return res.status(500).json({ error: 'Failed to update password.' });
    }
  }
);

// POST /api/auth/forgot-password - Request password recovery
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { role, identifier, reason } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Please provide your Student ID or Email.' });
    }
    const result = await createPasswordRecoveryRequest({
      role: role || 'STUDENT',
      identifier,
      reason,
    });
    return res.json(result);
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Failed to submit recovery request.' });
  }
});

// GET /api/auth/users - List profiles (Admin gets all, Teacher gets assigned students + teachers)
app.get(
  '/api/auth/users',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const all = await getAllProfiles();
      const actor = req.authProfile!;
      if (actor.role === 'ADMIN' || actor.teacherPermissions.canViewAllStudents) {
        return res.json(all);
      }
      // Teacher only sees students assigned to them (or in their batches) + themselves
      const allBatches = await getAllBatches();
      const teacherBatchIds = new Set(
        allBatches.filter((b) => b.teacherId === actor.id).map((b) => b.id)
      );
      const filtered = all.filter(
        (u) =>
          u.id === actor.id ||
          (u.role === 'STUDENT' &&
            (u.teacherId === actor.id || (u.batchId && teacherBatchIds.has(u.batchId))))
      );
      return res.json(filtered);
    } catch (err) {
      console.error('Error listing users:', err);
      return res.status(500).json({ error: 'Failed to load users.' });
    }
  }
);

// POST /api/auth/teachers - Admin creates a teacher account
app.post(
  '/api/auth/teachers',
  requireRoles(['ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await createTeacherAccount({
        ...req.body,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.status(201).json(result);
    } catch (err) {
      console.error('Create teacher error:', err);
      return res.status(500).json({ error: 'Failed to create teacher account.' });
    }
  }
);

// POST /api/auth/students - Teacher or Admin creates a student account & generates unique Student ID
app.post(
  '/api/auth/students',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await createStudentAccount({
        ...req.body,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.status(201).json(result);
    } catch (err) {
      console.error('Create student error:', err);
      return res.status(500).json({ error: 'Failed to create student account.' });
    }
  }
);

// POST /api/auth/generate-student-id-preview
app.post(
  '/api/auth/generate-student-id-preview',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req, res) => {
    try {
      const { examCategory, mode } = req.body;
      const previewId = await generateUniqueStudentId(examCategory || 'JEE_MAIN', mode);
      return res.json({ studentId: previewId });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate Student ID.' });
    }
  }
);

// PATCH /api/auth/users/:id - Update user profile, status, permissions, batch, or teacher
app.patch(
  '/api/auth/users/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await updateProfileByStaff({
        targetUserId: req.params.id,
        patch: req.body,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json(result);
    } catch (err) {
      console.error('Update user error:', err);
      return res.status(500).json({ error: 'Failed to update user.' });
    }
  }
);

// DELETE /api/auth/users/:id - Admin deletes user account
app.delete(
  '/api/auth/users/:id',
  requireRoles(['ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await deleteProfileByAdmin({
        targetUserId: req.params.id,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete user.' });
    }
  }
);

// POST /api/auth/users/:id/reset-password - Staff resets user credentials
app.post(
  '/api/auth/users/:id/reset-password',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { newTemporaryPassword, forceChangeOnNextLogin } = req.body;
      const result = await resetUserPasswordByStaff({
        targetUserId: req.params.id,
        newTemporaryPassword,
        forceChangeOnNextLogin: forceChangeOnNextLogin !== false,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to reset credentials.' });
    }
  }
);

// POST /api/auth/users/:id/revoke-sessions - Force logout user across all devices
app.post(
  '/api/auth/users/:id/revoke-sessions',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const count = await revokeAllUserSessions(req.params.id);
      await createAuditLog({
        actorId: req.authProfile!.id,
        actorName: req.authProfile!.fullName,
        actorRole: req.authProfile!.role,
        action: 'FORCE_LOGOUT_SESSIONS',
        target: req.params.id,
        details: `Revoked ${count} active session(s)`,
      });
      return res.json({ success: true, revokedCount: count });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to revoke sessions.' });
    }
  }
);

// ----------------- BATCHES & CLASSES ENDPOINTS -----------------

app.get('/api/auth/batches', requireSessionAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const all = await getAllBatches();
    return res.json(all);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load batches.' });
  }
});

app.post(
  '/api/auth/batches',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await createBatchRecord({
        ...req.body,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.status(201).json(result.batch);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create batch.' });
    }
  }
);

app.patch(
  '/api/auth/batches/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await updateBatchRecord({
        batchId: req.params.id,
        patch: req.body,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json(result.batch);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update batch.' });
    }
  }
);

app.delete(
  '/api/auth/batches/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      await deleteBatchRecord(req.params.id, req.authProfile!);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete batch.' });
    }
  }
);

// ----------------- ANNOUNCEMENTS ENDPOINTS (COURSE-SCOPED) -----------------

app.get('/api/auth/announcements', requireSessionAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const list = await getAllAnnouncements();
    const actor = req.authProfile!;
    if (actor.role === 'ADMIN') {
      return res.json(list);
    }
    const allowedCourses = new Set(getAuthorizedCourseTypes(actor));
    const filtered = list.filter(
      (a) =>
        !a.courseType ||
        a.courseType === 'ALL' ||
        allowedCourses.has(a.courseType as any)
    );
    return res.json(filtered);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load announcements.' });
  }
});

app.post(
  '/api/auth/announcements',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const item = await createAnnouncementRecord({
        ...req.body,
        actor: req.authProfile!,
      });
      return res.status(201).json(item);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to publish announcement.' });
    }
  }
);

app.delete(
  '/api/auth/announcements/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req, res) => {
    try {
      await deleteAnnouncementRecord(req.params.id);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete announcement.' });
    }
  }
);

// ----------------- TEST ACCESS CONTROL ENDPOINTS -----------------

app.get('/api/auth/test-assignments', requireSessionAuth, async (_req, res) => {
  try {
    const list = await getAllTestAssignments();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load test assignments.' });
  }
});

app.post(
  '/api/auth/test-assignments',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const record = await upsertTestAssignment({
        ...req.body,
        actor: req.authProfile!,
      });
      return res.json(record);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update test access rules.' });
    }
  }
);

// ----------------- PASSWORD RECOVERY & AUDIT LOGS & STUDENT ID CONFIG -----------------

app.get(
  '/api/auth/recovery-requests',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const list = await getPasswordRecoveryRequests();
      const actor = req.authProfile!;
      if (actor.role === 'ADMIN') return res.json(list);
      return res.json(list.filter((r) => r.teacherId === actor.id));
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load password recovery requests.' });
    }
  }
);

app.post(
  '/api/auth/recovery-requests/:id/resolve',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await resolvePasswordRecoveryRequest({
        requestId: req.params.id,
        newTemporaryPassword: req.body.newTemporaryPassword,
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to resolve recovery request.' });
    }
  }
);

app.get('/api/auth/audit-logs', requireRoles(['ADMIN']), async (_req, res) => {
  try {
    const logs = await getAuditLogs(150);
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load audit logs.' });
  }
});

app.get('/api/auth/student-id-config', requireRoles(['ADMIN', 'TEACHER']), async (_req, res) => {
  try {
    const config = await getStudentIdConfig();
    return res.json(config);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load Student ID configuration.' });
  }
});

app.patch('/api/auth/student-id-config', requireRoles(['ADMIN']), async (req: AuthenticatedRequest, res) => {
  try {
    const updated = await updateStudentIdConfig(req.body);
    await createAuditLog({
      actorId: req.authProfile!.id,
      actorName: req.authProfile!.fullName,
      actorRole: req.authProfile!.role,
      action: 'UPDATE_STUDENT_ID_CONFIG',
      target: 'Student ID Generator Prefixes',
      details: `Prefixes: JEE=${updated.jeeMainPrefix}, ADV=${updated.jeeAdvancedPrefix}, NEET=${updated.neetPrefix}`,
    });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update Student ID configuration.' });
  }
});

// ----------------- COURSES, ENROLLMENTS & STUDY MATERIALS ENDPOINTS -----------------

app.get('/api/courses', requireSessionAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const all = await getAllCourses();
    const actor = req.authProfile!;
    if (actor.role === 'ADMIN') {
      return res.json(all);
    }
    const allowedIds = new Set(getAuthorizedCourseIds(actor));
    return res.json(all.filter((c) => allowedIds.has(c.id)));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load courses.' });
  }
});

app.get('/api/enrollments', requireSessionAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const all = await getAllEnrollments();
    const actor = req.authProfile!;
    if (actor.role === 'ADMIN' || actor.role === 'TEACHER') {
      return res.json(all);
    }
    return res.json(all.filter((e) => e.studentId === actor.id));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load enrollments.' });
  }
});

app.post(
  '/api/enrollments',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { studentId, courseType, enrollmentStatus, includeJeeAdvanced } = req.body;
      if (!studentId || !courseType) {
        return res.status(400).json({ error: 'studentId and courseType are required.' });
      }
      const result = await updateStudentCourseEnrollment({
        studentId,
        courseType,
        enrollmentStatus: enrollmentStatus || 'ACTIVE',
        includeJeeAdvanced: Boolean(includeJeeAdvanced),
        actor: req.authProfile!,
      });
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update course enrollment.' });
    }
  }
);

app.get('/api/study-materials', requireSessionAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const requestedCourse = req.query.courseType as string | undefined;
    if (
      requestedCourse &&
      !validateCourseAccessOrReject(req.authProfile, requestedCourse, res, 'study materials')
    ) {
      return;
    }
    const items = await getStudyMaterialsForUser(req.authProfile);
    return res.json(items);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load study materials.' });
  }
});

app.post(
  '/api/study-materials',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const created = await createStudyMaterialRecord({
        ...req.body,
        actor: req.authProfile!,
      });
      return res.status(201).json(created);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create study material.' });
    }
  }
);

app.delete(
  '/api/study-materials/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req, res) => {
    try {
      await deleteStudyMaterialRecord(req.params.id);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete study material.' });
    }
  }
);

// ----------------- EXAM & QUESTION BANK API ROUTES (STRICT COURSE ISOLATION) -----------------

const seedTestIds = new Set(SEED_TESTS.map((t) => t.id));

// Helper to map authorized courses to allowed examTypes
function getAllowedExamTypesForProfile(profile?: AuthenticatedRequest['authProfile']): string[] {
  if (!profile || profile.role === 'ADMIN') {
    return ['JEE_MAIN', 'JEE_ADVANCED', 'NEET', 'CUSTOM'];
  }
  const courses = getAuthorizedCourseTypes(profile);
  const exams: string[] = [];
  if (courses.includes('JEE')) exams.push('JEE_MAIN');
  if (courses.includes('JEE_ADVANCED')) {
    if (!exams.includes('JEE_MAIN')) exams.push('JEE_MAIN');
    exams.push('JEE_ADVANCED');
  }
  if (courses.includes('NEET')) exams.push('NEET');
  return exams;
}

// GET /api/tests - list published tests (strictly filtered by student's enrolled course)
app.get('/api/tests', attachOptionalSessionAuth, (req: AuthenticatedRequest, res) => {
  const { examType, testType, customOnly } = req.query;
  const profile = req.authProfile;

  // If authenticated student/teacher explicitly requests an unauthorized examType/course, reject with 403!
  if (
    profile &&
    examType &&
    typeof examType === 'string' &&
    examType !== 'ALL' &&
    !validateCourseAccessOrReject(profile, examType, res, 'mock tests')
  ) {
    return;
  }

  let results = testsDB;
  if (customOnly === 'true') {
    results = results.filter((t) => !seedTestIds.has(t.id));
  }

  // Enforce strict course filtering for non-Admin users
  if (profile && profile.role !== 'ADMIN') {
    const allowedExams = new Set(getAllowedExamTypesForProfile(profile));
    results = results.filter((t) => allowedExams.has(t.examType));
  }

  if (examType && typeof examType === 'string' && examType !== 'ALL') {
    results = results.filter((t) => t.examType === examType);
  }
  if (testType && typeof testType === 'string' && testType !== 'ALL') {
    results = results.filter((t) => t.testType === testType);
  }
  res.json(results);
});

// GET /api/tests/:id - get single test (enforces course authorization!)
app.get('/api/tests/:id', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const test = testsDB.find((t) => t.id === req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Test not found' });
  }

  if (
    req.authProfile &&
    !validateCourseAccessOrReject(
      req.authProfile,
      test.courseType || test.examType,
      res,
      `test (${test.id})`
    )
  ) {
    await createAuditLog({
      actorId: req.authProfile.id,
      actorName: req.authProfile.fullName,
      actorRole: req.authProfile.role,
      action: 'COURSE_ACCESS_VIOLATION_BLOCKED',
      target: `GET /api/tests/${test.id} (${test.examType})`,
      details: `Blocked ${req.authProfile.courseType} user from accessing ${test.examType} test.`,
    });
    return;
  }

  res.json(test);
});

// GET /api/tests/:id/questions - Load saved test_questions snapshot without regenerating (Requirement 10)
app.get('/api/tests/:id/questions', attachOptionalSessionAuth, (req: AuthenticatedRequest, res) => {
  const test = testsDB.find((t) => t.id === req.params.id || t.testId === req.params.id);
  if (!test) {
    return res.status(404).json({ error: 'Test snapshot not found' });
  }
  const canonicalTestId = test.testId || test.id;
  const mappings =
    test.testQuestions && test.testQuestions.length > 0
      ? test.testQuestions
      : buildTestQuestionMappings(canonicalTestId, test.questions, 1, test.activeAttemptSet || 'Set A');

  res.json({
    testId: canonicalTestId,
    activeAttemptSet: test.activeAttemptSet || 'Set A',
    testQuestions: mappings,
    questions: test.questions,
  });
});

// POST /api/tests/:id/attempt-set - Generate or resolve multi-attempt set (Attempt 1 -> Set A, Attempt 2 -> Set B) (Requirement 12)
app.post('/api/tests/:id/attempt-set', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const idx = testsDB.findIndex((t) => t.id === req.params.id || t.testId === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Test not found' });
  }
  const test = testsDB[idx];
  const attemptNumber = Math.max(1, Number(req.body.attemptNumber) || 1);
  const forceSavedSnapshot = Boolean(req.body.forceSavedSnapshot);
  const bank = getCentralizedQuestionBank();

  const resolved = createOrResolveAttemptSnapshot(
    test,
    bank,
    attemptNumber,
    undefined,
    forceSavedSnapshot
  );

  testsDB[idx] = {
    ...test,
    questions: resolved.questions,
    snapshotQuestionIds: resolved.snapshotQuestionIds,
    testQuestions: resolved.testQuestions,
    attemptSnapshots: resolved.updatedSnapshots,
    activeAttemptSet: resolved.setLabel,
  };

  const canonicalTestId = test.testId || test.id;
  await saveTestSnapshotMappingsToDb(canonicalTestId, resolved.testQuestions);
  await persistQuestionUsageToDb(resolved.snapshotQuestionIds, `${canonicalTestId}_att${attemptNumber}`);

  res.json({
    testId: canonicalTestId,
    attemptNumber,
    setLabel: resolved.setLabel,
    snapshotQuestionIds: resolved.snapshotQuestionIds,
    testQuestions: resolved.testQuestions,
    questions: resolved.questions,
  });
});

// GET /api/questions/audit - Audit question bank and existing tests for duplicates (Requirements 13 & 14)
app.get('/api/questions/audit', attachOptionalSessionAuth, (_req, res) => {
  const bank = getCentralizedQuestionBank();
  const audit = auditQuestionBankAndTests(bank, testsDB);
  res.json(audit);
});

// POST /api/tests/generate - Authoritative Server-Side Course-Aware Test Generator (Requirements 1-18)
app.post(
  '/api/tests/generate',
  attachOptionalSessionAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const actor = req.authProfile;
      const {
        courseId,
        examType,
        testType,
        blueprintId,
        subjects,
        chapters,
        topics,
        questionType,
        questionCount,
        difficulty,
        difficultyDistribution,
        durationMinutes,
        positiveMarks,
        negativeMarks,
        title,
      } = req.body;

      const requestedCourseOrExam =
        courseId || examType || actor?.courseType || actor?.examCategory || 'JEE_MAIN';

      if (
        actor &&
        !validateCourseAccessOrReject(
          actor,
          requestedCourseOrExam,
          res,
          'test generation'
        )
      ) {
        await createAuditLog({
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.role,
          action: 'COURSE_TEST_GENERATION_REJECTED',
          target: `Requested: ${requestedCourseOrExam}`,
          details: `Student enrolled in [${getAuthorizedCourseTypes(actor).join(', ')}] attempted to generate ${requestedCourseOrExam} test.`,
        });
        return;
      }

      const resolved = resolveCourseFromExam(requestedCourseOrExam);
      const targetExam: ExamType =
        requestedCourseOrExam === 'NEET' || resolved.courseType === 'NEET'
          ? 'NEET'
          : requestedCourseOrExam === 'JEE_ADVANCED' || resolved.courseType === 'JEE_ADVANCED'
          ? 'JEE_ADVANCED'
          : 'JEE_MAIN';

      const requestedSubjects: SubjectName[] =
        Array.isArray(subjects) && subjects.length > 0
          ? subjects
          : resolved.defaultSubjects;

      if (actor && actor.role !== 'ADMIN') {
        const authorizedSubjects = getAuthorizedSubjectsForUser(actor);
        const invalidSubj = requestedSubjects.find((s) => !authorizedSubjects.includes(s));
        if (invalidSubj) {
          return res.status(403).json({
            error: `Course Access Denied — Subject "${invalidSubj}" is not part of your enrolled ${actor.courseType} curriculum.`,
            code: 'COURSE_SUBJECT_DENIED',
          });
        }
      }

      const bank = getCentralizedQuestionBank();
      const newTestId = generateUniqueTestId(`test_${targetExam.toLowerCase()}`);
      const distributionNotices: string[] = [];
      let selectedQuestions: Question[] = [];

      // Check if full blueprint generation was requested
      const matchedBlueprint =
        blueprintId && OFFICIAL_EXAM_BLUEPRINTS[blueprintId]
          ? OFFICIAL_EXAM_BLUEPRINTS[blueprintId]
          : testType === 'FULL_MOCK' && targetExam === 'JEE_MAIN'
          ? OFFICIAL_EXAM_BLUEPRINTS.JEE_MAIN_2026
          : testType === 'FULL_MOCK' && targetExam === 'NEET'
          ? OFFICIAL_EXAM_BLUEPRINTS.NEET_UG_2026
          : testType === 'JEE_ADVANCED_PAPER1'
          ? OFFICIAL_EXAM_BLUEPRINTS.JEE_ADVANCED_2026_PAPER1
          : testType === 'JEE_ADVANCED_PAPER2'
          ? OFFICIAL_EXAM_BLUEPRINTS.JEE_ADVANCED_2026_PAPER2
          : undefined;

      if (matchedBlueprint) {
        selectedQuestions = selectQuestionsForBlueprint(bank, matchedBlueprint, newTestId, {
          strictCount: true,
          onDistributionAdjusted: (msg) => distributionNotices.push(msg),
        });
      } else {
        const totalCount = Math.max(1, Number(questionCount) || 25);
        const perSubject = Math.floor(totalCount / requestedSubjects.length);
        const remainder = totalCount % requestedSubjects.length;

        const usedIds = new Set<string>();
        const usedFps = new Set<string>();
        const usedNorms = new Set<string>();
        const usedConcepts = new Set<string>();

        const parsedChapters: string[] | undefined = Array.isArray(chapters)
          ? chapters.filter(Boolean)
          : typeof chapters === 'string' && chapters.trim() && chapters !== 'ALL'
          ? [chapters.trim()]
          : undefined;

        const parsedTopics: string[] | undefined = Array.isArray(topics)
          ? topics.filter(Boolean)
          : typeof topics === 'string' && topics.trim() && topics !== 'ALL'
          ? [topics.trim()]
          : undefined;

        const parsedQType: QuestionType | undefined =
          questionType && questionType !== 'ALL' ? (questionType as QuestionType) : undefined;

        const parsedDiff: Difficulty | undefined =
          difficulty && difficulty !== 'ALL' && difficulty !== 'MIXED'
            ? (difficulty as Difficulty)
            : undefined;

        for (let idx = 0; idx < requestedSubjects.length; idx++) {
          const subj = requestedSubjects[idx];
          const countForSubj = perSubject + (idx < remainder ? 1 : 0);
          if (countForSubj <= 0) continue;

          const picked = selectQuestionsIntelligent(bank, {
            courseId: resolved.courseId,
            courseType: resolved.courseType,
            exam: targetExam,
            subject: subj,
            questionType: parsedQType,
            count: countForSubj,
            chapters: parsedChapters,
            topics: parsedTopics,
            difficulty: parsedDiff,
            difficultyDistribution:
              !parsedDiff && difficultyDistribution
                ? difficultyDistribution
                : !parsedDiff
                ? { easyPercent: 30, mediumPercent: 50, hardPercent: 20 }
                : undefined,
            excludeQuestionIds: usedIds,
            excludeFingerprints: usedFps,
            excludeNormalizedTexts: usedNorms,
            excludeConceptKeys: usedConcepts,
            testIdForTracking: newTestId,
            strictCount: true,
            onDistributionAdjusted: (msg) => distributionNotices.push(msg),
          });

          picked.forEach((q) => {
            const qId = q.questionId || q.id;
            usedIds.add(qId);
            if (q.fingerprint) usedFps.add(q.fingerprint);
            usedNorms.add(q.normalizedText || normalizeQuestion(q.questionText));
            if (q.conceptKey) usedConcepts.add(q.conceptKey);
            selectedQuestions.push({
              ...q,
              positiveMarks: Number(positiveMarks) || q.positiveMarks || 4,
              marks: Number(positiveMarks) || q.positiveMarks || 4,
              negativeMarks: negativeMarks !== undefined ? Number(negativeMarks) : q.negativeMarks ?? 1,
            });
          });
        }
      }

      // Requirement 2: Final hard validation for zero duplicates
      validateGeneratedTestQuestions(selectedQuestions);

      const snapshotIds = selectedQuestions.map((q) => q.questionId || q.id);
      const testQuestions = buildTestQuestionMappings(newTestId, selectedQuestions, 1, 'Set A');
      const posMarks = Number(positiveMarks) || matchedBlueprint?.markingScheme.mcq.positive || 4;
      const negMarks =
        negativeMarks !== undefined
          ? Number(negativeMarks)
          : matchedBlueprint?.markingScheme.mcq.negative ?? 1;

      const generatedTest: TestDefinition = {
        id: newTestId,
        testId: newTestId,
        title:
          title ||
          `${resolved.courseType} Custom Assessment (${requestedSubjects.join(', ')})`,
        subtitle: `Course-Verified ${resolved.courseType} Paper • ${selectedQuestions.length} Unique Questions`,
        courseId: resolved.courseId,
        courseType: resolved.courseType,
        examType: targetExam,
        testType: testType || (matchedBlueprint ? 'FULL_MOCK' : 'CUSTOM'),
        patternYear: 2026,
        blueprintId: matchedBlueprint?.id,
        patternSource: `Server-Side Uniqueness Engine (${newTestId})`,
        durationMinutes:
          Number(durationMinutes) ||
          matchedBlueprint?.durationMinutes ||
          Math.max(20, selectedQuestions.length * 2),
        totalMarks:
          matchedBlueprint?.totalMarks ||
          selectedQuestions.reduce((acc, q) => acc + (q.positiveMarks || posMarks), 0),
        positiveMarks: posMarks,
        negativeMarks: negMarks,
        subjects: requestedSubjects,
        questionsCount: selectedQuestions.length,
        difficulty: difficulty && difficulty !== 'ALL' && difficulty !== 'MIXED' ? difficulty : 'MEDIUM',
        difficultyDistributionNotice:
          distributionNotices.length > 0 ? distributionNotices.join(' ') : undefined,
        syllabus: requestedSubjects.map((s) => `${s} (${resolved.courseType} Complete Syllabus)`),
        description: `Server-generated ${resolved.courseType} test with permanent snapshot (${newTestId}) and zero duplicate questions.`,
        published: true,
        sections: matchedBlueprint?.sections,
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
        createdAt: new Date().toISOString(),
        attemptsCount: 0,
        avgScore: 0,
      };

      testsDB.unshift(generatedTest);
      await saveTestToDb(generatedTest);
      return res.status(201).json(generatedTest);
    } catch (err: any) {
      const msg =
        err?.message ||
        'Not enough unique questions are available for this test. Please add more questions or reduce the number of questions.';
      return res.status(400).json({ error: msg });
    }
  }
);

// POST /api/tests - create / publish a new test (Admin / Authorized Teacher only)
app.post(
  '/api/tests',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const actor = req.authProfile!;
      if (actor.role === 'TEACHER' && !actor.teacherPermissions.canCreateTests) {
        return res.status(403).json({
          error: 'Permission Denied — Your teacher profile does not have test creation permission.',
        });
      }

      const examType: ExamType = req.body.examType || 'JEE_MAIN';
      if (!validateCourseAccessOrReject(actor, examType, res, 'test creation')) {
        return;
      }

      const resolved = resolveCourseFromExam(examType);
      const uniqueTestId =
        req.body.testId ||
        (req.body.id && req.body.id !== 'mock-test' ? req.body.id : generateUniqueTestId('test'));

      let testQuestionsList: Question[] = Array.isArray(req.body.questions) ? req.body.questions : [];
      const bank = getCentralizedQuestionBank();

      // If no questions were supplied or duplicates exist, dynamically select unique questions from the bank
      if (testQuestionsList.length === 0) {
        const requestedSubjects: SubjectName[] = req.body.subjects || resolved.defaultSubjects;
        const reqCount = Math.max(1, Number(req.body.questionsCount) || 25);
        const perSubj = Math.floor(reqCount / requestedSubjects.length);
        const rem = reqCount % requestedSubjects.length;
        const usedIds = new Set<string>();
        const usedFps = new Set<string>();
        const usedNorms = new Set<string>();

        requestedSubjects.forEach((subj, idx) => {
          const picked = selectQuestionsIntelligent(bank, {
            courseId: resolved.courseId,
            courseType: resolved.courseType,
            exam: examType,
            subject: subj,
            count: perSubj + (idx < rem ? 1 : 0),
            excludeQuestionIds: usedIds,
            excludeFingerprints: usedFps,
            excludeNormalizedTexts: usedNorms,
            testIdForTracking: uniqueTestId,
            strictCount: true,
          });
          picked.forEach((q) => {
            usedIds.add(q.questionId || q.id);
            if (q.fingerprint) usedFps.add(q.fingerprint);
            usedNorms.add(q.normalizedText || normalizeQuestion(q.questionText));
            testQuestionsList.push(q);
          });
        });
      }

      // Validate zero duplicates in testQuestionsList
      validateGeneratedTestQuestions(testQuestionsList);

      const snapshotIds = testQuestionsList.map((q) => q.questionId || q.id);
      const mappings = buildTestQuestionMappings(uniqueTestId, testQuestionsList, 1, 'Set A');

      const newTest: TestDefinition = {
        id: uniqueTestId,
        testId: uniqueTestId,
        title: req.body.title || 'Course Examination Paper',
        subtitle: req.body.subtitle || 'Controlled Question Bank Paper',
        courseId: req.body.courseId || resolved.courseId,
        courseType: req.body.courseType || resolved.courseType,
        examType,
        testType: req.body.testType || 'CUSTOM',
        patternYear: Number(req.body.patternYear) || 2026,
        patternSource: req.body.patternSource || `NTA/JAB Official Information Bulletin 2026 • ${uniqueTestId}`,
        durationMinutes: Number(req.body.durationMinutes) || 60,
        totalMarks: Number(req.body.totalMarks) || testQuestionsList.length * 4,
        positiveMarks: Number(req.body.positiveMarks) || 4,
        negativeMarks: Number(req.body.negativeMarks) ?? 1,
        subjects: req.body.subjects || resolved.defaultSubjects,
        questionsCount: testQuestionsList.length,
        difficulty: req.body.difficulty || 'MEDIUM',
        syllabus: req.body.syllabus || [],
        description: req.body.description || 'Assessment created from controlled question bank',
        published: req.body.published !== undefined ? req.body.published : true,
        questions: testQuestionsList,
        snapshotQuestionIds: snapshotIds,
        testQuestions: mappings,
        attemptSnapshots: [
          {
            attemptNumber: 1,
            setLabel: 'Set A',
            questionIds: snapshotIds,
            testQuestions: mappings,
            createdAt: new Date().toISOString(),
          },
        ],
        activeAttemptSet: 'Set A',
        createdAt: new Date().toISOString(),
        attemptsCount: 0,
        avgScore: 0,
      };

      testsDB.unshift(newTest);
      await saveTestToDb(newTest);
      res.status(201).json(newTest);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to create test due to duplicate question validation.' });
    }
  }
);

// PATCH /api/tests/:id - update test (Admin / Authorized Teacher only)
app.patch(
  '/api/tests/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    const idx = testsDB.findIndex((t) => t.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const existing = testsDB[idx];
    if (
      !validateCourseAccessOrReject(
        req.authProfile,
        existing.courseType || existing.examType,
        res,
        'test modification'
      )
    ) {
      return;
    }
    testsDB[idx] = { ...existing, ...req.body };
    await saveTestToDb(testsDB[idx]);
    res.json(testsDB[idx]);
  }
);

// DELETE /api/tests/:id - delete test (Admin / Authorized Teacher only)
app.delete(
  '/api/tests/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    const existing = testsDB.find((t) => t.id === req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Test not found' });
    }
    if (
      !validateCourseAccessOrReject(
        req.authProfile,
        existing.courseType || existing.examType,
        res,
        'test deletion'
      )
    ) {
      return;
    }
    testsDB = testsDB.filter((t) => t.id !== req.params.id);
    await deleteTestFromDb(req.params.id);
    res.json({ success: true });
  }
);

// GET /api/questions - paginated query with strict course isolation
app.get('/api/questions', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const examType = req.query.examType as string;
    const subject = req.query.subject as string;
    const chapter = req.query.chapter as string;
    const difficulty = req.query.difficulty as string;
    const status = req.query.status as string;
    const search = req.query.search as string;

    const profile = req.authProfile;

    // Enforce course separation on question bank queries
    if (profile && profile.role !== 'ADMIN') {
      if (
        examType &&
        examType !== 'ALL' &&
        !validateCourseAccessOrReject(profile, examType, res, 'questions')
      ) {
        return;
      }
      const allowedSubjects = getAuthorizedSubjectsForUser(profile);
      if (subject && subject !== 'ALL' && !allowedSubjects.includes(subject as SubjectName)) {
        return res.status(403).json({
          error: `Course Access Denied — Subject "${subject}" is outside your enrolled ${profile.courseType} course.`,
          code: 'COURSE_SUBJECT_DENIED',
          items: [],
          total: 0,
        });
      }
    }

    const allowedCourseIds =
      profile && profile.role !== 'ADMIN' ? getAuthorizedCourseIds(profile) : undefined;
    const allowedExamTypes =
      profile && profile.role !== 'ADMIN' ? getAllowedExamTypesForProfile(profile) : undefined;

    const result = await getQuestionsPaginated({
      page,
      limit,
      examType,
      subject,
      chapter,
      difficulty,
      status,
      search,
      allowedCourseIds,
      allowedExamTypes,
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching paginated questions:', err);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// POST /api/questions - Controlled Question Creation Workflow (Admin / Authorized Teacher only)
app.post(
  '/api/questions',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const actor = req.authProfile!;
      if (
        actor.role === 'TEACHER' &&
        !actor.teacherPermissions.canCreateQuestions &&
        !actor.teacherPermissions.canUploadQuestions
      ) {
        return res.status(403).json({
          error: 'Permission Denied — Your teacher account is not authorized to add questions to the bank.',
        });
      }

      const targetCourseOrExam = req.body.courseType || req.body.examType || 'JEE_MAIN';
      if (!validateCourseAccessOrReject(actor, targetCourseOrExam, res, 'question creation')) {
        return;
      }

      const resolved = resolveCourseFromExam(targetCourseOrExam);
      const { questionText, subject, chapter, topic, difficulty, correctAnswer } = req.body;
      if (!questionText || !subject || !chapter || !correctAnswer) {
        return res.status(400).json({
          error: 'Validation Failed — Question text, subject, chapter, and correct answer are required.',
        });
      }

      const fallbackExamType: ExamType =
        resolved.courseType === 'NEET'
          ? 'NEET'
          : resolved.courseType === 'JEE_ADVANCED'
          ? 'JEE_ADVANCED'
          : 'JEE_MAIN';

      const created = await createQuestionInDb({
        ...req.body,
        courseId: resolved.courseId,
        courseType: resolved.courseType,
        examType: req.body.examType || fallbackExamType,
        topic: topic || chapter,
        difficulty: difficulty || 'MEDIUM',
        source: req.body.source || 'ADMIN',
        status: req.body.status || 'APPROVED',
      });

      await createAuditLog({
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'CREATE_COURSE_QUESTION',
        target: `${created.questionId || created.id} (${resolved.courseType} - ${subject})`,
        details: `Chapter: ${chapter} • Topic: ${topic || chapter} • Difficulty: ${difficulty || 'MEDIUM'}`,
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error('Error creating question:', err);
      res.status(400).json({ error: err?.message || 'Failed to create question' });
    }
  }
);

// PATCH /api/questions/:id - Update question in PostgreSQL
app.patch(
  '/api/questions/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const updated = await updateQuestionInDb(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'Question not found' });
      }
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update question' });
    }
  }
);

// DELETE /api/questions/:id - Admin / Authorized Teacher only
app.delete(
  '/api/questions/:id',
  requireRoles(['ADMIN', 'TEACHER']),
  async (req: AuthenticatedRequest, res) => {
    try {
      await deleteQuestionFromDb(req.params.id);
      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete question' });
    }
  }
);

// ----------------- ACTIVE EXAM SESSION, BOOKMARKS & QUESTION REPORTS (POSTGRESQL) -----------------

app.get('/api/active-session', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authProfile?.id || (req.query.userId as string);
  if (!userId) return res.json(null);
  const session = await getActiveSessionFromDb(userId);
  res.json(session);
});

app.post('/api/active-session', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authProfile?.id || req.body.userId;
  const session = req.body.session;
  if (!userId || !session) {
    return res.status(400).json({ error: 'userId and session are required.' });
  }
  await saveActiveSessionToDb(userId, session);
  res.json({ saved: true });
});

app.delete('/api/active-session', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authProfile?.id || (req.query.userId as string);
  if (userId) {
    await deleteActiveSessionFromDb(userId);
  }
  res.json({ deleted: true });
});

app.get('/api/bookmarks', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authProfile?.id || (req.query.userId as string);
  if (!userId) return res.json({ bookmarkedQuestionIds: [], questionNotes: {} });
  const data = await getUserBookmarksFromDb(userId);
  res.json(data);
});

app.post('/api/bookmarks/toggle', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authProfile?.id || req.body.userId;
  const { questionId, bookmarked, notes } = req.body;
  if (!userId || !questionId) {
    return res.status(400).json({ error: 'userId and questionId are required.' });
  }
  await toggleUserBookmarkInDb({
    userId,
    questionId,
    bookmarked: Boolean(bookmarked),
    notes,
  });
  res.json({ success: true });
});

app.get('/api/question-reports', attachOptionalSessionAuth, async (_req, res) => {
  const reports = await getQuestionReportsFromDb();
  res.json(reports);
});

app.post('/api/question-reports', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const profile = req.authProfile;
  const report = await createQuestionReportInDb({
    id: req.body.id || `rep-${Date.now()}`,
    questionId: req.body.questionId,
    testId: req.body.testId || 'bank',
    userId: profile?.id || req.body.userId || 'usr-student-rahul',
    userName: profile?.fullName || req.body.userName || req.body.studentName || 'Student',
    studentName: profile?.fullName || req.body.studentName || req.body.userName || 'Student',
    reason: req.body.reason || 'OTHER',
    description: req.body.description || req.body.comment || '',
    comment: req.body.comment || req.body.description || '',
    status: 'OPEN',
    createdAt: new Date().toISOString(),
  });
  res.status(201).json(report);
});

app.patch('/api/question-reports/:id/resolve', requireRoles(['ADMIN', 'TEACHER']), async (req, res) => {
  await resolveQuestionReportInDb(req.params.id);
  res.json({ resolved: true, id: req.params.id });
});

// POST /api/evaluate - Server-side authoritative test evaluation with course verification
app.post('/api/evaluate', attachOptionalSessionAuth, async (req: AuthenticatedRequest, res) => {
  const { testId, responses, timeTakenSeconds, userId, userName } = req.body;
  const targetTest = testsDB.find((t) => t.id === testId) || req.body.testDefinition;

  if (!targetTest) {
    return res.status(404).json({ error: 'Test definition not found for evaluation' });
  }

  const profile = req.authProfile;
  if (
    profile &&
    !validateCourseAccessOrReject(
      profile,
      targetTest.courseType || targetTest.examType,
      res,
      'test evaluation'
    )
  ) {
    return;
  }

  const resolvedCourse = resolveCourseFromExam(targetTest.courseType || targetTest.examType);
  const effectiveUserId = profile?.id || userId || 'usr-student-rahul';
  const rawResult = evaluateTestAttempt(
    targetTest,
    responses || {},
    (targetTest.durationMinutes || 180) * 60,
    Number(timeTakenSeconds) || 0,
    effectiveUserId,
    profile?.fullName || userName || 'Rahul Verma'
  );

  const result: TestAttemptResult = {
    ...rawResult,
    courseId: resolvedCourse.courseId,
    courseType: resolvedCourse.courseType,
  };

  attemptsDB.unshift(result);
  await saveAttemptToDb(result);
  await deleteActiveSessionFromDb(effectiveUserId);
  res.json(result);
});

// GET /api/attempts - list attempts (strictly isolated by student ownership & enrolled course)
app.get('/api/attempts', attachOptionalSessionAuth, (req: AuthenticatedRequest, res) => {
  const { userId } = req.query;
  const profile = req.authProfile;

  if (profile && profile.role === 'STUDENT') {
    // A student can NEVER read another student's attempts or another course's attempts
    if (userId && typeof userId === 'string' && userId !== profile.id) {
      return res.status(403).json({
        error: 'Access Denied — Students can only view their own attempt results.',
        code: 'FORBIDDEN_ATTEMPT_ACCESS',
      });
    }
    const allowedExams = new Set(getAllowedExamTypesForProfile(profile));
    const myCourseAttempts = attemptsDB.filter(
      (a) => a.userId === profile.id && allowedExams.has(a.examType)
    );
    return res.json(myCourseAttempts);
  }

  if (profile && profile.role === 'TEACHER') {
    const allowedExams = new Set(getAllowedExamTypesForProfile(profile));
    let filtered = attemptsDB.filter((a) => allowedExams.has(a.examType));
    if (userId && typeof userId === 'string') {
      filtered = filtered.filter((a) => a.userId === userId);
    }
    return res.json(filtered);
  }

  if (userId && typeof userId === 'string') {
    return res.json(attemptsDB.filter((a) => a.userId === userId));
  }
  res.json(attemptsDB);
});

// GET /api/security/rls-audit - Live Server-Side Course Separation & RLS Verification Audit
app.get('/api/security/rls-audit', requireSessionAuth, async (_req, res) => {
  try {
    let rlsSql = '';
    try {
      rlsSql = fs.readFileSync(path.resolve('src/db/rls_policies.sql'), 'utf-8');
    } catch {
      rlsSql = '-- RLS policies active';
    }

    const rahulJee = await getProfileById('usr-student-rahul');
    const aaravAdv = await getProfileById('usr-student-aarav');
    const ananyaNeet = await getProfileById('usr-student-ananya');
    const vikramSuspended = await getProfileById('usr-student-vikram');

    const matrix = [
      {
        student: 'Rahul Verma (JEE26-10001)',
        enrolledCourse: rahulJee?.assignedCourses.join(', ') || 'JEE',
        enrollmentStatus: rahulJee?.enrollmentStatus || 'ACTIVE',
        canAccessJeeMain: isCourseAuthorizedForUser(rahulJee, 'JEE_MAIN'),
        canAccessJeeAdvanced: isCourseAuthorizedForUser(rahulJee, 'JEE_ADVANCED'),
        canAccessNeet: isCourseAuthorizedForUser(rahulJee, 'NEET'),
      },
      {
        student: 'Aarav Mehta (JEE26-7F42K)',
        enrolledCourse: aaravAdv?.assignedCourses.join(', ') || 'JEE, JEE_ADVANCED',
        enrollmentStatus: aaravAdv?.enrollmentStatus || 'ACTIVE',
        canAccessJeeMain: isCourseAuthorizedForUser(aaravAdv, 'JEE_MAIN'),
        canAccessJeeAdvanced: isCourseAuthorizedForUser(aaravAdv, 'JEE_ADVANCED'),
        canAccessNeet: isCourseAuthorizedForUser(aaravAdv, 'NEET'),
      },
      {
        student: 'Ananya Krishnan (NEET26-10001)',
        enrolledCourse: ananyaNeet?.assignedCourses.join(', ') || 'NEET',
        enrollmentStatus: ananyaNeet?.enrollmentStatus || 'ACTIVE',
        canAccessJeeMain: isCourseAuthorizedForUser(ananyaNeet, 'JEE_MAIN'),
        canAccessJeeAdvanced: isCourseAuthorizedForUser(ananyaNeet, 'JEE_ADVANCED'),
        canAccessNeet: isCourseAuthorizedForUser(ananyaNeet, 'NEET'),
      },
      {
        student: 'Vikramaditya Singh (JEE26-10003)',
        enrolledCourse: vikramSuspended?.assignedCourses.join(', ') || 'JEE',
        enrollmentStatus: vikramSuspended?.enrollmentStatus || 'SUSPENDED',
        canAccessJeeMain: isCourseAuthorizedForUser(vikramSuspended, 'JEE_MAIN'),
        canAccessJeeAdvanced: isCourseAuthorizedForUser(vikramSuspended, 'JEE_ADVANCED'),
        canAccessNeet: isCourseAuthorizedForUser(vikramSuspended, 'NEET'),
      },
    ];

    res.json({
      rlsEnabledTables: [
        'courses',
        'profiles',
        'enrollments',
        'questions',
        'tests',
        'test_assignments',
        'study_materials',
        'announcements',
        'test_attempts',
        'batches',
      ],
      accessMatrix: matrix,
      rlsPoliciesSql: rlsSql,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to run RLS security audit.' });
  }
});

// Setup Vite or Static Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;

