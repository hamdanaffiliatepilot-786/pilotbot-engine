const { Router } = require('express');
const { supabase } = require('../config/database');
const { GEMINI_KEY, GROQ_KEY } = require('../config/ai');
const { env } = require('../config/env');
const { TABLES } = require('../config/constants');
const { ok } = require('../utils/helpers');
const { askAI, getMetrics } = require('../services/ai.service');
const logger = require('../utils/logger');

const router = Router();

router.get('/', (req, res) => {
  ok(res, { message: 'PilotStaff API LIVE', timestamp: new Date().toISOString() });
});

router.get('/health', async (req, res) => {
  const checks = { database: false, ai: false };

  if (supabase) {
    try {
      // FIXED: Use TABLES constant, select specific column
      await supabase.from(TABLES.CLIENT_PROFILES).select('id').limit(1);
      checks.database = true;
    } catch {}
  }

  try {
    const result = await askAI('Reply with exactly: ok', 0);
    checks.ai = !!result;
  } catch {}

  const healthy = checks.database && checks.ai;
  const aiMetrics = getMetrics();

  ok(res, {
    success: healthy,
    status: healthy ? 'healthy' : 'degraded',
    platform: 'Render',
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    checks,
    ai: {
      gemini: !!GEMINI_KEY,
      groq: !!GROQ_KEY,
      metrics: aiMetrics,
    },
    auth: !!env('JWT_SECRET'),
  }, healthy ? 200 : 503);
});

module.exports = router;
