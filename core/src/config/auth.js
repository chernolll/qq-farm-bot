/**
 * 面板登录鉴权辅助
 *
 * 由环境变量驱动：
 * - AUTH_ENABLED=true 显式开启
 * - AUTH_USERNAME / AUTH_PASSWORD 必须同时非空
 * 三者同时满足才视为需要登录；否则回退到免登录的 auto-login 行为。
 */
const crypto = require('node:crypto');
const { CONFIG } = require('./config');

/** 是否已启用登录保护 */
function isAuthEnabled() {
    return CONFIG.authEnabled === true
        && String(CONFIG.authUsername || '').length > 0
        && String(CONFIG.authPassword || '').length > 0;
}

/** 定长比较，避免时序侧信道 */
function safeEqual(actual, expected) {
    const a = Buffer.from(String(actual), 'utf8');
    const b = Buffer.from(String(expected), 'utf8');
    if (a.length !== b.length) {
        // 长度不同也执行一次比较，减少长度差异带来的时间信息。
        crypto.timingSafeEqual(a, a);
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

/** 校验账密（未启用登录时恒为 false） */
function verifyCredentials(username, password) {
    if (!isAuthEnabled()) return false;
    const userOk = safeEqual(username ?? '', CONFIG.authUsername);
    const passOk = safeEqual(password ?? '', CONFIG.authPassword);
    return userOk && passOk;
}

/**
 * 内存登录限流：按 IP 统计时间窗内的失败次数。
 * 成功登录会清除该 IP 的失败记录。
 */
function createLoginRateLimiter(options = {}) {
    const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 60 * 1000;
    const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 5;
    const buckets = new Map();

    function normalizeKey(key) {
        return String(key || 'unknown');
    }

    function prune(now) {
        for (const [key, timestamps] of buckets) {
            const recent = timestamps.filter(ts => now - ts < windowMs);
            if (recent.length === 0) buckets.delete(key);
            else buckets.set(key, recent);
        }
    }

    function isBlocked(key, now = Date.now()) {
        const timestamps = buckets.get(normalizeKey(key));
        if (!timestamps || timestamps.length === 0) return false;
        const recent = timestamps.filter(ts => now - ts < windowMs);
        if (recent.length === 0) {
            buckets.delete(normalizeKey(key));
            return false;
        }
        buckets.set(normalizeKey(key), recent);
        return recent.length >= maxAttempts;
    }

    function recordFailure(key, now = Date.now()) {
        const normalized = normalizeKey(key);
        const timestamps = (buckets.get(normalized) || []).filter(ts => now - ts < windowMs);
        timestamps.push(now);
        buckets.set(normalized, timestamps);
        if (buckets.size > 1000) prune(now);
    }

    function reset(key) {
        buckets.delete(normalizeKey(key));
    }

    return { isBlocked, recordFailure, reset, windowMs, maxAttempts };
}

module.exports = {
    isAuthEnabled,
    verifyCredentials,
    safeEqual,
    createLoginRateLimiter,
};
