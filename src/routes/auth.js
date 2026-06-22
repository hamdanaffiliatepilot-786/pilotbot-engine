const { Router } = require('express');
const { supabase } = require('../config/database');
const { generateToken } = require('../middleware/auth');
const { sanitizeText } = require('../utils/sanitize');
const { validate } = require('../middleware/validator');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

router.post('/login', async (req, res) => {
    const email = sanitizeText(req.body.email || '', 200);
    const refCode = sanitizeText(req.body.refCode || '', 100);

    const validationErrors = validate({ email }, {
        email: { required: true, type: 'string', max: 200, email: true }
    });
    if (validationErrors.length > 0) return err(res, 'Valid email is required', 400);

    if (supabase) {
        try {
            const { data: existing } = await supabase
                .from('email_captures')
                .select('email')
                .eq('email', email)
                .single();

            if (!existing) {
                await supabase.from('email_captures').insert({
                    email,
                    source: refCode ? `referral:${refCode}` : 'auth_login',
                    captured_at: new Date().toISOString()
                });
                logger.info('New user:', email);

                // Track referral signup
                if (refCode) {
                    await supabase.from('referrals')
                        .update({ total_signups: supabase.raw('total_signups + 1') })
                        .eq('referral_code', refCode);
                }
            }
        } catch (e) {
            logger.warn('Auth DB error:', e.message?.substring(0, 100));
        }
    }

    const token = generateToken(email);
    if (!token) return err(res, 'Authentication not configured', 503);

    ok(res, { success: true, token, email });
});

module.exports = router;
