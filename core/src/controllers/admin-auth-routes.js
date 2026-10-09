const { isAuthEnabled, verifyCredentials, createLoginRateLimiter } = require("../config/auth");
const { CONFIG } = require("../config/config");

const ADMIN_USERNAME = "admin";

function createDefaultAdmin() {
  return {
    username: ADMIN_USERNAME,
    role: "admin",
    card: null,
    accountLimit: Number.MAX_SAFE_INTEGER,
    mustChangePassword: false,
  };
}

function sendAdminSession(res, createAdminSession) {
  const admin = createDefaultAdmin();
  const token = createAdminSession(admin);
  return res.json({
    ok: true,
    data: {
      token,
      role: admin.role,
      card: null,
      accountLimit: admin.accountLimit,
      user: { username: admin.username },
      mustChangePassword: false,
    },
  });
}

function getClientIp(req) {
  const forwarded = req.headers && req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return (req.ip || (req.socket && req.socket.remoteAddress) || "unknown").toString();
}

function registerAdminAuthRoutes({ app, logger, createAdminSession }) {
  const loginRateLimiter = createLoginRateLimiter();

  if (isAuthEnabled()) {
    logger && logger.info && logger.info("面板登录已启用", { username: "***" });
  } else if (CONFIG.authEnabled) {
    logger && logger.warn && logger.warn(
      "AUTH_ENABLED=true 但未配置 AUTH_USERNAME/AUTH_PASSWORD，登录未生效，面板保持免登录",
    );
  }

  // 公开的鉴权配置查询：前端据此决定是否跳转登录页。
  app.get("/api/auth/config", (_req, res) => {
    res.json({ ok: true, data: { authRequired: isAuthEnabled() } });
  });

  // 未启用登录时保持原有免登录行为；启用后必须走 /api/login。
  app.post("/api/auto-login", (req, res) => {
    if (isAuthEnabled()) {
      return res.status(401).json({ ok: false, error: "需要登录" });
    }
    return sendAdminSession(res, createAdminSession);
  });

  // 仅登录，不提供注册。
  app.post("/api/login", (req, res) => {
    if (!isAuthEnabled()) {
      return res.status(400).json({ ok: false, error: "登录功能未启用" });
    }

    const clientIp = getClientIp(req);
    if (loginRateLimiter.isBlocked(clientIp)) {
      logger && logger.warn && logger.warn("登录尝试过于频繁", { ip: clientIp });
      return res.status(429).json({ ok: false, error: "尝试过于频繁，请稍后再试" });
    }

    const { username, password } = req.body || {};
    if (!verifyCredentials(username, password)) {
      loginRateLimiter.recordFailure(clientIp);
      logger && logger.warn && logger.warn("面板登录失败", { ip: clientIp });
      return res.status(401).json({ ok: false, error: "用户名或密码错误" });
    }

    loginRateLimiter.reset(clientIp);
    logger && logger.info && logger.info("面板登录成功", { ip: clientIp });
    return sendAdminSession(res, createAdminSession);
  });
}

module.exports = { registerAdminAuthRoutes };
