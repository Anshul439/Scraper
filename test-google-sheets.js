// test-google-sheets.js
// Run this script to diagnose Google Sheets API issues

const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

async function diagnosticTest() {
  console.log('🔍 Starting Google Sheets Diagnostic Test\n');

  console.log(GOOGLE_SERVICE_ACCOUNT_KEY);
  
  
  // 1. Check if service account key exists
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './service-account-key.json';
  console.log(`1. Checking service account key at: ${keyPath}`);
  
  if (!fs.existsSync(keyPath)) {
    console.error(`❌ Service account key file not found at: ${keyPath}`);
    return;
  }
  console.log('✅ Service account key file exists');
  
  // 2. Parse and validate key file
  let credentials;
  try {
    const keyData = fs.readFileSync(keyPath, 'utf8');
    credentials = JSON.parse(keyData);
    console.log('✅ Service account key is valid JSON');
    console.log(`   Project ID: ${credentials.project_id}`);
    console.log(`   Client Email: ${credentials.client_email}`);
  } catch (error) {
    console.error(`❌ Error reading service account key: ${error.message}`);
    return;
  }
  
  // 3. Test authentication
  console.log('\n2. Testing authentication...');
  let auth, sheets, drive;
  
  try {
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });
    
    sheets = google.sheets({ version: 'v4', auth });
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Authentication object created successfully');
  } catch (error) {
    console.error(`❌ Authentication failed: ${error.message}`);
    return;
  }
  
  // 4. Test basic API access
  console.log('\n3. Testing API access...');
  
  try {
    // Try to list some files to test Drive API access
    const driveResponse = await drive.files.list({
      pageSize: 1,
      fields: 'files(id, name)'
    });
    console.log('✅ Google Drive API access successful');
  } catch (error) {
    console.error(`❌ Google Drive API access failed: ${error.message}`);
    console.error(`   Error code: ${error.code}`);
    console.error(`   Error details:`, error.errors);
  }
  
  // 5. Test spreadsheet creation with detailed error info
  console.log('\n4. Testing spreadsheet creation...');
  
  try {
    const createResponse = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: `Test Spreadsheet - ${new Date().toISOString()}`
        }
      }
    });
    
    console.log('✅ Spreadsheet creation successful!');
    console.log(`   Spreadsheet ID: ${createResponse.data.spreadsheetId}`);
    console.log(`   URL: https://docs.google.com/spreadsheets/d/${createResponse.data.spreadsheetId}/edit`);
    
    // Clean up - delete the test spreadsheet
    try {
      await drive.files.delete({ fileId: createResponse.data.spreadsheetId });
      console.log('✅ Test spreadsheet cleaned up');
    } catch (deleteError) {
      console.log('⚠️  Could not delete test spreadsheet (this is okay)');
    }
    
  } catch (error) {
    console.error(`❌ Spreadsheet creation failed: ${error.message}`);
    console.error(`   Error code: ${error.code}`);
    console.error(`   Status: ${error.status}`);
    
    if (error.errors) {
      console.error(`   Detailed errors:`, JSON.stringify(error.errors, null, 2));
    }
    
    // Additional diagnostics based on error type
    if (error.code === 403) {
      console.log('\n🔧 Troubleshooting 403 Forbidden Error:');
      console.log('   - Check if Google Sheets API is enabled in your Google Cloud Console');
      console.log('   - Check if Google Drive API is enabled in your Google Cloud Console');
      console.log('   - Verify your service account has the correct roles (Editor or Owner)');
      console.log('   - Check if your Google Cloud project has billing enabled');
      console.log('   - Verify the service account key is not expired or revoked');
    }
    
    if (error.code === 401) {
      console.log('\n🔧 Troubleshooting 401 Unauthorized Error:');
      console.log('   - The service account key might be invalid or expired');
      console.log('   - Check if the key file is corrupted or incomplete');
      console.log('   - Try generating a new service account key');
    }
  }
  
  // 6. Test using existing spreadsheet (alternative approach)
  console.log('\n5. Alternative: Testing with existing spreadsheet...');
  console.log('   Create a new spreadsheet manually at: https://sheets.google.com');
  console.log(`   Share it with: ${credentials.client_email}`);
  console.log('   Give "Editor" permissions');
  console.log('   Then use --spreadsheet-id flag with the spreadsheet ID');
  
  console.log('\n🔍 Diagnostic test completed');
}

// Handle errors gracefully
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Run the diagnostic
diagnosticTest().catch(error => {
  console.error('Fatal error in diagnostic:', error);
});