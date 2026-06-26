const crypto = require('crypto');
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

function errorId() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

const logger = {
    debug: (...args) => currentLevel <= 0 && console.log(`[DEBUG] ${new Date().toISOString()} ${formatArgs(args)}`),
    info: (...args) => currentLevel <= 1 && console.log(`[INFO]  ${new Date().toISOString()} ${formatArgs(args)}`),
    warn: (...args) => currentLevel <= 2 && console.warn(`[WARN]  ${new Date().toISOString()} ${formatArgs(args)}`),
    error: (...args) => currentLevel <= 3 && console.error(`[ERROR] ${new Date().toISOString()} ${formatArgs(args)}`),

    errorId,

    auth: (event, details = {}) => {
        const eid = errorId();
        logger.info(`[AUTH:${eid}] ${event}`, details);
        return eid;
    },

    payment: (event, details = {}) => {
        const eid = errorId();
        logger.info(`[PAY:${eid}] ${event}`, details);
        return eid;
    },

    ai: (agent, email, details = {}) => {
        const eid = errorId();
        logger.info(`[AI:${eid}] ${agent}`, { email, ...details });
        return eid;
    },

    activity: (userId, email, action, details = {}) => {
        const eid = errorId();
        logger.info(`[ACT:${eid}] ${action}`, { userId, email, ...details });
        return eid;
    },
};

module.exports = logger;
