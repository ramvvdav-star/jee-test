import {
  Question,
  SubjectName,
  ExamType,
  Difficulty,
  QuestionType,
  ExamBlueprint,
  QuestionUsageRecord,
  TestDefinition,
  TestAttemptSnapshot,
  TestQuestionMapping,
} from '../types/exam';
import { OFFICIAL_EXAM_BLUEPRINTS } from './officialExamPatterns';

// ============================================================================
// PART 1 & 3: NORMALIZATION, FINGERPRINTING & CANONICAL QUESTION IDS
// ============================================================================

/**
 * Normalizes question text (Requirement 3):
 * - converts to lowercase
 * - trims whitespace
 * - removes unnecessary formatting & artificial variant tags
 * - normalizes repeated spaces
 * - normalizes obvious punctuation differences
 */
export function normalizeQuestion(text: string): string {
  return (text || '')
    .toLowerCase()
    // Strip any artificial variant suffixes if present in legacy records
    .replace(/\[shift variant #\d+\]/gi, '')
    .replace(/\(experiment #\d+\)/gi, '')
    .replace(/for trial #\d+/gi, '')
    .replace(/from subject #\d+/gi, '')
    .replace(/\$+/g, '')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\,/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^\w\s\d.=+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const normalizeQuestionText = normalizeQuestion;

/**
 * Computes a concept stem signature by replacing numeric literals in the normalized
 * question text so we can also diversify problem stems within a single test.
 */
export function computeConceptKey(
  questionText: string,
  subject?: string,
  chapter?: string,
  topic?: string
): string {
  const stem = normalizeQuestion(questionText)
    .replace(/\b\d+(\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return `${(subject || '').toLowerCase()}|${(chapter || '').toLowerCase()}|${(topic || '').toLowerCase()}|${stem}`;
}

/**
 * Computes a deterministic 64-bit FNV-1a hex fingerprint from normalized question text + subject + type.
 */
export function computeQuestionFingerprint(
  questionText: string,
  subject?: string,
  questionType?: string
): string {
  const normalized = `${(subject || '').toLowerCase()}|${(questionType || '').toLowerCase()}|${normalizeQuestion(questionText)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x1000193b);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `fp_${hex1}${hex2}`;
}

/**
 * Formats a permanent canonical questionId (Requirement 1):
 * e.g. jee_physics_000001, jee_chemistry_000001, neet_botany_000001
 */
export function formatCanonicalQuestionId(
  exam: ExamType,
  subject: SubjectName,
  serialNumber: number
): string {
  const examPrefix =
    exam === 'NEET'
      ? 'neet'
      : exam === 'JEE_ADVANCED'
      ? 'jee_adv'
      : 'jee';
  const subjSlug =
    subject === 'Mathematics'
      ? 'mathematics'
      : subject.toLowerCase();
  return `${examPrefix}_${subjSlug}_${String(serialNumber).padStart(6, '0')}`;
}

/**
 * Generates a unique testId (Requirement 11) e.g. test_20261007_001
 */
let generatedTestSequence = 1;
export function generateUniqueTestId(prefix = 'test'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq = String(generatedTestSequence++).padStart(3, '0');
  const randSuffix = Math.floor(100 + Math.random() * 900);
  return `${prefix}_${yyyy}${mm}${dd}_${seq}_${randSuffix}`;
}

/**
 * Builds canonical test_questions mappings (Requirement 10).
 */
export function buildTestQuestionMappings(
  testId: string,
  questions: readonly Question[],
  attemptNumber = 1,
  setLabel = 'Set A'
): TestQuestionMapping[] {
  return questions.map((q, idx) => ({
    testId,
    questionId: q.questionId || q.id,
    questionOrder: idx + 1,
    attemptNumber,
    setLabel,
  }));
}

/**
 * Enriches any Question object so all canonical properties are present and synced.
 */
export function enrichQuestionRecord(q: Question, fallbackSerial = 1): Question {
  const canonicalId =
    q.questionId && /^(jee|neet)_/.test(q.questionId)
      ? q.questionId
      : q.id && /^(jee|neet)_/.test(q.id)
      ? q.id
      : formatCanonicalQuestionId(q.examType || 'JEE_MAIN', q.subject || 'Physics', fallbackSerial);

  const normText = normalizeQuestion(q.questionText);
  const fp = computeQuestionFingerprint(q.questionText, q.subject, q.type);
  const cKey = q.conceptKey || computeConceptKey(q.questionText, q.subject, q.chapter, q.topic);
  const hasImg = Boolean(q.hasImage || q.diagramSvg || q.image);

  const resolvedCourseType: 'JEE' | 'JEE_ADVANCED' | 'NEET' =
    q.courseType ||
    (q.examType === 'NEET' || q.subject === 'Botany' || q.subject === 'Zoology'
      ? 'NEET'
      : q.examType === 'JEE_ADVANCED'
      ? 'JEE_ADVANCED'
      : 'JEE');

  const resolvedCourseId =
    q.courseId ||
    (resolvedCourseType === 'NEET'
      ? 'course_neet'
      : resolvedCourseType === 'JEE_ADVANCED'
      ? 'course_jee_adv'
      : 'course_jee');

  return {
    ...q,
    id: canonicalId,
    questionId: canonicalId,
    courseId: resolvedCourseId,
    courseType: resolvedCourseType,
    exam: q.examType,
    examType: q.examType,
    questionType: q.type,
    type: q.type,
    marks: q.positiveMarks,
    positiveMarks: q.positiveMarks,
    year: q.year || q.pyqMetadata?.year || q.patternYear || 2026,
    image: q.image || q.diagramSvg,
    hasImage: hasImg,
    fingerprint: fp,
    normalizedText: normText,
    conceptKey: cKey,
    timesUsed: q.timesUsed ?? 0,
    lastUsedAt: q.lastUsedAt ?? null,
    testIds: q.testIds ?? [],
  };
}

// ============================================================================
// PART 2: PROPER FISHER-YATES RANDOMIZATION (Requirement 8)
// ============================================================================

export function shuffle<T>(array: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const fisherYatesShuffle = shuffle;

/**
 * Deterministic Mulberry32 PRNG for reproducible initial seed test snapshots.
 */
export function createDeterministicRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// PART 3: GLOBAL QUESTION USAGE TRACKING SYSTEM (Requirement 6 & 15)
// ============================================================================

const USAGE_STORAGE_KEY = 'cbt_global_question_usage_v2';
const usageRegistry = new Map<string, QuestionUsageRecord>();

function loadPersistedUsageRegistry(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, QuestionUsageRecord>;
    for (const [qid, rec] of Object.entries(parsed)) {
      if (rec && typeof rec.timesUsed === 'number') {
        usageRegistry.set(qid, {
          questionId: qid,
          timesUsed: rec.timesUsed,
          lastUsedAt: rec.lastUsedAt || null,
          testIds: Array.isArray(rec.testIds) ? rec.testIds : [],
        });
      }
    }
  } catch {
    // ignore storage errors
  }
}

function savePersistedUsageRegistry(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const obj: Record<string, QuestionUsageRecord> = {};
    usageRegistry.forEach((val, key) => {
      if (val.timesUsed > 0) {
        obj[key] = val;
      }
    });
    window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage quota errors
  }
}

loadPersistedUsageRegistry();

export function getQuestionUsage(questionId: string, fallbackQuestion?: Question): QuestionUsageRecord {
  const existing = usageRegistry.get(questionId);
  if (existing) {
    if (fallbackQuestion && (fallbackQuestion.timesUsed || 0) > existing.timesUsed) {
      existing.timesUsed = fallbackQuestion.timesUsed!;
      existing.lastUsedAt = fallbackQuestion.lastUsedAt || existing.lastUsedAt;
      existing.testIds = Array.from(new Set([...existing.testIds, ...(fallbackQuestion.testIds || [])]));
    }
    return existing;
  }
  const initial: QuestionUsageRecord = {
    questionId,
    timesUsed: fallbackQuestion?.timesUsed ?? 0,
    lastUsedAt: fallbackQuestion?.lastUsedAt ?? null,
    testIds: Array.isArray(fallbackQuestion?.testIds) ? [...fallbackQuestion!.testIds!] : [],
  };
  usageRegistry.set(questionId, initial);
  return initial;
}

export function recordQuestionUsage(
  questionIds: string[],
  testId: string,
  timestampIso: string = new Date().toISOString()
): void {
  for (const qid of questionIds) {
    if (!qid) continue;
    const rec = getQuestionUsage(qid);
    if (!rec.testIds.includes(testId)) {
      rec.timesUsed += 1;
      rec.testIds.push(testId);
    } else if (rec.timesUsed === 0) {
      rec.timesUsed = 1;
    }
    rec.lastUsedAt = timestampIso;
    usageRegistry.set(qid, rec);
  }
  savePersistedUsageRegistry();
}

export function syncUsageRegistryFromTests(tests: readonly TestDefinition[]): void {
  for (const t of tests) {
    const tId = t.testId || t.id;
    const ts = t.createdAt || new Date().toISOString();
    const ids =
      t.testQuestions && t.testQuestions.length > 0
        ? t.testQuestions.map((tq) => tq.questionId)
        : t.snapshotQuestionIds && t.snapshotQuestionIds.length > 0
        ? t.snapshotQuestionIds
        : (t.questions || []).map((q) => q.questionId || q.id);
    for (const qid of ids) {
      if (!qid) continue;
      const rec = getQuestionUsage(qid);
      if (!rec.testIds.includes(tId)) {
        rec.timesUsed += 1;
        rec.testIds.push(tId);
        if (!rec.lastUsedAt || ts > rec.lastUsedAt) {
          rec.lastUsedAt = ts;
        }
        usageRegistry.set(qid, rec);
      }
    }
  }
  savePersistedUsageRegistry();
}

export function getAllQuestionUsageRecords(): QuestionUsageRecord[] {
  return Array.from(usageRegistry.values());
}

export function resetQuestionUsageRegistry(): void {
  usageRegistry.clear();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(USAGE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// PART 4: HARD VALIDATION — ZERO DUPLICATES INSIDE ONE TEST (Requirement 2 & 3)
// ============================================================================

/**
 * Validates that a generated test contains ZERO duplicate questionIds and ZERO
 * duplicate normalized question texts. Throws an error if even ONE duplicate exists.
 */
export function validateGeneratedTestQuestions(testQuestions: readonly Question[]): void {
  const ids = testQuestions.map((q) => q.questionId || q.id);
  const uniqueIds = new Set(ids);

  if (ids.length !== uniqueIds.size) {
    throw new Error('Duplicate question detected in generated test');
  }

  const normalizedTexts = testQuestions.map((q) => normalizeQuestion(q.questionText));
  const uniqueTexts = new Set(normalizedTexts);

  if (normalizedTexts.length !== uniqueTexts.size) {
    throw new Error('Duplicate question text detected in generated test');
  }
}

// ============================================================================
// PART 5: DATABASE AUDIT & CANONICAL DEDUPLICATION (Requirement 13)
// ============================================================================

export interface DatabaseDeduplicationReport {
  totalInputQuestions: number;
  canonicalUniqueQuestions: number;
  duplicateIdsRemoved: number;
  duplicateTextsRemoved: number;
  malformedQuestionsRemoved: number;
  migratedIdsCount: number;
  canonicalIdMap: Record<string, string>;
}

/**
 * Audits an existing question array/database:
 * - Detects empty/non-canonical questionIds and migrates them to permanent IDs
 * - Detects duplicate questionIds and duplicate normalized question texts
 * - Keeps one canonical record per unique question and builds a reference remapping table
 */
export function deduplicateAndMigrateQuestionBank(
  rawQuestions: readonly Question[]
): {
  canonicalQuestions: Question[];
  report: DatabaseDeduplicationReport;
} {
  const canonicalQuestions: Question[] = [];
  const seenQuestionIds = new Set<string>();
  const textToCanonicalId = new Map<string, string>();
  const canonicalIdMap: Record<string, string> = {};
  const serialCounters = new Map<string, number>();

  let duplicateIdsRemoved = 0;
  let duplicateTextsRemoved = 0;
  let malformedQuestionsRemoved = 0;
  let migratedIdsCount = 0;

  const nextSerialFor = (exam: ExamType, subject: SubjectName): number => {
    const key = `${exam}_${subject}`;
    const next = (serialCounters.get(key) || 0) + 1;
    serialCounters.set(key, next);
    return next;
  };

  // Seed serialCounters from existing valid canonical IDs so we never collide
  for (const q of rawQuestions) {
    const rawId = q.questionId || q.id || '';
    const match = rawId.match(/^(jee_adv|jee|neet)_([a-z]+)_(\d+)$/);
    if (match) {
      const num = parseInt(match[3], 10);
      const key = `${q.examType || 'JEE_MAIN'}_${q.subject || 'Physics'}`;
      const curr = serialCounters.get(key) || 0;
      if (num > curr) serialCounters.set(key, num);
    }
  }

  for (const q of rawQuestions) {
    if (!q || !q.questionText || !q.subject || !q.correctAnswer) {
      malformedQuestionsRemoved++;
      continue;
    }

    const normText = normalizeQuestion(q.questionText);
    if (!normText || normText.length < 8) {
      malformedQuestionsRemoved++;
      continue;
    }

    const originalId = q.questionId || q.id || '';
    const existingCanonicalForText = textToCanonicalId.get(`${q.subject.toLowerCase()}|${normText}`);

    if (existingCanonicalForText) {
      duplicateTextsRemoved++;
      if (originalId) {
        canonicalIdMap[originalId] = existingCanonicalForText;
      }
      continue;
    }

    let finalId = originalId;
    const isCanonicalFormat = /^(jee_adv|jee|neet)_(physics|chemistry|mathematics|math|botany|zoology)_\d{6}$/.test(
      finalId
    );

    if (!finalId || !isCanonicalFormat || seenQuestionIds.has(finalId)) {
      if (seenQuestionIds.has(finalId)) {
        duplicateIdsRemoved++;
      } else {
        migratedIdsCount++;
      }
      const serial = nextSerialFor(q.examType || 'JEE_MAIN', q.subject);
      finalId = formatCanonicalQuestionId(q.examType || 'JEE_MAIN', q.subject, serial);
      while (seenQuestionIds.has(finalId)) {
        finalId = formatCanonicalQuestionId(
          q.examType || 'JEE_MAIN',
          q.subject,
          nextSerialFor(q.examType || 'JEE_MAIN', q.subject)
        );
      }
    }

    if (originalId) {
      canonicalIdMap[originalId] = finalId;
    }
    canonicalIdMap[finalId] = finalId;

    seenQuestionIds.add(finalId);
    textToCanonicalId.set(`${q.subject.toLowerCase()}|${normText}`, finalId);

    const enriched = enrichQuestionRecord({
      ...q,
      id: finalId,
      questionId: finalId,
    });

    canonicalQuestions.push(enriched);
  }

  return {
    canonicalQuestions,
    report: {
      totalInputQuestions: rawQuestions.length,
      canonicalUniqueQuestions: canonicalQuestions.length,
      duplicateIdsRemoved,
      duplicateTextsRemoved,
      malformedQuestionsRemoved,
      migratedIdsCount,
      canonicalIdMap,
    },
  };
}

// ============================================================================
// PART 6: COURSE-AWARE INTELLIGENT QUESTION SELECTION (Requirements 5-8, 15-18)
// ============================================================================

export class InsufficientQuestionBankError extends Error {
  public readonly requestedCount: number;
  public readonly availableUniqueCount: number;

  constructor(
    requestedCount: number,
    availableUniqueCount: number,
    message = 'Not enough unique questions are available for this test. Please add more questions or reduce the number of questions.'
  ) {
    super(message);
    this.name = 'InsufficientQuestionBankError';
    this.requestedCount = requestedCount;
    this.availableUniqueCount = availableUniqueCount;
  }
}

export interface IntelligentSelectionOptions {
  courseId?: string;
  courseType?: 'JEE' | 'JEE_ADVANCED' | 'NEET';
  exam: ExamType;
  subject: SubjectName;
  questionType?: QuestionType;
  count: number;
  chapters?: string[];
  topics?: string[];
  difficulty?: Difficulty;
  difficultyDistribution?: {
    easyPercent: number;
    mediumPercent: number;
    hardPercent: number;
  };
  excludeQuestionIds?: Set<string>;
  excludeFingerprints?: Set<string>;
  excludeNormalizedTexts?: Set<string>;
  excludeConceptKeys?: Set<string>;
  testIdForTracking?: string;
  rng?: () => number;
  timestampIso?: string;
  strictCount?: boolean;
  onDistributionAdjusted?: (notice: string) => void;
}

/**
 * Helper to sort eligible unique questions by the 4-level priority system (Requirement 6):
 * Priority 1: Questions that have NEVER been used (timesUsed === 0)
 * Priority 2: Questions with the lowest timesUsed
 * Priority 3: Questions that were used longest ago (lastUsedAt ascending)
 * Priority 4: Random selection (Fisher-Yates shuffle) among equally eligible questions
 */
function prioritizeAndRandomizeCandidates(
  candidates: readonly Question[],
  rng: () => number
): Question[] {
  // First perform an unbiased Fisher-Yates shuffle so all ties in usage are randomized
  const randomized = shuffle(candidates, rng);

  randomized.sort((a, b) => {
    const usageA = getQuestionUsage(a.questionId || a.id, a);
    const usageB = getQuestionUsage(b.questionId || b.id, b);

    // Priority 1 & 2: Never used (0) first, then lowest timesUsed ascending
    if (usageA.timesUsed !== usageB.timesUsed) {
      return usageA.timesUsed - usageB.timesUsed;
    }

    // Priority 3: Used longest ago first (null comes before any timestamp)
    if (!usageA.lastUsedAt && usageB.lastUsedAt) return -1;
    if (usageA.lastUsedAt && !usageB.lastUsedAt) return 1;
    if (usageA.lastUsedAt && usageB.lastUsedAt && usageA.lastUsedAt !== usageB.lastUsedAt) {
      return usageA.lastUsedAt.localeCompare(usageB.lastUsedAt);
    }

    return 0;
  });

  return randomized;
}

/**
 * Course-aware question selection following exact Requirement 7 hierarchy:
 * Student -> Course -> Exam -> Subject -> Chapter/Topic -> Difficulty ->
 * Unused/least-used -> Remove duplicates -> Randomize -> Generate -> Validate
 */
export function selectQuestionsIntelligent(
  questionBank: readonly Question[],
  options: IntelligentSelectionOptions
): Question[] {
  const {
    courseId,
    courseType,
    exam,
    subject,
    questionType,
    count,
    chapters,
    topics,
    difficulty,
    difficultyDistribution,
    excludeQuestionIds = new Set<string>(),
    excludeFingerprints = new Set<string>(),
    excludeNormalizedTexts = new Set<string>(),
    excludeConceptKeys = new Set<string>(),
    testIdForTracking,
    rng = Math.random,
    timestampIso = new Date().toISOString(),
    strictCount = false,
    onDistributionAdjusted,
  } = options;

  if (count <= 0) return [];

  const usedQuestionIds = new Set<string>(excludeQuestionIds);
  const usedFingerprints = new Set<string>(excludeFingerprints);
  const usedNormalizedTexts = new Set<string>(excludeNormalizedTexts);
  const usedConceptKeys = new Set<string>(excludeConceptKeys);
  const selectedQuestions: Question[] = [];

  // Requirement 2 & 3 mandatory guard before adding any question
  function addQuestion(question: Question): boolean {
    const qId = question.questionId || question.id;
    const normText = question.normalizedText || normalizeQuestion(question.questionText);
    const fp = question.fingerprint || computeQuestionFingerprint(question.questionText, question.subject, question.type);
    const cKey = question.conceptKey || computeConceptKey(question.questionText, question.subject, question.chapter, question.topic);

    if (!qId || !normText) return false;
    if (usedQuestionIds.has(qId) || usedFingerprints.has(fp) || usedNormalizedTexts.has(normText)) {
      return false;
    }

    const usage = getQuestionUsage(qId, question);
    const enrichedQuestion: Question = {
      ...question,
      id: qId,
      questionId: qId,
      fingerprint: fp,
      normalizedText: normText,
      conceptKey: cKey,
      timesUsed: usage.timesUsed + (testIdForTracking ? 1 : 0),
      lastUsedAt: testIdForTracking ? timestampIso : usage.lastUsedAt,
      testIds: testIdForTracking
        ? Array.from(new Set([...usage.testIds, testIdForTracking]))
        : usage.testIds,
    };

    usedQuestionIds.add(qId);
    usedFingerprints.add(fp);
    usedNormalizedTexts.add(normText);
    usedConceptKeys.add(cKey);
    selectedQuestions.push(enrichedQuestion);
    return true;
  }

  // Step 1: Filter by Course & Exam & Subject (Strict isolation between NEET and JEE)
  const isNeetCourse =
    exam === 'NEET' ||
    courseType === 'NEET' ||
    courseId === 'course_neet' ||
    subject === 'Botany' ||
    subject === 'Zoology';

  let pool = questionBank.filter((q) => {
    if (q.subject !== subject) return false;
    const qIsNeet =
      q.examType === 'NEET' ||
      q.courseType === 'NEET' ||
      q.courseId === 'course_neet' ||
      (q.questionId || q.id || '').startsWith('neet_');
    if (isNeetCourse !== qIsNeet) return false;
    if (exam !== 'CUSTOM' && q.examType === exam) return true;
    return exam === 'CUSTOM';
  });

  // If a specific JEE exam (e.g. JEE_ADVANCED) needs more questions of the same subject & type,
  // allow within the same JEE course family (never crossing NEET <-> JEE).
  const checkTypePool = questionType ? pool.filter((q) => q.type === questionType) : pool;
  if (checkTypePool.length < count) {
    pool = questionBank.filter((q) => {
      if (q.subject !== subject) return false;
      const qIsNeet =
        q.examType === 'NEET' ||
        q.courseType === 'NEET' ||
        q.courseId === 'course_neet' ||
        (q.questionId || q.id || '').startsWith('neet_');
      return isNeetCourse === qIsNeet;
    });
  }

  // Step 2: Filter by QuestionType (MCQ, NUMERICAL, MULTIPLE_CORRECT, ASSERTION_REASON)
  if (questionType) {
    const typedPool = pool.filter((q) => q.type === questionType);
    if (typedPool.length >= count || strictCount) {
      pool = typedPool;
    }
  }

  // Step 3: Filter by Chapter / Topic if specified
  if (chapters && chapters.length > 0) {
    const lowerChapters = new Set(chapters.map((c) => c.toLowerCase().trim()));
    const chapterFiltered = pool.filter((q) => lowerChapters.has((q.chapter || '').toLowerCase().trim()));
    if (chapterFiltered.length >= count || strictCount) {
      pool = chapterFiltered;
    }
  }

  if (topics && topics.length > 0) {
    const lowerTopics = new Set(topics.map((t) => t.toLowerCase().trim()));
    const topicFiltered = pool.filter((q) => lowerTopics.has((q.topic || '').toLowerCase().trim()));
    if (topicFiltered.length >= count || strictCount) {
      pool = topicFiltered;
    }
  }

  // Step 4: Deduplicate eligible pool before selection (exclude already-used in this test)
  const deduplicatedPool: Question[] = [];
  const poolSeenIds = new Set<string>();
  const poolSeenNorms = new Set<string>();
  const poolSeenFps = new Set<string>();

  for (const q of pool) {
    const qId = q.questionId || q.id;
    const norm = q.normalizedText || normalizeQuestion(q.questionText);
    const fp = q.fingerprint || computeQuestionFingerprint(q.questionText, q.subject, q.type);
    if (
      !qId ||
      !norm ||
      usedQuestionIds.has(qId) ||
      usedNormalizedTexts.has(norm) ||
      usedFingerprints.has(fp) ||
      poolSeenIds.has(qId) ||
      poolSeenNorms.has(norm) ||
      poolSeenFps.has(fp)
    ) {
      continue;
    }
    poolSeenIds.add(qId);
    poolSeenNorms.add(norm);
    poolSeenFps.add(fp);
    deduplicatedPool.push(q);
  }

  // Helper to pick `targetCount` from a candidate list, strictly exhausting lower `timesUsed` tiers
  // (Priority 1: NEVER-USED `timesUsed === 0` questions first, per Requirements 6 & 15) before moving
  // to any higher `timesUsed` tier, while preferring distinct conceptKeys within each tier.
  const pickFromCandidates = (candidates: readonly Question[], targetCount: number) => {
    if (targetCount <= 0 || candidates.length === 0) return;
    const prioritized = prioritizeAndRandomizeCandidates(candidates, rng);
    let added = 0;

    const tiers = new Map<number, Question[]>();
    for (const q of prioritized) {
      const tUsed = getQuestionUsage(q.questionId || q.id, q).timesUsed;
      const list = tiers.get(tUsed);
      if (list) {
        list.push(q);
      } else {
        tiers.set(tUsed, [q]);
      }
    }

    const sortedTierLevels = Array.from(tiers.keys()).sort((a, b) => a - b);

    for (const tierLevel of sortedTierLevels) {
      if (added >= targetCount || selectedQuestions.length >= count) break;
      const tierCandidates = tiers.get(tierLevel)!;

      // Sub-pass A within this usage tier: Enforce distinct conceptKey so the same stem doesn't repeat
      for (const q of tierCandidates) {
        if (added >= targetCount || selectedQuestions.length >= count) break;
        const cKey = q.conceptKey || computeConceptKey(q.questionText, q.subject, q.chapter, q.topic);
        if (!usedConceptKeys.has(cKey)) {
          if (addQuestion(q)) added++;
        }
      }

      // Sub-pass B within this usage tier: Exhaust remaining unique questions in this tier
      // before ever reusing a question from a higher timesUsed tier
      if (added < targetCount && selectedQuestions.length < count) {
        for (const q of tierCandidates) {
          if (added >= targetCount || selectedQuestions.length >= count) break;
          if (addQuestion(q)) added++;
        }
      }
    }
  };

  // Step 5: Apply Difficulty / Difficulty Distribution (Requirement 18)
  if (difficulty) {
    const exactDiff = deduplicatedPool.filter((q) => q.difficulty === difficulty);
    pickFromCandidates(exactDiff, count);

    if (selectedQuestions.length < count) {
      if (onDistributionAdjusted && exactDiff.length < count) {
        onDistributionAdjusted(
          `Requested ${count} ${difficulty} questions for ${subject}, but only ${exactDiff.length} unique ${difficulty} questions were available. Filled remaining ${count - exactDiff.length} slots with unique questions from adjacent difficulty levels.`
        );
      }
      const remaining = deduplicatedPool.filter((q) => q.difficulty !== difficulty);
      pickFromCandidates(remaining, count - selectedQuestions.length);
    }
  } else if (difficultyDistribution) {
    const easyTarget = Math.round((count * difficultyDistribution.easyPercent) / 100);
    const hardTarget = Math.round((count * difficultyDistribution.hardPercent) / 100);
    const mediumTarget = Math.max(0, count - easyTarget - hardTarget);

    const easyPool = deduplicatedPool.filter((q) => q.difficulty === 'EASY');
    const mediumPool = deduplicatedPool.filter((q) => q.difficulty === 'MEDIUM');
    const hardPool = deduplicatedPool.filter((q) => q.difficulty === 'HARD');

    pickFromCandidates(easyPool, easyTarget);
    pickFromCandidates(mediumPool, mediumTarget);
    pickFromCandidates(hardPool, hardTarget);

    if (selectedQuestions.length < count) {
      const shortfall = count - selectedQuestions.length;
      if (onDistributionAdjusted) {
        onDistributionAdjusted(
          `Adjusted difficulty distribution for ${subject} by ${shortfall} question(s) to preserve 100% question uniqueness.`
        );
      }
      pickFromCandidates(deduplicatedPool, shortfall);
    }
  } else {
    pickFromCandidates(deduplicatedPool, count);
  }

  // Requirement 16: Insufficient Question Bank check
  if (strictCount && selectedQuestions.length < count) {
    throw new InsufficientQuestionBankError(
      count,
      selectedQuestions.length,
      'Not enough unique questions are available for this test. Please add more questions or reduce the number of questions.'
    );
  }

  // Final Fisher-Yates shuffle of selected questions within this section/request
  const finalSelection = shuffle(selectedQuestions, rng);

  // Requirement 2: Final validation on selected questions
  validateGeneratedTestQuestions(finalSelection);

  // Requirement 6: Record global question usage if testIdForTracking is provided
  if (testIdForTracking && finalSelection.length > 0) {
    recordQuestionUsage(
      finalSelection.map((q) => q.questionId || q.id),
      testIdForTracking,
      timestampIso
    );
  }

  return finalSelection;
}

/**
 * Generates a full test question list strictly following an ExamBlueprint (Requirements 7, 17, 18),
 * guaranteeing zero duplicate questionIds and zero duplicate question texts.
 */
export function selectQuestionsForBlueprint(
  questionBank: readonly Question[],
  blueprint: ExamBlueprint,
  testId: string,
  options?: {
    excludeQuestionIds?: Set<string>;
    rng?: () => number;
    timestampIso?: string;
    strictCount?: boolean;
    onDistributionAdjusted?: (notice: string) => void;
  }
): Question[] {
  const usedQuestionIds = new Set<string>(options?.excludeQuestionIds || []);
  const usedFingerprints = new Set<string>();
  const usedNormalizedTexts = new Set<string>();
  const usedConceptKeys = new Set<string>();
  const rng = options?.rng || Math.random;
  const timestampIso = options?.timestampIso || new Date().toISOString();

  const allSelected: Question[] = [];

  for (const section of blueprint.sections) {
    const sectionQuestions = selectQuestionsIntelligent(questionBank, {
      courseId: blueprint.courseId,
      courseType: blueprint.courseType,
      exam: blueprint.exam,
      subject: section.subject,
      questionType: section.questionType,
      count: section.totalQuestions,
      difficultyDistribution: blueprint.difficultyDistribution,
      excludeQuestionIds: usedQuestionIds,
      excludeFingerprints: usedFingerprints,
      excludeNormalizedTexts: usedNormalizedTexts,
      excludeConceptKeys: usedConceptKeys,
      testIdForTracking: testId,
      rng,
      timestampIso,
      strictCount: options?.strictCount,
      onDistributionAdjusted: options?.onDistributionAdjusted,
    }).map((q) => ({
      ...q,
      positiveMarks: section.positiveMarks,
      marks: section.positiveMarks,
      negativeMarks: section.negativeMarks,
      sectionId: section.id,
      sectionName: section.sectionName,
    }));

    for (const sq of sectionQuestions) {
      const qId = sq.questionId || sq.id;
      const fp = sq.fingerprint || computeQuestionFingerprint(sq.questionText, sq.subject, sq.type);
      const norm = sq.normalizedText || normalizeQuestion(sq.questionText);
      const cKey = sq.conceptKey || computeConceptKey(sq.questionText, sq.subject, sq.chapter, sq.topic);
      usedQuestionIds.add(qId);
      usedFingerprints.add(fp);
      usedNormalizedTexts.add(norm);
      usedConceptKeys.add(cKey);
      allSelected.push(sq);
    }
  }

  // Requirement 2: Final validation across the entire generated test
  validateGeneratedTestQuestions(allSelected);

  return allSelected;
}

// ============================================================================
// PART 7: TEST SNAPSHOT & MULTI-ATTEMPT ROTATION ENGINE (Requirements 10, 11, 12)
// ============================================================================

const SET_LABELS = ['Set A', 'Set B', 'Set C', 'Set D', 'Set E', 'Set F'];

/**
 * Resolves the saved snapshot of questions for a test, or generates a new Attempt Set
 * (Attempt 1 -> Set A, Attempt 2 -> Set B, Attempt 3 -> Set C) without repeating questions
 * from previous attempts if sufficient questions exist in the bank.
 * If test.isFixedPaper is true (e.g., Official PYQ Archive paper when user doesn't request a fresh set),
 * it loads the saved test_questions snapshot.
 */
export function createOrResolveAttemptSnapshot(
  test: TestDefinition,
  questionBank: readonly Question[],
  attemptNumber: number,
  blueprintOverride?: ExamBlueprint,
  forceSavedSnapshot = false
): {
  setLabel: string;
  questions: Question[];
  snapshotQuestionIds: string[];
  testQuestions: TestQuestionMapping[];
  updatedSnapshots: TestAttemptSnapshot[];
} {
  const effectiveAttempt = forceSavedSnapshot || test.isFixedPaper ? 1 : Math.max(1, attemptNumber);
  const setIndex = Math.max(0, effectiveAttempt - 1);
  const setLabel = SET_LABELS[setIndex % SET_LABELS.length] || `Set #${effectiveAttempt}`;
  const existingSnapshots = test.attemptSnapshots || [];
  const canonicalTestId = test.testId || test.id;

  const bankMap = new Map<string, Question>();
  questionBank.forEach((q) => {
    bankMap.set(q.id, q);
    if (q.questionId) bankMap.set(q.questionId, q);
  });
  (test.questions || []).forEach((q) => {
    bankMap.set(q.id, q);
    if (q.questionId) bankMap.set(q.questionId, q);
  });

  // 1. Check if this attempt number already has a saved snapshot
  const savedForAttempt = existingSnapshots.find((s) => s.attemptNumber === effectiveAttempt);
  if (savedForAttempt && savedForAttempt.questionIds.length > 0) {
    const resolved = savedForAttempt.questionIds
      .map((id) => bankMap.get(id))
      .filter((q): q is Question => Boolean(q));

    // Verify the saved snapshot has zero internal duplicates
    const uniqueResolvedIds = new Set(resolved.map((q) => q.questionId || q.id));
    if (resolved.length === savedForAttempt.questionIds.length && uniqueResolvedIds.size === resolved.length) {
      const mappings =
        savedForAttempt.testQuestions ||
        buildTestQuestionMappings(canonicalTestId, resolved, effectiveAttempt, savedForAttempt.setLabel);
      return {
        setLabel: savedForAttempt.setLabel,
        questions: resolved,
        snapshotQuestionIds: savedForAttempt.questionIds,
        testQuestions: mappings,
        updatedSnapshots: existingSnapshots,
      };
    }
  }

  // 2. If Attempt 1 and test already has valid deduplicated saved questions, preserve its snapshot!
  if (effectiveAttempt === 1 && test.questions && test.questions.length > 0) {
    const ids = test.questions.map((q) => q.questionId || q.id);
    const norms = test.questions.map((q) => normalizeQuestion(q.questionText));
    if (new Set(ids).size === ids.length && new Set(norms).size === norms.length) {
      const mappings =
        test.testQuestions && test.testQuestions.length === ids.length
          ? test.testQuestions
          : buildTestQuestionMappings(canonicalTestId, test.questions, 1, 'Set A');
      const snapshot: TestAttemptSnapshot = {
        attemptNumber: 1,
        setLabel: 'Set A',
        questionIds: ids,
        testQuestions: mappings,
        createdAt: test.createdAt || new Date().toISOString(),
      };
      return {
        setLabel: 'Set A',
        questions: test.questions,
        snapshotQuestionIds: ids,
        testQuestions: mappings,
        updatedSnapshots: [snapshot, ...existingSnapshots.filter((s) => s.attemptNumber !== 1)],
      };
    }
  }

  // 3. For Attempt 2, 3, ... (or if Attempt 1 had malformed/duplicate questions), generate a fresh unique Question Set!
  const previouslyUsedInThisTest = new Set<string>();
  if (effectiveAttempt > 1) {
    existingSnapshots.forEach((snap) => {
      snap.questionIds.forEach((id) => previouslyUsedInThisTest.add(id));
    });
    (test.questions || []).forEach((q) => previouslyUsedInThisTest.add(q.questionId || q.id));
  }

  let newQuestions: Question[] = [];
  const blueprint =
    blueprintOverride ||
    (test.examType === 'JEE_MAIN' && (test.testType === 'FULL_MOCK' || test.testType === 'PYQ_PAPER')
      ? OFFICIAL_EXAM_BLUEPRINTS.JEE_MAIN_2026
      : test.examType === 'NEET' && (test.testType === 'FULL_MOCK' || test.testType === 'PYQ_PAPER')
      ? OFFICIAL_EXAM_BLUEPRINTS.NEET_UG_2026
      : test.examType === 'JEE_ADVANCED' && test.testType === 'JEE_ADVANCED_PAPER1'
      ? OFFICIAL_EXAM_BLUEPRINTS.JEE_ADVANCED_2026_PAPER1
      : test.examType === 'JEE_ADVANCED' && test.testType === 'JEE_ADVANCED_PAPER2'
      ? OFFICIAL_EXAM_BLUEPRINTS.JEE_ADVANCED_2026_PAPER2
      : undefined);

  const attemptTrackingId = `${canonicalTestId}_attempt_${effectiveAttempt}`;

  if (blueprint) {
    newQuestions = selectQuestionsForBlueprint(questionBank, blueprint, attemptTrackingId, {
      excludeQuestionIds: previouslyUsedInThisTest,
    });
  } else {
    const usedIds = new Set<string>(previouslyUsedInThisTest);
    const usedFps = new Set<string>();
    const usedNorms = new Set<string>();
    const usedConcepts = new Set<string>();
    const totalNeeded = test.questionsCount || (test.questions || []).length || 25;
    const subjects = test.subjects && test.subjects.length > 0 ? test.subjects : (['Physics'] as SubjectName[]);
    const basePerSubject = Math.floor(totalNeeded / subjects.length);
    const remainder = totalNeeded % subjects.length;

    subjects.forEach((subj, idx) => {
      const subjCount = basePerSubject + (idx < remainder ? 1 : 0);
      const picked = selectQuestionsIntelligent(questionBank, {
        courseId: test.courseId,
        courseType: test.courseType,
        exam: test.examType,
        subject: subj,
        count: subjCount,
        excludeQuestionIds: usedIds,
        excludeFingerprints: usedFps,
        excludeNormalizedTexts: usedNorms,
        excludeConceptKeys: usedConcepts,
        testIdForTracking: attemptTrackingId,
      });
      picked.forEach((q) => {
        usedIds.add(q.questionId || q.id);
        if (q.fingerprint) usedFps.add(q.fingerprint);
        if (q.normalizedText) usedNorms.add(q.normalizedText);
        if (q.conceptKey) usedConcepts.add(q.conceptKey);
        newQuestions.push(q);
      });
    });
  }

  validateGeneratedTestQuestions(newQuestions);

  const newIds = newQuestions.map((q) => q.questionId || q.id);
  const mappings = buildTestQuestionMappings(canonicalTestId, newQuestions, effectiveAttempt, setLabel);
  const newSnap: TestAttemptSnapshot = {
    attemptNumber: effectiveAttempt,
    setLabel,
    questionIds: newIds,
    testQuestions: mappings,
    createdAt: new Date().toISOString(),
  };

  return {
    setLabel,
    questions: newQuestions,
    snapshotQuestionIds: newIds,
    testQuestions: mappings,
    updatedSnapshots: [...existingSnapshots.filter((s) => s.attemptNumber !== effectiveAttempt), newSnap],
  };
}

/**
 * Audits a list of tests and the centralized question bank to verify:
 * 1. Zero duplicate questions within any single test (by ID and by normalized text)
 * 2. Distinct question snapshots across tests
 * 3. Usage rotation metrics (Never used, Least used, Max used)
 */
export function auditQuestionBankAndTests(
  questionBank: readonly Question[],
  tests: readonly TestDefinition[]
) {
  let duplicateIdsInTests = 0;
  let duplicateFingerprintsInTests = 0;
  let identicalTestSnapshotsCount = 0;
  const snapshotSignatures = new Set<string>();

  const perTestAudit: Array<{
    testId: string;
    title: string;
    totalQuestions: number;
    uniqueIds: number;
    uniqueFingerprints: number;
    hasDuplicates: boolean;
  }> = [];

  for (const t of tests) {
    const ids = new Set<string>();
    const fps = new Set<string>();
    for (const q of t.questions || []) {
      const qid = q.questionId || q.id;
      const fp = normalizeQuestion(q.questionText);
      if (ids.has(qid)) duplicateIdsInTests++;
      if (fps.has(fp)) duplicateFingerprintsInTests++;
      ids.add(qid);
      fps.add(fp);
    }

    const sig = Array.from(ids).sort().join(',');
    if (sig && snapshotSignatures.has(sig)) {
      identicalTestSnapshotsCount++;
    } else if (sig) {
      snapshotSignatures.add(sig);
    }

    perTestAudit.push({
      testId: t.testId || t.id,
      title: t.title,
      totalQuestions: (t.questions || []).length,
      uniqueIds: ids.size,
      uniqueFingerprints: fps.size,
      hasDuplicates: ids.size !== (t.questions || []).length || fps.size !== (t.questions || []).length,
    });
  }

  let neverUsedCount = 0;
  let usedOnceCount = 0;
  let usedMultipleCount = 0;

  for (const q of questionBank) {
    const u = getQuestionUsage(q.questionId || q.id, q);
    if (u.timesUsed === 0) neverUsedCount++;
    else if (u.timesUsed === 1) usedOnceCount++;
    else usedMultipleCount++;
  }

  return {
    totalBankQuestions: questionBank.length,
    totalTestsAudited: tests.length,
    duplicateIdsInTests,
    duplicateFingerprintsInTests,
    identicalTestSnapshotsCount,
    zeroDuplicatesVerified:
      duplicateIdsInTests === 0 &&
      duplicateFingerprintsInTests === 0 &&
      identicalTestSnapshotsCount === 0,
    neverUsedCount,
    usedOnceCount,
    usedMultipleCount,
    perTestAudit,
  };
}
