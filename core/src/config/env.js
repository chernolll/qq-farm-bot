/**
 * 轻量 .env 加载器
 *
 * Docker 部署时由 docker-compose 通过 environment 注入变量，无需读取文件。
 * 本地源码运行时（pnpm -C core dev / start.sh）此模块会尝试读取仓库根目录 .env，
 * 使 AUTH_ENABLED / AUTH_USERNAME / AUTH_PASSWORD 等配置生效。
 * 已存在的进程环境变量优先，不会被 .env 覆盖。
 */
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

let loaded = false;

/** 解析 .env 文本为键值对 */
function parseEnvContent(content) {
    const result = {};
    for (const rawLine of String(content || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        if (!/^[A-Z_]\w*$/i.test(key)) continue;
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
            || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ) {
            value = value.slice(1, -1);
        } else {
            const hashIndex = value.indexOf(' #');
            if (hashIndex >= 0) value = value.slice(0, hashIndex).trim();
        }
        result[key] = value;
    }
    return result;
}

/** 候选 .env 路径，按优先级排列 */
function candidateEnvPaths() {
    const paths = [];
    if (process.env.FARM_ENV_FILE) paths.push(path.resolve(process.env.FARM_ENV_FILE));
    if (process.pkg) {
        // 打包后可执行文件同级目录
        paths.push(path.join(path.dirname(process.execPath), '.env'));
    } else {
        paths.push(path.resolve(process.cwd(), '.env'));
        paths.push(path.resolve(process.cwd(), '../.env'));
        paths.push(path.resolve(__dirname, '../../../.env'));
    }
    return [...new Set(paths)];
}

/** 加载 .env（幂等） */
function loadEnvFile() {
    if (loaded) return;
    loaded = true;
    for (const filePath of candidateEnvPaths()) {
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch {
            continue;
        }
        const parsed = parseEnvContent(content);
        for (const [key, value] of Object.entries(parsed)) {
            if (process.env[key] === undefined) process.env[key] = value;
        }
        break;
    }
}

loadEnvFile();

module.exports = { loadEnvFile, parseEnvContent, candidateEnvPaths };
