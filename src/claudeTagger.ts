import { Anthropic } from '@anthropic-ai/sdk';
import { Question, QuestionType } from './types/index';
import { QuestionCandidate, ParsedPDF } from './parser/pdfParser';

export interface TaggingConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  batchSize?: number;
}

export interface TaggedQuestion extends Question {
  confidence: number;
  rawClaudeResponse?: string;
  processingTimestamp: string;
}

export interface ExamContext {
  examKey: string;
  examFullName?: string;
  year?: string;
  description?: string;
  knownSubjects?: string[];
  commonTopics?: string[];
}

export interface TaggingResult {
  success: boolean;
  taggedQuestions: TaggedQuestion[];
  errors: string[];
  stats: {
    totalProcessed: number;
    successful: number;
    failed: number;
    totalTokensUsed?: number;
  };
}

/**
 * Initialize Claude AI client
 */
export function initClaudeClient(config: TaggingConfig): Anthropic {
  return new Anthropic({
    apiKey: config.apiKey,
  });
}

/**
 * Create exam context from parsed PDFs
 */
export function createExamContext(parsedPDFs: ParsedPDF[]): ExamContext {
  const examKeys = [...new Set(parsedPDFs.map(pdf => pdf.metadata.examKey).filter(Boolean))];
  const years = [...new Set(parsedPDFs.map(pdf => pdf.metadata.year).filter(Boolean))];
  
  const primaryExamKey = examKeys[0] || 'UNKNOWN';
  const examContextMap = getExamContextMap();
  const context = examContextMap[primaryExamKey.toUpperCase()] || examContextMap['DEFAULT'];
  
  return {
    ...context,
    examKey: primaryExamKey,
    year: years.join(', ') || undefined
  };
}

/**
 * Get exam-specific context mapping
 */
function getExamContextMap(): Record<string, ExamContext> {
  return {
    'CHSL': {
      examKey: 'CHSL',
      examFullName: 'SSC Combined Higher Secondary Level',
      description: 'SSC CHSL exam for 10+2 level posts in government departments',
      knownSubjects: ['General Intelligence & Reasoning', 'General Awareness', 'Quantitative Aptitude', 'English Language'],
      commonTopics: [
        'Logical Reasoning', 'Analogies', 'Classification', 'Series', 'Coding-Decoding', 'Blood Relations',
        'Current Affairs', 'History', 'Geography', 'Polity', 'Economics', 'Science', 'Sports',
        'Arithmetic', 'Algebra', 'Geometry', 'Trigonometry', 'Statistics', 'Data Interpretation',
        'Grammar', 'Vocabulary', 'Comprehension', 'Synonyms', 'Antonyms', 'Sentence Correction'
      ]
    },
    'CGL': {
      examKey: 'CGL',
      examFullName: 'SSC Combined Graduate Level',
      description: 'SSC CGL exam for graduate level posts in government departments',
      knownSubjects: ['General Intelligence & Reasoning', 'General Awareness', 'Quantitative Aptitude', 'English Comprehension'],
      commonTopics: [
        'Logical Reasoning', 'Verbal Reasoning', 'Non-verbal Reasoning', 'Pattern Recognition',
        'Current Affairs', 'Static GK', 'History', 'Geography', 'Polity', 'Economics', 'Science',
        'Number System', 'Percentages', 'Profit & Loss', 'Time & Work', 'Geometry', 'Mensuration',
        'Reading Comprehension', 'Grammar', 'Vocabulary', 'Para Jumbles', 'Cloze Test'
      ]
    },
    'PO': {
      examKey: 'PO',
      examFullName: 'Bank Probationary Officer',
      description: 'Banking exam for Probationary Officer positions',
      knownSubjects: ['Reasoning Ability', 'Quantitative Aptitude', 'English Language', 'General Awareness', 'Computer Awareness'],
      commonTopics: [
        'Logical Reasoning', 'Puzzles', 'Seating Arrangement', 'Data Sufficiency', 'Syllogism',
        'Number Series', 'Data Interpretation', 'Quadratic Equations', 'Simplification',
        'Reading Comprehension', 'Error Detection', 'Para Jumbles', 'Fill in the Blanks',
        'Banking Awareness', 'Financial Awareness', 'Current Affairs', 'Computer Knowledge'
      ]
    },
    'CLERK': {
      examKey: 'CLERK',
      examFullName: 'Bank Clerk',
      description: 'Banking exam for Clerk positions',
      knownSubjects: ['Reasoning Ability', 'Numerical Ability', 'English Language', 'General Awareness', 'Computer Knowledge'],
      commonTopics: [
        'Logical Reasoning', 'Coding-Decoding', 'Direction Sense', 'Ranking', 'Alphabet Test',
        'Simplification', 'Number Series', 'Average', 'Percentage', 'Simple Interest',
        'Grammar', 'Vocabulary', 'Comprehension', 'Sentence Rearrangement',
        'Banking Terms', 'Computer Basics', 'MS Office', 'Internet', 'Current Affairs'
      ]
    },
    'RRB': {
      examKey: 'RRB',
      examFullName: 'Railway Recruitment Board',
      description: 'Railway recruitment examinations for various posts',
      knownSubjects: ['General Intelligence & Reasoning', 'General Awareness', 'Arithmetic', 'General Science'],
      commonTopics: [
        'Analogies', 'Classification', 'Series', 'Coding-Decoding', 'Mathematical Operations',
        'Current Affairs', 'Indian Railways', 'Geography', 'History', 'Science',
        'Number System', 'Decimals', 'Fractions', 'LCM HCF', 'Ratio Proportion',
        'Physics', 'Chemistry', 'Biology', 'Computer Science'
      ]
    },
    'DEFAULT': {
      examKey: 'UNKNOWN',
      examFullName: 'Government Competitive Examination',
      description: 'General government competitive examination',
      knownSubjects: ['Reasoning', 'General Knowledge', 'Quantitative Aptitude', 'English'],
      commonTopics: [
        'Logical Reasoning', 'Verbal Reasoning', 'Mathematical Reasoning',
        'Current Affairs', 'General Science', 'History', 'Geography', 'Polity',
        'Arithmetic', 'Algebra', 'Geometry', 'Statistics',
        'Grammar', 'Vocabulary', 'Comprehension'
      ]
    }
  };
}

