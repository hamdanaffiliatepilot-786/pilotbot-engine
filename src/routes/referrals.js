const { Router } = require('express');
const { requireDB } = require('../config/database');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');
const crypto = require('crypto');

const router = Router();

// Generate or get referral code
router.get('/my-referral', async (req, res) => {
    if (!requireDB(res)) return;
    const email = req.query.email;
    if (!email) return err(res, 'Email required', 400);

    try {
        const { data: existing } = await req.app.locals.supabase
            .from('referrals').select('*').eq('referrer_email', email).single();

        if (existing) return ok(res, { success: true, code: existing.referral_code, clicks: existing.total_clicks, signups: existing.total_signups });

        const code = crypto.createHash('md5').update(email).digest('hex').substring(0, 8);
        const { data, error } = await req.app.locals.supabase.from('referrals').insert({
            referrer_email: email, referral_code: code
        }).select('*').single();

        if (error) { logger.error('Referral create error:', error.message); return err(res, 'Failed to create referral', 500); }
        ok(res, { success: true, code: data.referral_code, clicks: 0, signups: 0 });
    } catch (e) { err(res, 'Failed to get referral', 500); }
});

// Track referral click
router.post('/track-click', async (req, res) => {
    if (!requireDB(res)) return;
    const code = sanitizeText(req.body.code || '', 20);
    if (!code) return ok(res, { success: true });

    try {
        await req.app.locals.supabase.from('referrals')
            .update({ total_clicks: req.app.locals.supabase.raw('total_clicks + 1') })
            .eq('referral_code', code);
    } catch {}
    ok(res, { success: true });
});

module.exports = router;
