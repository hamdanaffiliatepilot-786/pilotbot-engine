const { Router } = require('express');
const { optionalAuth } = require('../middleware/auth');
const { supabase } = require('../config/database');
const { sendTelegram } = require('../services/telegram.service');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

router.post('/capture-email', optionalAuth, async (req, res) => {
    const email = req.user?.email || sanitizeText(req.body.email || '', 200);
    const source = sanitizeText(req.body.source || 'unknown', 100);

    if (!email || !email.includes('@')) {
        return err(res, 'Valid email is required', 400);
    }

    if (supabase) {
        try {
            await supabase.from('email_captures').upsert(
                { email, source, captured_at: new Date().toISOString() },
                { onConflict: 'email' }
            );
        } catch (e) {
            logger.warn('Email capture DB error:', e.message?.substring(0, 100));
        }
    }

    await sendTelegram(`📬 <b>New Lead!</b>\n${email}\nSource: ${source}`);
    ok(res, { success: true, message: 'Subscribed!' });
});

module.exports = router;
