// test-manual-sheet.js
const { google } = require('googleapis');
const fs = require('fs');

async function testManualSheet() {
  const auth = new google.auth.GoogleAuth({
    keyFile: './google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  
  // Replace with your actual spreadsheet ID
  const SPREADSHEET_ID = '1D8J_G5BOORGheJg67Ww9jWQOWO7G0crj6Z5MketpQhw';
  
  try {
    // Test simple read operation
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID
    });
    
    console.log('✅ Successfully accessed spreadsheet:');
    console.log('   Title:', response.data.properties.title);
    console.log('   URL:', `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
    
  } catch (error) {
    console.error('❌ Failed to access spreadsheet:');
    console.error('   Error:', error.message);
    console.error('   Code:', error.code);
    
    if (error.errors) {
      console.error('   Details:', JSON.stringify(error.errors, null, 2));
    }
  }
}

testManualSheet();