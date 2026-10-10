import crypto from 'node:crypto';
import { eq, desc, or, and, sql } from 'drizzle-orm';
import { db, isPostgresConfigured } from './index.ts';
import {
  courses,
  enrollments,
  studyMaterials,
  profiles,
  authSessions,
  batches,
  testAssignments,
  announcements,
  auditLogs,
  passwordRecoveryRequests,
  platformSettings,
} from './schema.ts';
import {
  AuthProfile,
  UserRole,
  AccountStatus,
  CourseType,
  EnrollmentStatus,
  CourseRecord,
  EnrollmentRecord,
  StudyMaterialRecord,
  BatchRecord,
  TestAssignmentRecord,
  AnnouncementRecord,
  AuditLogRecord,
  PasswordRecoveryRecord,
  StudentIdConfig,
  TeacherPermissions,
} from '../types/auth.ts';
import { ExamType, SubjectName } from '../types/exam.ts';

// ----------------- COURSE & ENROLLMENT AUTHORIZATION HELPERS -----------------

export function resolveCourseFromExam(
  examOrCourse?: string | null
): {
  courseId: string;
  courseType: CourseType;
  assignedCourses: CourseType[];
  defaultSubjects: SubjectName[];
} {
  const val = (examOrCourse || 'JEE_MAIN').toUpperCase();
  if (val === 'NEET' || val === 'COURSE_NEET') {
    return {
      courseId: 'course_neet',
      courseType: 'NEET',
      assignedCourses: ['NEET'],
      defaultSubjects: ['Physics', 'Chemistry', 'Botany', 'Zoology'],
    };
  }
  if (val === 'JEE_ADVANCED' || val === 'COURSE_JEE_ADV') {
    return {
      courseId: 'course_jee_adv',
      courseType: 'JEE_ADVANCED',
      assignedCourses: ['JEE', 'JEE_ADVANCED'],
      defaultSubjects: ['Physics', 'Chemistry', 'Mathematics'],
    };
  }
  return {
    courseId: 'course_jee',
    courseType: 'JEE',
    assignedCourses: ['JEE'],
    defaultSubjects: ['Physics', 'Chemistry', 'Mathematics'],
  };
}

export function normalizeTargetToCourseType(target?: string | null): CourseType {
  const val = (target || 'JEE').toUpperCase();
  if (val === 'NEET' || val === 'COURSE_NEET') return 'NEET';
  if (val === 'JEE_ADVANCED' || val === 'COURSE_JEE_ADV') return 'JEE_ADVANCED';
  return 'JEE';
}

export function getAuthorizedCourseTypes(profile?: AuthProfile | null): CourseType[] {
  if (!profile) return [];
  if (profile.role === 'ADMIN') {
    return ['JEE', 'JEE_ADVANCED', 'NEET'];
  }
  if (profile.role === 'STUDENT' && profile.enrollmentStatus && profile.enrollmentStatus !== 'ACTIVE') {
    return [];
  }
  if (profile.assignedCourses && profile.assignedCourses.length > 0) {
    return profile.assignedCourses;
  }
  const resolved = resolveCourseFromExam(profile.courseType || profile.examCategory);
  return resolved.assignedCourses;
}

export function getAuthorizedCourseIds(profile?: AuthProfile | null): string[] {
  const types = getAuthorizedCourseTypes(profile);
  const ids: string[] = [];
  if (types.includes('JEE')) ids.push('course_jee');
  if (types.includes('JEE_ADVANCED')) ids.push('course_jee_adv');
  if (types.includes('NEET')) ids.push('course_neet');
  return ids;
}

export function isCourseAuthorizedForUser(
  profile: AuthProfile | null | undefined,
  targetCourseOrExam: string | null | undefined
): boolean {
  if (!profile) return false;
  if (profile.role === 'ADMIN') return true;
  if (profile.status !== 'ACTIVE') return false;
  if (profile.role === 'STUDENT' && profile.enrollmentStatus && profile.enrollmentStatus !== 'ACTIVE') {
    return false;
  }
  if (!targetCourseOrExam || targetCourseOrExam === 'ALL') return true;
  const targetCourseType = normalizeTargetToCourseType(targetCourseOrExam);
  const allowed = getAuthorizedCourseTypes(profile);
  return allowed.includes(targetCourseType);
}

export function getAuthorizedSubjectsForUser(profile?: AuthProfile | null): SubjectName[] {
  if (!profile) return ['Physics', 'Chemistry', 'Mathematics'];
  if (profile.role === 'ADMIN') {
    return ['Physics', 'Chemistry', 'Mathematics', 'Botany', 'Zoology'];
  }
  const allowedCourses = getAuthorizedCourseTypes(profile);
  if (allowedCourses.includes('NEET') && !allowedCourses.includes('JEE')) {
    return ['Physics', 'Chemistry', 'Botany', 'Zoology'];
  }
  if (allowedCourses.includes('JEE') && !allowedCourses.includes('NEET')) {
    return ['Physics', 'Chemistry', 'Mathematics'];
  }
  return profile.subjectAccess && profile.subjectAccess.length > 0
    ? profile.subjectAccess
    : ['Physics', 'Chemistry', 'Mathematics'];
}

// ----------------- CRYPTOGRAPHIC PASSWORD & TOKEN HELPERS -----------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    if (!storedHash || !storedHash.startsWith('scrypt$')) return false;
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, keyHex] = parts;
    const keyBuffer = Buffer.from(keyHex, 'hex');
    const derivedBuffer = crypto.scryptSync(password, salt, 64);
    if (keyBuffer.length !== derivedBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, derivedBuffer);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function validatePasswordComplexity(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number (0-9).' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character (e.g., @, #, $, !, %).' };
  }
  return { valid: true };
}

// ----------------- MAPPER HELPERS -----------------

const DEFAULT_TEACHER_PERMS: TeacherPermissions = {
  canCreateTests: true,
  canCreateQuestions: true,
  canManageBatches: true,
  canResetStudentPasswords: true,
  canViewAllStudents: false,
};

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapRowToProfile(
  row: typeof profiles.$inferSelect,
  teacherMap?: Map<string, string>,
  batchMap?: Map<string, string>,
  sessionCounts?: Map<string, number>,
  enrollmentMap?: Map<string, EnrollmentRecord[]>
): AuthProfile {
  const resolved = resolveCourseFromExam(row.courseType || row.examCategory);
  const courseId = row.courseId || resolved.courseId;
  const courseType = (row.courseType as CourseType) || resolved.courseType;
  const enrollmentStatus = (row.enrollmentStatus as EnrollmentStatus) || 'ACTIVE';
  const assignedCourses = parseJsonSafe<CourseType[]>(
    row.assignedCoursesJson,
    row.role === 'ADMIN'
      ? ['JEE', 'JEE_ADVANCED', 'NEET']
      : resolved.assignedCourses
  );

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    role: (row.role as UserRole) || 'STUDENT',
    studentId: row.studentId,
    teacherId: row.teacherId,
    teacherName: row.teacherId && teacherMap ? teacherMap.get(row.teacherId) || null : null,
    batchId: row.batchId,
    batchName: row.batchId && batchMap ? batchMap.get(row.batchId) || null : null,
    className: row.className,
    examCategory: (row.examCategory as ExamType) || 'JEE_MAIN',
    courseId,
    courseType,
    enrollmentStatus,
    assignedCourses,
    enrollments: enrollmentMap ? enrollmentMap.get(row.id) || [] : [],
    targetYear: row.targetYear || 2026,
    subjectAccess: parseJsonSafe<SubjectName[]>(row.subjectAccessJson, resolved.defaultSubjects),
    testAccess: parseJsonSafe<string[]>(row.testAccessJson, []),
    teacherPermissions: parseJsonSafe<TeacherPermissions>(row.teacherPermissionsJson, DEFAULT_TEACHER_PERMS),
    status: (row.status as AccountStatus) || 'ACTIVE',
    mustChangePassword: Boolean(row.mustChangePassword),
    tempPasswordHint: row.tempPasswordHint,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastLogin: row.lastLogin ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : new Date().toISOString(),
    activeSessionsCount: sessionCounts ? sessionCounts.get(row.id) || 0 : 0,
  };
}

export function mapRowToBatch(row: typeof batches.$inferSelect): BatchRecord {
  const resolved = resolveCourseFromExam(row.courseType || row.examCategory);
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    examCategory: (row.examCategory as ExamType) || 'JEE_MAIN',
    courseId: row.courseId || resolved.courseId,
    courseType: (row.courseType as CourseType) || resolved.courseType,
    className: row.className || 'Class 12',
    teacherId: row.teacherId,
    teacherName: row.teacherName,
    status: (row.status as 'ACTIVE' | 'ARCHIVED') || 'ACTIVE',
    assignedTestIds: parseJsonSafe<string[]>(row.assignedTestIdsJson, []),
    studentIds: parseJsonSafe<string[]>(row.studentIdsJson, []),
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  };
}

// ----------------- RESILIENT IN-MEMORY RBAC STORAGE -----------------

export const memProfiles = new Map<string, typeof profiles.$inferSelect>();
export const memCourses = new Map<string, typeof courses.$inferSelect>();
export const memEnrollments = new Map<string, typeof enrollments.$inferSelect>();
export const memStudyMaterials = new Map<string, typeof studyMaterials.$inferSelect>();
export const memBatches = new Map<string, typeof batches.$inferSelect>();
export const memTestAssignments = new Map<string, typeof testAssignments.$inferSelect>();
export const memAnnouncements = new Map<string, typeof announcements.$inferSelect>();
export const memAuditLogs: (typeof auditLogs.$inferSelect)[] = [];
export const memPasswordRecovery = new Map<string, typeof passwordRecoveryRequests.$inferSelect>();
export const memAuthSessions = new Map<string, typeof authSessions.$inferSelect>();

const DEFAULT_STUDENT_ID_CONFIG: StudentIdConfig = {
  jeeMainPrefix: 'JEE26',
  jeeAdvancedPrefix: 'JADV26',
  neetPrefix: 'NEET26',
  nextJeeMainSeq: 10004,
  nextJeeAdvancedSeq: 10002,
  nextNeetSeq: 10003,
  mode: 'SEQUENTIAL',
};

let memStudentIdConfig: StudentIdConfig = { ...DEFAULT_STUDENT_ID_CONFIG };

export async function getStudentIdConfig(): Promise<StudentIdConfig> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, 'student_id_config'));
      if (rows.length > 0) {
        return { ...DEFAULT_STUDENT_ID_CONFIG, ...parseJsonSafe(rows[0].valueJson, DEFAULT_STUDENT_ID_CONFIG) };
      }
    } catch (err) {
      console.warn('Error reading student_id_config from PostgreSQL:', err);
    }
  }
  return { ...memStudentIdConfig };
}

