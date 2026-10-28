const helpers = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const {
    db, outbox, STRONG, uniqueEmail, start, client, tokenFromLink, lastMail,
    createVerifiedUser, signIn, createAdmin
} = helpers;

let server;
let base;

test.before(async () => {
    ({ server, base } = await start());
});
test.after(() => new Promise(resolve => server.close(resolve)));

const registerBody = (overrides = {}) => {
    const email = uniqueEmail('reg');
    return {
        name: 'Alex Morgan', email, password: STRONG, confirm_password: STRONG, role: 'teacher',
        college: 'NIT', department: 'CSE', ...overrides
    };
};

test('registration', async t => {
    await t.test('valid registration succeeds and never returns secrets', async () => {
        const c = client(base);
        const body = registerBody();
        const res = await c.post('/auth/register', body);
        assert.equal(res.status, 201);
        assert.equal(res.json.data.email, body.email);
        assert.ok(!/password|hash|token/i.test(JSON.stringify(res.json.data)));
        assert.ok(lastMail(body.email), 'verification email should be queued');
    });

    await t.test('stores a bcrypt hash, not the plaintext password', async () => {
        const body = registerBody();
        await client(base).post('/auth/register', body);
        const row = db.prepare('SELECT password FROM Users WHERE email = ?').get(body.email);
        assert.notEqual(row.password, body.password);
        assert.match(row.password, /^\$2[aby]\$12\$/);
    });

    await t.test('normalizes the email address (trim + lowercase)', async () => {
        const body = registerBody();
        const res = await client(base).post('/auth/register', { ...body, email: `  ${body.email.toUpperCase()} ` });
        assert.equal(res.status, 201);
        assert.equal(res.json.data.email, body.email);
    });

    await t.test('rejects duplicate emails, including case variants', async () => {
        const body = registerBody();
        assert.equal((await client(base).post('/auth/register', body)).status, 201);
        assert.equal((await client(base).post('/auth/register', body)).status, 409);
        assert.equal((await client(base).post('/auth/register', { ...body, email: body.email.toUpperCase() })).status, 409);
    });

    await t.test('concurrent duplicate registrations create exactly one account', async () => {
        const body = registerBody();
        const results = await Promise.all(Array.from({ length: 4 }, () => client(base).post('/auth/register', body)));
        assert.equal(results.filter(r => r.status === 201).length, 1);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM Users WHERE email = ?').get(body.email).n, 1);
    });

    await t.test('rejects an invalid email', async () => {
        const res = await client(base).post('/auth/register', registerBody({ email: 'not-an-email' }));
        assert.equal(res.status, 400);
        assert.ok(res.json.fields.email);
    });

    await t.test('rejects weak passwords', async () => {
        for (const weak of ['short1', 'alllettersnodigits', '123456789012345', 'Password1234']) {
            const res = await client(base).post('/auth/register', registerBody({ password: weak, confirm_password: weak }));
            assert.equal(res.status, 400, `password "${weak}" should be rejected`);
        }
    });

    await t.test('rejects mismatched confirm password', async () => {
        const res = await client(base).post('/auth/register', registerBody({ confirm_password: STRONG + 'x' }));
        assert.equal(res.status, 400);
        assert.ok(res.json.fields.confirm_password);
    });

    await t.test('cannot register privileged roles publicly', async () => {
        const res = await client(base).post('/auth/register', registerBody({ role: 'admin' }));
        assert.equal(res.status, 400);
    });

    await t.test('student registration requires student fields and creates a linked record', async () => {
        const missing = await client(base).post('/auth/register', registerBody({ role: 'student' }));
        assert.equal(missing.status, 400);
        const body = registerBody({ role: 'student', roll_no: `RN${Date.now()}`, semester: 4 });
        assert.equal((await client(base).post('/auth/register', body)).status, 201);
        const user = db.prepare('SELECT user_id, role FROM Users WHERE email = ?').get(body.email);
        assert.equal(user.role, 'student');
        assert.ok(db.prepare('SELECT 1 FROM Student WHERE user_id = ?').get(user.user_id));
    });
});

