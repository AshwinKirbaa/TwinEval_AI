const { initializeDatabase, databasePath } = require('../src/config/db');

try {
    initializeDatabase();
    console.log('✅ TwinEval AI SQLite database initialized.');
    console.log(`📁 ${databasePath}`);
    console.log('ℹ️ No demo or sample data is created automatically.');
    console.log('ℹ️ To import your existing MySQL data, run:');
    console.log('   npm run import:mysql -- /path/to/twineval_ai.sql');
} catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
}
