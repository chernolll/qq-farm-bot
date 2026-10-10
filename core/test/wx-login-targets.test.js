const test = require('node:test');
const assert = require('node:assert/strict');

const nativeProtocol = require('../src/services/wx-login/native-protocol');

test('targets falls back to built-in MMTLS targets when HTTPDNS fetch fails', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  global.fetch = async () => {
    const error = new Error('fetch failed');
    error.cause = { code: 'ETIMEDOUT' };
    throw error;
  };
  console.warn = () => {};
  try {
    const targets = await nativeProtocol.targets('long');
    assert.deepEqual(targets, nativeProtocol.staticTargets('long'));
    assert.ok(targets.length > 0);
    assert.ok(targets.some(t => t.port === 8080));
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('targets prefers HTTPDNS results when available', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    json: async () => ({
      dns: {
        domainlist: [{
          name: 'longcloud.weixin.com',
          protocollist: [{ name: 'mmtlsovertcp', portlist: [80, 8080, 443, 5000] }],
          iplist: [{ ip: '1.2.3.4' }, { ip: '5.6.7.8' }],
        }],
      },
    }),
  });
  try {
    const targets = await nativeProtocol.targets('long');
    assert.deepEqual(targets.slice(0, 4), [
      { ip: '1.2.3.4', port: 8080 },
      { ip: '1.2.3.4', port: 443 },
      { ip: '1.2.3.4', port: 5000 },
      { ip: '1.2.3.4', port: 80 },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('targets honors WX_MMTLS_TARGETS_LONG override without any network call', async () => {
  const originalFetch = global.fetch;
  const original = process.env.WX_MMTLS_TARGETS_LONG;
  global.fetch = async () => {
    throw new Error('HTTPDNS must not be called when an override is configured');
  };
  process.env.WX_MMTLS_TARGETS_LONG = '9.9.9.9:443,8.8.8.8';
  try {
    const targets = await nativeProtocol.targets('long');
    assert.deepEqual(targets, [
      { ip: '9.9.9.9', port: 443 },
      { ip: '8.8.8.8', port: 8080 },
      { ip: '8.8.8.8', port: 443 },
      { ip: '8.8.8.8', port: 5000 },
      { ip: '8.8.8.8', port: 80 },
    ]);
  } finally {
    global.fetch = originalFetch;
    if (original === undefined) delete process.env.WX_MMTLS_TARGETS_LONG;
    else process.env.WX_MMTLS_TARGETS_LONG = original;
  }
});