test('email verification', async t => {
    await t.test('link verifies once; reuse and garbage tokens fail', async () => {
        const body = registerBody();
        await client(base).post('/auth/register', body);
        const token = tokenFromLink(lastMail(body.email).link);
        assert.equal((await client(base).post('/auth/verify-email', { token })).status, 200);
        assert.equal((await client(base).post('/auth/verify-email', { token })).status, 400);
        assert.equal((await client(base).post('/auth/verify-email', { token: 'x'.repeat(64) })).status, 400);
    });

    await t.test('expired verification tokens are rejected', async () => {
        const body = registerBody();
        await client(base).post('/auth/register', body);
        const token = tokenFromLink(lastMail(body.email).link);
        db.prepare(`UPDATE Users SET verification_expires_at = ? WHERE email = ?`).run(new Date(Date.now() - 1000).toISOString(), body.email);
        assert.equal((await client(base).post('/auth/verify-email', { token })).status, 400);
    });

    await t.test('resend gives the same generic answer for known and unknown emails', async () => {
        const body = registerBody();
        await client(base).post('/auth/register', body);
        const before = outbox.length;
        const known = await client(base).post('/auth/resend-verification', { email: body.email });
        const unknown = await client(base).post('/auth/resend-verification', { email: uniqueEmail('ghost') });
        assert.equal(known.status, 200);
        assert.deepEqual(known.json, unknown.json);
        assert.equal(outbox.length, before + 1, 'only the real, unverified account receives mail');
        // the freshly issued token works
        assert.equal((await client(base).post('/auth/verify-email', { token: tokenFromLink(lastMail(body.email).link) })).status, 200);
    });
});

test('login', async t => {
    const creds = await createVerifiedUser(base, { role: 'teacher' });

    await t.test('correct credentials succeed with HttpOnly cookies and no token in the body', async () => {
        const { c, res } = await signIn(base, creds);
        assert.equal(res.json.data.role, 'teacher');
        assert.ok(!('token' in res.json.data) && !('password' in res.json.data));
        const cookies = res.setCookie.join('\n');
        assert.match(cookies, /te_at=[^;]+;.*HttpOnly/i);
        assert.match(cookies, /te_rt=[^;]+;.*HttpOnly/i);
        assert.match(cookies, /SameSite=Strict/i);
        assert.equal((await c.get('/auth/me')).json.data.email, creds.email);
    });

    await t.test('remember me makes the refresh cookie persistent; default is a session cookie', async () => {
        const remembered = await signIn(base, creds, { remember: true });
        assert.match(remembered.res.setCookie.find(l => l.startsWith('te_rt=')), /Max-Age=\d+/i);
        const plain = await signIn(base, creds);
        assert.doesNotMatch(plain.res.setCookie.find(l => l.startsWith('te_rt=')), /Max-Age|Expires/i);
    });

    await t.test('wrong password and unknown email get an identical generic error', async () => {
        const wrong = await client(base).post('/auth/login', { email: creds.email, password: 'Wrong-password-123' });
        const unknown = await client(base).post('/auth/login', { email: uniqueEmail('nobody'), password: 'Wrong-password-123' });
        assert.equal(wrong.status, 401);
        assert.equal(unknown.status, 401);
        assert.deepEqual(wrong.json, unknown.json);
    });

    await t.test('unverified accounts cannot sign in (after proving the password)', async () => {
        const body = registerBody();
        await client(base).post('/auth/register', body);
        const bad = await client(base).post('/auth/login', { email: body.email, password: 'nope-nope-nope-1' });
        assert.equal(bad.status, 401);
        const res = await client(base).post('/auth/login', { email: body.email, password: STRONG });
        assert.equal(res.status, 403);
        assert.equal(res.json.code, 'EMAIL_NOT_VERIFIED');
    });

    await t.test('disabled accounts cannot sign in and existing sessions stop working', async () => {
        const u = await createVerifiedUser(base, { role: 'teacher' });
        const { c } = await signIn(base, u);
        assert.equal((await c.get('/auth/me')).status, 200);
        db.prepare(`UPDATE Users SET account_status = 'disabled' WHERE email = ?`).run(u.email);
        assert.equal((await client(base).post('/auth/login', { email: u.email, password: u.password })).status, 403);
        assert.equal((await c.get('/auth/me')).status, 401);
    });

    await t.test('repeated failures lock the account, even for the right password', async () => {
        const u = await createVerifiedUser(base, { role: 'teacher' });
        for (let i = 0; i < 5; i++) {
            assert.equal((await client(base).post('/auth/login', { email: u.email, password: 'Wrong-password-123' })).status, 401);
        }
        assert.equal((await client(base).post('/auth/login', { email: u.email, password: u.password })).status, 429);
        // unknown emails lock identically, so the lock does not reveal existence
        const ghost = uniqueEmail('ghost');
        for (let i = 0; i < 5; i++) await client(base).post('/auth/login', { email: ghost, password: 'Wrong-password-123' });
        assert.equal((await client(base).post('/auth/login', { email: ghost, password: 'Wrong-password-123' })).status, 429);
    });
});

