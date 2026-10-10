import { db, isPostgresConfigured } from './index.ts';
import {
  questions,
  tests,
  testQuestions,
  questionUsage,
  testAttempts,
  activeExamSessions,
  userBookmarks,
  questionReports,
} from './schema.ts';
import { eq, and, sql, desc } from 'drizzle-orm';
import {
  Question,
  TestDefinition,
  TestAttemptResult,
  ActiveExamSession,
  QuestionErrorReport,
  TestQuestionMapping,
  SubjectName,
  ExamType,
} from '../types/exam';
import { generateQuestionBank } from './questionBankGenerator';
import { SEED_TESTS } from '../data/seedTests';
import {
  normalizeQuestion,
  computeQuestionFingerprint,
  computeConceptKey,
  formatCanonicalQuestionId,
  enrichQuestionRecord,
  getQuestionUsage,
  recordQuestionUsage,
  syncUsageRegistryFromTests,
  deduplicateAndMigrateQuestionBank,
  buildTestQuestionMappings,
} from '../data/questionBankEngine';

// In-memory fast cache synchronized with PostgreSQL canonical Question Bank and usage registry
let cachedQuestions: Question[] = [];
let cachedCount = 0;
let isSeeding = false;

// Resilient in-memory collections for attempts, sessions, bookmarks, reports and custom tests
const memoryTests = new Map<string, TestDefinition>();
const memoryTestQuestions = new Map<string, TestQuestionMapping[]>();
const memoryAttempts: TestAttemptResult[] = [];
const memoryActiveSessions = new Map<string, ActiveExamSession>();
const memoryBookmarks = new Map<string, { bookmarkedQuestionIds: string[]; questionNotes: Record<string, string> }>();
const memoryQuestionReports: QuestionErrorReport[] = [];

for (const t of SEED_TESTS) {
  memoryTests.set(t.id, t);
  if (t.testId) memoryTests.set(t.testId, t);
}


export function getCachedQuestionBank(): Question[] {
  if (cachedQuestions.length === 0) {
    const raw = generateQuestionBank();
    const { canonicalQuestions } = deduplicateAndMigrateQuestionBank(raw);
    cachedQuestions = canonicalQuestions;
    cachedCount = cachedQuestions.length;
    syncUsageRegistryFromTests(SEED_TESTS);
  }
  return cachedQuestions.map((q) => {
    const usage = getQuestionUsage(q.questionId || q.id, q);
    return {
      ...q,
      timesUsed: usage.timesUsed,
      lastUsedAt: usage.lastUsedAt,
      testIds: usage.testIds,
    };
  });
}

function mapDbRowToQuestion(row: typeof questions.$inferSelect): Question {
  let options: Question['options'] = undefined;
  let testIds: string[] = [];

  if (row.optionsJson) {
    try {
      options = JSON.parse(row.optionsJson);
    } catch {}
  }
  if (row.testIdsJson) {
    try {
      testIds = JSON.parse(row.testIdsJson);
    } catch {}
  }

  return enrichQuestionRecord({
    id: row.id,
    questionId: row.id,
    courseId: row.courseId,
    courseType: row.courseType as 'JEE' | 'JEE_ADVANCED' | 'NEET',
    examType: row.examType as ExamType,
    subject: row.subject as SubjectName,
    chapter: row.chapter,
    topic: row.topic,
    difficulty: row.difficulty as Question['difficulty'],
    type: row.type as Question['type'],
    questionText: row.questionText,
    normalizedText: row.normalizedText || normalizeQuestion(row.questionText),
    fingerprint: row.fingerprint || computeQuestionFingerprint(row.questionText, row.subject, row.type),
    conceptKey: row.conceptKey || computeConceptKey(row.questionText, row.subject, row.chapter, row.topic),
    latex: row.latex || undefined,
    options,
    correctAnswer: row.correctAnswer,
    tolerance: row.tolerance ?? undefined,
    explanation: row.explanation,
    positiveMarks: row.positiveMarks,
    negativeMarks: row.negativeMarks,
    source: row.source as Question['source'],
    status: row.status as Question['status'],
    timesAttempted: row.timesAttempted,
    timesCorrect: row.timesCorrect,
    timesUsed: row.timesUsed,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    testIds,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  });
}

let isDbSeeded = false;

