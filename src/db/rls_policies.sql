-- ============================================================================
-- NTA PULSE — PRODUCTION POSTGRESQL / SUPABASE ROW LEVEL SECURITY (RLS)
-- Enforces strict course-based access control at the database engine level.
-- Conceptually:
--   Student -> Authenticated User -> Profile -> Active Enrollment -> Course -> Allowed Data
-- ============================================================================

-- 1. Enable Row Level Security across all course-scoped & sensitive tables
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;

-- 2. Helper SQL Functions for Current Session User & Authorized Course IDs
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), ''),
    NULLIF(current_setting('request.jwt.claim.sub', true), '')
  );
$$;

CREATE OR REPLACE FUNCTION app_current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT role FROM profiles WHERE id = app_current_user_id() AND status = 'ACTIVE' LIMIT 1;
$$;

-- Returns the set of active course_ids ('course_jee', 'course_jee_adv', 'course_neet')
-- that the currently authenticated student or teacher is authorized to access.
CREATE OR REPLACE FUNCTION app_authorized_course_ids()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
AS $$
  -- 1. Active student enrollments from the enrollments table
  SELECT e.course_id
  FROM enrollments e
  JOIN profiles p ON p.id = e.student_id
  WHERE e.student_id = app_current_user_id()
    AND e.status = 'ACTIVE'
    AND p.status = 'ACTIVE'
    AND p.enrollment_status = 'ACTIVE'
  UNION
  -- 2. Fallback to primary profile course_id if active
  SELECT p.course_id
  FROM profiles p
  WHERE p.id = app_current_user_id()
    AND p.status = 'ACTIVE'
    AND p.enrollment_status = 'ACTIVE';
$$;

-- 3. COURSES TABLE POLICIES
DROP POLICY IF EXISTS courses_select_policy ON courses;
CREATE POLICY courses_select_policy ON courses
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR id IN (SELECT app_authorized_course_ids())
  );

-- 4. ENROLLMENTS TABLE POLICIES
-- Students can ONLY read their own enrollments; Admins & Teachers manage enrollments.
DROP POLICY IF EXISTS enrollments_select_policy ON enrollments;
CREATE POLICY enrollments_select_policy ON enrollments
  FOR SELECT
  USING (
    app_current_user_role() IN ('ADMIN', 'TEACHER')
    OR student_id = app_current_user_id()
  );

DROP POLICY IF EXISTS enrollments_write_policy ON enrollments;
CREATE POLICY enrollments_write_policy ON enrollments
  FOR ALL
  USING (app_current_user_role() IN ('ADMIN', 'TEACHER'))
  WITH CHECK (app_current_user_role() IN ('ADMIN', 'TEACHER'));

-- 5. QUESTIONS TABLE POLICIES (Strict Course Isolation: question.course_id = student's enrolled course)
-- A JEE student querying NEET questions directly receives 0 rows.
DROP POLICY IF EXISTS questions_course_isolation_select ON questions;
CREATE POLICY questions_course_isolation_select ON questions
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR (
      app_current_user_role() = 'TEACHER'
      AND course_id IN (SELECT app_authorized_course_ids())
    )
    OR (
      app_current_user_role() = 'STUDENT'
      AND status = 'PUBLISHED'
      AND course_id IN (SELECT app_authorized_course_ids())
    )
  );

DROP POLICY IF EXISTS questions_staff_write ON questions;
CREATE POLICY questions_staff_write ON questions
  FOR ALL
  USING (
    app_current_user_role() = 'ADMIN'
    OR (
      app_current_user_role() = 'TEACHER'
      AND course_id IN (SELECT app_authorized_course_ids())
    )
  );

-- 6. TESTS TABLE POLICIES (Strict Course Isolation: test.course_id = student's enrolled course)
DROP POLICY IF EXISTS tests_course_isolation_select ON tests;
CREATE POLICY tests_course_isolation_select ON tests
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR (
      app_current_user_role() = 'TEACHER'
      AND course_id IN (SELECT app_authorized_course_ids())
    )
    OR (
      app_current_user_role() = 'STUDENT'
      AND published = TRUE
      AND course_id IN (SELECT app_authorized_course_ids())
    )
  );

-- 7. STUDY MATERIALS TABLE POLICIES (Strict Course Isolation)
DROP POLICY IF EXISTS study_materials_course_isolation_select ON study_materials;
CREATE POLICY study_materials_course_isolation_select ON study_materials
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR course_id IN (SELECT app_authorized_course_ids())
  );

-- 8. ANNOUNCEMENTS TABLE POLICIES (Course-Scoped)
DROP POLICY IF EXISTS announcements_course_isolation_select ON announcements;
CREATE POLICY announcements_course_isolation_select ON announcements
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR course_id = 'ALL'
    OR course_id IN (SELECT app_authorized_course_ids())
  );

-- 9. TEST ATTEMPTS / RESULTS TABLE POLICIES (Student Ownership + Course Isolation)
-- Students can ONLY read and insert their own attempts for their enrolled course.
DROP POLICY IF EXISTS attempts_student_course_select ON test_attempts;
CREATE POLICY attempts_student_course_select ON test_attempts
  FOR SELECT
  USING (
    app_current_user_role() = 'ADMIN'
    OR (
      app_current_user_role() = 'TEACHER'
      AND course_id IN (SELECT app_authorized_course_ids())
    )
    OR (
      app_current_user_role() = 'STUDENT'
      AND user_id = app_current_user_id()
      AND course_id IN (SELECT app_authorized_course_ids())
    )
  );

DROP POLICY IF EXISTS attempts_student_course_insert ON test_attempts;
CREATE POLICY attempts_student_course_insert ON test_attempts
  FOR INSERT
  WITH CHECK (
    user_id = app_current_user_id()
    AND course_id IN (SELECT app_authorized_course_ids())
  );
