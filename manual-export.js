// manual-export.js
const { exportFromPipelineOutput } = require('./src/sheetsIntegration.ts');
const { existsSync } = require('fs');

async function manualExport() {
  const taggedQuestionsPath = './processed-questions/processed/data/SSC-CHSL/tagged-questions.json';
  
  if (!existsSync(taggedQuestionsPath)) {
    console.error('❌ Tagged questions file not found');
    return;
  }

  console.log('📊 Manual export starting...');
  
  const result = await exportFromPipelineOutput(
    taggedQuestionsPath,
    {
      serviceAccountKey: './google-service-account.json',
      spreadsheetId: '1D8J_G5BOORGheJg67Ww9jWQOWO7G0crj6Z5MketpQhw',
      createNewSpreadsheet: false,
      sheetName: 'SSC-CHSL_Questions'
    },
    {
      groupBySubject: false,
      includeConfidenceScore: true,
      includeProcessingTimestamp: true
    }
  );

  console.log('📊 Manual export result:', result);
}

manualExport();