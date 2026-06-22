const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

function formatArgs(args) {
    return args.map(a => {
        if (a instanceof Error) return `${a.message}\n${a.stack}`;
        if (typeof a === 'object') {
            try { return JSON.stringify(a, null, 2); } catch { return String(a); }
        }
        return String(a);
    }).join(' ');
}

const logger = {
    debug: (...args) => currentLevel <= 0 && console.log(`[DEBUG] ${new Date().toISOString()} ${formatArgs(args)}`),
    info: (...args) => currentLevel <= 1 && console.log(`[INFO]  ${new Date().toISOString()} ${formatArgs(args)}`),
    warn: (...args) => currentLevel <= 2 && console.warn(`[WARN]  ${new Date().toISOString()} ${formatArgs(args)}`),
    error: (...args) => currentLevel <= 3 && console.error(`[ERROR] ${new Date().toISOString()} ${formatArgs(args)}`),
};

module.exports = logger;
