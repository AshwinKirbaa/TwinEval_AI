process.env.AUTH_LOGIN_MAX = '3';
process.env.AUTH_REGISTER_MAX = '3';
process.env.AUTH_EMAIL_MAX = '2';

const helpers = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const { start, client, uniqueEmail, STRONG } = helpers;

let server;
let base;
test.before(async () => { ({ server, base } = await start()); });
test.after(() => new Promise(resolve => server.close(resolve)));

test('login attempts are rate limited per IP + email', async () => {
    const email = uniqueEmail('rl');
    const c = client(base);
    for (let i = 0; i < 3; i++) {
        assert.equal((await c.post('/auth/login', { email, password: 'Wrong-password-123' })).status, 401);
    }
    const blocked = await c.post('/auth/login', { email, password: 'Wrong-password-123' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('ratelimit-limit') || blocked.headers.get('ratelimit'));
});

test('registration attempts are rate limited per IP', async () => {
    const c = client(base);
    let last;
    for (let i = 0; i < 4; i++) {
        last = await c.post('/auth/register', {
            name: 'Rate Limit', email: uniqueEmail('rr'), password: STRONG, confirm_password: STRONG,
            role: 'teacher', college: 'C', department: 'D'
        });
    }
    assert.equal(last.status, 429);
});

test('password-reset requests are rate limited per IP + email', async () => {
    const email = uniqueEmail('fp');
    const c = client(base);
    assert.equal((await c.post('/auth/forgot-password', { email })).status, 200);
    assert.equal((await c.post('/auth/forgot-password', { email })).status, 200);
    assert.equal((await c.post('/auth/forgot-password', { email })).status, 429);
});
