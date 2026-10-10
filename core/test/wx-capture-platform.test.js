const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerAdminCaptureRoutes,
  setEmbeddedCapture,
} = require('../src/controllers/admin-capture-routes');

/** 最小 express app 替身：只记录每个路由的最后一个处理函数 */
function createFakeApp() {
  const routes = new Map();
  const record = (method, path, handlers) => {
    routes.set(`${method} ${path}`, handlers[handlers.length - 1]);
  };
  return {
    routes,
    get: (path, ...handlers) => record('GET', path, handlers),
    post: (path, ...handlers) => record('POST', path, handlers),
    put: (path, ...handlers) => record('PUT', path, handlers),
    delete: (path, ...handlers) => record('DELETE', path, handlers),
  };
}

function createFakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send() {
      return this;
    },
    setHeader() {
      return this;
    },
  };
}

test('WX capture session creation forwards platform to the capture service', async () => {
  const recorded = [];
  setEmbeddedCapture({
    handleApiRequest(method, path, body) {
      recorded.push({ method, path, body });
      return { status: 200, body: { ok: true, data: {} } };
    },
  });

  const app = createFakeApp();
  const noop = () => {};
  registerAdminCaptureRoutes({
    app,
    store: {
      getCaptureConfig: () => ({ enabled: true, embedded: true, apiBase: 'http://127.0.0.1:8450' }),
      getAccounts: () => ({ accounts: [] }),
    },
    provider: {},
    userStore: {},
    logger: { warn: noop, info: noop, error: noop },
    requireAdminRole: (req, res, next) => next(),
    requireDangerConfirmation: (req, res, next) => next(),
    canAccessAccount: () => true,
    resolveAccountReference: (id) => id,
    ensureEmbeddedCaptureService: noop,
    stopEmbeddedCaptureService: noop,
  });

  try {
    const handler = app.routes.get('POST /api/capture/sessions');
    assert.equal(typeof handler, 'function', 'capture session route should be registered');

    const res = createFakeRes();
    await handler(
      { currentUser: { username: 'tester', role: 'admin' }, body: { platform: 'wx' }, params: {}, headers: {} },
      res,
    );

    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const sessionCall = recorded.find((call) => call.path === '/api/sessions');
    assert.ok(sessionCall, 'capture service /api/sessions should be called');
    assert.equal(sessionCall.body.platform, 'wx');
  } finally {
    setEmbeddedCapture(null);
  }
});
