import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { TaggedQuestion } from '../types/questions.types';
import { ExportOptions, SheetsConfig, SheetsExportResult } from '../types/sheets.types';

/**
 * Initialize Google Sheets API client
 */
export function initSheetsClient(serviceAccountKey: string | object) {
  try {
    let credentials;
    
    if (typeof serviceAccountKey === 'string') {
      credentials = JSON.parse(readFileSync(serviceAccountKey, 'utf8'));
    } else {
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

  if (options.maxQuestionsPerSheet) {
    sortedQuestions = sortedQuestions.slice(0, options.maxQuestionsPerSheet);
  }

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
    spreadsheetId: config.spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
    sheetName: config.sheetName || 'Questions',
    rowsExported: 0,
    errors: []
  };

  try {
    console.log('\n🔄 Initializing Google Sheets export...');
    
    const sheets = initSheetsClient(config.serviceAccountKey);
    
    if (!config.spreadsheetId) {
      throw new Error('Spreadsheet ID is required');
    }

    console.log(`📊 Using existing spreadsheet: ${result.spreadsheetUrl}`);

    if (options.groupBySubject) {
      await exportBySubject(sheets, config.spreadsheetId, questions, options, result);
    } else {
      await exportToSingleSheet(sheets, config.spreadsheetId, questions, config.sheetName || 'Questions', options, result);
    }

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
    console.log(`  📄 Using sheet for ${subject} (${subjectQuestions.length} questions)`);
    
    try {
      await exportToSingleSheet(sheets, spreadsheetId, subjectQuestions, sheetName, options, result);
    } catch (error) {
      console.error(`  ❌ Failed to export to sheet ${sheetName}: ${(error as Error).message}`);
      result.errors.push(`Failed to export to sheet ${sheetName}: ${(error as Error).message}`);
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
  
  try {
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
    
  } catch (error) {
    if ((error as any).message.includes('Unable to parse range')) {
      // Sheet doesn't exist, try to create it
      console.log(`  📄 Sheet ${sheetName} doesn't exist, creating...`);
      await createSheet(sheets, spreadsheetId, sheetName);
      
      // Retry the export
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: data
        }
      });
      
      await formatSheet(sheets, spreadsheetId, sheetName, data[0].length);
      result.rowsExported += data.length - 1;
    } else {
      throw error;
    }
  }
}

/**
 * Create a new sheet in the existing spreadsheet
 */
async function createSheet(
  sheets: any,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
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
  return name
    .replace(/[\[\]*?:\\\/]/g, '-')
    .substring(0, 100)
    .trim();
}

/**
 * Utility function to create sheets config with defaults
 */
export function createSheetsConfig(
  serviceAccountKeyPath: string,
  spreadsheetId: string,
  options: Partial<SheetsConfig> = {}
): SheetsConfig {
  return {
    serviceAccountKey: serviceAccountKeyPath,
    spreadsheetId,
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
      spreadsheetId: config.spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`,
      sheetName: config.sheetName || 'Questions',
      rowsExported: 0,
      errors: [`Failed to export from pipeline output: ${(error as Error).message}`]
    };
  }
}