export async function updateStudentIdConfig(patch: Partial<StudentIdConfig>): Promise<StudentIdConfig> {
  const current = await getStudentIdConfig();
  const updated: StudentIdConfig = { ...current, ...patch };
  memStudentIdConfig = updated;
  if (isPostgresConfigured()) {
    try {
      await db
        .insert(platformSettings)
        .values({
          key: 'student_id_config',
          valueJson: JSON.stringify(updated),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            valueJson: JSON.stringify(updated),
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      console.warn('Error saving student_id_config to PostgreSQL:', err);
    }
  }
  return updated;
}

export async function generateUniqueStudentId(
  examCategory: ExamType = 'JEE_MAIN',
  forceMode?: 'SEQUENTIAL' | 'ALPHANUMERIC'
): Promise<string> {
  const config = await getStudentIdConfig();
  const mode = forceMode || config.mode;

  let prefix = config.jeeMainPrefix || 'JEE26';
  if (examCategory === 'NEET') prefix = config.neetPrefix || 'NEET26';
  else if (examCategory === 'JEE_ADVANCED') prefix = config.jeeAdvancedPrefix || 'JADV26';

  for (let attempt = 0; attempt < 25; attempt++) {
    let candidate = '';
    if (mode === 'ALPHANUMERIC') {
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let suffix = '';
      for (let i = 0; i < 5; i++) {
        suffix += chars.charAt(crypto.randomInt(0, chars.length));
      }
      candidate = `${prefix}-${suffix}`;
    } else {
      let seq = config.nextJeeMainSeq;
      if (examCategory === 'NEET') seq = config.nextNeetSeq;
      else if (examCategory === 'JEE_ADVANCED') seq = config.nextJeeAdvancedSeq;
      candidate = `${prefix}-${seq + attempt}`;
    }

    let exists = Array.from(memProfiles.values()).some((p) => p.studentId === candidate);
    if (!exists && isPostgresConfigured()) {
      try {
        const rows = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.studentId, candidate));
        if (rows.length > 0) exists = true;
      } catch {}
    }

    if (!exists) {
      if (mode === 'SEQUENTIAL') {
        if (examCategory === 'NEET') {
          await updateStudentIdConfig({ nextNeetSeq: config.nextNeetSeq + attempt + 1 });
        } else if (examCategory === 'JEE_ADVANCED') {
          await updateStudentIdConfig({ nextJeeAdvancedSeq: config.nextJeeAdvancedSeq + attempt + 1 });
        } else {
          await updateStudentIdConfig({ nextJeeMainSeq: config.nextJeeMainSeq + attempt + 1 });
        }
      }
      return candidate;
    }
  }

  const fallbackRandom = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${fallbackRandom}`;
}

// ----------------- AUDIT LOGGING -----------------

export async function createAuditLog(params: {
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  target: string;
  details?: string;
}): Promise<void> {
  const entry: typeof auditLogs.$inferSelect = {
    id: `audit-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    action: params.action,
    target: params.target,
    details: params.details || null,
    createdAt: new Date(),
  };
  memAuditLogs.unshift(entry);
  if (isPostgresConfigured()) {
    try {
      await db.insert(auditLogs).values(entry);
    } catch (err) {
      console.warn('Failed to insert audit log to PostgreSQL:', err);
    }
  }
}


export async function getAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          actorName: r.actorName,
          actorRole: r.actorRole as UserRole,
          action: r.action,
          target: r.target,
          details: r.details,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch (err) {
      console.warn('Failed to get audit logs from PostgreSQL:', err);
    }
  }
  return memAuditLogs.slice(0, limit).map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actorName: r.actorName,
    actorRole: r.actorRole as UserRole,
    action: r.action,
    target: r.target,
    details: r.details,
    createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
  }));
}

// ----------------- DATABASE SEEDING FOR AUTH & RBAC -----------------

let isAuthSeeded = false;