/**
 * Create system prompt for Claude AI tagging
 */
function createSystemPrompt(examContext: ExamContext): string {
  return `You are an expert in analyzing ${examContext.examFullName || examContext.examKey} examination questions. Your task is to analyze questions and provide accurate, structured tagging information.

EXAM CONTEXT:
- Exam: ${examContext.examFullName} (${examContext.examKey})
- Year: ${examContext.year || 'Not specified'}
- Description: ${examContext.description}
- Known Subjects: ${examContext.knownSubjects?.join(', ') || 'Not specified'}

INSTRUCTIONS:
1. Analyze each question carefully to determine its subject, topics, difficulty, and other relevant metadata
2. Provide consistent, accurate tagging based on the exam pattern and syllabus
3. Use the known subjects and topics as reference, but don't limit yourself to them
4. Be specific with topic tags - use detailed topic names rather than generic ones
5. Assess difficulty based on the level of knowledge and reasoning required
6. Identify the question type accurately (MCQ, Descriptive, etc.)

RESPONSE FORMAT:
Return a JSON object with the following structure for each question:
{
  "questionId": "string",
  "questionType": "MCQ|Descriptive|TrueFalse|FillIn|Integer|Matching",
  "subject": "string",
  "topics": ["array", "of", "specific", "topics"],
  "difficulty": "easy|medium|hard",
  "extraTags": ["additional", "relevant", "tags"],
  "confidence": 0.85,
  "reasoning": "Brief explanation of your analysis"
}

DIFFICULTY GUIDELINES:
- Easy: Basic knowledge, direct application of concepts
- Medium: Requires analysis, connecting multiple concepts, moderate reasoning
- Hard: Complex reasoning, advanced concepts, multi-step problem solving

Be precise and consistent in your analysis.`;
}