test('sessions: logout, revocation, expiry', async t => {
    const creds = await createVerifiedUser(base, { role: 'teacher' });

    await t.test('logout clears cookies and revokes the session server-side', async () => {
        const { c } = await signIn(base, creds);
        const stolen = new Map(c.jar); // a copy of the cookies, as an attacker might replay them
        const out = await c.post('/auth/logout');
        assert.equal(out.status, 200);
        assert.equal(c.jar.size, 0);
        assert.equal((await c.get('/auth/me')).status, 401);

        const replay = client(base);
        stolen.forEach((v, k) => replay.jar.set(k, v));
        assert.equal((await replay.get('/auth/me')).status, 401, 'revoked cookies must be rejected');
    });

    await t.test('unauthenticated requests are rejected with 401', async () => {
        assert.equal((await client(base).get('/auth/me')).status, 401);
        assert.equal((await client(base).get('/papers')).status, 401);
    });

    await t.test('an expired access token is transparently renewed from the refresh cookie', async () => {
        const { c } = await signIn(base, creds);
        const claims = jwt.decode(c.jar.get('te_at'));
        const expired = jwt.sign(
            { user_id: claims.user_id, role: claims.role, sid: claims.sid, iat: Math.floor(Date.now() / 1000) - 7200 },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', issuer: 'twineval-ai', audience: 'twineval-web', expiresIn: 60 }
        );
        c.jar.set('te_at', expired);
        const res = await c.get('/auth/me');
        assert.equal(res.status, 200);
        assert.notEqual(c.jar.get('te_at'), expired, 'a new access cookie is issued');
    });

    await t.test('an expired access token without a valid refresh token is rejected', async () => {
        const { c } = await signIn(base, creds);
        const claims = jwt.decode(c.jar.get('te_at'));
        c.jar.set('te_at', jwt.sign(
            { user_id: claims.user_id, role: claims.role, sid: claims.sid, iat: Math.floor(Date.now() / 1000) - 7200 },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', issuer: 'twineval-ai', audience: 'twineval-web', expiresIn: 60 }
        ));
        c.jar.delete('te_rt');
        assert.equal((await c.get('/auth/me')).status, 401);
    });

    await t.test('forged or wrongly signed tokens are rejected', async () => {
        const c = client(base);
        c.jar.set('te_at', jwt.sign({ user_id: 1, role: 'admin', sid: 'x' }, 'another-secret-another-secret-1234567', { algorithm: 'HS256', issuer: 'twineval-ai', audience: 'twineval-web' }));
        assert.equal((await c.get('/auth/me')).status, 401);
        c.jar.set('te_at', jwt.sign({ user_id: 1, role: 'admin', sid: 'x' }, process.env.JWT_SECRET, { algorithm: 'HS256' }));
        assert.equal((await c.get('/auth/me')).status, 401, 'tokens without the expected issuer/audience are rejected');
    });

    await t.test('expired server-side sessions are rejected', async () => {
        const { c } = await signIn(base, creds);
        const sid = jwt.decode(c.jar.get('te_at')).sid;
        db.prepare(`UPDATE AuthSession SET expires_at = ? WHERE session_id = ?`).run(new Date(Date.now() - 1000).toISOString(), sid);
        assert.equal((await c.get('/auth/me')).status, 401);
    });
});

