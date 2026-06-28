// src/routes/referrals.js
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
            .from('referrals').select('*').eq('referrer_email', email).maybeSingle();

        if (existing) return ok(res, {
            success: true,
            code: existing.referral_code,
            clicks: existing.total_clicks || 0,
            signups: existing.total_signups || 0
        });

        const code = crypto.createHash('md5').update(email).digest('hex').substring(0, 8);
        const { data, error } = await req.app.locals.supabase.from('referrals').insert({
            referrer_email: email, referral_code: code, total_clicks: 0, total_signups: 0
        }).select('*').single();

        if (error) { logger.error('Referral create error:', error.message); return err(res, 'Failed to create referral', 500); }
        ok(res, { success: true, code: data.referral_code, clicks: 0, signups: 0 });
    } catch (e) {
        logger.error('Referral error:', e?.message || e);
        err(res, 'Failed to get referral', 500);
    }
});

// Track referral click — FIX: supabase.raw() exist nahi karta, manual fetch+update use karo
router.post('/track-click', async (req, res) => {
    if (!requireDB(res)) return;
    const code = sanitizeText(req.body.code || '', 20);
    if (!code) return ok(res, { success: true });

    try {
        const db = req.app.locals.supabase;

        const { data: row } = await db.from('referrals')
            .select('id, total_clicks')
            .eq('referral_code', code)
            .maybeSingle();

        if (row) {
            await db.from('referrals')
                .update({ total_clicks: (row.total_clicks || 0) + 1 })
                .eq('id', row.id);
        }
    } catch (e) {
        logger.warn('Track click error:', e?.message || e);
    }
    ok(res, { success: true });
});

module.exports = router;
