const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

// SQLite is built into supported modern Node.js releases, so TwinEval AI
// does not require MySQL Server, credentials, ports, or a separate service.
const configuredPath = process.env.DB_PATH || './database/twineval.db';
const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__dirname, '../..', configuredPath);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

class SQLiteConnection {
    async execute(sql, params = []) {
        const normalizedParams = (Array.isArray(params) ? params : []).map(value =>
            typeof value === 'boolean' ? (value ? 1 : 0) : value
        );
        const trimmed = sql.trim().toUpperCase();

        // Seed/schema files may contain multiple SQL statements. SQLite's
        // exec() is the correct API for those scripts; model queries use
        // prepare()/run()/all() below.
        if (normalizedParams.length === 0 && sql.includes(';') && !/^SELECT\b|^WITH\b|^PRAGMA\b/.test(trimmed)) {
            db.exec(sql);
            return [{ insertId: 0, affectedRows: 0 }, []];
        }

        const statement = db.prepare(sql);
        if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.startsWith('PRAGMA')) {
            return [statement.all(...normalizedParams), []];
        }

        const result = statement.run(...normalizedParams);
        return [{
            insertId: Number(result.lastInsertRowid || 0),
            affectedRows: Number(result.changes || 0)
        }, []];
    }

    async beginTransaction() {
        db.exec('BEGIN');
    }

    async commit() {
        db.exec('COMMIT');
    }

    async rollback() {
        db.exec('ROLLBACK');
    }

    release() {
        // Kept for compatibility with the previous MySQL pool API.
    }
}

const connection = new SQLiteConnection();

const pool = {
    execute: (...args) => connection.execute(...args),
    getConnection: async () => connection
};

function initializeDatabase() {
    const schemaPath = path.join(__dirname, '../../docs/sqlite/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    runMigrations();
}

function runMigrations() {
    // Additive, idempotent migrations for databases created before a
    // given schema change -- CREATE TABLE IF NOT EXISTS above only
    // covers brand-new databases, so an existing Users table (from a
    // database created before the profile-photo feature was added)
    // needs an explicit ALTER TABLE. Guarded to run safely on every
    // startup: SQLite has no "ADD COLUMN IF NOT EXISTS", so the
    // existing column set is checked first.
    const userColumns = db.prepare('PRAGMA table_info(Users)').all().map(c => c.name);
    if (!userColumns.includes('avatar_url')) {
        db.exec('ALTER TABLE Users ADD COLUMN avatar_url TEXT');
        console.log('🔧 Migrated database: added Users.avatar_url');
    }
    for (const column of ['college', 'department', 'year']) {
        if (!userColumns.includes(column)) {
            db.exec(`ALTER TABLE Users ADD COLUMN ${column} TEXT`);
            console.log(`🔧 Migrated database: added Users.${column}`);
        }
    }
    for (const column of ['email_verified_at', 'verification_token_hash', 'verification_expires_at']) {
        if (!userColumns.includes(column)) {
            db.exec(`ALTER TABLE Users ADD COLUMN ${column} TEXT`);
            console.log(`🔧 Migrated database: added Users.${column}`);
        }
    }
    // Accounts created before verification was introduced remain usable.
    db.exec("UPDATE Users SET email_verified_at = COALESCE(email_verified_at, created_at) WHERE email_verified_at IS NULL AND verification_token_hash IS NULL");
}

function testConnection() {
    try {
        initializeDatabase();
        db.prepare('SELECT 1').get();
        console.log(`✅ SQLite database ready: ${databasePath}`);
        return true;
    } catch (error) {
        console.error('❌ SQLite database initialization failed:', error.message);
        return false;
    }
}

module.exports = {
    db,
    pool,
    testConnection,
    initializeDatabase,
    databasePath
};
