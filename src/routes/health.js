const { Router } = require('express');
const { supabase } = require('../config/database');
const { GEMINI_KEY, GROQ_KEY } = require('../config/ai');
const { env } = require('../config/env');
const { ok } = require('../utils/helpers');
const { askAI } = require('../services/ai.service');
const logger = require('../utils/logger');

const router = Router();

router.get('/', (req, res) => {
    ok(res, { message: 'PilotStaff API LIVE', timestamp: new Date().toISOString() });
});

router.get('/health', async (req, res) => {
    const checks = { database: false, ai: false };

    if (supabase) {
        try {
            await supabase.from('client_setups').select('id').limit(1);
            checks.database = true;
        } catch {}
    }

    try {
        const result = await askAI('Reply with exactly: ok', 0);
        checks.ai = !!result;
    } catch {}

    const healthy = checks.database && checks.ai;

    ok(res, {
        success: healthy,
        status: healthy ? 'healthy' : 'degraded',
        platform: 'Render',
        uptime: process.uptime(),
        checks,
        ai: { gemini: !!GEMINI_KEY, groq: !!GROQ_KEY },
        auth: !!env('JWT_SECRET')
    }, healthy ? 200 : 503);
});

module.exports = router;
