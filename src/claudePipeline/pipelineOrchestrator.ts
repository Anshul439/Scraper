// updatedPipelineOrchestrator.ts
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { PipelineConfig, PipelineResult } from "../types/pipeline.types";
import { TaggedQuestion } from "../types/questions.types";
import {
  processPdfsDirectly,
  flattenBatchResults,
  BatchProcessResult,
  EnhancedExamContext,
} from "../directPdfProcessor";

/**
 * Updated pipeline function using direct PDF processing with Claude
 */
export async function runDirectPdfExtractionPipeline(
  config: PipelineConfig
): Promise<PipelineResult> {
  const startTime = Date.now();
  const result: PipelineResult = {
    success: false,
    summary: {
      pdfsProcessed: 0,
      questionsExtracted: 0,
      questionsTagged: 0,
      timeElapsed: "0s",
    },
    outputs: {
      taggedQuestions: "",
      statistics: "",
    },
    errors: [],
  };

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🚀 Starting Direct PDF Extraction Pipeline`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Input directory: ${config.inputDir}`);
    console.log(`Output directory: ${config.outputDir}`);
    if (config.exam?.name) {
      console.log(
        `Exam: ${config.exam.name} ${
          config.exam.year ? `(${config.exam.year})` : ""
        }`
      );
    }

    // Ensure output directory exists
    if (!existsSync(config.outputDir)) {
      mkdirSync(config.outputDir, { recursive: true });
    }

    // Load exam configuration from config.json
    function loadExamConfig(examName?: string): {
      examKey: string[];
      allowedYears: string[];
    } {
      try {
        const configPath = "./config.json";
        if (existsSync(configPath)) {
          const configData = readFileSync(configPath, "utf8");
          const config = JSON.parse(configData);

          if (config.exams && Array.isArray(config.exams)) {
            // If examName is provided, find specific exam config
            if (examName) {
              const examConfig = config.exams.find(
                (exam: any) =>
                  exam.examName === examName ||
                  exam.examName
                    ?.toLowerCase()
                    .includes(examName.toLowerCase()) ||
                  exam.examKey?.some((key: string) =>
                    examName.toLowerCase().includes(key.toLowerCase())
                  )
              );

              if (examConfig) {
                return {
                  examKey: Array.isArray(examConfig.examKey)
                    ? examConfig.examKey
                    : [examConfig.examKey],
                  allowedYears: examConfig.years || [],
                };
              }
            }

            // Fallback: use first exam config
            const firstExam = config.exams[0];
            return {
              examKey: Array.isArray(firstExam.examKey)
                ? firstExam.examKey
                : [firstExam.examKey],
              allowedYears: firstExam.years || [],
            };
          }
        }
      } catch (error) {
        console.log("Error loading exam config, using defaults:", error);
      }

      // Default fallback
      return {
        examKey: ["ssc", "chsl"],
        allowedYears: ["2020", "2021"],
      };
    }

    // Load year configuration from config.json
    function loadYearConfig(examName?: string): { allowedYears: string[] } {
      try {
        const configPath = "./config.json";
        if (existsSync(configPath)) {
          const configData = readFileSync(configPath, "utf8");
          const config = JSON.parse(configData);

          if (config.exams && Array.isArray(config.exams)) {
            // If examName is provided, find specific exam config
            if (examName) {
              const examConfig = config.exams.find(
                (exam: any) =>
                  exam.examName === examName ||
                  exam.examName?.toLowerCase().includes(examName.toLowerCase())
              );

              if (examConfig) {
                return {
                  allowedYears: examConfig.years || [],
                };
              }
            }

            // Fallback: use first exam config years
            const firstExam = config.exams[0];
            return {
              allowedYears: firstExam.years || [],
            };
          }
        }
      } catch (error) {
        console.log("Error loading year config, using defaults:", error);
      }

      // Default fallback
      return {
        allowedYears: ["2020", "2021"],
      };
    }

    // Create simplified exam context with only year filtering
const yearConfig = loadYearConfig(config.exam?.name);
const examContext: EnhancedExamContext = {
  examFullName: config.exam?.name || 'Government Competitive Examination',
  allowedYears: yearConfig.allowedYears,
  strictYearFiltering: true, // Enable strict year filtering
  year: config.exam?.year,
  description: 'Government competitive examination',
  knownSubjects: ['Reasoning', 'General Knowledge', 'Quantitative Aptitude', 'English'],
  commonTopics: [
    'Logical Reasoning', 'Verbal Reasoning', 'Mathematical Reasoning',
    'Current Affairs', 'General Science', 'History', 'Geography', 'Polity',
    'Arithmetic', 'Algebra', 'Geometry', 'Statistics',
    'Grammar', 'Vocabulary', 'Comprehension'
  ]
};

