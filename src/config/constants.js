// src/config/constants.js
module.exports = {
  // Pagination
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,

  // Cache TTLs (ms)
  CACHE_TTL: {
    TOOL_RESULT: 600000,
    AGENT_RESULT: 300000,
    USER_PROFILE: 120000,
    SUBSCRIPTIONS: 60000,
    AI_STAFF_LIST: 300000,
    TOOLS_PLANS: 300000,
    USAGE_COUNT: 30000,
    REFERRAL: 120000,
    TASK_LIST: 60000,
  },

  // Rate Limits
  RATE_LIMITS: {
    GLOBAL: { windowMs: 900000, max: 500 },
    AI: { windowMs: 3600000, max: 150 },
    AUTH_LOGIN_IP: { windowMs: 900000, max: 20 },
    AUTH_LOGIN_EMAIL: { windowMs: 900000, max: 10 },
    AUTH_FORGOT: { windowMs: 900000, max: 3 },
    AUTH_VERIFY_RESEND: { windowMs: 300000, max: 2 },
  },

  // AI Models
  AI_MODELS: {
    GEMINI: 'gemini-2.0-flash',
    GROQ: 'llama-3.3-70b-versatile',
  },

  // Token cost per 1K tokens (rough USD)
  AI_COST_PER_1K: {
    'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
    'llama-3.3-70b-versatile': { input: 0.00059, output: 0.00079 },
  },

  // DB Tables
  TABLES: {
    USERS: 'users',
    SESSIONS: 'sessions',
    SUBSCRIPTIONS: 'subscriptions',
    TOOL_SUBSCRIPTIONS: 'tool_subscriptions',
    TRANSACTIONS: 'transactions',
    AUTOMATION_TASKS: 'automation_tasks',
    TASKS: 'automation_tasks',          // ← FIX: alias added
    TASK_OUTPUTS: 'task_outputs',
    TASK_LOGS: 'task_logs',
    GENERATED_OUTPUTS: 'generated_outputs',
    CLIENT_PROFILES: 'client_profiles',
    EMAIL_CAPTURES: 'email_captures',
    REFERRALS: 'referrals',
    TOOL_USAGE: 'tool_usage',
    AI_STAFF: 'ai_staff',
    TOOLS_PLANS: 'tools_plans',
  },

  // Validation
  NAME_MIN: 2,
  NAME_MAX: 100,
  EMAIL_MAX: 200,
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 100,

  // Token Expiry
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  VERIFICATION_EXPIRY_HOURS: 24,
  RESET_EXPIRY_HOURS: 1,

  // Slow thresholds (ms)
  SLOW_QUERY_THRESHOLD: 500,
  SLOW_AI_THRESHOLD: 10000,
  SLOW_PAYMENT_THRESHOLD: 5000,
};