/**
 * Create user prompt for a batch of questions
 */
function createUserPrompt(questions: QuestionCandidate[]): string {
  const questionsList = questions.map((q, index) => {
    const optionsText = q.options ? `\nOptions: ${q.options.join(' | ')}` : '';
    return `QUESTION ${index + 1}:
ID: ${q.id}
Type Detected: ${q.type}
Text: ${q.text}${optionsText}
Page: ${q.pageNumber}
`;
  }).join('\n---\n');

  return `Please analyze the following questions and provide structured tagging for each:

${questionsList}

Return a JSON array with analysis for each question in the same order they appear above.`;
}

/**
 * Process a batch of questions with Claude AI
 */
async function processQuestionBatch(
  client: Anthropic,
  questions: QuestionCandidate[],
  examContext: ExamContext,
  config: TaggingConfig
): Promise<{ success: boolean; results: TaggedQuestion[]; error?: string }> {
  try {
    const systemPrompt = createSystemPrompt(examContext);
    const userPrompt = createUserPrompt(questions);

    const response = await client.messages.create({
      model: config.model || 'claude-3-sonnet-20240229',
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature || 0.1,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userPrompt
      }]
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in response');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    
    if (!Array.isArray(analysis)) {
      throw new Error('Response is not an array');
    }

    // Convert to TaggedQuestion format
    const results: TaggedQuestion[] = questions.map((question, index) => {
      const claudeAnalysis = analysis[index] || {};
      
      return {
        id: question.id,
        examKey: examContext.examKey,
        year: examContext.year,
        fileName: '', // Will be set by caller
        pageNo: question.pageNumber,
        text: question.text,
        options: question.options,
        answer: null, // Could be enhanced to detect answers
        questionType: mapQuestionType(claudeAnalysis.questionType || question.type),
        subject: claudeAnalysis.subject || 'Unknown',
        topics: claudeAnalysis.topics || [],
        difficulty: claudeAnalysis.difficulty || 'unknown',
        extraTags: claudeAnalysis.extraTags || [],
        confidence: claudeAnalysis.confidence || 0.5,
        // rawClaudeResponse: responseText,
        processingTimestamp: new Date().toISOString(),
        provenance: {
          sourceUrl: '',
          fileName: '',
          pageNo: question.pageNumber,
          charOffsetStart: question.startIndex,
          charOffsetEnd: question.endIndex
        }
      };
    });

    return { success: true, results };

  } catch (error) {
    return {
      success: false,
      results: [],
      error: `Failed to process batch: ${(error as Error).message}`
    };
  }
}

/**
 * Map question types from Claude response to our enum
 */
function mapQuestionType(type: string): QuestionType {
  const typeMap: Record<string, QuestionType> = {
    'MCQ': 'MCQ',
    'mcq': 'MCQ',
    'Descriptive': 'Descriptive',
    'descriptive': 'Descriptive',
    'TrueFalse': 'TrueFalse',
    'true_false': 'TrueFalse',
    'FillIn': 'FillIn',
    'fill_blank': 'FillIn',
    'Integer': 'Integer',
    'integer': 'Integer',
    'Matching': 'Matching',
    'matching': 'Matching'
  };
  
  return typeMap[type] || 'MCQ';
}

/**
 * Process all questions from parsed PDFs with Claude AI tagging
 */