export async function ensureDatabaseSeeded(): Promise<number> {
  const bank = getCachedQuestionBank();
  if (isDbSeeded || isSeeding) return cachedQuestions.length;

  try {
    const countRes = await db.select({ count: sql<number>`count(*)` }).from(questions);
    const dbCount = Number(countRes[0]?.count || 0);

    // Load any custom/admin questions stored in DB without pulling all 60,000 static rows
    if (dbCount > 0) {
      try {
        const dbRows = await db
          .select()
          .from(questions)
          .where(sql`${questions.id} NOT LIKE 'jee_%' AND ${questions.id} NOT LIKE 'neet_%'`)
          .limit(500);
        const existingIds = new Set(cachedQuestions.map((q) => q.questionId || q.id));
        for (const r of dbRows) {
          const mapped = mapDbRowToQuestion(r);
          if (!existingIds.has(mapped.id)) {
            cachedQuestions.unshift(mapped);
            existingIds.add(mapped.id);
          }
        }
      } catch (err) {
        console.warn('Error loading custom questions from PostgreSQL:', err);
      }
    }

    // Load global question_usage records from DB
    try {
      const usageRows = await db.select().from(questionUsage);
      for (const u of usageRows) {
        let parsedTestIds: string[] = [];
        try {
          parsedTestIds = JSON.parse(u.testIdsJson || '[]');
        } catch {}
        for (const tId of parsedTestIds) {
          recordQuestionUsage(
            [u.questionId],
            tId,
            u.lastUsedAt ? u.lastUsedAt.toISOString() : new Date().toISOString()
          );
        }
      }
    } catch {}

    if (dbCount === 0) {
      isSeeding = true;
      const chunkSize = 200;
      (async () => {
        try {
          for (let i = 0; i < bank.length; i += chunkSize) {
            const chunk = bank.slice(i, i + chunkSize);
            await db
              .insert(questions)
              .values(
                chunk.map((q) => {
                  const qId = q.questionId || q.id;
                  const usage = getQuestionUsage(qId, q);
                  return {
                    id: qId,
                    courseId:
                      q.courseId ||
                      (q.examType === 'NEET'
                        ? 'course_neet'
                        : q.examType === 'JEE_ADVANCED'
                        ? 'course_jee_adv'
                        : 'course_jee'),
                    courseType:
                      q.courseType ||
                      (q.examType === 'NEET'
                        ? 'NEET'
                        : q.examType === 'JEE_ADVANCED'
                        ? 'JEE_ADVANCED'
                        : 'JEE'),
                    examType: q.examType,
                    subject: q.subject,
                    chapter: q.chapter,
                    topic: q.topic,
                    difficulty: q.difficulty,
                    type: q.type,
                    questionText: q.questionText,
                    normalizedText: q.normalizedText || normalizeQuestion(q.questionText),
                    fingerprint: q.fingerprint || computeQuestionFingerprint(q.questionText, q.subject, q.type),
                    conceptKey: q.conceptKey || computeConceptKey(q.questionText, q.subject, q.chapter, q.topic),
                    latex: q.latex || null,
                    optionsJson: q.options ? JSON.stringify(q.options) : null,
                    correctAnswer: q.correctAnswer,
                    tolerance: q.tolerance ?? null,
                    explanation: q.explanation,
                    positiveMarks: q.positiveMarks,
                    negativeMarks: q.negativeMarks,
                    source: q.source,
                    status: q.status,
                    timesAttempted: q.timesAttempted || 0,
                    timesCorrect: q.timesCorrect || 0,
                    timesUsed: usage.timesUsed || 0,
                    lastUsedAt: usage.lastUsedAt ? new Date(usage.lastUsedAt) : null,
                    testIdsJson: JSON.stringify(usage.testIds || []),
                  };
                })
              )
              .onConflictDoNothing();
          }
        } catch (err) {
          console.warn('Database background seed note:', err);
        } finally {
          isSeeding = false;
        }
      })();
    }

    // Seed tests and test_questions snapshots if empty
    const testCountRes = await db.select({ count: sql<number>`count(*)` }).from(tests);
    if (Number(testCountRes[0]?.count || 0) === 0) {
      for (const t of SEED_TESTS) {
        await saveTestToDb(t);
      }
    }

    isDbSeeded = true;
    return cachedQuestions.length;
  } catch (err) {
    isSeeding = false;
    return cachedQuestions.length;
  }
}

