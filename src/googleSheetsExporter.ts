import { google } from 'googleapis';
import { TaggedQuestion } from './claudeTagger';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface SheetsConfig {
  serviceAccountKey: string | object; // Path to service account key file or key object
  spreadsheetId?: string; // If provided, will update existing sheet
  sheetName?: string;
  createNewSpreadsheet?: boolean;
  shareWithEmails?: string[]; // Emails to share the sheet with
}

export interface SheetsExportResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  sheetName: string;
  rowsExported: number;
  errors: string[];
}

export interface ExportOptions {
  includeConfidenceScore?: boolean;
  includeProcessingTimestamp?: boolean;
  includeProvenance?: boolean;
  maxQuestionsPerSheet?: number;
  groupBySubject?: boolean;
  sortBy?: 'subject' | 'difficulty' | 'confidence' | 'pageNo';
}

/**
 * Initialize Google Sheets API client
 */
export function initSheetsClient(serviceAccountKey: string | object) {
  try {
    let credentials;
    
    if (typeof serviceAccountKey === 'string') {
      // If it's a file path
      credentials = JSON.parse(readFileSync(serviceAccountKey, 'utf8'));
    } else {
      // If it's already an object
      credentials = serviceAccountKey;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });

    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    throw new Error(`Failed to initialize Google Sheets client: ${(error as Error).message}`);
  }
}

/**
 * Create a new spreadsheet
 */
export async function createSpreadsheet(
  sheets: any,
  title: string,
  shareWithEmails?: string[]
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  try {
    const response = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title
        }
      }
    });

    const spreadsheetId = response.data.spreadsheetId;
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // Share with provided emails if any
    if (shareWithEmails && shareWithEmails.length > 0) {
      const drive = google.drive({ version: 'v3', auth: sheets._options.auth });
      
      for (const email of shareWithEmails) {
        try {
          await drive.permissions.create({
            fileId: spreadsheetId,
            resource: {
              role: 'writer',
              type: 'user',
              emailAddress: email
            }
          });
          console.log(`Shared spreadsheet with ${email}`);
        } catch (shareError) {
          console.warn(`Failed to share with ${email}: ${(shareError as Error).message}`);
        }
      }
    }

    return { spreadsheetId, spreadsheetUrl };
  } catch (error) {
    throw new Error(`Failed to create spreadsheet: ${(error as Error).message}`);
  }
}

/**
 * Prepare question data for export
 */
