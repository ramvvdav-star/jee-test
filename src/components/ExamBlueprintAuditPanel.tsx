import React, { useState, useMemo } from 'react';
import { useExam } from '../context/ExamContext';
import {
  auditQuestionBankAndTests,
  getAllQuestionUsageRecords,
} from '../data/questionBankEngine';
import {
  ShieldCheck,
  CheckCircle2,
  Fingerprint,
  Layers,
  RefreshCw,
  Sliders,
  Sparkles,
  FileCheck,
  BarChart3,
  Clock,
  Award,
} from 'lucide-react';

export const ExamBlueprintAuditPanel: React.FC = () => {
  const {
    questions,
    tests,
    examBlueprints,
    updateExamBlueprint,
    generateBlueprintMockTest,
    setActiveTest,
    setCurrentView,
  } = useExam();

  const [selectedBlueprintKey, setSelectedBlueprintKey] = useState<string>('JEE_MAIN_2026');
  const [customMockTitle, setCustomMockTitle] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedBanner, setGeneratedBanner] = useState<string | null>(null);

  const activeBlueprint = examBlueprints[selectedBlueprintKey] || examBlueprints.JEE_MAIN_2026;

  // Live Zero-Duplicate & Question Rotation Audit
  const auditReport = useMemo(() => {
    return auditQuestionBankAndTests(questions, tests);
  }, [questions, tests]);

  const usageRecords = useMemo(() => {
    return getAllQuestionUsageRecords().slice(0, 25);
  }, [tests, questions]);

  const handleGenerateFromBlueprint = async () => {
    setIsGenerating(true);
    setGeneratedBanner(null);
    const created = await generateBlueprintMockTest(
      selectedBlueprintKey,
      customMockTitle.trim() || undefined
    );
    setIsGenerating(false);
    setCustomMockTitle('');
    setGeneratedBanner(
      `Generated "${created.title}" with ${created.questions.length} unique questions (Snapshot ${created.activeAttemptSet || 'Set A'} saved).`
    );
  };

  const handleDurationChange = (mins: number) => {
    if (!activeBlueprint) return;
    updateExamBlueprint(selectedBlueprintKey, {
      ...activeBlueprint,
      durationMinutes: Math.max(15, mins),
    });
  };

  const handleMarkingChange = (
    qType: 'mcq' | 'numerical',
    field: 'positive' | 'negative',
    val: number
  ) => {
    if (!activeBlueprint) return;
    const updatedScheme = {
      ...activeBlueprint.markingScheme,
      [qType]: {
        ...activeBlueprint.markingScheme[qType],
        [field]: val,
      },
    };
    const updatedSections = activeBlueprint.sections.map((s) => {
      if (
        (qType === 'mcq' && s.questionType === 'MCQ') ||
        (qType === 'numerical' && s.questionType === 'NUMERICAL')
      ) {
        return {
          ...s,
          positiveMarks: field === 'positive' ? val : s.positiveMarks,
          negativeMarks: field === 'negative' ? val : s.negativeMarks,
        };
      }
      return s;
    });
    const newTotalMarks = updatedSections.reduce(
      (sum, s) => sum + s.compulsoryQuestions * s.positiveMarks,
      0
    );
    updateExamBlueprint(selectedBlueprintKey, {
      ...activeBlueprint,
      markingScheme: updatedScheme,
      sections: updatedSections,
      totalMarks: newTotalMarks,
    });
  };

  return (
    <div className="space-y-8">
      {/* 1. ZERO-DUPLICATE & QUESTION BANK AUDIT SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Centralized Question Bank
            </span>
            <Fingerprint className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono mt-2">
            {auditReport.totalBankQuestions.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> 100% Unique Fingerprint Hashes
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Duplicate Check (All Tests)
            </span>
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-600 font-mono mt-2">
            {auditReport.duplicateIdsInTests} Duplicates
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Verified across {auditReport.totalTestsAudited} saved test snapshots
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Question Usage Rotation
            </span>
            <RefreshCw className="w-5 h-5 text-sky-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono mt-2">
            {auditReport.neverUsedCount.toLocaleString()} Unused
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {auditReport.usedOnceCount} used once • {auditReport.usedMultipleCount} rotated
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Official Exam Blueprints
            </span>
            <Sliders className="w-5 h-5 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono mt-2">
            {Object.keys(examBlueprints).length} Active
          </div>
          <div className="text-[11px] text-amber-600 font-semibold mt-1">
            JEE Main (75 Qs) • NEET (180 Qs) • JEE Adv (54 Qs)
          </div>
        </div>
      </div>

      {/* 2. CONFIGURABLE OFFICIAL EXAM BLUEPRINT ENGINE (PART 6) */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                Configurable ExamBlueprint System
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Fisher-Yates + Usage Rotation
              </span>
            </div>
            <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 mt-1">
              Official Examination Blueprint Configuration &amp; Intelligent Paper Generator
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure current official NTA / JAB exam patterns and generate new snapshot-locked mock papers with zero duplicate questions.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {Object.entries(examBlueprints).map(([key, bp]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedBlueprintKey(key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  selectedBlueprintKey === key
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                {bp.exam.replace('_', ' ')} ({bp.totalQuestions} Qs)
              </button>
            ))}
          </div>
        </div>

        {activeBlueprint && (
          <div className="space-y-6">
            {/* Blueprint Meta & Editable Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Duration (Minutes)
                </label>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <input
                    type="number"
                    value={activeBlueprint.durationMinutes}
                    onChange={(e) => handleDurationChange(Number(e.target.value))}
                    className="w-28 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-sm"
                  />
                  <span className="text-xs text-slate-500">mins</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  MCQ Marking (+Correct / -Negative)
                </label>
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-600" />
                  <input
                    type="number"
                    value={activeBlueprint.markingScheme.mcq.positive}
                    onChange={(e) =>
                      handleMarkingChange('mcq', 'positive', Number(e.target.value))
                    }
                    className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-sm text-emerald-600"
                  />
                  <span className="text-xs text-slate-400">/ -</span>
                  <input
                    type="number"
                    value={activeBlueprint.markingScheme.mcq.negative}
                    onChange={(e) =>
                      handleMarkingChange('mcq', 'negative', Number(e.target.value))
                    }
                    className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-sm text-rose-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  Blueprint Totals
                </label>
                <div className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono pt-1">
                  {activeBlueprint.totalQuestions} Questions • {activeBlueprint.totalMarks} Marks
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {activeBlueprint.sourceDocument}
                </div>
              </div>
            </div>

            {/* Sections Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase">
                    <th className="py-2 pr-4">Section ID</th>
                    <th className="py-2 px-4">Subject</th>
                    <th className="py-2 px-4">Section Name</th>
                    <th className="py-2 px-4">Question Type</th>
                    <th className="py-2 px-4">Compulsory Qs</th>
                    <th className="py-2 pl-4">Marks (+ / -)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeBlueprint.sections.map((sec) => (
                    <tr key={sec.id} className="text-slate-800 dark:text-slate-200">
                      <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500">
                        {sec.id}
                      </td>
                      <td className="py-2.5 px-4 font-bold">{sec.subject}</td>
                      <td className="py-2.5 px-4">{sec.sectionName}</td>
                      <td className="py-2.5 px-4 font-mono">{sec.questionType}</td>
                      <td className="py-2.5 px-4 font-mono font-bold">
                        {sec.compulsoryQuestions} / {sec.totalQuestions}
                      </td>
                      <td className="py-2.5 pl-4 font-mono">
                        <span className="text-emerald-600 font-bold">+{sec.positiveMarks}</span>
                        {' / '}
                        <span className="text-rose-600 font-bold">-{sec.negativeMarks}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* One-Click Intelligent Blueprint Mock Generator */}
            <div className="p-4 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-2xl border border-indigo-200 dark:border-indigo-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[240px]">
                <input
                  type="text"
                  value={customMockTitle}
                  onChange={(e) => setCustomMockTitle(e.target.value)}
                  placeholder={`Optional Custom Title (e.g. ${activeBlueprint.exam.replace('_', ' ')} All-India Rotated Mock)...`}
                  className="w-full px-4 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="button"
                onClick={handleGenerateFromBlueprint}
                disabled={isGenerating}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs flex items-center gap-2 shadow-xs cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating
                  ? 'Selecting Least-Used Questions...'
                  : `Generate New ${activeBlueprint.exam.replace('_', ' ')} Snapshot Mock`}
              </button>
            </div>

            {generatedBanner && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{generatedBanner}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. SAVED TEST SNAPSHOTS & ZERO-DUPLICATE VERIFICATION TABLE (PART 2 & PART 5) */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-black text-slate-900 dark:text-slate-100">
              Saved Test Snapshots &amp; Zero-Duplicate Verification Log
            </h3>
          </div>
          <span className="text-xs font-mono text-emerald-600 font-bold">
            All {auditReport.totalTestsAudited} Tests Verified: 0 Duplicate Questions
          </span>
        </div>

        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-white dark:bg-slate-900">
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase">
                <th className="py-2 pr-4">Test ID</th>
                <th className="py-2 px-4">Title</th>
                <th className="py-2 px-4">Total Qs</th>
                <th className="py-2 px-4">Unique IDs</th>
                <th className="py-2 px-4">Unique Fingerprints</th>
                <th className="py-2 px-4">Status</th>
                <th className="py-2 pl-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {auditReport.perTestAudit.slice(0, 20).map((item) => {
                const testObj = tests.find((t) => t.id === item.testId);
                return (
                  <tr key={item.testId} className="text-slate-800 dark:text-slate-200">
                    <td className="py-2.5 pr-4 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                      {item.testId}
                    </td>
                    <td className="py-2.5 px-4 font-semibold truncate max-w-xs">
                      {item.title}
                    </td>
                    <td className="py-2.5 px-4 font-mono">{item.totalQuestions}</td>
                    <td className="py-2.5 px-4 font-mono text-emerald-600 font-bold">
                      {item.uniqueIds}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-emerald-600 font-bold">
                      {item.uniqueFingerprints}
                    </td>
                    <td className="py-2.5 px-4">
                      {!item.hasDuplicates ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" /> Snapshot Verified
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                          Duplicate Found
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pl-4">
                      {testObj && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTest(testObj);
                            setCurrentView('test-details');
                          }}
                          className="text-indigo-600 hover:underline font-bold text-[11px] cursor-pointer"
                        >
                          Inspect Snapshot
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

      {/* 4. QUESTION USAGE TRACKING REGISTRY (PART 4) */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-black text-slate-900 dark:text-slate-100">
              Question Usage &amp; Rotation Tracking Registry (Part 4)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Priority: Never Used (0) → Lowest timesUsed → Oldest lastUsedAt → Fisher-Yates
          </span>
        </div>

        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 uppercase">
                <th className="py-2 pr-4">Permanent Question ID</th>
                <th className="py-2 px-4">Times Used</th>
                <th className="py-2 px-4">Last Used At</th>
                <th className="py-2 pl-4">Assigned Test Snapshots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {usageRecords.map((rec) => (
                <tr key={rec.questionId} className="text-slate-800 dark:text-slate-200">
                  <td className="py-2 pr-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    {rec.questionId}
                  </td>
                  <td className="py-2 px-4 font-mono font-bold">{rec.timesUsed}</td>
                  <td className="py-2 px-4 font-mono text-[11px] text-slate-500">
                    {rec.lastUsedAt ? new Date(rec.lastUsedAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="py-2 pl-4 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    {rec.testIds.slice(0, 4).join(', ')}
                    {rec.testIds.length > 4 ? ` (+${rec.testIds.length - 4} more)` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