export async function persistQuestionUsageToDb(
  questionIds: string[],
  testId: string,
  timestampIso: string = new Date().toISOString()
): Promise<void> {
  recordQuestionUsage(questionIds, testId, timestampIso);
  try {
    for (const qId of questionIds) {
      if (!qId) continue;
      const usage = getQuestionUsage(qId);
      const lastUsedDate = usage.lastUsedAt ? new Date(usage.lastUsedAt) : new Date();
      await db
        .insert(questionUsage)
        .values({
          questionId: qId,
          timesUsed: usage.timesUsed,
          lastUsedAt: lastUsedDate,
          testIdsJson: JSON.stringify(usage.testIds),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: questionUsage.questionId,
          set: {
            timesUsed: usage.timesUsed,
            lastUsedAt: lastUsedDate,
            testIdsJson: JSON.stringify(usage.testIds),
            updatedAt: new Date(),
          },
        });
    }
  } catch (err) {
    console.warn('Note persisting question usage to PostgreSQL:', err);
  }
}

export async function saveTestToDb(t: TestDefinition): Promise<void> {
  const tId = t.testId || t.id;
  memoryTests.set(tId, t);
  if (t.id) memoryTests.set(t.id, t);

  if (isPostgresConfigured()) {
    try {
      const qIds =
        t.snapshotQuestionIds && t.snapshotQuestionIds.length > 0
          ? t.snapshotQuestionIds
          : t.questions.map((q) => q.questionId || q.id);

      const mappings =
        t.testQuestions && t.testQuestions.length > 0
          ? t.testQuestions
          : buildTestQuestionMappings(tId, t.questions, 1, 'Set A');

      await db
        .insert(tests)
        .values({
          id: tId,
          title: t.title,
          subtitle: t.subtitle || '',
          courseId:
            t.courseId ||
            (t.examType === 'NEET'
              ? 'course_neet'
              : t.examType === 'JEE_ADVANCED'
              ? 'course_jee_adv'
              : 'course_jee'),
          courseType:
            t.courseType ||
            (t.examType === 'NEET'
              ? 'NEET'
              : t.examType === 'JEE_ADVANCED'
              ? 'JEE_ADVANCED'
              : 'JEE'),
          examType: t.examType,
          testType: t.testType,
          patternYear: t.patternYear || 2026,
          blueprintId: t.blueprintId || null,
          patternSource: t.patternSource || null,
          durationMinutes: t.durationMinutes,
          totalMarks: t.totalMarks,
          positiveMarks: t.positiveMarks,
          negativeMarks: t.negativeMarks,
          subjectsJson: JSON.stringify(t.subjects || []),
          questionsCount: t.questionsCount || qIds.length,
          difficulty: t.difficulty || 'MIXED',
          syllabusJson: JSON.stringify(t.syllabus || []),
          sectionsJson: t.sections ? JSON.stringify(t.sections) : null,
          description: t.description || '',
          questionIdsJson: JSON.stringify(qIds),
          testQuestionsJson: JSON.stringify(mappings),
          attemptSnapshotsJson: JSON.stringify(t.attemptSnapshots || []),
          activeAttemptSet: t.activeAttemptSet || 'Set A',
          published: t.published !== false,
          attemptsCount: t.attemptsCount || 0,
          avgScore: t.avgScore || 0,
        })
        .onConflictDoUpdate({
          target: tests.id,
          set: {
            title: t.title,
            subtitle: t.subtitle || '',
            durationMinutes: t.durationMinutes,
            totalMarks: t.totalMarks,
            questionsCount: t.questionsCount || qIds.length,
            questionIdsJson: JSON.stringify(qIds),
            testQuestionsJson: JSON.stringify(mappings),
            attemptSnapshotsJson: JSON.stringify(t.attemptSnapshots || []),
            activeAttemptSet: t.activeAttemptSet || 'Set A',
            published: t.published !== false,
            attemptsCount: t.attemptsCount || 0,
            avgScore: t.avgScore || 0,
          },
        });

      if (mappings.length > 0) {
        await db
          .insert(testQuestions)
          .values(
            mappings.map((m, idx) => ({
              id: `${tId}_att${m.attemptNumber || 1}_q${m.questionOrder || idx + 1}`,
              testId: tId,
              questionId: m.questionId,
              questionOrder: m.questionOrder || idx + 1,
              attemptNumber: m.attemptNumber || 1,
              setLabel: m.setLabel || 'Set A',
            }))
          )
          .onConflictDoNothing();
      }

      await persistQuestionUsageToDb(qIds, tId, t.createdAt || new Date().toISOString());
    } catch (err) {
      console.warn('Error saving test snapshot to PostgreSQL:', err);
    }
  }
}

