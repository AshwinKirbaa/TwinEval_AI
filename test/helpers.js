// Shared test harness. Must be required BEFORE the app so configuration is in place.
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'twineval-test-')), 'test.db');
process.env.NODE_ENV = 'test';
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.PUBLIC_APP_URL = 'http://localhost:5000';
delete process.env.VERCEL;
// Generous limits so functional tests are not throttled; ratelimit.test.js sets its own first.
for (const name of ['AUTH_LOGIN_MAX', 'AUTH_REGISTER_MAX', 'AUTH_EMAIL_MAX', 'AUTH_RESET_MAX']) {
    process.env[name] = process.env[name] || '1000';
}

const app = require('../server');
const { db, initializeDatabase } = require('../src/config/db');
const bcrypt = require('bcryptjs');
const { outbox } = require('../src/services/emailService');

initializeDatabase();

const STRONG = 'Correct-Horse-Battery-9';
let counter = 0;
const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${counter++}@example.com`;

function start() {
    return new Promise(resolve => {
        const server = http.createServer(app).listen(0, '127.0.0.1', () => {
            resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

/** Minimal cookie-jar HTTP client. */
function client(base) {
    const jar = new Map();
    const api = {
        jar,
        async request(method, url, body, headers = {}) {
            const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
            const res = await fetch(base + url, {
                method,
                headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: 'manual'
            });
            const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
            for (const line of raw) {
                const [pair, ...attrs] = line.split(';');
                const [name, ...rest] = pair.split('=');
                const value = rest.join('=');
                const expired = attrs.some(a => /^\s*max-age=0/i.test(a)) || attrs.some(a => /expires=thu, 01 jan 1970/i.test(a));
                if (expired || !value) jar.delete(name.trim()); else jar.set(name.trim(), value);
            }
            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch (_) { /* not json */ }
            return { status: res.status, json, text, headers: res.headers, setCookie: raw };
        },
        get: (url, headers) => api.request('GET', url, undefined, headers),
        post: (url, body, headers) => api.request('POST', url, body ?? {}, headers),
        put: (url, body, headers) => api.request('PUT', url, body ?? {}, headers)
    };
    return api;
}

const tokenFromLink = link => new URL(link).searchParams.get('token');
const lastMail = to => [...outbox].reverse().find(m => m.to === to);

/** Register + verify. Returns credentials. */
async function createVerifiedUser(base, { role = 'student', email = uniqueEmail(role), password = STRONG } = {}) {
    const c = client(base);
    const body = {
        name: `Test ${role}`, email, password, confirm_password: password, role,
        college: 'Test College', department: 'CSE'
    };
    if (role === 'student') Object.assign(body, { roll_no: `R${Date.now()}${counter++}`, semester: 3 });
    const reg = await c.post('/auth/register', body);
    if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
    const verify = await c.post('/auth/verify-email', { token: tokenFromLink(lastMail(email).link) });
    if (verify.status !== 200) throw new Error(`verify failed: ${verify.text}`);
    return { email, password, role };
}

async function signIn(base, creds, extra = {}) {
    const c = client(base);
    const res = await c.post('/auth/login', { email: creds.email, password: creds.password, ...extra });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
    return { c, res };
}

function createAdmin() {
    const email = uniqueEmail('admin');
    db.prepare(`INSERT INTO Users (name, email, password, role, email_verified_at) VALUES (?, ?, ?, 'admin', CURRENT_TIMESTAMP)`)
        .run('Admin', email, bcrypt.hashSync(STRONG, 4));
    return { email, password: STRONG, role: 'admin' };
}

module.exports = { db, outbox, STRONG, uniqueEmail, start, client, tokenFromLink, lastMail, createVerifiedUser, signIn, createAdmin };