export async function tagQuestionsWithClaude(
  parsedPDFs: ParsedPDF[],
  candidates: QuestionCandidate[],
  config: TaggingConfig
): Promise<TaggingResult> {
  const client = initClaudeClient(config);
  const examContext = createExamContext(parsedPDFs);
  const batchSize = config.batchSize || 5; // Process 5 questions at a time
  
  console.log(`\n=== Starting Claude AI Tagging ===`);
  console.log(`Exam Context: ${examContext.examFullName} (${examContext.examKey})`);
  console.log(`Total questions to process: ${candidates.length}`);
  console.log(`Batch size: ${batchSize}`);
  
  const results: TaggingResult = {
    success: true,
    taggedQuestions: [],
    errors: [],
    stats: {
      totalProcessed: 0,
      successful: 0,
      failed: 0
    }
  };
  
  // Process in batches
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(candidates.length / batchSize);
    
    console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} questions)`);
    
    const batchResult = await processQuestionBatch(client, batch, examContext, config);
    
    if (batchResult.success) {
      // Set fileName from source PDF
      batchResult.results.forEach((taggedQ, index) => {
        const originalQ = batch[index];
        // Find the PDF this question came from
        const sourcePDF = parsedPDFs.find(pdf => 
          pdf.pages.some(page => page.pageNumber === originalQ.pageNumber)
        );
        
        taggedQ.fileName = sourcePDF?.fileName || '';
        taggedQ.provenance!.fileName = sourcePDF?.fileName || '';
        taggedQ.provenance!.sourceUrl = sourcePDF?.filePath || '';
      });
      
      results.taggedQuestions.push(...batchResult.results);
      results.stats.successful += batch.length;
      
      console.log(`  ✅ Successfully processed ${batch.length} questions`);
      
      // Show sample results
      if (batchResult.results.length > 0) {
        const sample = batchResult.results[0];
        console.log(`  📋 Sample: [${sample.subject}] ${sample.topics.join(', ')} (${sample.difficulty})`);
      }
      
    } else {
      results.errors.push(`Batch ${batchNum}: ${batchResult.error}`);
      results.stats.failed += batch.length;
      console.error(`  ❌ Failed to process batch: ${batchResult.error}`);
    }
    
    results.stats.totalProcessed += batch.length;
    
    // Rate limiting - wait between batches
    if (i + batchSize < candidates.length) {
      console.log(`  ⏳ Waiting 2 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final statistics
  results.success = results.stats.failed === 0;
  
  console.log(`\n=== Tagging Complete ===`);
  console.log(`Total processed: ${results.stats.totalProcessed}`);
  console.log(`Successful: ${results.stats.successful}`);
  console.log(`Failed: ${results.stats.failed}`);
  console.log(`Success rate: ${((results.stats.successful / results.stats.totalProcessed) * 100).toFixed(1)}%`);
  
  if (results.errors.length > 0) {
    console.log(`\nErrors encountered:`);
    results.errors.forEach(error => console.log(`  - ${error}`));
  }
  
  return results;
}

/**
 * Get tagging statistics and insights
 */
export function getTaggingStats(taggedQuestions: TaggedQuestion[]): {
  totalQuestions: number;
  bySubject: Record<string, number>;
  byDifficulty: Record<string, number>;
  byQuestionType: Record<string, number>;
  topTopics: Array<{ topic: string; count: number }>;
  avgConfidence: number;
  examKeys: string[];
  years: string[];
} {
  const bySubject: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  const byQuestionType: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const confidenceScores: number[] = [];
  const examKeys = new Set<string>();
  const years = new Set<string>();
  
  taggedQuestions.forEach(q => {
    // Count by subject
    bySubject[q.subject || 'Unknown'] = (bySubject[q.subject || 'Unknown'] || 0) + 1;
    
    // Count by difficulty
    byDifficulty[q.difficulty || 'unknown'] = (byDifficulty[q.difficulty || 'unknown'] || 0) + 1;
    
    // Count by question type
    byQuestionType[q.questionType || 'Unknown'] = (byQuestionType[q.questionType || 'Unknown'] || 0) + 1;
    
    // Count topics
    (q.topics || []).forEach(topic => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
    
    // Collect confidence scores
    confidenceScores.push(q.confidence || 0);
    
    // Collect exam keys and years
    if (q.examKey) examKeys.add(q.examKey);
    if (q.year) years.add(q.year);
  });
  
  // Get top topics
  const topTopics = Object.entries(topicCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 20)
    .map(([topic, count]) => ({ topic, count }));
  
  const avgConfidence = confidenceScores.length > 0 
    ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length 
    : 0;
  
  return {
    totalQuestions: taggedQuestions.length,
    bySubject,
    byDifficulty,
    byQuestionType,
    topTopics,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    examKeys: Array.from(examKeys),
    years: Array.from(years)
  };
}