export async function saveTestSnapshotMappingsToDb(
  testId: string,
  mappings: TestQuestionMapping[]
): Promise<void> {
  memoryTestQuestions.set(testId, mappings);
  if (!mappings || mappings.length === 0 || !isPostgresConfigured()) return;
  try {
    await db
      .insert(testQuestions)
      .values(
        mappings.map((m, idx) => ({
          id: `${testId}_att${m.attemptNumber || 1}_q${m.questionOrder || idx + 1}`,
          testId,
          questionId: m.questionId,
          questionOrder: m.questionOrder || idx + 1,
          attemptNumber: m.attemptNumber || 1,
          setLabel: m.setLabel || `Set ${m.attemptNumber || 1}`,
        }))
      )
      .onConflictDoNothing();
  } catch (err) {
    console.warn('Error saving test_questions mappings to PostgreSQL:', err);
  }
}

export async function getAllTestsFromDb(): Promise<TestDefinition[]> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db.select().from(tests);
      if (rows.length > 0) {
        const bank = getCachedQuestionBank();
        const byId = new Map<string, Question>();
        for (const q of bank) {
          byId.set(q.questionId || q.id, q);
          byId.set(q.id, q);
        }

        const allMappings = await db.select().from(testQuestions);
        const mappingsByTestId = new Map<string, TestQuestionMapping[]>();
        for (const m of allMappings) {
          const list = mappingsByTestId.get(m.testId) || [];
          list.push({
            testId: m.testId,
            questionId: m.questionId,
            questionOrder: m.questionOrder,
            attemptNumber: m.attemptNumber,
            setLabel: m.setLabel,
          });
          mappingsByTestId.set(m.testId, list);
        }

        const loadedTests: TestDefinition[] = [];
        for (const r of rows) {
          let qIds: string[] = [];
          let subjects: SubjectName[] = [];
          let syllabus: string[] = [];
          let sections: TestDefinition['sections'] = undefined;
          try {
            qIds = JSON.parse(r.questionIdsJson || '[]');
          } catch {}
          try {
            subjects = JSON.parse(r.subjectsJson || '[]');
          } catch {}
          try {
            syllabus = JSON.parse(r.syllabusJson || '[]');
          } catch {}
          if (r.sectionsJson) {
            try {
              sections = JSON.parse(r.sectionsJson);
            } catch {}
          }

          const rawMappings = (mappingsByTestId.get(r.id) || [])
            .filter((m) => (m.attemptNumber || 1) === 1)
            .sort((a, b) => a.questionOrder - b.questionOrder);
          const orderedIds = rawMappings.length > 0 ? rawMappings.map((m) => m.questionId) : qIds;
          const resolvedQuestions = orderedIds
            .map((id) => byId.get(id))
            .filter((q): q is Question => Boolean(q));

          const seedMatch = SEED_TESTS.find((s) => s.id === r.id || s.testId === r.id);
          const finalQuestions =
            resolvedQuestions.length > 0 ? resolvedQuestions : seedMatch ? seedMatch.questions : [];

          const tDef: TestDefinition = {
            id: r.id,
            testId: r.id,
            title: r.title,
            subtitle: r.subtitle || '',
            courseId: r.courseId,
            courseType: r.courseType as 'JEE' | 'JEE_ADVANCED' | 'NEET',
            exam: r.examType as ExamType,
            examType: r.examType as ExamType,
            testType: r.testType as TestDefinition['testType'],
            patternYear: r.patternYear || 2026,
            blueprintId: r.blueprintId || undefined,
            patternSource: r.patternSource || undefined,
            durationMinutes: r.durationMinutes,
            totalMarks: r.totalMarks,
            positiveMarks: r.positiveMarks,
            negativeMarks: r.negativeMarks,
            subjects,
            questionsCount: finalQuestions.length || r.questionsCount,
            difficulty: r.difficulty as TestDefinition['difficulty'],
            syllabus,
            description: r.description || '',
            questions: finalQuestions,
            testQuestions:
              rawMappings.length > 0
                ? rawMappings
                : buildTestQuestionMappings(r.id, finalQuestions, 1, 'Set A'),
            snapshotQuestionIds: finalQuestions.map((q) => q.questionId || q.id),
            sections: sections || seedMatch?.sections,
            activeAttemptSet: r.activeAttemptSet || 'Set A',
            published: r.published,
            createdAt: r.createdAt ? r.createdAt.toISOString().split('T')[0] : '2025-02-01',
            attemptsCount: r.attemptsCount,
            avgScore: r.avgScore,
          };
          loadedTests.push(tDef);
          memoryTests.set(tDef.id, tDef);
        }

        const loadedIds = new Set(loadedTests.map((t) => t.id));
        for (const st of SEED_TESTS) {
          if (!loadedIds.has(st.id)) {
            loadedTests.push(st);
            memoryTests.set(st.id, st);
          }
        }

        syncUsageRegistryFromTests(loadedTests);
        return loadedTests;
      }
    } catch (err) {
      console.warn('Error loading tests from PostgreSQL, falling back to memory store:', err);
    }
  }

  const unique = new Map<string, TestDefinition>();
  for (const t of memoryTests.values()) {
    unique.set(t.id, t);
  }
  for (const st of SEED_TESTS) {
    if (!unique.has(st.id)) {
      unique.set(st.id, st);
    }
  }
  const result = Array.from(unique.values());
  syncUsageRegistryFromTests(result);
  return result;
}