console.log(`🔍 Year Filtering Configuration:`);
console.log(`   - Allowed Years: ${yearConfig.allowedYears.join(', ')}`);
console.log(`   - Strict Year Filtering: ${examContext.strictYearFiltering}`);

    // Create enhanced exam context with proper filtering
    const examConfig = loadExamConfig(config.exam?.name);

    console.log(`🔍 Exam Filtering Configuration:`);
    console.log(`   - Exam Keys: ${examConfig.examKey.join(", ")}`);
    console.log(`   - Allowed Years: ${examConfig.allowedYears.join(", ")}`);
    console.log(`   - Strict Filtering: ${examContext.strictYearFiltering}`);

    // Step 1: Process PDFs directly with Claude
    console.log(`\n📄 Step 1: Processing PDFs directly with Claude AI`);
    const batchResult: BatchProcessResult = await processPdfsDirectly(
      config.inputDir,
      config.claude,
      examContext,
      {
        maxFiles: config.options?.maxFiles,
        delayBetweenFiles: config.options?.delayBetweenFiles || 3000,
      }
    );

    if (!batchResult.success || batchResult.results.length === 0) {
      throw new Error("No PDFs were successfully processed");
    }

    result.summary.pdfsProcessed = batchResult.totalFiles;
    result.summary.questionsExtracted = batchResult.totalQuestions;
    result.summary.questionsTagged = batchResult.totalQuestions; // Since extraction and tagging happen together
    result.errors.push(...batchResult.errors);

    // Flatten all questions from batch results
    const allTaggedQuestions = flattenBatchResults(batchResult);

    if (allTaggedQuestions.length === 0) {
      throw new Error("No questions were extracted from PDFs");
    }

    // Step 2: Save Results and Generate Statistics
    console.log(`\n💾 Step 2: Saving results and generating statistics`);

    // Save tagged questions
    const taggedQuestionsPath = join(config.outputDir, "tagged-questions.json");
    writeFileSync(
      taggedQuestionsPath,
      JSON.stringify(allTaggedQuestions, null, 2)
    );
    result.outputs.taggedQuestions = taggedQuestionsPath;

    // Generate and save comprehensive statistics
    const stats = generateDirectPipelineStats(batchResult, allTaggedQuestions);
    const statsPath = join(config.outputDir, "pipeline-statistics.json");
    writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    result.outputs.statistics = statsPath;

    // Save human-readable summary
    const summaryPath = join(config.outputDir, "summary.txt");
    const summaryText = generateDirectPipelineSummary(stats, config);
    writeFileSync(summaryPath, summaryText);

    // Save detailed PDF processing results
    if (config.options?.saveIntermediateResults) {
      const detailedResultsPath = join(
        config.outputDir,
        "detailed-pdf-results.json"
      );
      writeFileSync(detailedResultsPath, JSON.stringify(batchResult, null, 2));
      result.outputs.detailedResults = detailedResultsPath;
      console.log(`💾 Saved detailed results: ${detailedResultsPath}`);
    }

    console.log(`✅ Saved tagged questions: ${taggedQuestionsPath}`);
    console.log(`📊 Saved statistics: ${statsPath}`);
    console.log(`📄 Saved summary: ${summaryPath}`);

    // Calculate elapsed time
    const endTime = Date.now();
    const elapsedSeconds = Math.round((endTime - startTime) / 1000);
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const remainingSeconds = elapsedSeconds % 60;
    result.summary.timeElapsed =
      elapsedMinutes > 0
        ? `${elapsedMinutes}m ${remainingSeconds}s`
        : `${elapsedSeconds}s`;

    result.success = true;

    // Final summary
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎉 Direct PDF Pipeline Completed Successfully!`);
    console.log(`${"=".repeat(60)}`);
    console.log(`📊 Final Summary:`);
    console.log(`   PDFs processed: ${result.summary.pdfsProcessed}`);
    console.log(
      `   Questions extracted & tagged: ${result.summary.questionsTagged}`
    );
    console.log(
      `   Success rate: ${(
        (batchResult.results.filter((r) => r.success).length /
          batchResult.totalFiles) *
        100
      ).toFixed(1)}%`
    );
    console.log(
      `   Average questions/PDF: ${(
        result.summary.questionsTagged / result.summary.pdfsProcessed
      ).toFixed(1)}`
    );
    console.log(`   Time elapsed: ${result.summary.timeElapsed}`);
    console.log(`   Output directory: ${config.outputDir}`);

    if (result.errors.length > 0) {
      console.log(`\n⚠️  ${result.errors.length} warnings/errors occurred:`);
      result.errors
        .slice(0, 5)
        .forEach((error) => console.log(`   - ${error}`));
      if (result.errors.length > 5) {
        console.log(
          `   ... and ${result.errors.length - 5} more (check detailed logs)`
        );
      }
    }
  } catch (error) {
    result.success = false;
    result.errors.push(`Pipeline failed: ${(error as Error).message}`);

    const endTime = Date.now();
    const elapsedSeconds = Math.round((endTime - startTime) / 1000);
    result.summary.timeElapsed = `${elapsedSeconds}s`;

    console.error(`\n❌ Pipeline failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Generate comprehensive statistics for direct PDF processing
 */
