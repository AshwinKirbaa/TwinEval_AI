const { initializeDatabase, databasePath } = require('../src/config/db');

(async () => {
    try {
        await initializeDatabase();
        console.log(`✅ TwinEval AI ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'} database initialized.`);
        if (!process.env.DATABASE_URL) console.log(`📁 ${databasePath}`);
        console.log('ℹ️ No demo or sample data is created automatically.');
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
})();
