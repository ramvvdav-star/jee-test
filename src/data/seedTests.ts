import { TestDefinition } from '../types/exam';
import { getAllFullLengthPapers, getCentralizedQuestionBank } from './fullLengthPapersGenerator';
import {
  selectQuestionsIntelligent,
  createDeterministicRng,
  buildTestQuestionMappings,
  validateGeneratedTestQuestions,
} from './questionBankEngine';

const fullLengthPapers = getAllFullLengthPapers();
const centralBank = getCentralizedQuestionBank();

const phyChapterQuestions = selectQuestionsIntelligent(centralBank, {
  exam: 'JEE_MAIN',
  subject: 'Physics',
  count: 15,
  testIdForTracking: 'jee-phy-chapter-01',
  rng: createDeterministicRng(7001),
});
validateGeneratedTestQuestions(phyChapterQuestions);

const bioChapterQuestions = [
  ...selectQuestionsIntelligent(centralBank, {
    exam: 'NEET',
    subject: 'Botany',
    count: 10,
    testIdForTracking: 'neet-bio-chapter-01',
    rng: createDeterministicRng(7002),
  }),
  ...selectQuestionsIntelligent(centralBank, {
    exam: 'NEET',
    subject: 'Zoology',
    count: 10,
    testIdForTracking: 'neet-bio-chapter-01',
    rng: createDeterministicRng(7003),
  }),
];
validateGeneratedTestQuestions(bioChapterQuestions);

const chapterTests: TestDefinition[] = [
  {
    id: 'jee-phy-chapter-01',
    testId: 'jee-phy-chapter-01',
    title: 'JEE Physics: Electrostatics & Rotational Mechanics Sprint',
    subtitle: 'High-Yield Chapter Test with Detailed Numerical Problems',
    courseId: 'course_jee',
    courseType: 'JEE',
    examType: 'JEE_MAIN',
    testType: 'CHAPTER_TEST',
    patternYear: 2026,
    durationMinutes: 45,
    totalMarks: 60,
    positiveMarks: 4,
    negativeMarks: 1,
    subjects: ['Physics'],
    questionsCount: phyChapterQuestions.length,
    difficulty: 'HARD',
    syllabus: [
      'Electrostatics: Capacitance with Dielectrics, Potential Energy',
      'Mechanics: Rolling Motion without Slipping, Moment of Inertia',
      'Current Electricity: Bridge networks, EMF induction',
    ],
    description: 'Fast-paced chapter test targeting challenging concepts in Electrodynamics and Mechanics.',
    published: true,
    createdAt: '2026-02-10T12:00:00Z',
    attemptsCount: 1540,
    avgScore: 36,
    questions: phyChapterQuestions,
    snapshotQuestionIds: phyChapterQuestions.map((q) => q.questionId || q.id),
    testQuestions: buildTestQuestionMappings('jee-phy-chapter-01', phyChapterQuestions, 1, 'Set A'),
    attemptSnapshots: [
      {
        attemptNumber: 1,
        setLabel: 'Set A',
        questionIds: phyChapterQuestions.map((q) => q.questionId || q.id),
        testQuestions: buildTestQuestionMappings('jee-phy-chapter-01', phyChapterQuestions, 1, 'Set A'),
        createdAt: '2026-02-10T12:00:00Z',
      },
    ],
    activeAttemptSet: 'Set A',
  },
  {
    id: 'neet-bio-chapter-01',
    testId: 'neet-bio-chapter-01',
    title: 'NEET Biology: Genetics, Cell Cycle & Physiology Sprint',
    subtitle: 'Targeted High-Scoring NCERT Concept Test',
    courseId: 'course_neet',
    courseType: 'NEET',
    examType: 'NEET',
    testType: 'CHAPTER_TEST',
    patternYear: 2026,
    durationMinutes: 45,
    totalMarks: 80,
    positiveMarks: 4,
    negativeMarks: 1,
    subjects: ['Botany', 'Zoology'],
    questionsCount: bioChapterQuestions.length,
    difficulty: 'MEDIUM',
    syllabus: [
      'Botany: Mendelian Genetics, C4 Cycle, Prophase I Meiosis',
      'Zoology: Hypothalamic & Pituitary Hormones, Cardiac Output & PCR',
    ],
    description: 'Focus on pure NCERT-based core concepts with speed and zero-mistake accuracy.',
    published: true,
    createdAt: '2026-02-12T14:00:00Z',
    attemptsCount: 2890,
    avgScore: 48,
    questions: bioChapterQuestions,
    snapshotQuestionIds: bioChapterQuestions.map((q) => q.questionId || q.id),
    testQuestions: buildTestQuestionMappings('neet-bio-chapter-01', bioChapterQuestions, 1, 'Set A'),
    attemptSnapshots: [
      {
        attemptNumber: 1,
        setLabel: 'Set A',
        questionIds: bioChapterQuestions.map((q) => q.questionId || q.id),
        testQuestions: buildTestQuestionMappings('neet-bio-chapter-01', bioChapterQuestions, 1, 'Set A'),
        createdAt: '2026-02-12T14:00:00Z',
      },
    ],
    activeAttemptSet: 'Set A',
  },
];

export const SEED_TESTS: TestDefinition[] = [...fullLengthPapers, ...chapterTests];