test('authorization', async t => {
    const studentA = await createVerifiedUser(base, { role: 'student' });
    const studentB = await createVerifiedUser(base, { role: 'student' });
    const teacher = await createVerifiedUser(base, { role: 'teacher' });
    const otherTeacher = await createVerifiedUser(base, { role: 'teacher' });
    const sa = (await signIn(base, studentA)).c;
    const tc = (await signIn(base, teacher)).c;
    const ot = (await signIn(base, otherTeacher)).c;
    const idOf = email => db.prepare(`SELECT s.student_id FROM Student s JOIN Users u ON u.user_id = s.user_id WHERE u.email = ?`).get(email).student_id;
    const aId = idOf(studentA.email);
    const bId = idOf(studentB.email);

    await t.test('students cannot reach teacher-only endpoints (403)', async () => {
        assert.equal((await sa.get('/students')).status, 403);
        assert.equal((await sa.get('/students/analytics/leaderboard')).status, 403);
        assert.equal((await sa.get('/analytics')).status, 403);
        assert.equal((await sa.get('/dashboard')).status, 403);
        assert.equal((await sa.get('/evaluations')).status, 403);
        assert.equal((await sa.post('/papers/finalize', {})).status, 403);
        assert.equal((await sa.post('/ai/evaluate', {})).status, 403);
    });

    await t.test('teacher-only data endpoints require authentication (401)', async () => {
        for (const url of ['/students', '/students/1', '/analytics', '/dashboard', '/evaluations', '/plans', '/papers/1']) {
            assert.equal((await client(base).get(url)).status, 401, url);
        }
    });

    await t.test('students can read their own record but not another student\'s', async () => {
        assert.equal((await sa.get(`/students/${aId}`)).status, 200);
        assert.equal((await sa.get(`/students/${aId}/report`)).status, 200);
        assert.equal((await sa.get(`/students/${bId}`)).status, 403);
        assert.equal((await sa.get(`/students/${bId}/report`)).status, 403);
        assert.equal((await tc.get(`/students/${bId}`)).status, 200);
    });

    await t.test('users cannot escalate their own role', async () => {
        const res = await sa.put('/auth/profile', { name: 'Hacker', email: studentA.email, role: 'admin', user_id: 1 });
        assert.equal(res.status, 200);
        assert.equal(db.prepare('SELECT role FROM Users WHERE email = ?').get(studentA.email).role, 'student');
        assert.equal((await sa.get('/students')).status, 403);
    });

    await t.test('a student cannot create or modify papers or evaluations', async () => {
        assert.equal((await sa.put('/submissions/1/override', {})).status, 403);
        assert.equal((await sa.post('/evaluations', {})).status, 403);
    });

    await t.test('uploaded files are private and authorized per file', async () => {
        const teacherId = db.prepare('SELECT user_id FROM Users WHERE email = ?').get(teacher.email).user_id;
        const paperId = Number(db.prepare(`INSERT INTO QuestionPaper (teacher_id, title, subject) VALUES (?, 'P', 'S')`).run(teacherId).lastInsertRowid);
        const sheet = `test-sheet-${Date.now()}.txt`;
        const avatar = `test-avatar-${Date.now()}.txt`;
        const uploads = path.join(__dirname, '..', 'uploads');
        fs.writeFileSync(path.join(uploads, sheet), 'answer sheet');
        fs.writeFileSync(path.join(uploads, avatar), 'avatar');
        db.prepare(`INSERT INTO Submission (paper_id, student_id, answer_file_path) VALUES (?, ?, ?)`).run(paperId, aId, `/uploads/${sheet}`);
        db.prepare(`UPDATE Users SET avatar_url = ? WHERE email = ?`).run(`/uploads/${avatar}`, studentA.email);
        try {
            assert.equal((await client(base).get(`/uploads/${sheet}`)).status, 401, 'anonymous');
            assert.equal((await sa.get(`/uploads/${sheet}`)).status, 200, 'owning student');
            assert.equal((await tc.get(`/uploads/${sheet}`)).status, 200, "paper's teacher");
            assert.equal((await ot.get(`/uploads/${sheet}`)).status, 403, 'unrelated teacher');
            const sb = (await signIn(base, studentB)).c;
            assert.equal((await sb.get(`/uploads/${sheet}`)).status, 403, 'other student');
            assert.equal((await sb.get(`/uploads/${avatar}`)).status, 200, 'avatars are visible to signed-in users');
            assert.equal((await sa.get('/uploads/does-not-exist.txt')).status, 404);
            assert.equal((await sa.get('/uploads/..%2Fserver.js')).status, 404);
            const admin = createAdmin();
            assert.equal((await (await signIn(base, admin)).c.get(`/uploads/${sheet}`)).status, 200, 'admin');
        } finally {
            fs.rmSync(path.join(uploads, sheet), { force: true });
            fs.rmSync(path.join(uploads, avatar), { force: true });
        }
    });

    await t.test('papers: answer keys are staff-only and lists require sign-in', async () => {
        assert.equal((await sa.get('/papers')).status, 200);
        assert.equal((await sa.get('/papers/1')).status, 403);
    });
});

