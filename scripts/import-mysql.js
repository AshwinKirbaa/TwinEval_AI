#!/usr/bin/env node
/**
 * One-time migration helper: import a MySQL/MariaDB SQL dump into TwinEval AI's
 * portable SQLite database.
 *
 * This script intentionally does NOT create demo/sample data. It only imports
 * INSERT statements found in the SQL dump supplied by the user.
 *
 * Usage:
 *   node scripts/import-mysql.js /path/to/twineval_ai.sql
 *   npm run import:mysql -- /path/to/twineval_ai.sql
 *
 * The target SQLite database must be empty. A non-empty database is rejected
 * so existing real data cannot be silently overwritten or mixed with another
 * database.
 */

const fs = require('fs');
const path = require('path');
const { pool, initializeDatabase, databasePath, db } = require('../src/config/db');

const TABLE_COLUMNS = {
    Users: ['user_id', 'name', 'email', 'password', 'role', 'created_at', 'updated_at'],
    Student: ['student_id', 'name', 'roll_no', 'user_id', 'email', 'department', 'semester', 'created_at', 'updated_at'],
    EvaluationResult: ['evaluation_id', 'student_id', 'subject', 'marks', 'attendance', 'communication', 'problem_solving', 'ai_score', 'remarks', 'evaluated_at'],
    LearningPlan: ['plan_id', 'student_id', 'weak_topics', 'recommended_resources', 'practice_tasks', 'study_schedule', 'generated_date'],
    TeacherAnalytics: ['analytics_id', 'department', 'average_score', 'top_students', 'weak_students', 'generated_on'],
    QuestionPaper: ['paper_id', 'teacher_id', 'title', 'subject', 'topic', 'pass_percentage', 'source_file_path', 'status', 'created_at', 'updated_at'],
    Question: ['question_id', 'paper_id', 'ai_question_id', 'question_order', 'text', 'topic', 'max_marks', 'group_id', 'group_required'],
    AnswerKey: ['answer_key_id', 'question_id', 'data', 'generated_at'],
    Submission: ['submission_id', 'paper_id', 'student_id', 'answer_file_path', 'raw_extracted_text', 'total_marks', 'max_marks', 'percentage', 'grade', 'pass_fail', 'overall_report', 'status', 'error_message', 'teacher_override_marks', 'teacher_comments', 'submitted_at', 'evaluated_at'],
    QuestionResult: ['result_id', 'submission_id', 'question_id', 'student_answer', 'marks', 'max_marks', 'percentage', 'grade', 'is_off_topic', 'needs_review', 'teacher_override_marks', 'full_result']
};

const INSERT_ORDER = Object.keys(TABLE_COLUMNS);

function usage() {
    console.error('Usage: npm run import:mysql -- /path/to/twineval_ai.sql');
    process.exit(2);
}

function stripIdentifier(identifier) {
    return identifier.trim().replace(/^`|`$/g, '');
}

function splitStatements(sql) {
    const statements = [];
    let start = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let i = 0; i < sql.length; i += 1) {
        const ch = sql[i];
        const next = sql[i + 1];

        if (lineComment) {
            if (ch === '\n' || ch === '\r') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') {
                blockComment = false;
                i += 1;
            }
            continue;
        }

        if (!quote && ch === '-' && next === '-' && /\s/.test(sql[i + 2] || '')) {
            lineComment = true;
            i += 1;
            continue;
        }
        if (!quote && ch === '#') {
            lineComment = true;
            continue;
        }
        if (!quote && ch === '/' && next === '*') {
            blockComment = true;
            i += 1;
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) {
                if (sql[i + 1] === quote) {
                    i += 1;
                } else {
                    quote = null;
                }
            }
            continue;
        }

        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }

        if (ch === ';') {
            const statement = sql.slice(start, i).trim();
            if (statement) statements.push(statement);
            start = i + 1;
        }
    }

    const tail = sql.slice(start).trim();
    if (tail) statements.push(tail);
    return statements;
}