export function prepareQuestionData(
  questions: TaggedQuestion[],
  options: ExportOptions = {}
): any[][] {
  // Sort questions if requested
  let sortedQuestions = [...questions];
  
  if (options.sortBy) {
    sortedQuestions.sort((a, b) => {
      switch (options.sortBy) {
        case 'subject':
          return (a.subject || '').localeCompare(b.subject || '');
        case 'difficulty':
          const difficultyOrder = { 'easy': 1, 'medium': 2, 'hard': 3, 'unknown': 4 };
          return (difficultyOrder[a.difficulty as keyof typeof difficultyOrder] || 4) - 
                 (difficultyOrder[b.difficulty as keyof typeof difficultyOrder] || 4);
        case 'confidence':
          return (b.confidence || 0) - (a.confidence || 0);
        case 'pageNo':
          return (a.pageNo || 0) - (b.pageNo || 0);
        default:
          return 0;
      }
    });
  }

  // Limit number of questions if specified
  if (options.maxQuestionsPerSheet) {
    sortedQuestions = sortedQuestions.slice(0, options.maxQuestionsPerSheet);
  }

  // Create header row
  const headers = [
    'Question ID',
    'Exam Key',
    'Year',
    'File Name',
    'Page No',
    'Question Text',
    'Question Type',
    'Options',
    'Subject',
    'Topics',
    'Difficulty',
    'Extra Tags'
  ];

  if (options.includeConfidenceScore) {
    headers.push('Confidence Score');
  }

  if (options.includeProcessingTimestamp) {
    headers.push('Processing Timestamp');
  }

  if (options.includeProvenance) {
    headers.push('Source URL', 'Char Start', 'Char End');
  }

  // Create data rows
  const rows = [headers];

  for (const question of sortedQuestions) {
    const row = [
      question.id || '',
      question.examKey || '',
      question.year || '',
      question.fileName || '',
      question.pageNo?.toString() || '',
      question.text || '',
      question.questionType || '',
      question.options ? question.options.join(' | ') : '',
      question.subject || '',
      question.topics ? question.topics.join(', ') : '',
      question.difficulty || '',
      question.extraTags ? question.extraTags.join(', ') : ''
    ];

    if (options.includeConfidenceScore) {
      row.push((question.confidence || 0).toString());
    }

    if (options.includeProcessingTimestamp) {
      row.push(question.processingTimestamp || '');
    }

    if (options.includeProvenance && question.provenance) {
      row.push(
        question.provenance.sourceUrl || '',
        question.provenance.charOffsetStart?.toString() || '',
        question.provenance.charOffsetEnd?.toString() || ''
      );
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Create sheets grouped by subject
 */
export function groupQuestionsBySubject(questions: TaggedQuestion[]): Record<string, TaggedQuestion[]> {
  const grouped: Record<string, TaggedQuestion[]> = {};
  
  for (const question of questions) {
    const subject = question.subject || 'Unknown';
    if (!grouped[subject]) {
      grouped[subject] = [];
    }
    grouped[subject].push(question);
  }
  
  return grouped;
}

/**
 * Export questions to Google Sheets
 */
export async function exportToGoogleSheets(
  questions: TaggedQuestion[],
  config: SheetsConfig,
  options: ExportOptions = {}
): Promise<SheetsExportResult> {
  const result: SheetsExportResult = {
    success: false,
    sheetName: config.sheetName || 'Questions',
    rowsExported: 0,
    errors: []
  };

  try {
    console.log('\n🔄 Initializing Google Sheets export...');
    
    const sheets = initSheetsClient(config.serviceAccountKey);
    let spreadsheetId = config.spreadsheetId;
    let spreadsheetUrl = '';

    // Create new spreadsheet if needed
    if (config.createNewSpreadsheet || !spreadsheetId) {
      const examKey = questions[0]?.examKey || 'Unknown';
      const year = questions[0]?.year || new Date().getFullYear().toString();
      const title = `${examKey} Questions Dataset - ${year}`;
      
      console.log(`📊 Creating new spreadsheet: ${title}`);
      const created = await createSpreadsheet(sheets, title, config.shareWithEmails);
      spreadsheetId = created.spreadsheetId;
      spreadsheetUrl = created.spreadsheetUrl;
    }

    if (!spreadsheetId) {
      throw new Error('No spreadsheet ID available');
    }

    result.spreadsheetId = spreadsheetId;
    result.spreadsheetUrl = spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    if (options.groupBySubject) {
      // Export to separate sheets by subject
      await exportBySubject(sheets, spreadsheetId, questions, options, result);
    } else {
      // Export to single sheet
      await exportToSingleSheet(sheets, spreadsheetId, questions, config.sheetName || 'Questions', options, result);
    }

    // Create summary sheet
    await createSummarySheet(sheets, spreadsheetId, questions);

    result.success = true;
    console.log(`✅ Export completed successfully!`);
    console.log(`📊 Spreadsheet URL: ${result.spreadsheetUrl}`);
    console.log(`📈 Total rows exported: ${result.rowsExported}`);

  } catch (error) {
    result.success = false;
    result.errors.push(`Export failed: ${(error as Error).message}`);
    console.error(`❌ Export failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Export questions grouped by subject to separate sheets
 */
async function exportBySubject(
  sheets: any,
  spreadsheetId: string,
  questions: TaggedQuestion[],
  options: ExportOptions,
  result: SheetsExportResult
): Promise<void> {
  const groupedQuestions = groupQuestionsBySubject(questions);
  
  console.log(`📝 Exporting to ${Object.keys(groupedQuestions).length} subject sheets...`);
  
  for (const [subject, subjectQuestions] of Object.entries(groupedQuestions)) {
    const sheetName = sanitizeSheetName(subject);
    console.log(`  📄 Creating sheet for ${subject} (${subjectQuestions.length} questions)`);
    
    try {
      // Create new sheet for this subject
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });

      await exportToSingleSheet(sheets, spreadsheetId, subjectQuestions, sheetName, options, result);
      
    } catch (error) {
      if ((error as any).message.includes('already exists')) {
        console.log(`  ⚠️  Sheet ${sheetName} already exists, updating...`);
        await exportToSingleSheet(sheets, spreadsheetId, subjectQuestions, sheetName, options, result);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Export questions to a single sheet
 */
async function exportToSingleSheet(
  sheets: any,
  spreadsheetId: string,
  questions: TaggedQuestion[],
  sheetName: string,
  options: ExportOptions,
  result: SheetsExportResult
): Promise<void> {
  const data = prepareQuestionData(questions, options);
  
  console.log(`  📊 Writing ${data.length - 1} questions to sheet ${sheetName}`);
  
  // Clear existing data and write new data
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A:Z`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: data
    }
  });

  // Format the sheet
  await formatSheet(sheets, spreadsheetId, sheetName, data[0].length);
  
  result.rowsExported += data.length - 1; // Exclude header row
}

/**
 * Create a summary sheet with statistics
 */
async function createSummarySheet(
  sheets: any,
  spreadsheetId: string,
  questions: TaggedQuestion[]
): Promise<void> {
  console.log('📈 Creating summary sheet...');
  
  // Calculate statistics
  const stats = calculateExportStats(questions);
  
  // Prepare summary data
  const summaryData = [
    ['Question Dataset Summary', '', ''],
    ['Generated:', new Date().toLocaleDateString(), ''],
    ['Total Questions:', questions.length.toString(), ''],
    ['', '', ''],
    ['By Subject:', '', ''],
    ...Object.entries(stats.bySubject).map(([subject, count]) => ['', subject, count.toString()]),
    ['', '', ''],
    ['By Difficulty:', '', ''],
    ...Object.entries(stats.byDifficulty).map(([difficulty, count]) => ['', difficulty, count.toString()]),
    ['', '', ''],
    ['By Question Type:', '', ''],
    ...Object.entries(stats.byType).map(([type, count]) => ['', type, count.toString()]),
    ['', '', ''],
    ['By Exam:', '', ''],
    ...Object.entries(stats.byExam).map(([exam, count]) => ['', exam, count.toString()]),
    ['', '', ''],
    ['Top Topics:', '', ''],
    ...stats.topTopics.slice(0, 10).map(([topic, count]) => ['', topic, count.toString()]),
    ['', '', ''],
    ['Average Confidence:', stats.avgConfidence.toFixed(2), '']
  ];

  try {
    // Create summary sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: 'Summary'
            }
          }
        }]
      }
    });
  } catch (error) {
    // Sheet might already exist, continue
  }

  // Write summary data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Summary!A1',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: summaryData
    }
  });

  // Format summary sheet
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: await getSheetId(sheets, spreadsheetId, 'Summary'),
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 3
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.6, blue: 1.0 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }
      ]
    }
  });
}