export async function ensureAuthSeeded(): Promise<void> {
  if (isAuthSeeded) return;

  const adminId = 'usr-admin-01';
  const teacher1Id = 'usr-teacher-hcverma';
  const teacher2Id = 'usr-teacher-ritusharma';

  const batchJeeMainId = 'batch-jee-main-2027-m';
  const batchJeeAdvId = 'batch-jee-adv-2027-a';
  const batchNeetBioId = 'batch-neet-2027-bio';

  const student1Id = 'usr-student-rahul';
  const student2Id = 'usr-student-aarav';
  const student3Id = 'usr-student-ananya';
  const student4Id = 'usr-student-rohan';
  const student5Id = 'usr-student-vikram';

  // Seed canonical Courses
  const seedCoursesList: (typeof courses.$inferSelect)[] = [
    {
      id: 'course_jee',
      name: 'JEE (Main) Engineering Entrance Course',
      type: 'JEE',
      description: 'Physics, Chemistry & Mathematics — Official 75-Question (300 Marks) NTA CBT Curriculum.',
      active: true,
      createdAt: new Date(),
    },
    {
      id: 'course_jee_adv',
      name: 'JEE (Advanced) IIT Entrance Course',
      type: 'JEE_ADVANCED',
      description: 'High-Order Multi-Format Paper 1 & Paper 2 IIT Entrance Curriculum (Physics, Chemistry, Mathematics).',
      active: true,
      createdAt: new Date(),
    },
    {
      id: 'course_neet',
      name: 'NEET (UG) Pre-Medical Entrance Course',
      type: 'NEET',
      description: 'Physics, Chemistry, Botany & Zoology — Official 180-Question (720 Marks) Medical Entrance Curriculum.',
      active: true,
      createdAt: new Date(),
    },
  ];
  for (const c of seedCoursesList) memCourses.set(c.id, c);

  // Seed Enrollments
  const seedEnrollmentsList: (typeof enrollments.$inferSelect)[] = [
    {
      id: 'enr-rahul-jee',
      studentId: student1Id,
      courseId: 'course_jee',
      courseType: 'JEE',
      status: 'ACTIVE',
      assignedBy: teacher1Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'enr-aarav-jee',
      studentId: student2Id,
      courseId: 'course_jee',
      courseType: 'JEE',
      status: 'ACTIVE',
      assignedBy: teacher1Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'enr-aarav-jee-adv',
      studentId: student2Id,
      courseId: 'course_jee_adv',
      courseType: 'JEE_ADVANCED',
      status: 'ACTIVE',
      assignedBy: teacher1Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'enr-ananya-neet',
      studentId: student3Id,
      courseId: 'course_neet',
      courseType: 'NEET',
      status: 'ACTIVE',
      assignedBy: teacher2Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'enr-rohan-neet',
      studentId: student4Id,
      courseId: 'course_neet',
      courseType: 'NEET',
      status: 'ACTIVE',
      assignedBy: teacher2Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'enr-vikram-jee',
      studentId: student5Id,
      courseId: 'course_jee',
      courseType: 'JEE',
      status: 'SUSPENDED',
      assignedBy: teacher1Id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  for (const e of seedEnrollmentsList) memEnrollments.set(e.id, e);

  // Seed Study Materials
  const seedStudyMats: (typeof studyMaterials.$inferSelect)[] = [
    {
      id: 'mat-jee-phy-01',
      courseId: 'course_jee',
      courseType: 'JEE',
      subject: 'Physics',
      chapter: 'Rotational Mechanics & Electrostatics',
      title: 'JEE Main 2026 Physics Master Formula & Theorem Sheet',
      materialType: 'FORMULA_SHEET',
      description: 'Complete Moment of Inertia tensors, Rolling without slipping conservation equations, Gauss Law flux integrals, and Dielectric slab capacitor relations.',
      contentBody: '1. Moment of Inertia: I_cm for Ring = MR^2, Disc = 1/2 MR^2, Solid Sphere = 2/5 MR^2, Hollow Sphere = 2/3 MR^2.\n2. Rolling Acceleration on incline θ: a = g sinθ / (1 + I / MR^2).\n3. Parallel Plate Capacitor with Dielectric Slab thickness t: C = ε₀A / (d - t + t/K).',
      createdBy: teacher1Id,
      createdAt: new Date(),
    },
    {
      id: 'mat-jee-chem-01',
      courseId: 'course_jee',
      courseType: 'JEE',
      subject: 'Chemistry',
      chapter: 'Electrochemistry & Chemical Kinetics',
      title: 'JEE Main Physical Chemistry Rapid Revision Handbook',
      materialType: 'CONCEPT_SUMMARY',
      description: 'Nernst equation derivations at 298 K, First-order kinetics half-life relations, Arrhenius activation energy equations, and Colligative properties.',
      contentBody: '1. Nernst Equation: E_cell = E°_cell - (0.0591 / n) log Q at 298 K.\n2. First Order Kinetics: k = (2.303 / t) log([A]₀ / [A]_t), t_{1/2} = 0.693 / k.\n3. Gibbs Free Energy: ΔG° = -nFE°_cell = -2.303 RT log K_eq.',
      createdBy: teacher1Id,
      createdAt: new Date(),
    },
    {
      id: 'mat-jee-math-01',
      courseId: 'course_jee',
      courseType: 'JEE',
      subject: 'Mathematics',
      chapter: 'Definite Calculus, Matrices & 3D Vectors',
      title: 'JEE Main Mathematics High-Weightage Identities & Shortcuts',
      materialType: 'FORMULA_SHEET',
      description: 'King property of definite integrals, Cayley-Hamilton characteristic equations, Shortest distance between skew lines, and Conic section tangents.',
      contentBody: '1. King Property: ∫_a^b f(x) dx = ∫_a^b f(a + b - x) dx.\n2. Determinants: |adj(A)| = |A|^{n-1}, |kA| = k^n |A|.\n3. Shortest Distance between Skew Lines: d = |(b₁ × b₂) · (a₂ - a₁)| / |b₁ × b₂|.',
      createdBy: teacher1Id,
      createdAt: new Date(),
    },
    {
      id: 'mat-jee-adv-01',
      courseId: 'course_jee_adv',
      courseType: 'JEE_ADVANCED',
      subject: 'Physics',
      chapter: 'Advanced Electrodynamics & Modern Physics',
      title: 'JEE Advanced Multi-Concept Problem Solving Monograph',
      materialType: 'PYQ_BOOKLET',
      description: 'Non-uniform charge distributions, motional EMF in rotating conductors, de Broglie matter waves in variable potentials, and RC transient circuits.',
      contentBody: '1. Motional EMF in rotating rod in uniform B: ε = 1/2 B ω L^2.\n2. Radiation Pressure for perfectly reflecting surface: P = 2I / c.\n3. Bohr Orbit Velocity & Energy: v_n ∝ Z/n, E_n = -13.6 Z^2 / n^2 eV.',
      createdBy: teacher1Id,
      createdAt: new Date(),
    },
    {
      id: 'mat-neet-bio-01',
      courseId: 'course_neet',
      courseType: 'NEET',
      subject: 'Botany',
      chapter: 'Genetics, Molecular Biology & Plant Physiology',
      title: 'NEET UG NCERT Line-by-Line Botany Master Compendium',
      materialType: 'NOTES',
      description: 'Mendelian dihybrid phenotypic ratios, Lac Operon regulation, C3 vs C4 Kranz anatomy pathways, and Meiosis Prophase-I sub-stages.',
      contentBody: '1. Prophase-I Stages: Leptotene -> Zygotene (Synapsis) -> Pachytene (Crossing over) -> Diplotene (Chiasmata) -> Diakinesis.\n2. C4 Cycle (Hatch-Slack): Primary CO₂ acceptor is PEP (3-carbon) in mesophyll cells catalyzed by PEPcase.\n3. Hardy-Weinberg Equilibrium: p² + 2pq + q² = 1.',
      createdBy: teacher2Id,
      createdAt: new Date(),
    },
    {
      id: 'mat-neet-zoo-01',
      courseId: 'course_neet',
      courseType: 'NEET',
      subject: 'Zoology',
      chapter: 'Human Physiology & Biotechnology Applications',
      title: 'NEET UG Zoology High-Yield NCERT Clinical & Hormone Chart',
      materialType: 'CONCEPT_SUMMARY',
      description: 'Cardiac cycle ventricular volumes, Oxyhaemoglobin dissociation curve shifts, Counter-current mechanism in Henle loop, and PCR Taq polymerase steps.',
      contentBody: '1. Cardiac Output = Stroke Volume (70 mL) × Heart Rate (72 bpm) ≈ 5040 mL/min.\n2. PCR Cycle Steps: Denaturation (94°C) -> Annealing (54°C) -> Extension (72°C with Taq Polymerase).\n3. Neurohypophysis Hormones: Oxytocin and Vasopressin (ADH) synthesized in hypothalamus.',
      createdBy: teacher2Id,
      createdAt: new Date(),
    },
    {
      id: 'mat-neet-phychem-01',
      courseId: 'course_neet',
      courseType: 'NEET',
      subject: 'Physics',
      chapter: 'NEET Physics & Chemistry Rapid Calculation Formulae',
      title: 'NEET UG 180-Minute Speed Calculation Formula Booklet',
      materialType: 'FORMULA_SHEET',
      description: 'Ray optics lens-maker equation, Logic gates truth tables, Semiconductors, Coordination chemistry EAN & VSEPR hybridization tables for NEET.',
      contentBody: '1. Lens Maker Formula: 1/f = (n₂/n₁ - 1)(1/R₁ - 1/R₂).\n2. Radioactive Decay & Photoelectric Effect: K_max = hν - φ₀.\n3. Spin-Only Magnetic Moment: μ = √(n(n+2)) BM where n = number of unpaired electrons.',
      createdBy: teacher2Id,
      createdAt: new Date(),
    },
  ];
  for (const m of seedStudyMats) memStudyMaterials.set(m.id, m);

  // Seed Profiles
  const seedProfilesList: (typeof profiles.$inferSelect)[] = [
    {
      id: adminId,
      username: 'admin',
      email: 'admin@ntapulse.edu.in',
      fullName: 'Dr. Rajeshwar Rao (Chief Controller of Examinations)',
      passwordHash: hashPassword('Admin@2026!'),
      role: 'ADMIN',
      studentId: null,
      teacherId: null,
      batchId: null,
      className: 'Administration',
      examCategory: 'JEE_MAIN',
      courseId: 'course_jee',
      courseType: 'JEE',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['JEE', 'JEE_ADVANCED', 'NEET']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Mathematics', 'Botany', 'Zoology']),
      testAccessJson: JSON.stringify(['ALL']),
      teacherPermissionsJson: JSON.stringify({
        canCreateTests: true,
        canCreateQuestions: true,
        canManageBatches: true,
        canResetStudentPasswords: true,
        canViewAllStudents: true,
      }),
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: teacher1Id,
      username: 'hcverma',
      email: 'hcverma@ntapulse.edu.in',
      fullName: 'Prof. H.C. Verma (HOD Physics & JEE Mentor)',
      passwordHash: hashPassword('Teacher@2026!'),
      role: 'TEACHER',
      studentId: null,
      teacherId: null,
      batchId: null,
      className: 'JEE Faculty',
      examCategory: 'JEE_MAIN',
      courseId: 'course_jee',
      courseType: 'JEE',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['JEE', 'JEE_ADVANCED']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Mathematics']),
      testAccessJson: JSON.stringify([]),
      teacherPermissionsJson: JSON.stringify(DEFAULT_TEACHER_PERMS),
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: teacher2Id,
      username: 'ritusharma',
      email: 'ritusharma@ntapulse.edu.in',
      fullName: 'Dr. Ritu Sharma (Senior NEET Biology & Chemistry Faculty)',
      passwordHash: hashPassword('Teacher@2026!'),
      role: 'TEACHER',
      studentId: null,
      teacherId: null,
      batchId: null,
      className: 'NEET Faculty',
      examCategory: 'NEET',
      courseId: 'course_neet',
      courseType: 'NEET',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['NEET']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Botany', 'Zoology']),
      testAccessJson: JSON.stringify([]),
      teacherPermissionsJson: JSON.stringify(DEFAULT_TEACHER_PERMS),
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: student1Id,
      username: null,
      email: 'rahul.verma@student.ntapulse.edu.in',
      fullName: 'Rahul Verma',
      passwordHash: hashPassword('Student@2026!'),
      role: 'STUDENT',
      studentId: 'JEE26-10001',
      teacherId: teacher1Id,
      batchId: batchJeeMainId,
      className: 'Class 12',
      examCategory: 'JEE_MAIN',
      courseId: 'course_jee',
      courseType: 'JEE',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['JEE']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Mathematics']),
      testAccessJson: JSON.stringify(['jee-main-full-mock-01', 'JEE-MAIN-002']),
      teacherPermissionsJson: JSON.stringify({}),
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: student2Id,
      username: null,
      email: 'aarav.mehta@student.ntapulse.edu.in',
      fullName: 'Aarav Mehta',
      passwordHash: hashPassword('Temp@7F42K'),
      role: 'STUDENT',
      studentId: 'JEE26-7F42K',
      teacherId: teacher1Id,
      batchId: batchJeeAdvId,
      className: 'Class 12',
      examCategory: 'JEE_ADVANCED',
      courseId: 'course_jee_adv',
      courseType: 'JEE_ADVANCED',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['JEE', 'JEE_ADVANCED']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Mathematics']),
      testAccessJson: JSON.stringify(['jee-adv-paper1-mock-01', 'jee-main-full-mock-01']),
      teacherPermissionsJson: JSON.stringify({}),
      status: 'ACTIVE',
      mustChangePassword: true,
      tempPasswordHint: 'Temp@7F42K',
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: student3Id,
      username: null,
      email: 'ananya.krishnan@student.ntapulse.edu.in',
      fullName: 'Ananya Krishnan',
      passwordHash: hashPassword('Student@2026!'),
      role: 'STUDENT',
      studentId: 'NEET26-10001',
      teacherId: teacher2Id,
      batchId: batchNeetBioId,
      className: 'Class 12',
      examCategory: 'NEET',
      courseId: 'course_neet',
      courseType: 'NEET',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['NEET']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Botany', 'Zoology']),
      testAccessJson: JSON.stringify(['neet-ug-full-mock-01', 'NEET-UG-002']),
      teacherPermissionsJson: JSON.stringify({}),
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: student4Id,
      username: null,
      email: 'rohan.gupta@student.ntapulse.edu.in',
      fullName: 'Rohan Gupta',
      passwordHash: hashPassword('Temp@10482'),
      role: 'STUDENT',
      studentId: 'NEET26-10482',
      teacherId: teacher2Id,
      batchId: batchNeetBioId,
      className: 'Dropper / Repeater',
      examCategory: 'NEET',
      courseId: 'course_neet',
      courseType: 'NEET',
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(['NEET']),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Botany', 'Zoology']),
      testAccessJson: JSON.stringify(['neet-ug-full-mock-01']),
      teacherPermissionsJson: JSON.stringify({}),
      status: 'ACTIVE',
      mustChangePassword: true,
      tempPasswordHint: 'Temp@10482',
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: student5Id,
      username: null,
      email: 'vikram.singh@student.ntapulse.edu.in',
      fullName: 'Vikramaditya Singh',
      passwordHash: hashPassword('Student@2026!'),
      role: 'STUDENT',
      studentId: 'JEE26-10003',
      teacherId: teacher1Id,
      batchId: batchJeeMainId,
      className: 'Class 11',
      examCategory: 'JEE_MAIN',
      courseId: 'course_jee',
      courseType: 'JEE',
      enrollmentStatus: 'SUSPENDED',
      assignedCoursesJson: JSON.stringify(['JEE']),
      targetYear: 2027,
      subjectAccessJson: JSON.stringify(['Physics', 'Chemistry', 'Mathematics']),
      testAccessJson: JSON.stringify([]),
      teacherPermissionsJson: JSON.stringify({}),
      status: 'SUSPENDED',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  for (const p of seedProfilesList) memProfiles.set(p.id, p);

  // Seed Batches
  const seedBatchesList: (typeof batches.$inferSelect)[] = [
    {
      id: batchJeeAdvId,
      name: 'JEE Advanced 2027 Batch A',
      description: 'Elite rankers batch focused on multi-concept problem solving for IIT JEE Paper 1 & Paper 2.',
      examCategory: 'JEE_ADVANCED',
      courseId: 'course_jee_adv',
      courseType: 'JEE_ADVANCED',
      className: 'Class 12',
      teacherId: teacher1Id,
      teacherName: 'Prof. H.C. Verma (HOD Physics & JEE Mentor)',
      status: 'ACTIVE',
      assignedTestIdsJson: JSON.stringify(['jee-adv-paper1-mock-01', 'JEE-ADV-002', 'jee-main-full-mock-01']),
      studentIdsJson: JSON.stringify([student2Id]),
      createdAt: new Date(),
    },
    {
      id: batchJeeMainId,
      name: 'JEE Main 2027 Morning Batch',
      description: 'Comprehensive NCERT + NTA CBT simulation batch for JEE Main Paper 1 (75 Questions / 300 Marks).',
      examCategory: 'JEE_MAIN',
      courseId: 'course_jee',
      courseType: 'JEE',
      className: 'Class 12',
      teacherId: teacher1Id,
      teacherName: 'Prof. H.C. Verma (HOD Physics & JEE Mentor)',
      status: 'ACTIVE',
      assignedTestIdsJson: JSON.stringify(['jee-main-full-mock-01', 'JEE-MAIN-002', 'pyq-jee-main-2025-jan-s1']),
      studentIdsJson: JSON.stringify([student1Id, student5Id]),
      createdAt: new Date(),
    },
    {
      id: batchNeetBioId,
      name: 'NEET 2027 Biology Batch',
      description: 'Dedicated pre-medical cohort covering Physics, Chemistry, Botany & Zoology (180 Compulsory Questions).',
      examCategory: 'NEET',
      courseId: 'course_neet',
      courseType: 'NEET',
      className: 'Class 12',
      teacherId: teacher2Id,
      teacherName: 'Dr. Ritu Sharma (Senior NEET Biology & Chemistry Faculty)',
      status: 'ACTIVE',
      assignedTestIdsJson: JSON.stringify(['neet-ug-full-mock-01', 'NEET-UG-002', 'pyq-neet-ug-2025-official']),
      studentIdsJson: JSON.stringify([student3Id, student4Id]),
      createdAt: new Date(),
    },
  ];
  for (const b of seedBatchesList) memBatches.set(b.id, b);

  // Seed Announcements
  const seedAnnouncementsList: (typeof announcements.$inferSelect)[] = [
    {
      id: 'ann-01',
      title: 'Official 2026 Examination Security & Course Isolation Active',
      content: 'All mock tests, PYQ archives, and analytics are strictly bound to your enrolled course. Complete your system check 15 minutes before starting.',
      courseId: 'ALL',
      courseType: 'ALL',
      authorId: adminId,
      authorName: 'Dr. Rajeshwar Rao (Chief Controller)',
      authorRole: 'ADMIN',
      targetAudience: 'ALL',
      targetBatchId: null,
      priority: 'URGENT',
      createdAt: new Date(),
    },
    {
      id: 'ann-02',
      title: 'JEE Main Morning Batch: Mandatory Full Mock #01 Review',
      content: 'All JEE students in JEE Main 2027 Morning Batch must complete Full Mock Test #01 by Sunday 8:00 PM. Rotational mechanics and electrostatics numericals will be discussed.',
      courseId: 'course_jee',
      courseType: 'JEE',
      authorId: teacher1Id,
      authorName: 'Prof. H.C. Verma',
      authorRole: 'TEACHER',
      targetAudience: 'BATCH',
      targetBatchId: batchJeeMainId,
      priority: 'IMPORTANT',
      createdAt: new Date(),
    },
    {
      id: 'ann-03',
      title: 'NEET 2027 Biology Batch: Genetics & Plant Physiology Drill',
      content: 'NEET Full Mock #01 (180 Compulsory MCQs) has been assigned to the NEET cohort. Pay special attention to NCERT Genetics and Human Physiology.',
      courseId: 'course_neet',
      courseType: 'NEET',
      authorId: teacher2Id,
      authorName: 'Dr. Ritu Sharma',
      authorRole: 'TEACHER',
      targetAudience: 'BATCH',
      targetBatchId: batchNeetBioId,
      priority: 'NORMAL',
      createdAt: new Date(),
    },
  ];
  for (const a of seedAnnouncementsList) memAnnouncements.set(a.id, a);

  // Seed Audit Logs
  const seedAuditList: (typeof auditLogs.$inferSelect)[] = [
    {
      id: 'audit-init-1',
      actorId: adminId,
      actorName: 'Dr. Rajeshwar Rao',
      actorRole: 'ADMIN',
      action: 'SYSTEM_BOOTSTRAP',
      target: 'RBAC & Course Separation Security Engine',
      details: 'Initialized PostgreSQL profiles, courses (JEE, JEE_ADVANCED, NEET), student enrollments, and course-scoped RLS policies.',
      createdAt: new Date(),
    },
    {
      id: 'audit-init-2',
      actorId: teacher1Id,
      actorName: 'Prof. H.C. Verma',
      actorRole: 'TEACHER',
      action: 'ENROLL_STUDENT_COURSE',
      target: 'JEE26-10001 (Rahul Verma) -> course_jee',
      details: 'Verified ACTIVE enrollment in JEE (Main) course.',
      createdAt: new Date(),
    },
  ];
  for (const al of seedAuditList) memAuditLogs.push(al);

  isAuthSeeded = true;
  console.log('RBAC & Course Separation seeding initialized in memory.');

  // If PostgreSQL is configured, attempt to seed persistent tables in background
  if (isPostgresConfigured()) {
    try {
      await db.insert(courses).values(seedCoursesList).onConflictDoNothing();
      await db.insert(enrollments).values(seedEnrollmentsList).onConflictDoNothing();
      await db.insert(studyMaterials).values(seedStudyMats).onConflictDoNothing();
      await db.insert(profiles).values(seedProfilesList).onConflictDoNothing();
      await db.insert(batches).values(seedBatchesList).onConflictDoNothing();
      await db.insert(announcements).values(seedAnnouncementsList).onConflictDoNothing();
      await db.insert(auditLogs).values(seedAuditList).onConflictDoNothing();
      console.log('RBAC & Course Separation tables synchronized with PostgreSQL.');
    } catch (err) {
      console.warn('PostgreSQL synchronization note:', err);
    }
  }
}

// ----------------- AUTHENTICATION & SESSION OPERATIONS -----------------

export async function authenticateUser(params: {
  role: UserRole;
  identifier: string;
  password: string;
  rememberMe?: boolean;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{
  success: boolean;
  statusCode: number;
  error?: string;
  accountStatus?: AccountStatus;
  token?: string;
  profile?: AuthProfile;
}> {
  await ensureAuthSeeded();
  const cleanId = params.identifier.trim();

  let matchedRows: (typeof profiles.$inferSelect)[] = [];

  if (params.role === 'STUDENT') {
    matchedRows = Array.from(memProfiles.values()).filter(
      (s) => s.role === 'STUDENT' && s.studentId && s.studentId.toUpperCase() === cleanId.toUpperCase()
    );
  } else if (params.role === 'TEACHER') {
    matchedRows = Array.from(memProfiles.values()).filter(
      (t) =>
        t.role === 'TEACHER' &&
        ((t.email && t.email.toLowerCase() === cleanId.toLowerCase()) ||
          (t.username && t.username.toLowerCase() === cleanId.toLowerCase()))
    );
  } else if (params.role === 'ADMIN') {
    matchedRows = Array.from(memProfiles.values()).filter(
      (a) =>
        a.role === 'ADMIN' &&
        ((a.email && a.email.toLowerCase() === cleanId.toLowerCase()) ||
          (a.username && a.username.toLowerCase() === cleanId.toLowerCase()))
    );
  }

  if (matchedRows.length === 0) {
    const idLabel =
      params.role === 'STUDENT'
        ? 'Student ID'
        : params.role === 'TEACHER'
        ? 'Teacher email/username'
        : 'Administrator email';
    return {
      success: false,
      statusCode: 401,
      error: `Invalid ${idLabel} or password. Please verify your credentials and selected role tab.`,
    };
  }

  const userRow = matchedRows[0];

  // Verify password hash
  const passwordValid = verifyPassword(params.password, userRow.passwordHash);
  if (!passwordValid) {
    return {
      success: false,
      statusCode: 401,
      error: 'Invalid credentials. Please check your password and try again.',
    };
  }

  // Check Account Status
  if (userRow.status === 'SUSPENDED') {
    return {
      success: false,
      statusCode: 403,
      accountStatus: 'SUSPENDED',
      error:
        'Account Suspended — Your examination portal account has been suspended by the administration. Please contact your assigned faculty or Examination Controller.',
    };
  }
  if (userRow.status === 'DEACTIVATED') {
    return {
      success: false,
      statusCode: 403,
      accountStatus: 'DEACTIVATED',
      error:
        'Account Deactivated — This account is currently inactive and cannot access tests or dashboard resources.',
    };
  }
  if (userRow.status === 'PENDING') {
    return {
      success: false,
      statusCode: 403,
      accountStatus: 'PENDING',
      error:
        'Account Pending Approval — Your account setup is awaiting activation by an administrator.',
    };
  }

  if (userRow.expiresAt && new Date(userRow.expiresAt).getTime() < Date.now()) {
    return {
      success: false,
      statusCode: 403,
      error: `Account Expired — Your examination enrollment expired on ${new Date(
        userRow.expiresAt
      ).toLocaleDateString()}. Please contact your teacher or administrator to extend validity.`,
    };
  }

  if (
    userRow.role === 'STUDENT' &&
    userRow.enrollmentStatus &&
    userRow.enrollmentStatus !== 'ACTIVE'
  ) {
    return {
      success: false,
      statusCode: 403,
      error: `Course Enrollment ${userRow.enrollmentStatus} — Your enrollment in the ${
        userRow.courseType || userRow.examCategory
      } course is currently ${userRow.enrollmentStatus}. Please contact your Faculty Mentor or Administrator.`,
    };
  }

  // Update lastLogin timestamp
  const now = new Date();
  userRow.lastLogin = now;
  userRow.updatedAt = now;
  memProfiles.set(userRow.id, userRow);

  if (isPostgresConfigured()) {
    try {
      await db
        .update(profiles)
        .set({ lastLogin: now, updatedAt: now })
        .where(eq(profiles.id, userRow.id));
    } catch {}
  }

  // Create persistent session
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const ttlMs = params.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const sessionRow: typeof authSessions.$inferSelect = {
    id: `sess-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    tokenHash,
    userId: userRow.id,
    role: userRow.role,
    userAgent: params.userAgent || 'Browser Client',
    ipAddress: params.ipAddress || '127.0.0.1',
    rememberMe: Boolean(params.rememberMe),
    expiresAt,
    revoked: false,
    createdAt: now,
  };
  memAuthSessions.set(tokenHash, sessionRow);

  if (isPostgresConfigured()) {
    try {
      await db.insert(authSessions).values(sessionRow);
    } catch {}
  }

  await createAuditLog({
    actorId: userRow.id,
    actorName: userRow.fullName,
    actorRole: userRow.role as UserRole,
    action: 'USER_LOGIN',
    target: userRow.studentId || userRow.email || userRow.id,
    details: `${userRow.role} signed in successfully`,
  });

  const enrichedProfile = await getProfileById(userRow.id);

  return {
    success: true,
    statusCode: 200,
    token: rawToken,
    profile: enrichedProfile || mapRowToProfile({ ...userRow, lastLogin: now }),
  };
}

export async function verifySessionToken(rawToken: string): Promise<{
  valid: boolean;
  error?: string;
  accountStatus?: AccountStatus;
  profile?: AuthProfile;
  sessionId?: string;
}> {
  if (!rawToken) return { valid: false, error: 'Missing session token' };
  await ensureAuthSeeded();

  const tokenHash = hashToken(rawToken);
  let session = memAuthSessions.get(tokenHash);

  if (!session && isPostgresConfigured()) {
    try {
      const rows = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash));
      if (rows.length > 0) {
        session = rows[0];
        memAuthSessions.set(tokenHash, session);
      }
    } catch {}
  }

  if (!session) {
    return { valid: false, error: 'Invalid or expired session. Please sign in again.' };
  }

  if (session.revoked) {
    return {
      valid: false,
      error: 'Your session was terminated by an administrator. Please sign in again.',
    };
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    return { valid: false, error: 'Session expired. Please sign in again.' };
  }

  const profile = await getProfileById(session.userId);
  if (!profile) {
    return { valid: false, error: 'User profile no longer exists.' };
  }

  if (profile.status !== 'ACTIVE') {
    return {
      valid: false,
      accountStatus: profile.status,
      error: `Account is currently ${profile.status}. Access denied.`,
    };
  }

  if (profile.expiresAt && new Date(profile.expiresAt).getTime() < Date.now()) {
    return {
      valid: false,
      error: 'Your student account validity has expired.',
    };
  }

  return {
    valid: true,
    profile,
    sessionId: session.id,
  };
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  const session = memAuthSessions.get(tokenHash);
  if (session) {
    session.revoked = true;
  }
  if (isPostgresConfigured()) {
    try {
      await db
        .update(authSessions)
        .set({ revoked: true })
        .where(eq(authSessions.tokenHash, tokenHash));
    } catch {}
  }
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  let count = 0;
  for (const session of memAuthSessions.values()) {
    if (session.userId === userId && !session.revoked) {
      session.revoked = true;
      count++;
    }
  }
  if (isPostgresConfigured()) {
    try {
      await db
        .update(authSessions)
        .set({ revoked: true })
        .where(eq(authSessions.userId, userId));
    } catch {}
  }
  return count;
}

// ----------------- FIRST LOGIN & PASSWORD MANAGEMENT -----------------

export async function completeFirstLoginPasswordChange(params: {
  userId: string;
  newPassword: string;
}): Promise<{ success: boolean; error?: string; profile?: AuthProfile }> {
  await ensureAuthSeeded();
  const complexity = validatePasswordComplexity(params.newPassword);
  if (!complexity.valid) {
    return { success: false, error: complexity.message };
  }

  const userRow = memProfiles.get(params.userId);
  if (!userRow) {
    return { success: false, error: 'User not found.' };
  }

  const newHash = hashPassword(params.newPassword);
  const now = new Date();
  userRow.passwordHash = newHash;
  userRow.mustChangePassword = false;
  userRow.tempPasswordHint = null;
  userRow.updatedAt = now;
  memProfiles.set(userRow.id, userRow);

  if (isPostgresConfigured()) {
    try {
      await db
        .update(profiles)
        .set({
          passwordHash: newHash,
          mustChangePassword: false,
          tempPasswordHint: null,
          updatedAt: now,
        })
        .where(eq(profiles.id, params.userId));
    } catch {}
  }

  await createAuditLog({
    actorId: userRow.id,
    actorName: userRow.fullName,
    actorRole: userRow.role as UserRole,
    action: 'PASSWORD_CHANGE',
    target: userRow.studentId || userRow.email || userRow.id,
    details: 'Completed mandatory first-login password creation',
  });

  const updated = await getProfileById(params.userId);
  return { success: true, profile: updated || undefined };
}

export async function resetUserPasswordByStaff(params: {
  targetUserId: string;
  newTemporaryPassword: string;
  forceChangeOnNextLogin: boolean;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; profile?: AuthProfile }> {
  await ensureAuthSeeded();
  if (!params.newTemporaryPassword || params.newTemporaryPassword.length < 6) {
    return { success: false, error: 'Temporary password must be at least 6 characters.' };
  }

  const target = memProfiles.get(params.targetUserId);
  if (!target) {
    return { success: false, error: 'Target user not found.' };
  }

  if (params.actor.role === 'TEACHER') {
    if (target.role !== 'STUDENT') {
      return { success: false, error: 'Teachers can only reset student passwords.' };
    }
    if (
      !params.actor.teacherPermissions.canViewAllStudents &&
      target.teacherId !== params.actor.id
    ) {
      return {
        success: false,
        error: 'Access Denied — You can only reset credentials for students assigned to you.',
      };
    }
  }

  const newHash = hashPassword(params.newTemporaryPassword);
  const now = new Date();
  target.passwordHash = newHash;
  target.mustChangePassword = params.forceChangeOnNextLogin;
  target.tempPasswordHint = params.forceChangeOnNextLogin ? params.newTemporaryPassword : null;
  target.updatedAt = now;
  memProfiles.set(target.id, target);

  if (isPostgresConfigured()) {
    try {
      await db
        .update(profiles)
        .set({
          passwordHash: newHash,
          mustChangePassword: params.forceChangeOnNextLogin,
          tempPasswordHint: params.forceChangeOnNextLogin ? params.newTemporaryPassword : null,
          updatedAt: now,
        })
        .where(eq(profiles.id, params.targetUserId));
    } catch {}
  }

  await revokeAllUserSessions(params.targetUserId);

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'CREDENTIAL_RESET',
    target: `${target.fullName} (${target.studentId || target.email})`,
    details: `Password reset by ${params.actor.role}. Force change on login: ${params.forceChangeOnNextLogin}`,
  });

  const updated = await getProfileById(params.targetUserId);
  return { success: true, profile: updated || undefined };
}

// ----------------- PROFILE & USER CRUD -----------------

export async function getAllProfiles(): Promise<AuthProfile[]> {
  await ensureAuthSeeded();

  const allRows = Array.from(memProfiles.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const allBatches = Array.from(memBatches.values());
  const allEnrollments = Array.from(memEnrollments.values());
  const activeSessions = Array.from(memAuthSessions.values()).filter((s) => !s.revoked);

  const teacherMap = new Map<string, string>();
  const studentNameMap = new Map<string, { fullName: string; studentId?: string | null }>();
  allRows.forEach((r) => {
    if (r.role === 'TEACHER' || r.role === 'ADMIN') {
      teacherMap.set(r.id, r.fullName);
    }
    studentNameMap.set(r.id, { fullName: r.fullName, studentId: r.studentId });
  });

  const batchMap = new Map<string, string>();
  allBatches.forEach((b) => {
    batchMap.set(b.id, b.name);
  });

  const enrollmentMap = new Map<string, EnrollmentRecord[]>();
  allEnrollments.forEach((e) => {
    const stuInfo = studentNameMap.get(e.studentId);
    const rec: EnrollmentRecord = {
      id: e.id,
      studentId: e.studentId,
      studentName: stuInfo?.fullName,
      studentCode: stuInfo?.studentId,
      courseId: e.courseId,
      courseType: e.courseType as CourseType,
      status: (e.status as EnrollmentStatus) || 'ACTIVE',
      assignedBy: e.assignedBy,
      createdAt: e.createdAt ? e.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: e.updatedAt ? e.updatedAt.toISOString() : new Date().toISOString(),
    };
    const arr = enrollmentMap.get(e.studentId) || [];
    arr.push(rec);
    enrollmentMap.set(e.studentId, arr);
  });

  const now = Date.now();
  const sessionCounts = new Map<string, number>();
  activeSessions.forEach((s) => {
    if (new Date(s.expiresAt).getTime() > now) {
      sessionCounts.set(s.userId, (sessionCounts.get(s.userId) || 0) + 1);
    }
  });

  return allRows.map((row) =>
    mapRowToProfile(row, teacherMap, batchMap, sessionCounts, enrollmentMap)
  );
}

export async function getProfileById(userId: string): Promise<AuthProfile | null> {
  const all = await getAllProfiles();
  return all.find((p) => p.id === userId) || null;
}

export async function createTeacherAccount(params: {
  fullName: string;
  email: string;
  username?: string;
  password: string;
  examCategory: ExamType;
  className?: string;
  subjectAccess?: SubjectName[];
  assignedCourses?: CourseType[];
  teacherPermissions?: Partial<TeacherPermissions>;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; profile?: AuthProfile }> {
  await ensureAuthSeeded();
  if (params.actor.role !== 'ADMIN') {
    return { success: false, error: 'Only Administrators can create Teacher accounts.' };
  }

  const emailClean = params.email.trim().toLowerCase();
  const usernameClean = (params.username || emailClean.split('@')[0]).trim().toLowerCase();

  const existing = Array.from(memProfiles.values());
  if (existing.some((p) => p.email?.toLowerCase() === emailClean)) {
    return { success: false, error: 'A user with this email address already exists.' };
  }
  if (existing.some((p) => p.username?.toLowerCase() === usernameClean)) {
    return { success: false, error: 'A teacher with this username already exists.' };
  }

  const id = `usr-teacher-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const resolved = resolveCourseFromExam(params.examCategory);
  const now = new Date();

  const assignedCourses = params.assignedCourses && params.assignedCourses.length > 0
    ? params.assignedCourses
    : resolved.assignedCourses;

  const newTeacher: typeof profiles.$inferSelect = {
    id,
    username: usernameClean,
    email: emailClean,
    fullName: params.fullName.trim(),
    passwordHash: hashPassword(params.password),
    role: 'TEACHER',
    studentId: null,
    teacherId: null,
    batchId: null,
    className: params.className || 'Senior Faculty',
    examCategory: params.examCategory,
    courseId: resolved.courseId,
    courseType: resolved.courseType,
    enrollmentStatus: 'ACTIVE',
    assignedCoursesJson: JSON.stringify(assignedCourses),
    targetYear: 2026,
    subjectAccessJson: JSON.stringify(params.subjectAccess || resolved.defaultSubjects),
    testAccessJson: JSON.stringify([]),
    teacherPermissionsJson: JSON.stringify({
      ...DEFAULT_TEACHER_PERMS,
      ...(params.teacherPermissions || {}),
    }),
    status: 'ACTIVE',
    mustChangePassword: false,
    tempPasswordHint: null,
    expiresAt: null,
    lastLogin: null,
    createdAt: now,
    updatedAt: now,
  };

  memProfiles.set(id, newTeacher);
  if (isPostgresConfigured()) {
    try {
      await db.insert(profiles).values(newTeacher);
    } catch {}
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'CREATE_TEACHER',
    target: `${params.fullName} (${emailClean})`,
    details: `Created faculty mentor for ${params.examCategory}`,
  });

  const created = await getProfileById(id);
  return { success: true, profile: created || undefined };
}

export async function createStudentAccount(params: {
  fullName: string;
  email?: string;
  phone?: string;
  classStandard?: string;
  examCategory: ExamType;
  courseType?: CourseType;
  includeJeeAdvanced?: boolean;
  batchId?: string | null;
  teacherId?: string | null;
  temporaryPassword?: string;
  idGenerationMode?: 'SEQUENTIAL' | 'ALPHANUMERIC';
  validityUntil?: string | null;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; profile?: AuthProfile; temporaryPassword?: string }> {
  await ensureAuthSeeded();
  if (params.actor.role !== 'ADMIN' && params.actor.role !== 'TEACHER') {
    return { success: false, error: 'Unauthorized to enroll students.' };
  }

  const generatedStudentId = await generateUniqueStudentId(
    params.examCategory,
    params.idGenerationMode || 'SEQUENTIAL'
  );

  const rawPassword =
    params.temporaryPassword && params.temporaryPassword.trim()
      ? params.temporaryPassword.trim()
      : `Temp@${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const id = `usr-student-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const resolved = resolveCourseFromExam(params.courseType || params.examCategory);

  const assignedCourses: CourseType[] =
    params.includeJeeAdvanced && resolved.courseType === 'JEE'
      ? ['JEE', 'JEE_ADVANCED']
      : resolved.assignedCourses;

  const now = new Date();
  const assignedTeacherId =
    params.actor.role === 'TEACHER' ? params.actor.id : params.teacherId || null;

  const newStudent: typeof profiles.$inferSelect = {
    id,
    username: null,
    email: params.email?.trim().toLowerCase() || null,
    fullName: params.fullName.trim(),
    passwordHash: hashPassword(rawPassword),
    role: 'STUDENT',
    studentId: generatedStudentId,
    teacherId: assignedTeacherId,
    batchId: params.batchId || null,
    className: params.classStandard || 'Class 12',
    examCategory: params.examCategory,
    courseId: resolved.courseId,
    courseType: resolved.courseType,
    enrollmentStatus: 'ACTIVE',
    assignedCoursesJson: JSON.stringify(assignedCourses),
    targetYear: 2026,
    subjectAccessJson: JSON.stringify(resolved.defaultSubjects),
    testAccessJson: JSON.stringify([]),
    teacherPermissionsJson: JSON.stringify({}),
    status: 'ACTIVE',
    mustChangePassword: true,
    tempPasswordHint: rawPassword,
    expiresAt: params.validityUntil ? new Date(params.validityUntil) : null,
    lastLogin: null,
    createdAt: now,
    updatedAt: now,
  };

  memProfiles.set(id, newStudent);
  if (isPostgresConfigured()) {
    try {
      await db.insert(profiles).values(newStudent);
    } catch {}
  }

  // Create course enrollment records
  for (const cType of assignedCourses) {
    const cId = cType === 'NEET' ? 'course_neet' : cType === 'JEE_ADVANCED' ? 'course_jee_adv' : 'course_jee';
    const enrId = `enr-${id}-${cId}`;
    const enrRecord: typeof enrollments.$inferSelect = {
      id: enrId,
      studentId: id,
      courseId: cId,
      courseType: cType,
      status: 'ACTIVE',
      assignedBy: params.actor.id,
      createdAt: now,
      updatedAt: now,
    };
    memEnrollments.set(enrId, enrRecord);
    if (isPostgresConfigured()) {
      try {
        await db.insert(enrollments).values(enrRecord).onConflictDoNothing();
      } catch {}
    }
  }

  // If assigned to a batch, update batch member list
  if (params.batchId) {
    const batch = memBatches.get(params.batchId);
    if (batch) {
      const studentIds = parseJsonSafe<string[]>(batch.studentIdsJson, []);
      if (!studentIds.includes(id)) {
        studentIds.push(id);
        batch.studentIdsJson = JSON.stringify(studentIds);
        memBatches.set(batch.id, batch);
      }
    }
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'ENROLL_STUDENT',
    target: `${generatedStudentId} (${params.fullName})`,
    details: `Enrolled in course ${assignedCourses.join(' + ')}`,
  });

  const created = await getProfileById(id);
  return {
    success: true,
    profile: created || undefined,
    temporaryPassword: rawPassword,
  };
}

export async function updateProfileByStaff(params: {
  targetUserId: string;
  patch: Partial<AuthProfile>;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; profile?: AuthProfile }> {
  await ensureAuthSeeded();
  const current = memProfiles.get(params.targetUserId);
  if (!current) {
    return { success: false, error: 'User not found.' };
  }

  if (params.actor.role === 'TEACHER') {
    if (current.role !== 'STUDENT') {
      return { success: false, error: 'Faculty can only modify student profiles.' };
    }
  }

  const now = new Date();
  if (params.patch.fullName !== undefined) current.fullName = params.patch.fullName.trim();
  if (params.patch.email !== undefined) current.email = params.patch.email ? params.patch.email.trim().toLowerCase() : null;
  if (params.patch.className !== undefined) current.className = params.patch.className;
  if (params.patch.batchId !== undefined) current.batchId = params.patch.batchId;
  if (params.patch.teacherId !== undefined) current.teacherId = params.patch.teacherId;
  if (params.patch.status !== undefined) current.status = params.patch.status;
  if (params.patch.enrollmentStatus !== undefined) current.enrollmentStatus = params.patch.enrollmentStatus;
  if (params.patch.expiresAt !== undefined) current.expiresAt = params.patch.expiresAt ? new Date(params.patch.expiresAt) : null;
  if (params.patch.assignedCourses !== undefined) current.assignedCoursesJson = JSON.stringify(params.patch.assignedCourses);
  if (params.patch.subjectAccess !== undefined) current.subjectAccessJson = JSON.stringify(params.patch.subjectAccess);
  if (params.patch.teacherPermissions !== undefined) current.teacherPermissionsJson = JSON.stringify(params.patch.teacherPermissions);
  current.updatedAt = now;

  memProfiles.set(current.id, current);

  if (isPostgresConfigured()) {
    try {
      await db
        .update(profiles)
        .set({
          fullName: current.fullName,
          email: current.email,
          className: current.className,
          batchId: current.batchId,
          teacherId: current.teacherId,
          status: current.status,
          enrollmentStatus: current.enrollmentStatus,
          expiresAt: current.expiresAt,
          assignedCoursesJson: current.assignedCoursesJson,
          subjectAccessJson: current.subjectAccessJson,
          teacherPermissionsJson: current.teacherPermissionsJson,
          updatedAt: now,
        })
        .where(eq(profiles.id, current.id));
    } catch {}
  }

  const updated = await getProfileById(current.id);
  return { success: true, profile: updated || undefined };
}

export async function deleteProfileByAdmin(params: {
  targetUserId: string;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string }> {
  await ensureAuthSeeded();
  if (params.actor.role !== 'ADMIN') {
    return { success: false, error: 'Only Administrators can delete accounts.' };
  }

  const target = memProfiles.get(params.targetUserId);
  if (!target) {
    return { success: false, error: 'User does not exist.' };
  }

  memProfiles.delete(params.targetUserId);
  await revokeAllUserSessions(params.targetUserId);

  if (isPostgresConfigured()) {
    try {
      await db.delete(profiles).where(eq(profiles.id, params.targetUserId));
    } catch {}
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'DELETE_ACCOUNT',
    target: `${target.fullName} (${target.id})`,
    details: 'Account purged by administrator',
  });

  return { success: true };
}

// ----------------- BATCH MANAGEMENT -----------------

export async function getAllBatches(): Promise<BatchRecord[]> {
  await ensureAuthSeeded();
  return Array.from(memBatches.values()).map(mapRowToBatch);
}

export async function createBatchRecord(params: {
  name: string;
  description?: string;
  examCategory: ExamType;
  courseType?: CourseType;
  className?: string;
  teacherId: string;
  teacherName: string;
  assignedTestIds?: string[];
  studentIds?: string[];
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; batch?: BatchRecord }> {
  await ensureAuthSeeded();
  const id = `batch-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const resolved = resolveCourseFromExam(params.courseType || params.examCategory);

  const row: typeof batches.$inferSelect = {
    id,
    name: params.name.trim(),
    description: params.description || '',
    examCategory: params.examCategory,
    courseId: resolved.courseId,
    courseType: resolved.courseType,
    className: params.className || 'Class 12',
    teacherId: params.teacherId,
    teacherName: params.teacherName,
    status: 'ACTIVE',
    assignedTestIdsJson: JSON.stringify(params.assignedTestIds || []),
    studentIdsJson: JSON.stringify(params.studentIds || []),
    createdAt: new Date(),
  };

  memBatches.set(id, row);
  if (isPostgresConfigured()) {
    try {
      await db.insert(batches).values(row);
    } catch {}
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'CREATE_BATCH',
    target: params.name,
    details: `Created ${params.examCategory} cohort batch`,
  });

  return { success: true, batch: mapRowToBatch(row) };
}

export async function updateBatchRecord(params: {
  batchId: string;
  patch: Partial<BatchRecord>;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; batch?: BatchRecord }> {
  await ensureAuthSeeded();
  const current = memBatches.get(params.batchId);
  if (!current) return { success: false, error: 'Batch not found.' };

  if (params.patch.name !== undefined) current.name = params.patch.name;
  if (params.patch.description !== undefined) current.description = params.patch.description;
  if (params.patch.className !== undefined) current.className = params.patch.className;
  if (params.patch.teacherId !== undefined) current.teacherId = params.patch.teacherId;
  if (params.patch.teacherName !== undefined) current.teacherName = params.patch.teacherName;
  if (params.patch.status !== undefined) current.status = params.patch.status;
  if (params.patch.assignedTestIds !== undefined) current.assignedTestIdsJson = JSON.stringify(params.patch.assignedTestIds);
  if (params.patch.studentIds !== undefined) current.studentIdsJson = JSON.stringify(params.patch.studentIds);

  memBatches.set(current.id, current);

  if (isPostgresConfigured()) {
    try {
      await db
        .update(batches)
        .set({
          name: current.name,
          description: current.description,
          className: current.className,
          teacherId: current.teacherId,
          teacherName: current.teacherName,
          status: current.status,
          assignedTestIdsJson: current.assignedTestIdsJson,
          studentIdsJson: current.studentIdsJson,
        })
        .where(eq(batches.id, current.id));
    } catch {}
  }

  return { success: true, batch: mapRowToBatch(current) };
}

export async function deleteBatchRecord(batchId: string, actor: AuthProfile): Promise<boolean> {
  await ensureAuthSeeded();
  const current = memBatches.get(batchId);
  if (!current) return false;

  memBatches.delete(batchId);
  if (isPostgresConfigured()) {
    try {
      await db.delete(batches).where(eq(batches.id, batchId));
    } catch {}
  }

  await createAuditLog({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'DELETE_BATCH',
    target: current.name,
    details: 'Deleted cohort batch',
  });

  return true;
}

// ----------------- ANNOUNCEMENTS -----------------

export async function getAllAnnouncements(): Promise<AnnouncementRecord[]> {
  await ensureAuthSeeded();
  return Array.from(memAnnouncements.values()).map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    courseId: r.courseId,
    courseType: r.courseType as CourseType | 'ALL',
    authorId: r.authorId,
    authorName: r.authorName,
    authorRole: r.authorRole as UserRole,
    targetAudience: r.targetAudience as 'ALL' | 'TEACHERS' | 'STUDENTS' | 'BATCH',
    targetBatchId: r.targetBatchId,
    priority: r.priority as 'NORMAL' | 'IMPORTANT' | 'URGENT',
    createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
  }));
}

export async function createAnnouncementRecord(params: {
  title: string;
  content: string;
  courseId?: string;
  courseType?: CourseType | 'ALL';
  targetAudience?: 'ALL' | 'TEACHERS' | 'STUDENTS' | 'BATCH';
  targetBatchId?: string | null;
  priority?: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  actor: AuthProfile;
}): Promise<AnnouncementRecord> {
  await ensureAuthSeeded();
  const id = `ann-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date();

  const row: typeof announcements.$inferSelect = {
    id,
    title: params.title.trim(),
    content: params.content.trim(),
    courseId: params.courseId || 'ALL',
    courseType: params.courseType || 'ALL',
    authorId: params.actor.id,
    authorName: params.actor.fullName,
    authorRole: params.actor.role,
    targetAudience: params.targetAudience || 'ALL',
    targetBatchId: params.targetBatchId || null,
    priority: params.priority || 'NORMAL',
    createdAt: now,
  };

  memAnnouncements.set(id, row);
  if (isPostgresConfigured()) {
    try {
      await db.insert(announcements).values(row);
    } catch {}
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'CREATE_ANNOUNCEMENT',
    target: params.title,
    details: `Published notice to audience: ${row.targetAudience}`,
  });

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    courseId: row.courseId,
    courseType: row.courseType as CourseType | 'ALL',
    authorId: row.authorId,
    authorName: row.authorName,
    authorRole: row.authorRole as UserRole,
    targetAudience: row.targetAudience as any,
    targetBatchId: row.targetBatchId,
    priority: row.priority as any,
    createdAt: now.toISOString(),
  };
}

export async function deleteAnnouncementRecord(id: string): Promise<void> {
  memAnnouncements.delete(id);
  if (isPostgresConfigured()) {
    try {
      await db.delete(announcements).where(eq(announcements.id, id));
    } catch {}
  }
}

// ----------------- PASSWORD RECOVERY -----------------

export async function createPasswordRecoveryRequest(params: {
  userId?: string;
  identifier: string;
  userName?: string;
  userRole?: UserRole;
  role?: UserRole;
  teacherId?: string | null;
  reason?: string;
}): Promise<PasswordRecoveryRecord> {
  await ensureAuthSeeded();
  const id = `rec-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date();

  const cleanId = params.identifier.trim();
  const matchedUser = Array.from(memProfiles.values()).find(
    (p) =>
      (p.studentId && p.studentId.toUpperCase() === cleanId.toUpperCase()) ||
      (p.email && p.email.toLowerCase() === cleanId.toLowerCase()) ||
      (p.username && p.username.toLowerCase() === cleanId.toLowerCase()) ||
      p.id === cleanId
  );

  const userId = params.userId || matchedUser?.id || `usr-anon-${Date.now()}`;
  const userName = params.userName || matchedUser?.fullName || cleanId;
  const userRole = (params.userRole || params.role || matchedUser?.role || 'STUDENT') as UserRole;
  const teacherId = params.teacherId || matchedUser?.teacherId || null;
  const reason = params.reason || 'Forgot password / requested credential reset';

  const row: typeof passwordRecoveryRequests.$inferSelect = {
    id,
    userId,
    identifier: cleanId,
    userName,
    userRole,
    teacherId,
    reason,
    status: 'PENDING',
    recoveryCode: null,
    createdAt: now,
    resolvedAt: null,
  };

  memPasswordRecovery.set(id, row);
  if (isPostgresConfigured()) {
    try {
      await db.insert(passwordRecoveryRequests).values(row);
    } catch {}
  }

  return {
    id: row.id,
    userId: row.userId,
    identifier: row.identifier,
    userName: row.userName,
    userRole: row.userRole as UserRole,
    teacherId: row.teacherId,
    reason: row.reason || '',
    status: 'PENDING',
    recoveryCode: null,
    createdAt: now.toISOString(),
    resolvedAt: null,
  };
}

export async function getPasswordRecoveryRequests(): Promise<PasswordRecoveryRecord[]> {
  await ensureAuthSeeded();
  return Array.from(memPasswordRecovery.values()).map((r) => ({
    id: r.id,
    userId: r.userId,
    identifier: r.identifier,
    userName: r.userName,
    userRole: r.userRole as UserRole,
    teacherId: r.teacherId,
    reason: r.reason || '',
    status: r.status as 'PENDING' | 'RESOLVED' | 'REJECTED',
    recoveryCode: r.recoveryCode,
    createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }));
}

export async function resolvePasswordRecoveryRequest(params: {
  requestId: string;
  status?: 'RESOLVED' | 'REJECTED';
  recoveryCode?: string;
  newTemporaryPassword?: string;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string }> {
  await ensureAuthSeeded();
  const current = memPasswordRecovery.get(params.requestId);
  if (!current) return { success: false, error: 'Recovery request not found.' };

  const now = new Date();
  const status = params.status || 'RESOLVED';
  const code = params.newTemporaryPassword || params.recoveryCode || null;

  current.status = status;
  current.recoveryCode = code;
  current.resolvedAt = now;
  memPasswordRecovery.set(current.id, current);

  if (params.newTemporaryPassword && current.userId) {
    const user = memProfiles.get(current.userId);
    if (user) {
      user.passwordHash = hashPassword(params.newTemporaryPassword);
      user.mustChangePassword = true;
      user.tempPasswordHint = params.newTemporaryPassword;
      user.updatedAt = now;
      memProfiles.set(user.id, user);

      if (isPostgresConfigured()) {
        try {
          await db
            .update(profiles)
            .set({
              passwordHash: user.passwordHash,
              mustChangePassword: true,
              tempPasswordHint: user.tempPasswordHint,
              updatedAt: now,
            })
            .where(eq(profiles.id, user.id));
        } catch {}
      }
    }
  }

  if (isPostgresConfigured()) {
    try {
      await db
        .update(passwordRecoveryRequests)
        .set({
          status,
          recoveryCode: code,
          resolvedAt: now,
        })
        .where(eq(passwordRecoveryRequests.id, current.id));
    } catch {}
  }

  return { success: true };
}

// ----------------- TEST ASSIGNMENTS -----------------

export async function getAllTestAssignments(): Promise<TestAssignmentRecord[]> {
  await ensureAuthSeeded();
  return Array.from(memTestAssignments.values()).map((r) => ({
    id: r.id,
    testId: r.testId,
    courseId: r.courseId || undefined,
    visibility: (r.visibility as 'PUBLIC' | 'ASSIGNED_ONLY') || 'PUBLIC',
    assignedByUserId: r.assignedByUserId,
    assignedTeacherIds: parseJsonSafe<string[]>(r.assignedTeacherIdsJson, []),
    assignedBatchIds: parseJsonSafe<string[]>(r.assignedBatchIdsJson, []),
    assignedStudentIds: parseJsonSafe<string[]>(r.assignedStudentIdsJson, []),
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
  }));
}

export async function upsertTestAssignment(params: {
  testId: string;
  courseId?: string;
  visibility?: 'PUBLIC' | 'ASSIGNED_ONLY';
  assignedTeacherIds?: string[];
  assignedBatchIds?: string[];
  assignedStudentIds?: string[];
  dueDate?: string | null;
  actor: AuthProfile;
}): Promise<TestAssignmentRecord> {
  await ensureAuthSeeded();
  const id = `assign-${params.testId}`;
  const now = new Date();

  const row: typeof testAssignments.$inferSelect = {
    id,
    testId: params.testId,
    courseId: params.courseId || 'course_jee',
    visibility: params.visibility || 'ASSIGNED_ONLY',
    assignedByUserId: params.actor.id,
    assignedTeacherIdsJson: JSON.stringify(params.assignedTeacherIds || []),
    assignedBatchIdsJson: JSON.stringify(params.assignedBatchIds || []),
    assignedStudentIdsJson: JSON.stringify(params.assignedStudentIds || []),
    dueDate: params.dueDate ? new Date(params.dueDate) : null,
    createdAt: now,
  };

  memTestAssignments.set(id, row);
  if (isPostgresConfigured()) {
    try {
      await db
        .insert(testAssignments)
        .values(row)
        .onConflictDoUpdate({
          target: testAssignments.id,
          set: {
            visibility: row.visibility,
            assignedBatchIdsJson: row.assignedBatchIdsJson,
            assignedStudentIdsJson: row.assignedStudentIdsJson,
            dueDate: row.dueDate,
          },
        });
    } catch {}
  }

  return {
    id: row.id,
    testId: row.testId,
    courseId: row.courseId || undefined,
    visibility: row.visibility as any,
    assignedByUserId: row.assignedByUserId,
    assignedTeacherIds: params.assignedTeacherIds || [],
    assignedBatchIds: params.assignedBatchIds || [],
    assignedStudentIds: params.assignedStudentIds || [],
    dueDate: params.dueDate || null,
    createdAt: now.toISOString(),
  };
}

// ----------------- COURSES & ENROLLMENTS -----------------

export async function getAllCourses(): Promise<CourseRecord[]> {
  await ensureAuthSeeded();
  return Array.from(memCourses.values()).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type as CourseType,
    description: c.description || '',
    active: c.active,
    createdAt: c.createdAt ? c.createdAt.toISOString() : new Date().toISOString(),
  }));
}

export async function getAllEnrollments(): Promise<EnrollmentRecord[]> {
  await ensureAuthSeeded();
  const studentMap = new Map<string, { fullName: string; studentId?: string | null }>();
  for (const p of memProfiles.values()) {
    studentMap.set(p.id, { fullName: p.fullName, studentId: p.studentId });
  }

  return Array.from(memEnrollments.values()).map((e) => {
    const stu = studentMap.get(e.studentId);
    return {
      id: e.id,
      studentId: e.studentId,
      studentName: stu?.fullName,
      studentCode: stu?.studentId,
      courseId: e.courseId,
      courseType: e.courseType as CourseType,
      status: e.status as EnrollmentStatus,
      assignedBy: e.assignedBy,
      createdAt: e.createdAt ? e.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: e.updatedAt ? e.updatedAt.toISOString() : new Date().toISOString(),
    };
  });
}

export async function updateStudentCourseEnrollment(params: {
  studentId: string;
  courseType: CourseType;
  enrollmentStatus: EnrollmentStatus;
  includeJeeAdvanced?: boolean;
  actor: AuthProfile;
}): Promise<{ success: boolean; error?: string; profile?: AuthProfile }> {
  await ensureAuthSeeded();
  const student = memProfiles.get(params.studentId);
  if (!student) return { success: false, error: 'Student not found.' };

  const examCategory: ExamType = params.courseType === 'NEET' ? 'NEET' : 'JEE_MAIN';
  const resolved = resolveCourseFromExam(examCategory);

  const assignedCourses: CourseType[] =
    params.includeJeeAdvanced && resolved.courseType === 'JEE'
      ? ['JEE', 'JEE_ADVANCED']
      : resolved.assignedCourses;

  const now = new Date();
  student.examCategory = examCategory;
  student.courseId = resolved.courseId;
  student.courseType = resolved.courseType;
  student.enrollmentStatus = params.enrollmentStatus;
  student.assignedCoursesJson = JSON.stringify(assignedCourses);
  student.subjectAccessJson = JSON.stringify(resolved.defaultSubjects);
  student.updatedAt = now;
  memProfiles.set(student.id, student);

  // Update in-memory enrollments
  for (const cType of assignedCourses) {
    const cId = cType === 'NEET' ? 'course_neet' : cType === 'JEE_ADVANCED' ? 'course_jee_adv' : 'course_jee';
    const enrId = `enr-${params.studentId}-${cId}`;
    memEnrollments.set(enrId, {
      id: enrId,
      studentId: params.studentId,
      courseId: cId,
      courseType: cType,
      status: params.enrollmentStatus,
      assignedBy: params.actor.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (params.enrollmentStatus !== 'ACTIVE') {
    await revokeAllUserSessions(params.studentId);
  }

  if (isPostgresConfigured()) {
    try {
      await db
        .update(profiles)
        .set({
          examCategory,
          courseId: resolved.courseId,
          courseType: resolved.courseType,
          enrollmentStatus: params.enrollmentStatus,
          assignedCoursesJson: JSON.stringify(assignedCourses),
          subjectAccessJson: JSON.stringify(resolved.defaultSubjects),
          updatedAt: now,
        })
        .where(eq(profiles.id, params.studentId));
    } catch {}
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'UPDATE_COURSE_ENROLLMENT',
    target: params.studentId,
    details: `Course: ${assignedCourses.join(' + ')}, Status: ${params.enrollmentStatus}`,
  });

  const updated = await getProfileById(params.studentId);
  return { success: true, profile: updated || undefined };
}

// ----------------- STUDY MATERIALS -----------------

export async function getStudyMaterialsForUser(
  profile?: AuthProfile | null
): Promise<StudyMaterialRecord[]> {
  await ensureAuthSeeded();
  const list = Array.from(memStudyMaterials.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const mapped: StudyMaterialRecord[] = list.map((r) => ({
    id: r.id,
    courseId: r.courseId,
    courseType: r.courseType as CourseType,
    subject: r.subject as SubjectName,
    chapter: r.chapter,
    title: r.title,
    materialType: (r.materialType as StudyMaterialRecord['materialType']) || 'NOTES',
    description: r.description || '',
    contentBody: r.contentBody || '',
    createdBy: r.createdBy,
    createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
  }));

  if (!profile) return [];
  if (profile.role === 'ADMIN') return mapped;

  const allowedCourseIds = new Set(getAuthorizedCourseIds(profile));
  const allowedCourseTypes = new Set(getAuthorizedCourseTypes(profile));

  return mapped.filter(
    (m) => allowedCourseIds.has(m.courseId) || allowedCourseTypes.has(m.courseType)
  );
}

export async function createStudyMaterialRecord(params: {
  courseType: CourseType;
  subject: SubjectName;
  chapter: string;
  title: string;
  materialType: StudyMaterialRecord['materialType'];
  description: string;
  contentBody: string;
  actor: AuthProfile;
}): Promise<StudyMaterialRecord> {
  await ensureAuthSeeded();
  const courseId =
    params.courseType === 'NEET'
      ? 'course_neet'
      : params.courseType === 'JEE_ADVANCED'
      ? 'course_jee_adv'
      : 'course_jee';

  const id = `mat-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date();

  const row: typeof studyMaterials.$inferSelect = {
    id,
    courseId,
    courseType: params.courseType,
    subject: params.subject,
    chapter: params.chapter.trim(),
    title: params.title.trim(),
    materialType: params.materialType || 'NOTES',
    description: params.description.trim(),
    contentBody: params.contentBody.trim(),
    createdBy: params.actor.id,
    createdAt: now,
  };

  memStudyMaterials.set(id, row);
  if (isPostgresConfigured()) {
    try {
      await db.insert(studyMaterials).values(row);
    } catch {}
  }

  await createAuditLog({
    actorId: params.actor.id,
    actorName: params.actor.fullName,
    actorRole: params.actor.role,
    action: 'CREATE_STUDY_MATERIAL',
    target: params.title,
    details: `Course: ${params.courseType} (${params.subject} - ${params.chapter})`,
  });

  return {
    id,
    courseId,
    courseType: params.courseType,
    subject: params.subject,
    chapter: params.chapter.trim(),
    title: params.title.trim(),
    materialType: params.materialType || 'NOTES',
    description: params.description.trim(),
    contentBody: params.contentBody.trim(),
    createdBy: params.actor.id,
    createdAt: now.toISOString(),
  };
}

export async function deleteStudyMaterialRecord(id: string): Promise<void> {
  memStudyMaterials.delete(id);
  if (isPostgresConfigured()) {
    try {
      await db.delete(studyMaterials).where(eq(studyMaterials.id, id));
    } catch {}
  }
}

// ----------------- FIREBASE INTEGRATION -----------------

export async function getOrCreateFirebaseProfile(params: {
  uid: string;
  email: string;
  displayName?: string;
  preferredRole?: UserRole;
  preferredCourse?: CourseType;
}): Promise<{ profile: AuthProfile; sessionToken: string }> {
  await ensureAuthSeeded();
  const normalizedEmail = (params.email || `${params.uid}@firebase.user`).toLowerCase().trim();
  const isOwnerAdmin = normalizedEmail === 'ramvvdav@gmail.com';
  const targetRole: UserRole = params.preferredRole || (isOwnerAdmin ? 'ADMIN' : 'STUDENT');
  const resolvedCourse = resolveCourseFromExam(params.preferredCourse || 'JEE');

  let existing = memProfiles.get(params.uid);
  if (!existing) {
    for (const p of memProfiles.values()) {
      if (p.email?.toLowerCase() === normalizedEmail) {
        existing = p;
        break;
      }
    }
  }

  let profileId = params.uid;
  const now = new Date();

  if (existing) {
    profileId = existing.id;
    existing.lastLogin = now;
    existing.updatedAt = now;
    memProfiles.set(existing.id, existing);
  } else {
    const generatedStuId =
      targetRole === 'STUDENT'
        ? await generateUniqueStudentId(resolvedCourse.courseType === 'NEET' ? 'NEET' : 'JEE_MAIN')
        : null;

    const newProfile: typeof profiles.$inferSelect = {
      id: profileId,
      username: normalizedEmail.split('@')[0],
      email: normalizedEmail,
      fullName: params.displayName || normalizedEmail.split('@')[0] || 'Candidate',
      passwordHash: hashPassword(`Firebase#${params.uid.slice(0, 10)}!9`),
      role: targetRole,
      studentId: generatedStuId,
      teacherId: targetRole === 'STUDENT' ? 'usr-teacher-hcverma' : null,
      batchId: targetRole === 'STUDENT' ? 'batch-jee-main-2027-m' : null,
      className: targetRole === 'ADMIN' ? 'Administration' : 'Class 12',
      examCategory: resolvedCourse.courseType === 'NEET' ? 'NEET' : 'JEE_MAIN',
      courseId: resolvedCourse.courseId,
      courseType: resolvedCourse.courseType,
      enrollmentStatus: 'ACTIVE',
      assignedCoursesJson: JSON.stringify(
        targetRole === 'ADMIN' ? ['JEE', 'JEE_ADVANCED', 'NEET'] : resolvedCourse.assignedCourses
      ),
      targetYear: 2026,
      subjectAccessJson: JSON.stringify(
        targetRole === 'ADMIN'
          ? ['Physics', 'Chemistry', 'Mathematics', 'Botany', 'Zoology']
          : resolvedCourse.defaultSubjects
      ),
      testAccessJson: JSON.stringify(targetRole === 'ADMIN' ? ['ALL'] : []),
      teacherPermissionsJson: JSON.stringify(DEFAULT_TEACHER_PERMS),
      status: 'ACTIVE',
      mustChangePassword: false,
      tempPasswordHint: null,
      expiresAt: null,
      lastLogin: now,
      createdAt: now,
      updatedAt: now,
    };
    memProfiles.set(profileId, newProfile);

    if (targetRole === 'STUDENT') {
      const enrId = `enr-${profileId}-${resolvedCourse.courseId}`;
      memEnrollments.set(enrId, {
        id: enrId,
        studentId: profileId,
        courseId: resolvedCourse.courseId,
        courseType: resolvedCourse.courseType,
        status: 'ACTIVE',
        assignedBy: 'usr-admin-01',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Create session token
  const rawToken = `sess_${crypto.randomBytes(24).toString('hex')}`;
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const sessionRow: typeof authSessions.$inferSelect = {
    id: `sid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    tokenHash,
    userId: profileId,
    role: existing?.role || targetRole,
    userAgent: 'Firebase Google Auth',
    ipAddress: '127.0.0.1',
    rememberMe: true,
    expiresAt,
    revoked: false,
    createdAt: now,
  };
  memAuthSessions.set(tokenHash, sessionRow);

  const fullProfile = await getProfileById(profileId);
  return {
    profile: fullProfile!,
    sessionToken: rawToken,
  };
}