test('CSRF and CORS', async t => {
    const creds = await createVerifiedUser(base, { role: 'teacher' });
    const { c } = await signIn(base, creds);

    await t.test('state-changing requests from a foreign origin are blocked', async () => {
        const res = await c.put('/auth/profile', { name: 'x', email: creds.email }, { Origin: 'https://evil.example' });
        assert.equal(res.status, 403);
        const sameOrigin = await c.put('/auth/profile', { name: 'Same Origin', email: creds.email }, { Origin: base });
        assert.equal(sameOrigin.status, 200);
        const fetchMeta = await c.put('/auth/profile', { name: 'x', email: creds.email }, { 'Sec-Fetch-Site': 'cross-site' });
        assert.equal(fetchMeta.status, 403);
    });

    await t.test('CORS is not reflected for unknown origins', async () => {
        const res = await c.get('/health', { Origin: 'https://evil.example' });
        assert.equal(res.headers.get('access-control-allow-origin'), null);
    });

    await t.test('security headers are present', async () => {
        const res = await client(base).get('/health');
        assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('x-powered-by'), null);
    });
});

test('password reset', async t => {
    await t.test('requests do not reveal whether an account exists', async () => {
        const u = await createVerifiedUser(base, { role: 'teacher' });
        const before = outbox.length;
        const known = await client(base).post('/auth/forgot-password', { email: u.email });
        const unknown = await client(base).post('/auth/forgot-password', { email: uniqueEmail('ghost') });
        assert.equal(known.status, 200);
        assert.equal(unknown.status, 200);
        assert.deepEqual(known.json, unknown.json);
        assert.equal(outbox.length, before + 1);
        assert.ok(!/token/i.test(known.text));
    });

    await t.test('full reset: token works once, old password dies, sessions are revoked', async () => {
        const u = await createVerifiedUser(base, { role: 'teacher' });
        const { c: oldSession } = await signIn(base, u);
        await client(base).post('/auth/forgot-password', { email: u.email });
        const token = tokenFromLink(lastMail(u.email).link);
        const stored = db.prepare('SELECT reset_token_hash FROM Users WHERE email = ?').get(u.email).reset_token_hash;
        assert.notEqual(stored, token, 'only a hash of the token is stored');

        const newPassword = 'Brand-New-Passw0rd!';
        const reset = await client(base).post('/auth/reset-password', { token, password: newPassword, confirm_password: newPassword });
        assert.equal(reset.status, 200);

        assert.equal((await client(base).post('/auth/login', { email: u.email, password: u.password })).status, 401, 'old password');
        assert.equal((await client(base).post('/auth/login', { email: u.email, password: newPassword })).status, 200, 'new password');
        assert.equal((await oldSession.get('/auth/me')).status, 401, 'pre-reset sessions are revoked');

        const reuse = await client(base).post('/auth/reset-password', { token, password: 'Another-Passw0rd-1', confirm_password: 'Another-Passw0rd-1' });
        assert.equal(reuse.status, 400, 'token cannot be reused');
    });

    await t.test('invalid, malformed and expired tokens are rejected', async () => {
        const u = await createVerifiedUser(base, { role: 'teacher' });
        const pw = 'Brand-New-Passw0rd!';
        assert.equal((await client(base).post('/auth/reset-password', { token: 'a'.repeat(64), password: pw, confirm_password: pw })).status, 400);
        assert.equal((await client(base).post('/auth/reset-password', { token: 'short', password: pw, confirm_password: pw })).status, 400);
        await client(base).post('/auth/forgot-password', { email: u.email });
        const token = tokenFromLink(lastMail(u.email).link);
        db.prepare(`UPDATE Users SET reset_expires_at = ? WHERE email = ?`).run(new Date(Date.now() - 1000).toISOString(), u.email);
        assert.equal((await client(base).post('/auth/reset-password', { token, password: pw, confirm_password: pw })).status, 400);
    });

    await t.test('the new password must satisfy the same policy', async () => {
        const u = await createVerifiedUser(base, { role: 'teacher' });
        await client(base).post('/auth/forgot-password', { email: u.email });
        const token = tokenFromLink(lastMail(u.email).link);
        const weak = await client(base).post('/auth/reset-password', { token, password: 'weak', confirm_password: 'weak' });
        assert.equal(weak.status, 400);
        const ok = await client(base).post('/auth/reset-password', { token, password: 'Strong-Enough-Pw-7', confirm_password: 'Strong-Enough-Pw-7' });
        assert.equal(ok.status, 200, 'a rejected attempt does not burn the token');
    });
});

test('existing workflows still work with cookie auth', async t => {
    const teacher = await createVerifiedUser(base, { role: 'teacher' });
    const student = await createVerifiedUser(base, { role: 'student' });
    const tc = (await signIn(base, teacher)).c;
    const sc = (await signIn(base, student)).c;

    await t.test('teacher paper listing and student published-paper listing', async () => {
        assert.equal((await tc.get('/papers?mine=true')).status, 200);
        assert.equal((await sc.get('/papers')).status, 200);
        assert.equal((await tc.get('/submissions')).status, 200);
        assert.equal((await sc.get('/submissions')).status, 200);
    });

    await t.test('teacher can use staff endpoints', async () => {
        assert.equal((await tc.get('/students')).status, 200);
        assert.equal((await tc.get('/dashboard')).status, 200);
        assert.equal((await tc.get('/analytics')).status, 200);
    });

    await t.test('profile update persists for the signed-in user', async () => {
        const res = await sc.put('/auth/profile', { name: 'Renamed Student', email: student.email, department: 'ECE' });
        assert.equal(res.status, 200);
        assert.equal((await sc.get('/auth/me')).json.data.name, 'Renamed Student');
    });
});