/**
 * Format a sheet with headers and styling
 */
async function formatSheet(
  sheets: any,
  spreadsheetId: string,
  sheetName: string,
  columnCount: number
): Promise<void> {
  const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: [
        // Format header row
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: columnCount
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.6, blue: 1.0 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        },
        // Freeze header row
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        },
        // Auto-resize columns
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: columnCount
            }
          }
        }
      ]
    }
  });
}

/**
 * Get sheet ID by name
 */
async function getSheetId(sheets: any, spreadsheetId: string, sheetName: string): Promise<number> {
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = response.data.sheets.find((s: any) => s.properties.title === sheetName);
  
  if (!sheet) {
    throw new Error(`Sheet '${sheetName}' not found`);
  }
  
  return sheet.properties.sheetId;
}

/**
 * Sanitize sheet name for Google Sheets
 */
function sanitizeSheetName(name: string): string {
  // Google Sheets sheet names can't contain: [ ] * ? : \ / 
  // and must be 100 chars or less
  return name
    .replace(/[\[\]*?:\\\/]/g, '-')
    .substring(0, 100)
    .trim();
}

/**
 * Calculate export statistics
 */
function calculateExportStats(questions: TaggedQuestion[]): {
  bySubject: Record<string, number>;
  byDifficulty: Record<string, number>;
  byType: Record<string, number>;
  byExam: Record<string, number>;
  topTopics: Array<[string, number]>;
  avgConfidence: number;
} {
  const bySubject: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byExam: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  const confidenceScores: number[] = [];

  questions.forEach(q => {
    // Count by subject
    const subject = q.subject || 'Unknown';
    bySubject[subject] = (bySubject[subject] || 0) + 1;
    
    // Count by difficulty
    const difficulty = q.difficulty || 'unknown';
    byDifficulty[difficulty] = (byDifficulty[difficulty] || 0) + 1;
    
    // Count by type
    const type = q.questionType || 'Unknown';
    byType[type] = (byType[type] || 0) + 1;
    
    // Count by exam
    const exam = q.examKey || 'Unknown';
    byExam[exam] = (byExam[exam] || 0) + 1;
    
    // Count topics
    (q.topics || []).forEach(topic => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
    
    // Collect confidence scores
    if (q.confidence) {
      confidenceScores.push(q.confidence);
    }
  });

  const topTopics = Object.entries(topicCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 20);

  const avgConfidence = confidenceScores.length > 0 
    ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length 
    : 0;

  return {
    bySubject,
    byDifficulty,
    byType,
    byExam,
    topTopics,
    avgConfidence
  };
}

/**
 * Utility function to create sheets config with defaults
 */
export function createSheetsConfig(
  serviceAccountKeyPath: string,
  options: Partial<SheetsConfig> = {}
): SheetsConfig {
  return {
    serviceAccountKey: serviceAccountKeyPath,
    createNewSpreadsheet: true,
    sheetName: 'Questions',
    shareWithEmails: [],
    ...options
  };
}

/**
 * Export questions from pipeline output files
 */
export async function exportFromPipelineOutput(
  taggedQuestionsFilePath: string,
  config: SheetsConfig,
  options: ExportOptions = {}
): Promise<SheetsExportResult> {
  try {
    console.log(`📂 Reading tagged questions from: ${taggedQuestionsFilePath}`);
    const questionsData = JSON.parse(readFileSync(taggedQuestionsFilePath, 'utf8'));
    
    if (!Array.isArray(questionsData)) {
      throw new Error('Tagged questions file should contain an array of questions');
    }
    
    console.log(`📊 Found ${questionsData.length} questions to export`);
    
    return await exportToGoogleSheets(questionsData, config, options);
  } catch (error) {
    return {
      success: false,
      sheetName: config.sheetName || 'Questions',
      rowsExported: 0,
      errors: [`Failed to export from pipeline output: ${(error as Error).message}`]
    };
  }
}