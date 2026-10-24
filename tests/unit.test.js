// Dependency-free unit tests (config + rate limiter).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const configPath = path.resolve(__dirname, '../src/config/authConfig.js');

function runConfig(env, expr) {
    const result = spawnSync(process.execPath, ['-e', `const c=require(${JSON.stringify(configPath)}); ${expr}`], {
        env: { PATH: process.env.PATH, ...env }, encoding: 'utf8'
    });
    return result;
}

test('production refuses to start without JWT_SECRET', () => {
    const r = runConfig({ NODE_ENV: 'production' }, 'c.assertAuthConfig()');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JWT_SECRET is required in production/);
});

test('production refuses the example placeholder and short secrets', () => {
    assert.notEqual(runConfig({ NODE_ENV: 'production', JWT_SECRET: 'change_this_to_a_long_random_secret' }, 'c.assertAuthConfig()').status, 0);
    assert.notEqual(runConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }, 'c.assertAuthConfig()').status, 0);
});

test('production accepts a strong secret and uses it verbatim', () => {
    const secret = 'x'.repeat(48);
    const r = runConfig({ NODE_ENV: 'production', JWT_SECRET: secret }, 'process.stdout.write(c.getJwtSecret())');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, secret);
});

test('cookie options are HttpOnly, SameSite=Lax and Secure only in production', () => {
    const dev = runConfig({ NODE_ENV: 'development' }, 'process.stdout.write(JSON.stringify(c.cookieOptions({persistent:false})))');
    const prod = runConfig({ NODE_ENV: 'production' }, 'process.stdout.write(JSON.stringify(c.cookieOptions({persistent:true,maxAgeMs:1000})))');
    assert.deepEqual(JSON.parse(dev.stdout), { httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
    assert.deepEqual(JSON.parse(prod.stdout), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 1000 });
});

test('durationToMs understands JWT-style durations', () => {
    const { durationToMs } = require(configPath);
    assert.equal(durationToMs('7d'), 7 * 864e5);
    assert.equal(durationToMs('12h'), 12 * 36e5);
});

test('rate limiter allows up to max then answers 429 with Retry-After', () => {
    const { rateLimit } = require('../src/middleware/rateLimiter');
    const limiter = rateLimit({ windowMs: 60000, max: 2, key: 'unit' });
    const make = () => {
        const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        return res;
    };
    let passed = 0;
    for (let i = 0; i < 3; i++) {
        const res = make();
        limiter({ ip: '1.2.3.4' }, res, () => { passed++; });
        if (i === 2) {
            assert.equal(res.code, 429);
            assert.ok(res.headers['Retry-After']);
            assert.equal(res.body.success, false);
        }
    }
    assert.equal(passed, 2);
    // Different client is unaffected.
    let other = 0;
    limiter({ ip: '9.9.9.9' }, make(), () => { other++; });
    assert.equal(other, 1);
});