export async function deleteTestFromDb(testId: string): Promise<void> {
  memoryTests.delete(testId);
  if (isPostgresConfigured()) {
    try {
      await db.delete(testQuestions).where(eq(testQuestions.testId, testId));
      await db.delete(tests).where(eq(tests.id, testId));
    } catch (err) {
      console.warn('Error deleting test from PostgreSQL:', err);
    }
  }
}


export async function getQuestionsPaginated(params: {
  page?: number;
  limit?: number;
  examType?: string;
  subject?: string;
  chapter?: string;
  difficulty?: string;
  status?: string;
  search?: string;
  allowedCourseIds?: string[];
  allowedExamTypes?: string[];
}) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const offset = (page - 1) * limit;

  const allQuestions = getCachedQuestionBank();
  let filtered = allQuestions;

  if (params.allowedCourseIds && params.allowedCourseIds.length > 0) {
    const allowedSet = new Set(params.allowedCourseIds);
    filtered = filtered.filter((q) => q.courseId && allowedSet.has(q.courseId));
  }
  if (params.allowedExamTypes && params.allowedExamTypes.length > 0) {
    const allowedSet = new Set(params.allowedExamTypes);
    filtered = filtered.filter((q) => allowedSet.has(q.examType));
  }
  if (params.examType && params.examType !== 'ALL') {
    filtered = filtered.filter((q) => q.examType === params.examType);
  }
  if (params.subject && params.subject !== 'ALL') {
    filtered = filtered.filter((q) => q.subject === params.subject);
  }
  if (params.chapter && params.chapter !== 'ALL') {
    filtered = filtered.filter((q) => q.chapter === params.chapter);
  }
  if (params.difficulty && params.difficulty !== 'ALL') {
    filtered = filtered.filter((q) => q.difficulty === params.difficulty);
  }
  if (params.status && params.status !== 'ALL') {
    filtered = filtered.filter((q) => q.status === params.status);
  }
  if (params.search && params.search.trim()) {
    const s = params.search.toLowerCase().trim();
    filtered = filtered.filter(
      (q) =>
        (q.questionId || q.id).toLowerCase().includes(s) ||
        q.questionText.toLowerCase().includes(s) ||
        q.chapter.toLowerCase().includes(s) ||
        q.topic.toLowerCase().includes(s)
    );
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function createQuestionInDb(q: Partial<Question>): Promise<Question> {
  const bank = getCachedQuestionBank();
  const examType: ExamType = q.examType || 'JEE_MAIN';
  const subject: SubjectName = q.subject || 'Physics';
  const normInput = normalizeQuestion(q.questionText || '');

  if (!normInput || normInput.length < 5) {
    throw new Error('Question text is too short or empty.');
  }

  // Requirement 3: Block duplicate normalized question text
  const duplicateByText = bank.find(
    (existing) =>
      existing.subject === subject &&
      normalizeQuestion(existing.questionText) === normInput
  );
  if (duplicateByText) {
    throw new Error(
      `Duplicate question text detected: identical question already exists with ID ${duplicateByText.questionId || duplicateByText.id}.`
    );
  }

  // Requirement 1: Assign permanent canonical questionId (e.g. jee_physics_000851)
  const existingForSubj = bank.filter(
    (item) => item.examType === examType && item.subject === subject
  );
  let nextSerial = existingForSubj.length + 1;
  let canonicalId =
    q.questionId && /^(jee_adv|jee|neet)_/.test(q.questionId)
      ? q.questionId
      : formatCanonicalQuestionId(examType, subject, nextSerial);

  const usedIds = new Set(bank.map((item) => item.questionId || item.id));
  while (usedIds.has(canonicalId)) {
    nextSerial++;
    canonicalId = formatCanonicalQuestionId(examType, subject, nextSerial);
  }

  const newQ = enrichQuestionRecord(
    {
      id: canonicalId,
      questionId: canonicalId,
      courseId: q.courseId,
      courseType: q.courseType,
      examType,
      subject,
      chapter: q.chapter || 'General Chapter',
      topic: q.topic || q.chapter || 'General Topic',
      difficulty: q.difficulty || 'MEDIUM',
      type: q.type || 'MCQ',
      questionText: q.questionText || '',
      latex: q.latex,
      diagramSvg: q.diagramSvg,
      diagramCaption: q.diagramCaption,
      options: q.options,
      correctAnswer: q.correctAnswer || 'A',
      tolerance: q.tolerance,
      explanation: q.explanation || 'Detailed step-by-step solution.',
      positiveMarks: q.positiveMarks || 4,
      negativeMarks: q.negativeMarks ?? 1,
      source: q.source || 'ADMIN',
      status: q.status || 'PUBLISHED',
      pyqMetadata: q.pyqMetadata,
      createdAt: new Date().toISOString(),
      timesAttempted: 0,
      timesCorrect: 0,
      fingerprint: computeQuestionFingerprint(q.questionText || '', subject, q.type || 'MCQ'),
      normalizedText: normInput,
      timesUsed: 0,
      lastUsedAt: null,
      testIds: [],
    },
    nextSerial
  );

  try {
    await db.insert(questions).values({
      id: newQ.id,
      courseId: newQ.courseId!,
      courseType: newQ.courseType!,
      examType: newQ.examType,
      subject: newQ.subject,
      chapter: newQ.chapter,
      topic: newQ.topic,
      difficulty: newQ.difficulty,
      type: newQ.type,
      questionText: newQ.questionText,
      normalizedText: newQ.normalizedText || normInput,
      fingerprint: newQ.fingerprint || '',
      conceptKey: newQ.conceptKey || '',
      latex: newQ.latex || null,
      optionsJson: newQ.options ? JSON.stringify(newQ.options) : null,
      correctAnswer: newQ.correctAnswer,
      tolerance: newQ.tolerance ?? null,
      explanation: newQ.explanation,
      positiveMarks: newQ.positiveMarks,
      negativeMarks: newQ.negativeMarks,
      source: newQ.source,
      status: newQ.status,
      timesAttempted: 0,
      timesCorrect: 0,
      timesUsed: 0,
      lastUsedAt: null,
      testIdsJson: '[]',
    });
  } catch (err) {
    console.warn('Saved question in canonical cache:', err);
  }

  cachedQuestions.unshift(newQ);
  cachedCount = cachedQuestions.length;
  return newQ;
}

export async function updateQuestionInDb(
  id: string,
  patch: Partial<Question>
): Promise<Question | null> {
  getCachedQuestionBank();
  const idx = cachedQuestions.findIndex((q) => q.id === id || q.questionId === id);
  if (idx === -1) return null;

  const current = cachedQuestions[idx];
  const updated = enrichQuestionRecord({
    ...current,
    ...patch,
    id: current.id,
    questionId: current.questionId || current.id,
  });

  cachedQuestions[idx] = updated;

  try {
    await db
      .update(questions)
      .set({
        subject: updated.subject,
        chapter: updated.chapter,
        topic: updated.topic,
        difficulty: updated.difficulty,
        type: updated.type,
        questionText: updated.questionText,
        normalizedText: updated.normalizedText || normalizeQuestion(updated.questionText),
        fingerprint: updated.fingerprint || '',
        latex: updated.latex || null,
        optionsJson: updated.options ? JSON.stringify(updated.options) : null,
        correctAnswer: updated.correctAnswer,
        explanation: updated.explanation,
        positiveMarks: updated.positiveMarks,
        negativeMarks: updated.negativeMarks,
        status: updated.status,
      })
      .where(eq(questions.id, current.id));
  } catch (err) {
    console.warn('Updated question in cache:', err);
  }

  return updated;
}

export async function deleteQuestionFromDb(id: string): Promise<boolean> {
  try {
    await db.delete(questions).where(eq(questions.id, id));
  } catch {}
  cachedQuestions = cachedQuestions.filter((q) => q.id !== id && q.questionId !== id);
  cachedCount = cachedQuestions.length;
  return true;
}

export async function saveAttemptToDb(attempt: TestAttemptResult) {
  const existingIdx = memoryAttempts.findIndex((a) => a.id === attempt.id);
  if (existingIdx >= 0) {
    memoryAttempts[existingIdx] = attempt;
  } else {
    memoryAttempts.unshift(attempt);
  }

  if (isPostgresConfigured()) {
    try {
      await db
        .insert(testAttempts)
        .values({
          id: attempt.id,
          testId: attempt.testId,
          testTitle: attempt.testTitle,
          courseId:
            attempt.courseId ||
            (attempt.examType === 'NEET'
              ? 'course_neet'
              : attempt.examType === 'JEE_ADVANCED'
              ? 'course_jee_adv'
              : 'course_jee'),
          courseType:
            attempt.courseType ||
            (attempt.examType === 'NEET'
              ? 'NEET'
              : attempt.examType === 'JEE_ADVANCED'
              ? 'JEE_ADVANCED'
              : 'JEE'),
          examType: attempt.examType,
          userId: attempt.userId,
          userName: attempt.userName,
          timeTakenSeconds: attempt.timeTakenSeconds,
          totalScore: attempt.totalScore,
          maxScore: attempt.maxScore,
          percentage: attempt.percentage,
          accuracy: attempt.accuracy,
          attemptRate: attempt.attemptRate,
          totalQuestions: attempt.totalQuestions,
          totalAttempted: attempt.totalAttempted,
          totalCorrect: attempt.totalCorrect,
          totalIncorrect: attempt.totalIncorrect,
          totalUnanswered: attempt.totalUnanswered,
          negativeMarksLost: attempt.negativeMarksLost,
          simulatedPercentile: attempt.simulatedPercentile,
          practiceRank: attempt.practiceRank,
          resultJson: JSON.stringify(attempt),
        })
        .onConflictDoNothing();
    } catch (err) {
      console.warn('Failed to persist attempt to PostgreSQL:', err);
    }
  }
}

export async function getAttemptsFromDb(): Promise<TestAttemptResult[]> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db.select().from(testAttempts);
      if (rows.length > 0) {
        const parsed: TestAttemptResult[] = [];
        for (const r of rows) {
          try {
            const item = JSON.parse(r.resultJson) as TestAttemptResult;
            parsed.push(item);
          } catch {}
        }
        for (const p of parsed) {
          if (!memoryAttempts.some((a) => a.id === p.id)) {
            memoryAttempts.push(p);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to read attempts from PostgreSQL:', err);
    }
  }

  return [...memoryAttempts].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

// ----------------- ACTIVE EXAM SESSIONS (RESUMABLE EXAM PROGRESS) -----------------

export async function getActiveSessionFromDb(userId: string): Promise<ActiveExamSession | null> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db
        .select()
        .from(activeExamSessions)
        .where(eq(activeExamSessions.userId, userId))
        .orderBy(desc(activeExamSessions.updatedAt))
        .limit(1);
      if (rows.length > 0) {
        const parsed = JSON.parse(rows[0].sessionJson) as ActiveExamSession;
        memoryActiveSessions.set(userId, parsed);
        return parsed;
      }
    } catch (err) {
      console.warn('Error loading active exam session from PostgreSQL:', err);
    }
  }
  return memoryActiveSessions.get(userId) || null;
}

