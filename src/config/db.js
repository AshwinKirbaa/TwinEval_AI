const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const isVercel = Boolean(process.env.VERCEL);

const configuredPath = process.env.DB_PATH || './database/twineval.db';

const databasePath = isVercel
    ? '/tmp/twineval.db'
    : (
        path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(__dirname, '../..', configuredPath)
    );

if (!isVercel) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

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

    // Authentication hardening: password reset tokens, account status.
    const authColumns = {
        reset_token_hash: 'TEXT',
        reset_expires_at: 'TEXT',
        password_changed_at: 'TEXT',
        account_status: "TEXT NOT NULL DEFAULT 'active'"
    };
    for (const [column, definition] of Object.entries(authColumns)) {
        if (!userColumns.includes(column)) {
            db.exec(`ALTER TABLE Users ADD COLUMN ${column} ${definition}`);
            console.log(`🔧 Migrated database: added Users.${column}`);
        }
    }

    // Server-side sessions (refresh tokens stored as hashes; revocable).
    db.exec(`
        CREATE TABLE IF NOT EXISTS AuthSession (
            session_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            refresh_hash TEXT NOT NULL UNIQUE,
            remember INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            user_agent TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_authsession_user ON AuthSession(user_id);
    `);

    // Case-insensitive uniqueness backs up the application-level email
    // normalization (also guards concurrent registrations). Skipped, not
    // fatal, if legacy data already contains case-variant duplicates.
    try {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_lower ON Users(lower(email))');
    } catch (error) {
        console.warn('Could not create case-insensitive unique email index:', error.message);
    }
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
