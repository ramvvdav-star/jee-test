import React, { useState, useMemo } from 'react';
import { useExam } from '../context/ExamContext';
import { TeacherPermissions, CourseType, EnrollmentStatus } from '../types/auth';
import { ExamType } from '../types/exam';
import {
  Users,
  UserCheck,
  GraduationCap,
  ShieldCheck,
  UserPlus,
  Search,
  KeyRound,
  LogOut,
  Trash2,
  Layers,
  Bell,
  Settings,
  Check,
  Copy,
  BookOpen,
} from 'lucide-react';

export const AdminRbacControlPanel: React.FC = () => {
  const {
    managedUsers,
    batches,
    tests,
    totalQuestionsInBank,
    allAttempts,
    announcements,
    recoveryRequests,
    studentIdConfig,
    enrollments,
    createTeacher,
    createStudent,
    updateUserAccount,
    updateStudentEnrollment,
    deleteUserAccount,
    resetUserPassword,
    revokeUserSessions,
    createBatch,
    deleteBatch,
    publishAnnouncement,
    removeAnnouncement,
    resolveRecovery,
    saveStudentIdConfig,
  } = useExam();

  const [subTab, setSubTab] = useState<
    | 'enrollments'
    | 'users'
    | 'teachers'
    | 'students'
    | 'batches'
    | 'id-config'
    | 'announcements'
    | 'recovery'
  >('enrollments');

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'ADMIN' | 'TEACHER' | 'STUDENT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [courseFilter, setCourseFilter] = useState<string>('ALL');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Create Teacher Form State
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [teacherUsername, setTeacherUsername] = useState('');
  const [teacherPassword, setTeacherPassword] = useState('Teacher@2026!');
  const [teacherExam, setTeacherExam] = useState<ExamType>('JEE_MAIN');
  const [teacherAssignedCourses, setTeacherAssignedCourses] = useState<CourseType[]>(['JEE']);
  const [teacherPerms, setTeacherPerms] = useState<TeacherPermissions>({
    canCreateTests: true,
    canCreateQuestions: true,
    canUploadQuestions: true,
    canEditQuestions: true,
    canManageBatches: true,
    canResetStudentPasswords: true,
    canViewAllStudents: false,
    assignedCourses: ['JEE'],
  });

  // Create Student Form State
  const [stuName, setStuName] = useState('');
  const [stuExam, setStuExam] = useState<ExamType>('JEE_MAIN');
  const [stuIncludeAdv, setStuIncludeAdv] = useState(false);
  const [stuTeacherId, setStuTeacherId] = useState('usr-teacher-hcverma');
  const [stuBatchId, setStuBatchId] = useState('batch-jee-main-2027-m');
  const [stuClass, setStuClass] = useState('Class 12');
  const [stuFormat, setStuFormat] = useState<'SEQUENTIAL' | 'ALPHANUMERIC'>('SEQUENTIAL');
  const [stuPass, setStuPass] = useState('');
  const [generatedSlip, setGeneratedSlip] = useState<{
    name: string;
    studentId: string;
    tempPass: string;
    course: string;
  } | null>(null);
  const [copiedSlip, setCopiedSlip] = useState(false);

  // Batch Form State
  const [batchName, setBatchName] = useState('');
  const [batchDesc, setBatchDesc] = useState('');
  const [batchExam, setBatchExam] = useState<ExamType>('JEE_MAIN');
  const [batchTeacherId, setBatchTeacherId] = useState('usr-teacher-hcverma');

  // ID Prefix Config State
  const [jeePrefix, setJeePrefix] = useState(studentIdConfig?.jeeMainPrefix || 'JEE26');
  const [advPrefix, setAdvPrefix] = useState(studentIdConfig?.jeeAdvancedPrefix || 'JADV26');
  const [neetPrefix, setNeetPrefix] = useState(studentIdConfig?.neetPrefix || 'NEET26');
  const [idMode, setIdMode] = useState<'SEQUENTIAL' | 'ALPHANUMERIC'>(
    studentIdConfig?.mode || 'SEQUENTIAL'
  );

  // Announcement State
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annCourse, setAnnCourse] = useState<CourseType | 'ALL'>('JEE');
  const [annAudience, setAnnAudience] = useState<'ALL' | 'TEACHERS' | 'STUDENTS'>('STUDENTS');
  const [annPriority, setAnnPriority] = useState<'NORMAL' | 'IMPORTANT' | 'URGENT'>('URGENT');

  const teachersList = useMemo(
    () => managedUsers.filter((u) => u.role === 'TEACHER'),
    [managedUsers]
  );
  const studentsList = useMemo(
    () => managedUsers.filter((u) => u.role === 'STUDENT'),
    [managedUsers]
  );

  const activeTeachersCount = teachersList.filter((t) => t.status === 'ACTIVE').length;
  const activeStudentsCount = studentsList.filter((s) => s.status === 'ACTIVE').length;

  const filteredUsers = useMemo(() => {
    return managedUsers.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
      if (courseFilter !== 'ALL') {
        const hasCourse =
          u.courseType === courseFilter || (u.assignedCourses || []).includes(courseFilter as CourseType);
        if (!hasCourse) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = u.fullName.toLowerCase().includes(q);
        const matchEmail = u.email?.toLowerCase().includes(q);
        const matchId = u.studentId?.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchId) return false;
      }
      return true;
    });
  }, [managedUsers, roleFilter, statusFilter, courseFilter, searchQuery]);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const toggleTeacherCourseSelection = (course: CourseType) => {
    setTeacherAssignedCourses((prev) => {
      const exists = prev.includes(course);
      const next = exists ? prev.filter((c) => c !== course) : [...prev, course];
      const finalCourses = next.length > 0 ? next : ([course] as CourseType[]);
      setTeacherPerms((p) => ({ ...p, assignedCourses: finalCourses }));
      return finalCourses;
    });
  };

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await createTeacher({
      fullName: teacherName,
      email: teacherEmail,
      username: teacherUsername || undefined,
      password: teacherPassword,
      examCategory: teacherExam,
      assignedCourses: teacherAssignedCourses,
      teacherPermissions: {
        ...teacherPerms,
        assignedCourses: teacherAssignedCourses,
      },
    });
    if (res.success) {
      setTeacherName('');
      setTeacherEmail('');
      setTeacherUsername('');
      showToast(
        `Created teacher account for ${teacherName} assigned to [${teacherAssignedCourses.join(', ')}]`
      );
    } else {
      showToast(`Error: ${res.error}`);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const assignedCourses: CourseType[] =
      stuExam === 'NEET'
        ? ['NEET']
        : stuExam === 'JEE_ADVANCED' || stuIncludeAdv
        ? ['JEE', 'JEE_ADVANCED']
        : ['JEE'];
    const res = await createStudent({
      fullName: stuName,
      examCategory: stuExam,
      assignedCourses,
      teacherId: stuTeacherId,
      batchId: stuBatchId || null,
      className: stuClass,
      idFormat: stuFormat,
      initialPassword: stuPass.trim() || undefined,
    });
    if (res.success) {
      setGeneratedSlip({
        name: stuName,
        studentId: res.generatedStudentId || '',
        tempPass: res.temporaryPassword || '',
        course: assignedCourses.join(' + '),
      });
      setStuName('');
      setStuPass('');
      showToast(
        `Enrolled ${stuName} in ${assignedCourses.join(' + ')} (Student ID: ${res.generatedStudentId})`
      );
    } else {
      showToast(`Error: ${res.error}`);
    }
  };

  const handleQuickCourseSwitch = async (
    studentId: string,
    studentName: string,
    selection: 'JEE' | 'JEE_BOTH' | 'NEET',
    currentStatus: EnrollmentStatus
  ) => {
    const courseType: CourseType = selection === 'NEET' ? 'NEET' : 'JEE';
    const includeJeeAdvanced = selection === 'JEE_BOTH';
    const res = await updateStudentEnrollment({
      studentId,
      courseType,
      enrollmentStatus: currentStatus || 'ACTIVE',
      includeJeeAdvanced,
    });
    if (res.success) {
      showToast(
        `Updated ${studentName}'s course enrollment to ${
          includeJeeAdvanced ? 'JEE + JEE Advanced' : courseType
        }. All permissions & dashboard updated automatically!`
      );
    } else {
      showToast(`Error: ${res.error}`);
    }
  };

  const handleQuickEnrollmentStatus = async (
    studentId: string,
    studentName: string,
    courseType: CourseType,
    includeJeeAdvanced: boolean,
    nextStatus: EnrollmentStatus
  ) => {
    const res = await updateStudentEnrollment({
      studentId,
      courseType,
      enrollmentStatus: nextStatus,
      includeJeeAdvanced,
    });
    if (res.success) {
      showToast(`${studentName}'s course enrollment is now ${nextStatus}.`);
    } else {
      showToast(`Error: ${res.error}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Platform-Wide Enterprise Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">Total Students</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{studentsList.length}</div>
          <div className="text-[10px] text-emerald-600">{activeStudentsCount} Active</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">JEE Enrolled</div>
          <div className="text-xl font-black text-indigo-600 mt-0.5">
            {studentsList.filter((s) => (s.assignedCourses || []).includes('JEE')).length}
          </div>
          <div className="text-[10px] text-slate-500">Main &amp; Adv</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">NEET Enrolled</div>
          <div className="text-xl font-black text-emerald-600 mt-0.5">
            {studentsList.filter((s) => s.courseType === 'NEET').length}
          </div>
          <div className="text-[10px] text-slate-500">Medical UG</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">Total Teachers</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{teachersList.length}</div>
          <div className="text-[10px] text-emerald-600">{activeTeachersCount} Active</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">Active Batches</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{batches.length}</div>
          <div className="text-[10px] text-indigo-600">Course Scoped</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">Mock Tests</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{tests.length}</div>
          <div className="text-[10px] text-slate-500">Published CBT</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">Question Bank</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">
            {totalQuestionsInBank.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500">Course Tagged</div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[11px] text-slate-500 font-semibold">Reset Tickets</div>
          <div className="text-xl font-black text-amber-600 mt-0.5">
            {recoveryRequests.filter((r) => r.status === 'PENDING').length}
          </div>
          <div className="text-[10px] text-slate-500">Pending Action</div>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3.5 rounded-2xl bg-emerald-600 text-white text-xs font-bold flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{actionFeedback}</span>
          </div>
          <button onClick={() => setActionFeedback(null)} className="text-white/80 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200">
        {[
          { id: 'enrollments', label: `Course Enrollments (${enrollments.length})`, icon: BookOpen },
          { id: 'students', label: 'Create & Enroll Student', icon: GraduationCap },
          { id: 'teachers', label: 'Teachers & Course Access', icon: UserCheck },
          { id: 'users', label: 'All Accounts Directory', icon: Users },
          { id: 'batches', label: 'Batches & Classes', icon: Layers },
          { id: 'id-config', label: 'Student ID Generator', icon: Settings },
          { id: 'announcements', label: 'Course Announcements', icon: Bell },
          {
            id: 'recovery',
            label: `Password Recovery (${recoveryRequests.filter((r) => r.status === 'PENDING').length})`,
            icon: KeyRound,
          },
        ].map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                active
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ================= SUBTAB: COURSE ENROLLMENTS MANAGEMENT (SECTION 17) ================= */}
      {subTab === 'enrollments' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-lg font-black text-slate-900">
                Student Course Enrollment Management (JEE / JEE Advanced / NEET)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Assign, switch (`JEE ↔ NEET`), suspend, or reactivate student enrollments. Changing a student&apos;s course immediately updates their API permissions, dashboard, question bank, and mock test access.
              </p>
            </div>
            <button
              onClick={() => setSubTab('students')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <UserPlus className="w-4 h-4" /> Create &amp; Enroll Student
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Student ID</th>
                  <th className="py-3 px-4">Active Course Enrollment</th>
                  <th className="py-3 px-4">Enrollment Status</th>
                  <th className="py-3 px-4">Change Course (Instant Re-Provision)</th>
                  <th className="py-3 px-4 text-right">Suspend / Reactivate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {studentsList.map((stu) => {
                  const hasAdv = (stu.assignedCourses || []).includes('JEE_ADVANCED');
                  const currentSelectValue =
                    stu.courseType === 'NEET'
                      ? 'NEET'
                      : hasAdv
                      ? 'JEE_BOTH'
                      : 'JEE';
                  const isSuspended = stu.enrollmentStatus === 'SUSPENDED' || stu.status === 'SUSPENDED';

                  return (
                    <tr key={stu.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{stu.fullName}</div>
                        <div className="text-[11px] text-slate-500">{stu.className || 'Class 12'}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-mono font-bold text-slate-800 border border-slate-200">
                          {stu.studentId}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {(stu.assignedCourses || [stu.courseType]).map((c) => (
                            <span
                              key={c}
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                c === 'NEET'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : c === 'JEE_ADVANCED'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                              }`}
                            >
                              {c === 'JEE' ? 'JEE (Main)' : c === 'JEE_ADVANCED' ? 'JEE Advanced' : 'NEET UG'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            !isSuspended
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {isSuspended ? 'SUSPENDED' : stu.enrollmentStatus || 'ACTIVE'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          value={currentSelectValue}
                          onChange={(e) =>
                            handleQuickCourseSwitch(
                              stu.id,
                              stu.fullName,
                              e.target.value as 'JEE' | 'JEE_BOTH' | 'NEET',
                              stu.enrollmentStatus || 'ACTIVE'
                            )
                          }
                          className="py-1.5 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
                        >
                          <option value="JEE">Course: JEE (Main Only)</option>
                          <option value="JEE_BOTH">Course: JEE + JEE Advanced</option>
                          <option value="NEET">Course: NEET UG</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isSuspended ? (
                          <button
                            onClick={() =>
                              handleQuickEnrollmentStatus(
                                stu.id,
                                stu.fullName,
                                stu.courseType === 'NEET' ? 'NEET' : 'JEE',
                                hasAdv,
                                'ACTIVE'
                              )
                            }
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                          >
                            Reactivate Enrollment
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              handleQuickEnrollmentStatus(
                                stu.id,
                                stu.fullName,
                                stu.courseType === 'NEET' ? 'NEET' : 'JEE',
                                hasAdv,
                                'SUSPENDED'
                              )
                            }
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer"
                          >
                            Suspend Enrollment
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= SUBTAB: ALL USERS DIRECTORY ================= */}
      {subTab === 'users' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-5 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-slate-900">
                Master Accounts &amp; Role Access Directory
              </h3>
              <p className="text-xs text-slate-500">
                Manage credentials, account status, and session security across all roles.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, Student ID, email..."
                  className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs"
                />
              </div>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="py-1.5 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold"
              >
                <option value="ALL">All Roles</option>
                <option value="ADMIN">Admins</option>
                <option value="TEACHER">Teachers</option>
                <option value="STUDENT">Students</option>
              </select>

              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="py-1.5 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold"
              >
                <option value="ALL">All Courses</option>
                <option value="JEE">JEE</option>
                <option value="JEE_ADVANCED">JEE Advanced</option>
                <option value="NEET">NEET</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="py-1.5 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Login Identifier</th>
                  <th className="py-3 px-4">Authorized Course(s)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-bold text-slate-900">{u.fullName}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          u.role === 'ADMIN'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'TEACHER'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700">
                      {u.role === 'STUDENT' ? u.studentId : u.email}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-800">
                      {u.role === 'ADMIN'
                        ? 'ALL (JEE, JEE_ADV, NEET)'
                        : (u.assignedCourses || [u.courseType]).join(', ')}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={u.status}
                        disabled={u.role === 'ADMIN'}
                        onChange={async (e) => {
                          const nextStatus = e.target.value as any;
                          await updateUserAccount(u.id, { status: nextStatus });
                          showToast(`Updated ${u.fullName} status to ${nextStatus}`);
                        }}
                        className="py-1 px-2 rounded-lg border border-slate-200 text-[11px] font-bold bg-white"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                        <option value="DISABLED">DISABLED</option>
                        <option value="EXPIRED">EXPIRED</option>
                      </select>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={async () => {
                            const temp =
                              u.role === 'STUDENT' ? 'Welcome@123' : 'Teacher@2026!';
                            await resetUserPassword(u.id, temp, true);
                            showToast(
                              `Reset password for ${u.fullName} to "${temp}" (Must change on next login)`
                            );
                          }}
                          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                          title="Reset Password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            const c = await revokeUserSessions(u.id);
                            showToast(`Revoked ${c} active session(s) for ${u.fullName}`);
                          }}
                          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-amber-600 cursor-pointer"
                          title="Force Logout Sessions"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                        {u.role !== 'ADMIN' && (
                          <button
                            onClick={async () => {
                              await deleteUserAccount(u.id);
                              showToast(`Deleted user ${u.fullName}`);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 text-rose-600 cursor-pointer"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= SUBTAB: TEACHERS & COURSE PERMISSIONS (SECTION 15) ================= */}
      {subTab === 'teachers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleCreateTeacher}
            className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs"
          >
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-600" />
                Create Teacher &amp; Assign Course
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Teachers only receive access to the courses (JEE, JEE Advanced, or NEET) assigned to them.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="e.g. Prof. S.K. Mishra"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Official Email
                </label>
                <input
                  type="email"
                  required
                  value={teacherEmail}
                  onChange={(e) => setTeacherEmail(e.target.value)}
                  placeholder="skmishra@ntapulse.edu.in"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Initial Password
                </label>
                <input
                  type="text"
                  required
                  value={teacherPassword}
                  onChange={(e) => setTeacherPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1.5">
                  Assigned Courses (Teacher Course Scope)
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['JEE', 'JEE_ADVANCED', 'NEET'] as CourseType[]).map((c) => {
                    const active = teacherAssignedCourses.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleTeacherCourseSelection(c)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
            >
              Provision Teacher Account
            </button>
          </form>

          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h3 className="text-base font-black text-slate-900">
              Faculty Directory &amp; Course Assignments ({teachersList.length})
            </h3>
            <div className="space-y-3">
              {teachersList.map((t) => (
                <div
                  key={t.id}
                  className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{t.fullName}</div>
                      <div className="text-xs text-slate-500 font-mono">{t.email}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(['JEE', 'JEE_ADVANCED', 'NEET'] as CourseType[]).map((c) => {
                        const hasCourse = (t.assignedCourses || []).includes(c);
                        return (
                          <button
                            key={c}
                            onClick={async () => {
                              const current = t.assignedCourses || [];
                              const next = hasCourse
                                ? current.filter((item) => item !== c)
                                : [...current, c];
                              if (next.length === 0) return;
                              await updateUserAccount(t.id, {
                                assignedCourses: next,
                                courseType: next[0],
                                teacherPermissions: {
                                  ...t.teacherPermissions,
                                  assignedCourses: next,
                                },
                              });
                              showToast(
                                `Updated ${t.fullName}'s assigned courses to [${next.join(', ')}]`
                              );
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border cursor-pointer ${
                              hasCourse
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= SUBTAB: CREATE & ENROLL STUDENT ================= */}
      {subTab === 'students' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleCreateStudent}
            className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs"
          >
            <div>
              <h3 className="text-base font-black text-slate-900">
                Create Student &amp; Assign Course Enrollment
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Generates a unique Student ID (`JEE26-...` or `NEET26-...`) linked directly to their enrolled course.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Student Full Name
                </label>
                <input
                  type="text"
                  required
                  value={stuName}
                  onChange={(e) => setStuName(e.target.value)}
                  placeholder="e.g. Rohan Sharma"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Enrolled Course
                  </label>
                  <select
                    value={stuExam}
                    onChange={(e) => setStuExam(e.target.value as ExamType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                  >
                    <option value="JEE_MAIN">Course: JEE (Main)</option>
                    <option value="JEE_ADVANCED">Course: JEE + JEE Advanced</option>
                    <option value="NEET">Course: NEET UG</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Class / Cohort
                  </label>
                  <select
                    value={stuClass}
                    onChange={(e) => setStuClass(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                  >
                    <option value="Class 11">Class 11</option>
                    <option value="Class 12">Class 12</option>
                    <option value="Dropper / Repeater">Dropper / Repeater</option>
                  </select>
                </div>
              </div>

              {stuExam === 'JEE_MAIN' && (
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stuIncludeAdv}
                    onChange={(e) => setStuIncludeAdv(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  Also enroll in JEE Advanced course content
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Assign Faculty Mentor
                  </label>
                  <select
                    value={stuTeacherId}
                    onChange={(e) => setStuTeacherId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                  >
                    {teachersList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName} ({(t.assignedCourses || []).join('/')})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Student ID Format
                  </label>
                  <select
                    value={stuFormat}
                    onChange={(e) => setStuFormat(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                  >
                    <option value="SEQUENTIAL">Sequential (e.g. JEE26-10004)</option>
                    <option value="ALPHANUMERIC">Alphanumeric (e.g. JEE26-9X2K1)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Optional Custom Temporary Password
                </label>
                <input
                  type="text"
                  value={stuPass}
                  onChange={(e) => setStuPass(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
            >
              Generate Student ID &amp; Activate Course Enrollment
            </button>
          </form>

          {generatedSlip && (
            <div className="bg-slate-900 text-white rounded-3xl p-6 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
                  New Student Credential Slip
                </span>
                <h4 className="text-lg font-black">{generatedSlip.name}</h4>
                <div className="p-4 rounded-2xl bg-slate-800/90 border border-slate-700 space-y-2 font-mono text-xs">
                  <div>
                    <span className="text-slate-400">Student ID: </span>
                    <strong className="text-emerald-400 text-sm">{generatedSlip.studentId}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Enrolled Course: </span>
                    <strong className="text-indigo-300">{generatedSlip.course}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Temporary Password: </span>
                    <strong className="text-amber-300">{generatedSlip.tempPass}</strong>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `Student ID: ${generatedSlip.studentId} | Course: ${generatedSlip.course} | Temp Password: ${generatedSlip.tempPass}`
                  );
                  setCopiedSlip(true);
                  setTimeout(() => setCopiedSlip(false), 2500);
                }}
                className="w-full py-2.5 bg-white text-slate-900 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedSlip ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copiedSlip ? 'Copied Credentials!' : 'Copy Credential Slip'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================= SUBTAB: BATCHES & CLASSES ================= */}
      {subTab === 'batches' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await createBatch({
                name: batchName,
                description: batchDesc,
                examCategory: batchExam,
                teacherId: batchTeacherId,
              });
              if (ok) {
                setBatchName('');
                setBatchDesc('');
                showToast('Created new academic batch');
              }
            }}
            className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs"
          >
            <h3 className="text-base font-black text-slate-900">Create Academic Batch</h3>
            <input
              type="text"
              required
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="Batch Name (e.g. JEE 2026 Evening Batch)"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
            />
            <select
              value={batchExam}
              onChange={(e) => setBatchExam(e.target.value as ExamType)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
            >
              <option value="JEE_MAIN">JEE (Main)</option>
              <option value="JEE_ADVANCED">JEE Advanced</option>
              <option value="NEET">NEET UG</option>
            </select>
            <select
              value={batchTeacherId}
              onChange={(e) => setBatchTeacherId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
            >
              {teachersList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              value={batchDesc}
              onChange={(e) => setBatchDesc(e.target.value)}
              placeholder="Batch schedule and notes..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
            />
            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              Create Batch
            </button>
          </form>

          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 space-y-3 shadow-xs">
            <h3 className="text-base font-black text-slate-900">Active Batches ({batches.length})</h3>
            {batches.map((b) => (
              <div
                key={b.id}
                className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-sm text-slate-900">{b.name}</div>
                  <div className="text-xs text-slate-500">
                    Course: {b.courseType || b.examCategory} • {b.description}
                  </div>
                </div>
                <button
                  onClick={() => deleteBatch(b.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= SUBTAB: STUDENT ID GENERATOR CONFIG ================= */}
      {subTab === 'id-config' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 max-w-xl shadow-xs">
          <h3 className="text-base font-black text-slate-900">
            Student ID Prefix &amp; Format Configuration
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                JEE Prefix
              </label>
              <input
                type="text"
                value={jeePrefix}
                onChange={(e) => setJeePrefix(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                JEE Adv Prefix
              </label>
              <input
                type="text"
                value={advPrefix}
                onChange={(e) => setAdvPrefix(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                NEET Prefix
              </label>
              <input
                type="text"
                value={neetPrefix}
                onChange={(e) => setNeetPrefix(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-bold"
              />
            </div>
          </div>
          <button
            onClick={async () => {
              await saveStudentIdConfig({
                jeeMainPrefix: jeePrefix,
                jeeAdvancedPrefix: advPrefix,
                neetPrefix,
                mode: idMode,
              });
              showToast('Saved Student ID configuration');
            }}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl cursor-pointer"
          >
            Save Configuration
          </button>
        </div>
      )}

      {/* ================= SUBTAB: COURSE ANNOUNCEMENTS ================= */}
      {subTab === 'announcements' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await publishAnnouncement({
                title: annTitle,
                content: annContent,
                courseType: annCourse,
                targetAudience: annAudience,
                priority: annPriority,
              });
              setAnnTitle('');
              setAnnContent('');
              showToast(`Published announcement to ${annCourse} students`);
            }}
            className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs"
          >
            <h3 className="text-base font-black text-slate-900">Publish Course Announcement</h3>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                Target Course
              </label>
              <select
                value={annCourse}
                onChange={(e) => setAnnCourse(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
              >
                <option value="JEE">JEE Course Only</option>
                <option value="JEE_ADVANCED">JEE Advanced Only</option>
                <option value="NEET">NEET Course Only</option>
                <option value="ALL">All Courses</option>
              </select>
            </div>
            <input
              type="text"
              required
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              placeholder="Announcement Title..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
            />
            <textarea
              rows={3}
              required
              value={annContent}
              onChange={(e) => setAnnContent(e.target.value)}
              placeholder="Announcement details..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
            />
            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              Publish Announcement
            </button>
          </form>

          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 space-y-3 shadow-xs">
            <h3 className="text-base font-black text-slate-900">
              Active Course Announcements ({announcements.length})
            </h3>
            {announcements.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold uppercase">
                      Course: {a.courseType || 'ALL'}
                    </span>
                    <span className="font-bold text-sm text-slate-900">{a.title}</span>
                  </div>
                  <p className="text-xs text-slate-600">{a.content}</p>
                </div>
                <button
                  onClick={() => removeAnnouncement(a.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= SUBTAB: PASSWORD RECOVERY TICKETS ================= */}
      {subTab === 'recovery' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs">
          <h3 className="text-base font-black text-slate-900">
            Student &amp; Staff Password Recovery Queue
          </h3>
          {recoveryRequests.length === 0 ? (
            <p className="text-xs text-slate-500">No recovery requests in queue.</p>
          ) : (
            <div className="space-y-3">
              {recoveryRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex items-center justify-between"
                >
                  <div>
                    <div className="font-bold text-xs text-slate-900">
                      {req.userName} ({req.identifier})
                    </div>
                    <div className="text-[11px] text-slate-500">{req.reason}</div>
                  </div>
                  {req.status === 'PENDING' ? (
                    <button
                      onClick={async () => {
                        await resolveRecovery(req.id, 'Welcome@123');
                        showToast(`Resolved ticket for ${req.userName} (Temp pass: Welcome@123)`);
                      }}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl cursor-pointer"
                    >
                      Approve &amp; Reset to Welcome@123
                    </button>
                  ) : (
                    <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      RESOLVED
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