export async function saveActiveSessionToDb(
  userId: string,
  session: ActiveExamSession
): Promise<void> {
  memoryActiveSessions.set(userId, session);
  if (isPostgresConfigured()) {
    try {
      await db
        .insert(activeExamSessions)
        .values({
          userId,
          testId: session.testId,
          attemptSetLabel: session.attemptSetLabel || 'Set A',
          sessionJson: JSON.stringify(session),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: activeExamSessions.userId,
          set: {
            testId: session.testId,
            attemptSetLabel: session.attemptSetLabel || 'Set A',
            sessionJson: JSON.stringify(session),
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      console.warn('Error saving active exam session to PostgreSQL:', err);
    }
  }
}

export async function deleteActiveSessionFromDb(userId: string): Promise<void> {
  memoryActiveSessions.delete(userId);
  if (isPostgresConfigured()) {
    try {
      await db.delete(activeExamSessions).where(eq(activeExamSessions.userId, userId));
    } catch (err) {
      console.warn('Error deleting active exam session from PostgreSQL:', err);
    }
  }
}

// ----------------- USER BOOKMARKS -----------------

export async function getUserBookmarksFromDb(userId: string): Promise<{
  bookmarkedQuestionIds: string[];
  questionNotes: Record<string, string>;
}> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db
        .select()
        .from(userBookmarks)
        .where(eq(userBookmarks.userId, userId));
      if (rows.length > 0) {
        const bookmarkedQuestionIds: string[] = [];
        const questionNotes: Record<string, string> = {};
        for (const r of rows) {
          bookmarkedQuestionIds.push(r.questionId);
          if (r.note) {
            questionNotes[r.questionId] = r.note;
          }
        }
        memoryBookmarks.set(userId, { bookmarkedQuestionIds, questionNotes });
        return { bookmarkedQuestionIds, questionNotes };
      }
    } catch (err) {
      console.warn('Error loading user bookmarks from PostgreSQL:', err);
    }
  }

  const existing = memoryBookmarks.get(userId);
  if (existing) {
    return {
      bookmarkedQuestionIds: [...existing.bookmarkedQuestionIds],
      questionNotes: { ...existing.questionNotes },
    };
  }
  return { bookmarkedQuestionIds: [], questionNotes: {} };
}

