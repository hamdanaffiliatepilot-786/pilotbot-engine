const crypto = require('crypto');
const { SLOW_QUERY_THRESHOLD, SLOW_AI_THRESHOLD, SLOW_PAYMENT_THRESHOLD } = require('../config/constants');

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

// ─── Timing Helpers ───
const _timers = new Map();

function startTimer(label) {
  _timers.set(label, { start: Date.now(), label });
  return label;
}

function endTimer(label) {
  const t = _timers.get(label);
  if (!t) return 0;
  _timers.delete(label);
  return Date.now() - t.start;
}

function timeAsync(label, fn) {
  return (async () => {
    const id = startTimer(label);
    try {
      return await fn();
    } finally {
      const ms = endTimer(id);
      if (label.startsWith('ai:')) {
        if (ms > SLOW_AI_THRESHOLD) {
          logger.warn(`[SLOW_AI] ${label} took ${ms}ms`);
        } else {
          logger.debug(`[AI_TIMING] ${label} ${ms}ms`);
        }
      } else if (label.startsWith('db:')) {
        if (ms > SLOW_QUERY_THRESHOLD) {
          logger.warn(`[SLOW_QUERY] ${label} took ${ms}ms`);
        } else {
          logger.debug(`[DB_TIMING] ${label} ${ms}ms`);
        }
      } else if (label.startsWith('pay:')) {
        if (ms > SLOW_PAYMENT_THRESHOLD) {
          logger.warn(`[SLOW_PAYMENT] ${label} took ${ms}ms`);
        }
      }
    }
  })();
}

// ─── AI Metrics Tracker ───
const _aiMetrics = {
  totalCalls: 0,
  totalTokens: 0,
  totalCost: 0,
  failures: 0,
  byModel: {},
};

function trackAI(model, inputTokens, outputTokens, success) {
  const costPer1k = require('../config/constants').AI_COST_PER_1K[model] || { input: 0, output: 0 };
  const cost = (inputTokens / 1000) * costPer1k.input + (outputTokens / 1000) * costPer1k.output;

  _aiMetrics.totalCalls++;
  _aiMetrics.totalTokens += inputTokens + outputTokens;
  _aiMetrics.totalCost += cost;
  if (!success) _aiMetrics.failures++;

  if (!_aiMetrics.byModel[model]) {
    _aiMetrics.byModel[model] = { calls: 0, tokens: 0, cost: 0, failures: 0 };
  }
  _aiMetrics.byModel[model].calls++;
  _aiMetrics.byModel[model].tokens += inputTokens + outputTokens;
  _aiMetrics.byModel[model].cost += cost;
  if (!success) _aiMetrics.byModel[model].failures++;

  return { inputTokens, outputTokens, cost };
}

function getAIMetrics() {
  return { ..._aiMetrics, byModel: { ..._aiMetrics.byModel } };
}

function resetAIMetrics() {
  _aiMetrics.totalCalls = 0;
  _aiMetrics.totalTokens = 0;
  _aiMetrics.totalCost = 0;
  _aiMetrics.failures = 0;
  _aiMetrics.byModel = {};
}

// ─── Error Reporting Hook (Sentry-ready) ───
let _errorReporter = null;

function setErrorReporter(fn) {
  _errorReporter = fn;
}

function reportError(error, context = {}) {
  if (_errorReporter) {
    try { _errorReporter(error, context); } catch {}
  }
}

const logger = {
  debug: (...args) => currentLevel <= 0 && console.log(`[DEBUG] ${new Date().toISOString()} ${formatArgs(args)}`),
  info: (...args) => currentLevel <= 1 && console.log(`[INFO]  ${new Date().toISOString()} ${formatArgs(args)}`),
  warn: (...args) => currentLevel <= 2 && console.warn(`[WARN]  ${new Date().toISOString()} ${formatArgs(args)}`),
  error: (...args) => currentLevel <= 3 && console.error(`[ERROR] ${new Date().toISOString()} ${formatArgs(args)}`),

  errorId,
  startTimer,
  endTimer,
  timeAsync,
  trackAI,
  getAIMetrics,
  resetAIMetrics,
  setErrorReporter,
  reportError,

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