function extractInsert(statement) {
    const match = statement.match(/^INSERT\s+(?:IGNORE\s+)?INTO\s+(?:`[^`]+`\.)?`?([A-Za-z0-9_]+)`?\s*(?:\(([^)]*)\))?\s+VALUES\s+([\s\S]+)$/i);
    if (!match) return null;

    const table = stripIdentifier(match[1]);
    if (!TABLE_COLUMNS[table]) return null;

    const columns = match[2]
        ? match[2].split(',').map(stripIdentifier)
        : TABLE_COLUMNS[table];

    for (const column of columns) {
        if (!TABLE_COLUMNS[table].includes(column)) {
            throw new Error(`Unsupported column '${column}' in table '${table}'.`);
        }
    }

    return { table, columns, valuesText: match[3].trim() };
}

function splitRows(valuesText) {
    const rows = [];
    let rowStart = -1;
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = 0; i < valuesText.length; i += 1) {
        const ch = valuesText[i];

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                if (valuesText[i + 1] === quote) {
                    i += 1;
                } else {
                    quote = null;
                }
            }
            continue;
        }

        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === '(') {
            if (depth === 0) rowStart = i + 1;
            depth += 1;
        } else if (ch === ')') {
            depth -= 1;
            if (depth === 0) {
                rows.push(valuesText.slice(rowStart, i));
            }
        }
    }

    if (depth !== 0) throw new Error('Malformed INSERT statement: unbalanced parentheses.');
    return rows;
}

function splitValues(row) {
    const values = [];
    let start = 0;
    let quote = null;
    let escaped = false;
    let depth = 0;

    for (let i = 0; i < row.length; i += 1) {
        const ch = row[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) {
                if (row[i + 1] === quote) i += 1;
                else quote = null;
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
        if (ch === ',' && depth === 0) {
            values.push(row.slice(start, i).trim());
            start = i + 1;
        }
    }
    values.push(row.slice(start).trim());
    return values;
}

function decodeMySqlString(token) {
    const quote = token[0];
    let value = token.slice(1, -1);
    if (quote === "'") {
        value = value.replace(/\\([0abfnrtvZ'"\\])/g, (_, c) => ({
            '0': '\0',
            a: '\x07',
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
            v: '\x0b',
            Z: '\x1a',
            "'": "'",
            '"': '"',
            '\\': '\\'
        })[c]);
        value = value.replace(/''/g, "'");
    } else {
        value = value.replace(/""/g, '"');
    }
    return value;
}

function decodeValue(token) {
    const trimmed = token.trim();
    if (/^NULL$/i.test(trimmed)) return null;
    if (/^(TRUE|FALSE)$/i.test(trimmed)) return /^TRUE$/i.test(trimmed) ? 1 : 0;
    if (/^b'[01]'$/i.test(trimmed)) return trimmed[2] === '1' ? 1 : 0;
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return decodeMySqlString(trimmed);
    }
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
}

function collectInserts(sql) {
    const statements = splitStatements(sql);
    const inserts = [];
    for (const statement of statements) {
        const insert = extractInsert(statement);
        if (!insert) continue;
        for (const rowText of splitRows(insert.valuesText)) {
            const rawValues = splitValues(rowText);
            if (rawValues.length !== insert.columns.length) {
                throw new Error(`Column/value count mismatch in INSERT into ${insert.table}: expected ${insert.columns.length}, got ${rawValues.length}.`);
            }
            const row = {};
            insert.columns.forEach((column, index) => {
                row[column] = decodeValue(rawValues[index]);
            });
            inserts.push({ table: insert.table, row });
        }
    }
    return inserts;
}

function countRows(table) {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

async function main() {
    const dumpPath = process.argv[2];
    if (!dumpPath || dumpPath.startsWith('-')) usage();

    const absoluteDumpPath = path.resolve(process.cwd(), dumpPath);
    if (!fs.existsSync(absoluteDumpPath)) {
        throw new Error(`SQL dump not found: ${absoluteDumpPath}`);
    }

    initializeDatabase();

    const existing = INSERT_ORDER
        .map(table => ({ table, count: Number(countRows(table)) }))
        .filter(item => item.count > 0);

    if (existing.length) {
        throw new Error(
            `Target SQLite database is not empty (${existing.map(x => `${x.table}=${x.count}`).join(', ')}). ` +
            'Migration was stopped to protect existing data. Back up/remove the target database and retry.'
        );
    }

    const sql = fs.readFileSync(absoluteDumpPath, 'utf8');
    const inserts = collectInserts(sql);
    if (!inserts.length) throw new Error('No supported INSERT statements were found in the SQL dump.');

    const grouped = new Map(INSERT_ORDER.map(table => [table, []]));
    for (const item of inserts) grouped.get(item.table).push(item.row);

    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
        let total = 0;
        for (const table of INSERT_ORDER) {
            const rows = grouped.get(table);
            if (!rows.length) continue;

            const columns = Object.keys(rows[0]);
            const quotedColumns = columns.map(column => `"${column}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const statement = db.prepare(`INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders})`);

            for (const row of rows) {
                statement.run(...columns.map(column => row[column]));
                total += 1;
            }
            console.log(`Imported ${rows.length} row(s) into ${table}.`);
        }

        // Validate relationships before committing. If anything is invalid,
        // the transaction is rolled back and the target remains empty.
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length) {
            throw new Error(`SQLite foreign-key validation failed with ${violations.length} violation(s).`);
        }

        db.exec('COMMIT');
        db.exec('PRAGMA foreign_keys = ON');

        console.log('');
        console.log('✅ Real MySQL data imported successfully.');
        console.log(`📁 SQLite database: ${databasePath}`);
        console.log(`📦 Rows imported: ${total}`);
        console.log('');
        console.log('No demo/sample data was created by this migration.');
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) { /* rollback may already have happened */ }
        db.exec('PRAGMA foreign_keys = ON');
        throw error;
    }
}

main().catch(error => {
    console.error(`❌ Migration failed: ${error.message}`);
    process.exit(1);
});