export async function toggleUserBookmarkInDb(params: {
  userId: string;
  questionId: string;
  bookmarked: boolean;
  notes?: string;
}): Promise<void> {
  let userBm = memoryBookmarks.get(params.userId);
  if (!userBm) {
    userBm = { bookmarkedQuestionIds: [], questionNotes: {} };
    memoryBookmarks.set(params.userId, userBm);
  }

  if (params.bookmarked) {
    if (!userBm.bookmarkedQuestionIds.includes(params.questionId)) {
      userBm.bookmarkedQuestionIds.push(params.questionId);
    }
    if (params.notes !== undefined) {
      userBm.questionNotes[params.questionId] = params.notes;
    }
  } else {
    userBm.bookmarkedQuestionIds = userBm.bookmarkedQuestionIds.filter((id) => id !== params.questionId);
    delete userBm.questionNotes[params.questionId];
  }

  if (isPostgresConfigured()) {
    try {
      const id = `bm_${params.userId}_${params.questionId}`;
      if (!params.bookmarked && !params.notes) {
        await db
          .delete(userBookmarks)
          .where(
            and(
              eq(userBookmarks.userId, params.userId),
              eq(userBookmarks.questionId, params.questionId)
            )
          );
        return;
      }
      await db
        .insert(userBookmarks)
        .values({
          id,
          userId: params.userId,
          questionId: params.questionId,
          collection: 'General Revision',
          note: params.notes || '',
        })
        .onConflictDoUpdate({
          target: userBookmarks.id,
          set: {
            note: params.notes ?? '',
          },
        });
    } catch (err) {
      console.warn('Error toggling user bookmark in PostgreSQL:', err);
    }
  }
}

