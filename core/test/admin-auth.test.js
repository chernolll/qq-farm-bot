const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { CONFIG } = require('../src/config/config');
const { parseEnvContent } = require('../src/config/env');
const {
    isAuthEnabled,
    verifyCredentials,
    safeEqual,
    createLoginRateLimiter,
} = require('../src/config/auth');
const { registerAdminAuthRoutes } = require('../src/controllers/admin-auth-routes');

function applyAuthConfig({ enabled, username, password }) {
    CONFIG.authEnabled = enabled === true;
    CONFIG.authUsername = username || '';
    CONFIG.authPassword = password || '';
}

async function withServer(run) {
    const app = express();
    app.use(express.json());
    let sessionCount = 0;
    registerAdminAuthRoutes({
        app,
        logger: null,
        createAdminSession() {
            sessionCount += 1;
            return `token-${sessionCount}`;
        },
    });
    const server = app.listen(0);
    try {
        const { port } = server.address();
        await run({ baseUrl: `http://127.0.0.1:${port}` });
    } finally {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

async function request(baseUrl, method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
        data = await response.json();
    } catch {}
    return { status: response.status, data };
}

test('parseEnvContent 解析注释、引号与行尾注释', () => {
    const parsed = parseEnvContent([
        '# 注释',
        'AUTH_ENABLED=true',
        'AUTH_USERNAME="my user"',
        "AUTH_PASSWORD='p@ss=word'",
        'OTHER=value # trailing',
        'INVALID LINE',
        '',
    ].join('\n'));
    assert.equal(parsed.AUTH_ENABLED, 'true');
    assert.equal(parsed.AUTH_USERNAME, 'my user');
    assert.equal(parsed.AUTH_PASSWORD, 'p@ss=word');
    assert.equal(parsed.OTHER, 'value');
    assert.equal(parsed.INVALID, undefined);
});

test('isAuthEnabled 需要开关与账密同时满足', () => {
    const original = {
        enabled: CONFIG.authEnabled,
        username: CONFIG.authUsername,
        password: CONFIG.authPassword,
    };
    try {
        applyAuthConfig({ enabled: false, username: 'u', password: 'p' });
        assert.equal(isAuthEnabled(), false);

        applyAuthConfig({ enabled: true, username: '', password: 'p' });
        assert.equal(isAuthEnabled(), false);

        applyAuthConfig({ enabled: true, username: 'u', password: '' });
        assert.equal(isAuthEnabled(), false);

        applyAuthConfig({ enabled: true, username: 'u', password: 'p' });
        assert.equal(isAuthEnabled(), true);
    } finally {
        applyAuthConfig(original);
    }
});

test('verifyCredentials 仅匹配配置账密', () => {
    const original = {
        enabled: CONFIG.authEnabled,
        username: CONFIG.authUsername,
        password: CONFIG.authPassword,
    };
    try {
        applyAuthConfig({ enabled: true, username: 'alice', password: 'secret' });
        assert.equal(verifyCredentials('alice', 'secret'), true);
        assert.equal(verifyCredentials('alice', 'wrong'), false);
        assert.equal(verifyCredentials('bob', 'secret'), false);
        assert.equal(verifyCredentials('', ''), false);
        assert.equal(verifyCredentials(undefined, undefined), false);

        applyAuthConfig({ enabled: false, username: 'alice', password: 'secret' });
        assert.equal(verifyCredentials('alice', 'secret'), false);
    } finally {
        applyAuthConfig(original);
    }
});

test('safeEqual 对相同与不同字符串返回正确结果', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
});