function generateDirectPipelineStats(
  batchResult: BatchProcessResult,
  allQuestions: TaggedQuestion[]
) {
  // PDF processing stats
  const pdfStats = {
    totalFiles: batchResult.totalFiles,
    successfulFiles: batchResult.results.filter((r) => r.success).length,
    failedFiles: batchResult.results.filter((r) => !r.success).length,
    successRate: `${(
      (batchResult.results.filter((r) => r.success).length /
        batchResult.totalFiles) *
      100
    ).toFixed(1)}%`,
    totalQuestions: batchResult.totalQuestions,
    avgQuestionsPerFile:
      Math.round(
        (batchResult.totalQuestions /
          batchResult.results.filter((r) => r.success).length) *
          100
      ) / 100,
    processingTimes: batchResult.results.map((r) => ({
      fileName: r.fileName,
      timeMs: r.metadata.processingTime,
      questionCount: r.questions.length,
    })),
  };

  // Question analysis stats
  const bySubject: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  const byQuestionType: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const examKeys = new Set<string>();
  const years = new Set<string>();

  allQuestions.forEach((q) => {
    // Count by subject
    bySubject[q.subject || "Unknown"] =
      (bySubject[q.subject || "Unknown"] || 0) + 1;

    // Count by difficulty
    byDifficulty[q.difficulty || "unknown"] =
      (byDifficulty[q.difficulty || "unknown"] || 0) + 1;

    // Count by question type
    byQuestionType[q.questionType || "Unknown"] =
      (byQuestionType[q.questionType || "Unknown"] || 0) + 1;

    // Count topics
    (q.topics || []).forEach((topic) => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });

    // Collect exam keys and years
    if (q.examKey) examKeys.add(q.examKey);
    if (q.year) years.add(q.year);
  });

  // Get top topics
  const topTopics = Object.entries(topicCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([topic, count]) => ({ topic, count }));

  const questionAnalysis = {
    totalQuestions: allQuestions.length,
    bySubject,
    byDifficulty,
    byQuestionType,
    topTopics,
    examKeys: Array.from(examKeys),
    years: Array.from(years),
    questionsWithOptions: allQuestions.filter(
      (q) => q.options && q.options.length > 0
    ).length,
    questionsWithAnswers: allQuestions.filter((q) => q.answer).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    processingMethod: "Direct PDF Processing with Claude AI",
    pipeline: {
      pdfProcessing: pdfStats,
      questionAnalysis: questionAnalysis,
      errors: batchResult.errors,
    },
  };
}

/**
 * Generate human-readable summary for direct processing
 */