// ----------------- QUESTION ERROR REPORTS -----------------

export async function getQuestionReportsFromDb(): Promise<QuestionErrorReport[]> {
  if (isPostgresConfigured()) {
    try {
      const rows = await db
        .select()
        .from(questionReports)
        .orderBy(desc(questionReports.createdAt));
      if (rows.length > 0) {
        const loaded: QuestionErrorReport[] = rows.map((r) => ({
          id: r.id,
          questionId: r.questionId,
          testId: r.testId || 'bank',
          userId: r.studentId,
          userName: r.studentName,
          studentName: r.studentName,
          reason: r.reason as QuestionErrorReport['reason'],
          description: r.description,
          comment: r.description,
          status: r.status as QuestionErrorReport['status'],
          createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
        }));
        for (const item of loaded) {
          if (!memoryQuestionReports.some((q) => q.id === item.id)) {
            memoryQuestionReports.push(item);
          }
        }
      }
    } catch (err) {
      console.warn('Error loading question reports from PostgreSQL:', err);
    }
  }

  return [...memoryQuestionReports];
}

export async function createQuestionReportInDb(
  report: QuestionErrorReport
): Promise<QuestionErrorReport> {
  memoryQuestionReports.unshift(report);
  if (isPostgresConfigured()) {
    try {
      await db
        .insert(questionReports)
        .values({
          id: report.id,
          questionId: report.questionId,
          testId: report.testId || 'bank',
          studentId: report.userId || 'usr-student-rahul',
          studentName: report.studentName || report.userName || 'Student',
          reason: report.reason || 'OTHER',
          description: report.description || report.comment || '',
          status: report.status || 'PENDING',
        })
        .onConflictDoNothing();
    } catch (err) {
      console.warn('Error saving question report to PostgreSQL:', err);
    }
  }
  return report;
}

export async function resolveQuestionReportInDb(reportId: string): Promise<void> {
  const rep = memoryQuestionReports.find((r) => r.id === reportId);
  if (rep) {
    rep.status = 'RESOLVED';
  }
  if (isPostgresConfigured()) {
    try {
      await db
        .update(questionReports)
        .set({ status: 'RESOLVED' })
        .where(eq(questionReports.id, reportId));
    } catch (err) {
      console.warn('Error resolving question report in PostgreSQL:', err);
    }
  }
}

