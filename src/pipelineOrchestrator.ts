import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parsePDFsInDirectoryRecursive, extractQuestionCandidates, getPDFParsingStats, ParsedPDF, QuestionCandidate } from './parser/pdfParser';
import { tagQuestionsWithClaude, TaggingConfig, TaggedQuestion, getTaggingStats, TaggingResult } from './claudeTagger';

export interface PipelineConfig {
  inputDir: string;
  outputDir: string;
  claude: TaggingConfig;
  exam?: {
    name: string;
    year?: string;
    customContext?: {
      subjects?: string[];
      topics?: string[];
    };
  };
  options?: {
    saveIntermediateResults?: boolean;
    skipQuestionExtraction?: boolean;
    maxQuestionsPerPDF?: number;
  };
}

export interface PipelineResult {
  success: boolean;
  summary: {
    pdfsProcessed: number;
    questionsExtracted: number;
    questionsTagged: number;
    timeElapsed: string;
  };
  outputs: {
    rawPDFData?: string;
    extractedQuestions?: string;
    taggedQuestions: string;
    statistics: string;
  };
  errors: string[];
}

/**
 * Main pipeline function - orchestrates the entire process
 */
export async function runQuestionExtractionPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const startTime = Date.now();
  const result: PipelineResult = {
    success: false,
    summary: {
      pdfsProcessed: 0,
      questionsExtracted: 0,
      questionsTagged: 0,
      timeElapsed: '0s'
    },
    outputs: {
      taggedQuestions: '',
      statistics: ''
    },
    errors: []
  };

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Starting Question Extraction Pipeline`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Input directory: ${config.inputDir}`);
    console.log(`Output directory: ${config.outputDir}`);
    if (config.exam?.name) {
      console.log(`Exam: ${config.exam.name} ${config.exam.year ? `(${config.exam.year})` : ''}`);
    }
    
    // Ensure output directory exists
    if (!existsSync(config.outputDir)) {
      mkdirSync(config.outputDir, { recursive: true });
    }

    // Step 1: Parse PDFs
    console.log(`\n📄 Step 1: Parsing PDFs from ${config.inputDir}`);
    const parsedPDFs = await parsePDFsInDirectoryRecursive(config.inputDir);
    
    if (parsedPDFs.length === 0) {
      throw new Error('No PDFs were successfully parsed');
    }

    result.summary.pdfsProcessed = parsedPDFs.length;
    
    // // Save raw PDF data if requested
    // if (config.options?.saveIntermediateResults) {
    //   const rawDataPath = join(config.outputDir, 'raw-pdf-data.json');
    //   writeFileSync(rawDataPath, JSON.stringify(parsedPDFs, null, 2));
    //   result.outputs.rawPDFData = rawDataPath;
    //   console.log(`💾 Saved raw PDF data: ${rawDataPath}`);
    // }

    // Step 2: Extract Question Candidates
    console.log(`\n🔍 Step 2: Extracting question candidates`);
    let allCandidates: QuestionCandidate[] = [];
    
    for (const pdf of parsedPDFs) {
      console.log(`  Processing: ${pdf.fileName}`);
      const candidates = extractQuestionCandidates(pdf);
      
      // Apply per-PDF limit if specified
      const limitedCandidates = config.options?.maxQuestionsPerPDF 
        ? candidates.slice(0, config.options.maxQuestionsPerPDF)
        : candidates;
      
      allCandidates.push(...limitedCandidates);
      console.log(`    Extracted: ${candidates.length} questions ${limitedCandidates.length !== candidates.length ? `(limited to ${limitedCandidates.length})` : ''}`);
    }

    if (allCandidates.length === 0) {
      throw new Error('No question candidates were extracted from PDFs');
    }

    result.summary.questionsExtracted = allCandidates.length;

    // Save extracted questions if requested
    if (config.options?.saveIntermediateResults) {
      const candidatesPath = join(config.outputDir, 'extracted-candidates.json');
      writeFileSync(candidatesPath, JSON.stringify(allCandidates, null, 2));
      result.outputs.extractedQuestions = candidatesPath;
      console.log(`💾 Saved question candidates: ${candidatesPath}`);
    }

    // Step 3: Tag with Claude AI
    console.log(`\n🤖 Step 3: Tagging questions with Claude AI`);
    const taggingResult = await tagQuestionsWithClaude(parsedPDFs, allCandidates, config.claude);
    
    if (!taggingResult.success && taggingResult.taggedQuestions.length === 0) {
      throw new Error('Claude AI tagging completely failed');
    }

    result.summary.questionsTagged = taggingResult.taggedQuestions.length;
    result.errors.push(...taggingResult.errors);

    // Step 4: Save Results and Generate Statistics
    console.log(`\n💾 Step 4: Saving results and generating statistics`);
    
    // Save tagged questions
    const taggedQuestionsPath = join(config.outputDir, 'tagged-questions.json');
    writeFileSync(taggedQuestionsPath, JSON.stringify(taggingResult.taggedQuestions, null, 2));
    result.outputs.taggedQuestions = taggedQuestionsPath;
    
    // Generate and save comprehensive statistics
    const stats = generateComprehensiveStats(parsedPDFs, allCandidates, taggingResult);
    const statsPath = join(config.outputDir, 'pipeline-statistics.json');
    writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    result.outputs.statistics = statsPath;
    
    // Save human-readable summary
    const summaryPath = join(config.outputDir, 'summary.txt');
    const summaryText = generateHumanReadableSummary(stats, config);
    writeFileSync(summaryPath, summaryText);
    
    console.log(`✅ Saved tagged questions: ${taggedQuestionsPath}`);
    console.log(`📊 Saved statistics: ${statsPath}`);
    console.log(`📄 Saved summary: ${summaryPath}`);

    // Calculate elapsed time
    const endTime = Date.now();
    const elapsedSeconds = Math.round((endTime - startTime) / 1000);
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const remainingSeconds = elapsedSeconds % 60;
    result.summary.timeElapsed = elapsedMinutes > 0 
      ? `${elapsedMinutes}m ${remainingSeconds}s`
      : `${elapsedSeconds}s`;

    result.success = true;

    // Final summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎉 Pipeline Completed Successfully!`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📊 Final Summary:`);
    console.log(`   PDFs processed: ${result.summary.pdfsProcessed}`);
    console.log(`   Questions extracted: ${result.summary.questionsExtracted}`);
    console.log(`   Questions tagged: ${result.summary.questionsTagged}`);
    console.log(`   Success rate: ${((result.summary.questionsTagged / result.summary.questionsExtracted) * 100).toFixed(1)}%`);
    console.log(`   Time elapsed: ${result.summary.timeElapsed}`);
    console.log(`   Output directory: ${config.outputDir}`);
    
    if (result.errors.length > 0) {
      console.log(`\n⚠️  ${result.errors.length} warnings/errors occurred:`);
      result.errors.slice(0, 5).forEach(error => console.log(`   - ${error}`));
      if (result.errors.length > 5) {
        console.log(`   ... and ${result.errors.length - 5} more (check detailed logs)`);
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
 * Generate comprehensive statistics
 */
function generateComprehensiveStats(
  parsedPDFs: ParsedPDF[],
  candidates: QuestionCandidate[],
  taggingResult: TaggingResult
) {
  const pdfStats = getPDFParsingStats(parsedPDFs);
  const taggingStats = getTaggingStats(taggingResult.taggedQuestions);
  
  // Question extraction stats
  const extractionStats = {
    totalCandidates: candidates.length,
    byType: candidates.reduce((acc, q) => {
      acc[q.type] = (acc[q.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byPage: candidates.reduce((acc, q) => {
      acc[q.pageNumber] = (acc[q.pageNumber] || 0) + 1;
      return acc;
    }, {} as Record<number, number>),
    avgQuestionsPerPDF: Math.round((candidates.length / parsedPDFs.length) * 100) / 100,
    questionsWithOptions: candidates.filter(q => q.options && q.options.length > 0).length
  };

  return {
    generatedAt: new Date().toISOString(),
    pipeline: {
      pdfParsing: pdfStats,
      questionExtraction: extractionStats,
      claudeTagging: {
        ...taggingStats,
        processing: {
          totalProcessed: taggingResult.stats.totalProcessed,
          successful: taggingResult.stats.successful,
          failed: taggingResult.stats.failed,
          successRate: `${((taggingResult.stats.successful / taggingResult.stats.totalProcessed) * 100).toFixed(1)}%`,
          errors: taggingResult.errors
        }
      }
    }
  };
}

/**
 * Generate human-readable summary
 */
function generateHumanReadableSummary(stats: any, config: PipelineConfig): string {
  const lines = [
    '=' .repeat(60),
    'QUESTION EXTRACTION PIPELINE SUMMARY',
    '='.repeat(60),
    '',
    `Generated: ${new Date(stats.generatedAt).toLocaleString()}`,
    `Input Directory: ${config.inputDir}`,
    `Output Directory: ${config.outputDir}`,
    '',
    'PDF PROCESSING:',
    `  Total PDFs: ${stats.pipeline.pdfParsing.totalPDFs}`,
    `  Total Pages: ${stats.pipeline.pdfParsing.totalPages}`,
    `  Average Pages/PDF: ${stats.pipeline.pdfParsing.avgPagesPerPDF}`,
    `  Total Characters: ${stats.pipeline.pdfParsing.totalCharacters.toLocaleString()}`,
    `  Exam Keys Found: ${stats.pipeline.pdfParsing.examKeys.join(', ') || 'None'}`,
    `  Years Found: ${stats.pipeline.pdfParsing.years.join(', ') || 'None'}`,
    '',
    'QUESTION EXTRACTION:',
    `  Total Questions Extracted: ${stats.pipeline.questionExtraction.totalCandidates}`,
    `  Average Questions/PDF: ${stats.pipeline.questionExtraction.avgQuestionsPerPDF}`,
    `  Questions with Options: ${stats.pipeline.questionExtraction.questionsWithOptions}`,
    ''
  ];

  // Question types breakdown
  lines.push('  Question Types:');
  Object.entries(stats.pipeline.questionExtraction.byType).forEach(([type, count]) => {
    lines.push(`    ${type}: ${count}`);
  });
  lines.push('');

  // Claude AI tagging results
  lines.push('CLAUDE AI TAGGING:');
  lines.push(`  Successfully Tagged: ${stats.pipeline.claudeTagging.processing.successful}`);
  lines.push(`  Failed: ${stats.pipeline.claudeTagging.processing.failed}`);
  lines.push(`  Success Rate: ${stats.pipeline.claudeTagging.processing.successRate}`);
  lines.push(`  Average Confidence: ${stats.pipeline.claudeTagging.avgConfidence}`);
  lines.push('');

  // Subjects breakdown
  lines.push('  Subjects Identified:');
  Object.entries(stats.pipeline.claudeTagging.bySubject).forEach(([subject, count]) => {
    lines.push(`    ${subject}: ${count}`);
  });
  lines.push('');

  // Difficulty breakdown
  lines.push('  Difficulty Distribution:');
  Object.entries(stats.pipeline.claudeTagging.byDifficulty).forEach(([difficulty, count]) => {
    lines.push(`    ${difficulty}: ${count}`);
  });
  lines.push('');

  // Top topics
  lines.push('  Top 10 Topics:');
  stats.pipeline.claudeTagging.topTopics.slice(0, 10).forEach(({ topic, count }: any, index: number) => {
    lines.push(`    ${index + 1}. ${topic}: ${count}`);
  });
  lines.push('');

  // Errors (if any)
  if (stats.pipeline.claudeTagging.processing.errors.length > 0) {
    lines.push('ERRORS/WARNINGS:');
    stats.pipeline.claudeTagging.processing.errors.forEach((error: string) => {
      lines.push(`  - ${error}`);
    });
    lines.push('');
  }

  lines.push('='.repeat(60));
  lines.push('End of Summary');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Create a pipeline configuration with sensible defaults
 */
export function createPipelineConfig(
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
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4000,
      temperature: 0.1,
      batchSize: 20
    },
    exam: examName ? { name: examName } : undefined,
    options: {
      saveIntermediateResults: true,
      maxQuestionsPerPDF: 100 // Reasonable limit to avoid overwhelming Claude
    }
  };
}

/**
 * Utility function to run pipeline for a specific exam directory
 */
export async function runPipelineForExam(
  examDir: string,
  outputBaseDir: string,
  claudeApiKey: string,
  examName?: string
): Promise<PipelineResult> {
  const examDirName = examDir.split('/').pop() || 'unknown-exam';
  const outputDir = join(outputBaseDir, 'processed', examDirName);
  
  const config = createPipelineConfig(examDir, outputDir, claudeApiKey, examName);
  
  return await runQuestionExtractionPipeline(config);
}