function generateDirectPipelineSummary(
  stats: any,
  config: PipelineConfig
): string {
  const lines = [
    "=".repeat(60),
    "DIRECT PDF EXTRACTION PIPELINE SUMMARY",
    "=".repeat(60),
    "",
    `Generated: ${new Date(stats.generatedAt).toLocaleString()}`,
    `Processing Method: ${stats.processingMethod}`,
    `Input Directory: ${config.inputDir}`,
    `Output Directory: ${config.outputDir}`,
    "",
    "PDF PROCESSING:",
    `  Total PDFs: ${stats.pipeline.pdfProcessing.totalFiles}`,
    `  Successful: ${stats.pipeline.pdfProcessing.successfulFiles}`,
    `  Failed: ${stats.pipeline.pdfProcessing.failedFiles}`,
    `  Success Rate: ${stats.pipeline.pdfProcessing.successRate}`,
    `  Total Questions: ${stats.pipeline.pdfProcessing.totalQuestions}`,
    `  Average Questions/PDF: ${stats.pipeline.pdfProcessing.avgQuestionsPerFile}`,
    "",
  ];

  lines.push("QUESTION ANALYSIS:");
  lines.push(
    `  Total Questions: ${stats.pipeline.questionAnalysis.totalQuestions}`
  );
  lines.push(
    `  Questions with Options: ${stats.pipeline.questionAnalysis.questionsWithOptions}`
  );
  lines.push(
    `  Questions with Answers: ${stats.pipeline.questionAnalysis.questionsWithAnswers}`
  );
  lines.push(
    `  Exam Keys Found: ${
      stats.pipeline.questionAnalysis.examKeys.join(", ") || "None"
    }`
  );
  lines.push(
    `  Years Found: ${
      stats.pipeline.questionAnalysis.years.join(", ") || "None"
    }`
  );
  lines.push("");

  // Question types breakdown
  lines.push("  Question Types:");
  Object.entries(stats.pipeline.questionAnalysis.byQuestionType).forEach(
    ([type, count]) => {
      lines.push(`    ${type}: ${count}`);
    }
  );
  lines.push("");

  // Subjects breakdown
  lines.push("  Subjects Identified:");
  Object.entries(stats.pipeline.questionAnalysis.bySubject).forEach(
    ([subject, count]) => {
      lines.push(`    ${subject}: ${count}`);
    }
  );
  lines.push("");

  // Difficulty breakdown
  lines.push("  Difficulty Distribution:");
  Object.entries(stats.pipeline.questionAnalysis.byDifficulty).forEach(
    ([difficulty, count]) => {
      lines.push(`    ${difficulty}: ${count}`);
    }
  );
  lines.push("");

  // Top topics
  lines.push("  Top 10 Topics:");
  stats.pipeline.questionAnalysis.topTopics
    .slice(0, 10)
    .forEach(({ topic, count }: any, index: number) => {
      lines.push(`    ${index + 1}. ${topic}: ${count}`);
    });
  lines.push("");

  // Processing performance
  lines.push("PROCESSING PERFORMANCE:");
  const processingTimes = stats.pipeline.pdfProcessing.processingTimes;
  if (processingTimes && processingTimes.length > 0) {
    const avgTime =
      processingTimes.reduce((sum: number, p: any) => sum + p.timeMs, 0) /
      processingTimes.length;
    lines.push(
      `  Average processing time: ${Math.round(avgTime / 1000)}s per PDF`
    );
    lines.push(
      `  Fastest: ${
        Math.min(...processingTimes.map((p: any) => p.timeMs)) / 1000
      }s`
    );
    lines.push(
      `  Slowest: ${
        Math.max(...processingTimes.map((p: any) => p.timeMs)) / 1000
      }s`
    );
    lines.push("");
  }

  if (stats.pipeline.errors && stats.pipeline.errors.length > 0) {
    lines.push("ERRORS/WARNINGS:");
    stats.pipeline.errors.forEach((error: string) => {
      lines.push(`  - ${error}`);
    });
    lines.push("");
  }

  lines.push("=".repeat(60));
  lines.push("End of Summary");
  lines.push("=".repeat(60));

  return lines.join("\n");
}

/**
 * Create a pipeline configuration with sensible defaults for direct processing
 */
export function createDirectPipelineConfig(
  inputDir: string,
  outputDir: string,
  claudeApiKey: string,
  examName?: string
): PipelineConfig {
  return {
    inputDir,
    outputDir,
    claude: {
      apiKey: claudeApiKey,
      model: "claude-sonnet-4-20250514", // Use the latest model with PDF support
      maxTokens: 10000,
      temperature: 0.1,
      batchSize: 1, // Process one PDF at a time for direct processing
    },
    exam: examName ? { name: examName } : undefined,
    options: {
      saveIntermediateResults: true,
      maxFiles: undefined, // Process all files by default
      delayBetweenFiles: 3000, // 3 second delay between files
    },
  };
}

/**
 * Utility function to run direct PDF pipeline for a specific exam directory
 */
export async function runDirectPipelineForExam(
  examDir: string,
  outputBaseDir: string,
  claudeApiKey: string,
  examName?: string,
  examConfig?: any // Add this parameter
): Promise<PipelineResult> {
  const examDirName = examDir.split("/").pop() || "unknown-exam";
  const outputDir = join(outputBaseDir, "processed", examDirName);

  const config = createDirectPipelineConfig(
    examDir,
    outputDir,
    claudeApiKey,
    examName
  );

  return await runDirectPdfExtractionPipeline(config);
}