test('登录限流按时间窗累计失败并在成功时清除', () => {
    const limiter = createLoginRateLimiter({ windowMs: 60 * 1000, maxAttempts: 3 });
    const now = 1000;
    assert.equal(limiter.isBlocked('1.1.1.1', now), false);
    limiter.recordFailure('1.1.1.1', now);
    limiter.recordFailure('1.1.1.1', now);
    assert.equal(limiter.isBlocked('1.1.1.1', now), false);
    limiter.recordFailure('1.1.1.1', now);
    assert.equal(limiter.isBlocked('1.1.1.1', now), true);

    // 其他 IP 不受影响
    assert.equal(limiter.isBlocked('2.2.2.2', now), false);

    // 成功登录清除记录
    limiter.reset('1.1.1.1');
    assert.equal(limiter.isBlocked('1.1.1.1', now), false);

    // 时间窗过期后自动失效
    limiter.recordFailure('3.3.3.3', now);
    limiter.recordFailure('3.3.3.3', now);
    limiter.recordFailure('3.3.3.3', now);
    assert.equal(limiter.isBlocked('3.3.3.3', now), true);
    assert.equal(limiter.isBlocked('3.3.3.3', now + 61 * 1000), false);
});

test('未启用登录时保持免登录行为', async () => {
    const original = {
        enabled: CONFIG.authEnabled,
        username: CONFIG.authUsername,
        password: CONFIG.authPassword,
    };
    applyAuthConfig({ enabled: false, username: '', password: '' });
    try {
        await withServer(async ({ baseUrl }) => {
            const config = await request(baseUrl, 'GET', '/api/auth/config');
            assert.equal(config.status, 200);
            assert.equal(config.data.data.authRequired, false);

            const autoLogin = await request(baseUrl, 'POST', '/api/auto-login');
            assert.equal(autoLogin.status, 200);
            assert.equal(autoLogin.data.ok, true);
            assert.ok(autoLogin.data.data.token);

            const login = await request(baseUrl, 'POST', '/api/login', {
                username: 'admin',
                password: 'admin',
            });
            assert.equal(login.status, 400);
            assert.equal(login.data.ok, false);
        });
    } finally {
        applyAuthConfig(original);
    }
});

test('启用登录后 auto-login 被拒绝且仅正确账密可登录', async () => {
    const original = {
        enabled: CONFIG.authEnabled,
        username: CONFIG.authUsername,
        password: CONFIG.authPassword,
    };
    applyAuthConfig({ enabled: true, username: 'farmer', password: 'strong-pass' });
    try {
        await withServer(async ({ baseUrl }) => {
            const config = await request(baseUrl, 'GET', '/api/auth/config');
            assert.equal(config.data.data.authRequired, true);

            const autoLogin = await request(baseUrl, 'POST', '/api/auto-login');
            assert.equal(autoLogin.status, 401);
            assert.equal(autoLogin.data.ok, false);

            const wrong = await request(baseUrl, 'POST', '/api/login', {
                username: 'farmer',
                password: 'nope',
            });
            assert.equal(wrong.status, 401);
            assert.equal(wrong.data.ok, false);

            const ok = await request(baseUrl, 'POST', '/api/login', {
                username: 'farmer',
                password: 'strong-pass',
            });
            assert.equal(ok.status, 200);
            assert.ok(ok.data.data.token);
        });
    } finally {
        applyAuthConfig(original);
    }
});

test('连续失败达到阈值后登录被限流', async () => {
    const original = {
        enabled: CONFIG.authEnabled,
        username: CONFIG.authUsername,
        password: CONFIG.authPassword,
    };
    applyAuthConfig({ enabled: true, username: 'farmer', password: 'strong-pass' });
    try {
        await withServer(async ({ baseUrl }) => {
            for (let i = 0; i < 5; i += 1) {
                const res = await request(baseUrl, 'POST', '/api/login', {
                    username: 'farmer',
                    password: 'wrong',
                });
                assert.equal(res.status, 401);
            }
            const blocked = await request(baseUrl, 'POST', '/api/login', {
                username: 'farmer',
                password: 'strong-pass',
            });
            assert.equal(blocked.status, 429);
        });
    } finally {
        applyAuthConfig(original);
    }
});
