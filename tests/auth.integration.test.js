// End-to-end authentication tests against the real Express app and a throwaway SQLite database.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-integration-test-secret';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.DB_PATH = require('node:path').join(require('node:os').tmpdir(), `twineval-test-${process.pid}-${Date.now()}.db`);
delete process.env.SMTP_USER; delete process.env.SMTP_PASS; delete process.env.SMTP_HOST;

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { testConnection, db } = require('../src/config/db');
const email = require('../src/services/emailService');

let server; let base;
const outbox = [];

test.before(async () => {
    assert.equal(testConnection(), true);
    email.__setTransportForTests({ sendMail: async (message) => { outbox.push(message); } });
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
async function call(method, url, { body, cookie, headers = {} } = {}) {
    const res = await fetch(base + url, {
        method,
        redirect: 'manual',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* not json */ }
    return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}
const sessionCookie = r => (r.setCookie.find(c => c.startsWith('twineval_session=')) || '').split(';')[0];
const lastMailToken = (pattern) => {
    const mail = outbox[outbox.length - 1];
    return new RegExp(pattern).exec(mail.text)[1];
};

async function registerAndVerify({ name, mail, role, password = 'CorrectHorse9' }) {
    const body = { name, email: mail, password, role, college: 'Test College', department: 'CSE' };
    if (role === 'student') Object.assign(body, { roll_no: 'R' + Math.floor(Math.random() * 1e6), semester: 3 });
    const reg = await call('POST', '/auth/register', { body });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    const token = lastMailToken('verify-email\\.html\\?token=([a-f0-9]{64})');
    return { token, password };
}

const student = { name: 'Sam Student', mail: 'sam.student@example.com', role: 'student' };
const teacher = { name: 'Tia Teacher', mail: 'tia.teacher@example.com', role: 'teacher' };

test('registration stores a bcrypt hash and requires email verification before sign-in', async () => {
    const { token, password } = await registerAndVerify(student);
    const row = db.prepare('SELECT password, verification_token_hash FROM Users WHERE email = ?').get(student.mail);
    assert.match(row.password, /^\$2[aby]\$12\$/);
    assert.notEqual(row.password, password);
    assert.notEqual(row.verification_token_hash, token); // only a hash is stored

    const blocked = await call('POST', '/auth/login', { body: { email: student.mail, password } });
    assert.equal(blocked.status, 403);
    assert.match(blocked.json.message, /verify your email/i);

    const verified = await call('GET', `/auth/verify-email?token=${token}`);
    assert.equal(verified.status, 200);
    const reuse = await call('GET', `/auth/verify-email?token=${token}`);
    assert.equal(reuse.status, 400);
});

test('public registration cannot create admin accounts', async () => {
    const r = await call('POST', '/auth/register', { body: { name: 'Eve', email: 'eve@example.com', password: 'CorrectHorse9', role: 'admin' } });
    assert.equal(r.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Users WHERE email = ?').get('eve@example.com').n, 0);
});

test('registration rejects weak passwords', async () => {
    const r = await call('POST', '/auth/register', { body: { name: 'Weak', email: 'weak@example.com', password: '12345', role: 'teacher' } });
    assert.equal(r.status, 400);
});

test('login validation: empty body and malformed email are rejected', async () => {
    assert.equal((await call('POST', '/auth/login', { body: {} })).status, 400);
    assert.equal((await call('POST', '/auth/login', { body: { email: 'not-an-email', password: 'x' } })).status, 400);
});

test('wrong password and unknown email produce the same generic 401', async () => {
    const wrong = await call('POST', '/auth/login', { body: { email: student.mail, password: 'WrongPassword1' } });
    const unknown = await call('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'WrongPassword1' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.message, unknown.json.message);
    assert.equal(wrong.setCookie.length, 0);
});

test('valid login sets an HttpOnly SameSite=Lax cookie; remember controls persistence', async () => {
    const remembered = await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9', remember: true } });
    assert.equal(remembered.status, 200);
    assert.equal(remembered.json.data.role, 'student');
    assert.ok(remembered.json.data.student_id);
    const header = remembered.setCookie.find(c => c.startsWith('twineval_session='));
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    assert.match(header, /Max-Age=/i);
    assert.doesNotMatch(header, /Secure/i); // only in production

    const session = await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9', remember: false } });
    const sessionHeader = session.setCookie.find(c => c.startsWith('twineval_session='));
    assert.doesNotMatch(sessionHeader, /Max-Age=|Expires=/i); // browser-session cookie
});

test('session restore via /auth/me works with the cookie and fails without one', async () => {
    const login = await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9' } });
    const cookie = sessionCookie(login);
    const me = await call('GET', '/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.email, student.mail);
    assert.equal(me.json.data.role, 'student');
    assert.equal((await call('GET', '/auth/me')).status, 401);
});

test('missing, malformed, wrongly-signed and expired tokens are rejected', async () => {
    const id = db.prepare('SELECT user_id FROM Users WHERE email = ?').get(student.mail).user_id;
    const forged = jwt.sign({ user_id: id }, 'some-other-secret');
    const expired = jwt.sign({ user_id: id }, process.env.JWT_SECRET, { expiresIn: -10 });
    const noneAlg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ user_id: id })).toString('base64url') + '.';
    for (const token of ['garbage', forged, expired, noneAlg]) {
        const viaBearer = await call('GET', '/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(viaBearer.status, 401, token.slice(0, 20));
        const viaCookie = await call('GET', '/auth/me', { cookie: `twineval_session=${token}` });
        assert.equal(viaCookie.status, 401);
    }
    const deleted = jwt.sign({ user_id: 999999, role: 'teacher' }, process.env.JWT_SECRET);
    assert.equal((await call('GET', '/auth/me', { headers: { Authorization: `Bearer ${deleted}` } })).status, 401);
});

test('protected APIs reject anonymous requests', async () => {
    for (const url of ['/dashboard', '/students', '/analytics', '/evaluations', '/plans', '/papers', '/submissions']) {
        assert.equal((await call('GET', url)).status, 401, url);
    }
    assert.equal((await call('POST', '/ai/evaluate', { body: { marks: 1, attendance: 1, communication: 1, problem_solving: 1 } })).status, 401);
});

test('roles are enforced on the server and cannot be forged through the token', async () => {
    await registerAndVerify(teacher).then(({ token }) => call('GET', `/auth/verify-email?token=${token}`));
    const studentCookie = sessionCookie(await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9' } }));
    const teacherLogin = await call('POST', '/auth/login', { body: { email: teacher.mail, password: 'CorrectHorse9' } });
    const teacherCookie = sessionCookie(teacherLogin);
    assert.equal(teacherLogin.json.data.role, 'teacher');

    assert.equal((await call('GET', '/students', { cookie: studentCookie })).status, 403);
    assert.equal((await call('GET', '/dashboard', { cookie: studentCookie })).status, 403);
    assert.equal((await call('GET', '/students', { cookie: teacherCookie })).status, 200);
    assert.equal((await call('GET', '/papers?mine=true', { cookie: teacherCookie })).status, 200);

    // A token that claims role=teacher for the student's user id is still treated as a student.
    const studentId = db.prepare('SELECT user_id FROM Users WHERE email = ?').get(student.mail).user_id;
    const forged = jwt.sign({ user_id: studentId, role: 'teacher', student_id: 1 }, process.env.JWT_SECRET);
    assert.equal((await call('GET', '/students', { headers: { Authorization: `Bearer ${forged}` } })).status, 403);
    const me = await call('GET', '/auth/me', { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(me.json.data.role, 'student');

    // Student-only endpoint is closed to teachers.
    assert.equal((await call('POST', '/submissions/generate-job', { cookie: teacherCookie, headers: XHR })).status, 403);
});

test('cookie-authenticated writes require the CSRF header and same-site origin', async () => {
    const cookie = sessionCookie(await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9' } }));
    const payload = { name: 'Sam Student', email: student.mail, college: 'X', department: 'CSE', year: '3' };
    assert.equal((await call('PUT', '/auth/profile', { cookie, body: payload })).status, 403);
    assert.equal((await call('PUT', '/auth/profile', { cookie, body: payload, headers: { ...XHR, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('PUT', '/auth/profile', { cookie, body: payload, headers: XHR })).status, 200);
});

test('logout clears the session cookie', async () => {
    const r = await call('POST', '/auth/logout');
    assert.equal(r.status, 200);
    const cleared = r.setCookie.find(c => c.startsWith('twineval_session='));
    assert.match(cleared, /twineval_session=;/);
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
});

test('forgot-password answers identically for known and unknown emails and mails only known ones', async () => {
    outbox.length = 0;
    const known = await call('POST', '/auth/forgot-password', { body: { email: student.mail } });
    const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'ghost@example.com' } });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.equal(known.json.message, unknown.json.message);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, student.mail);
    assert.equal((await call('POST', '/auth/forgot-password', { body: { email: 'bad' } })).status, 400);
});

test('password reset: hashed single-use token, expiry, new password works, old sessions die', async () => {
    outbox.length = 0;
    const oldCookie = sessionCookie(await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9' } }));
    await call('POST', '/auth/forgot-password', { body: { email: student.mail } });
    await new Promise(r => setTimeout(r, 50));
    const token = lastMailToken('reset-password\\.html#token=([a-f0-9]{64})');
    const stored = db.prepare('SELECT token_hash FROM PasswordResetTokens ORDER BY reset_id DESC LIMIT 1').get();
    assert.notEqual(stored.token_hash, token);
    assert.match(stored.token_hash, /^[a-f0-9]{64}$/);

    assert.equal((await call('POST', '/auth/reset-password', { body: { token, password: 'short' } })).status, 400);
    assert.equal((await call('POST', '/auth/reset-password', { body: { token: 'a'.repeat(64), password: 'BrandNewPass1' } })).status, 400);

    await new Promise(r => setTimeout(r, 1100)); // so the session issued above predates the change
    const ok = await call('POST', '/auth/reset-password', { body: { token, password: 'BrandNewPass1' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await call('POST', '/auth/reset-password', { body: { token, password: 'AnotherPass22' } })).status, 400); // single use

    assert.equal((await call('POST', '/auth/login', { body: { email: student.mail, password: 'CorrectHorse9' } })).status, 401);
    assert.equal((await call('POST', '/auth/login', { body: { email: student.mail, password: 'BrandNewPass1' } })).status, 200);
    assert.equal((await call('GET', '/auth/me', { cookie: oldCookie })).status, 401);
});

test('expired reset tokens are rejected', async () => {
    outbox.length = 0;
    await call('POST', '/auth/forgot-password', { body: { email: teacher.mail } });
    await new Promise(r => setTimeout(r, 50));
    const token = lastMailToken('reset-password\\.html#token=([a-f0-9]{64})');
    db.prepare("UPDATE PasswordResetTokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used_at IS NULL").run();
    const r = await call('POST', '/auth/reset-password', { body: { token, password: 'BrandNewPass1' } });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /invalid or has expired/i);
});

test('forgot-password reports honestly when email delivery is not configured', async () => {
    email.__setTransportForTests(null);
    const r = await call('POST', '/auth/forgot-password', { body: { email: student.mail } });
    assert.equal(r.status, 503);
    assert.doesNotMatch(r.json.message, /sent/i);
    email.__setTransportForTests({ sendMail: async (m) => { outbox.push(m); } });
});

test('errors never leak stack traces or SQL', async () => {
    const r = await call('POST', '/auth/login', { body: { email: student.mail, password: 'x' } });
    assert.equal(r.json.stack, undefined);
    assert.doesNotMatch(JSON.stringify(r.json), /SELECT|sqlite|at .*\.js/i);
});
