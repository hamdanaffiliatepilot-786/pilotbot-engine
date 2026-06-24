const { Router } = require('express');
const { dashboardAuth } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

/*
|--------------------------------------------------------------------------
| CLIENT SETUP
|--------------------------------------------------------------------------
| This router is mounted in src/index.js at:
| app.use('/api/client', require('./routes/client'));
|
| Subscription endpoints were duplicated here and in subscriptions.js.
| They now remain ONLY in subscriptions.js:
|   GET  /api/my-subscriptions
|   POST /api/subscribe
|   POST /api/subscribe-tools
|   POST /api/paypal-webhook
|--------------------------------------------------------------------------
*/

router.post('/setup', dashboardAuth, async (req, res) => {
    if (!requireDB(res)) return;

    const businessName = sanitizeText(req.body?.businessName || '', 150);
    const businessType = sanitizeText(req.body?.businessType || '', 100);
    const website = sanitizeText(req.body?.website || '', 300);
    const phone = sanitizeText(req.body?.phone || '', 50);
    const tone = sanitizeText(req.body?.tone || '', 100);
    const notes = sanitizeText(req.body?.notes || '', 3000);

    if (!businessName) {
        return err(res, 'Business name is required', 400);
    }

    try {
        const payload = {
            email: req.user.email,
            business_name: businessName,
            business_type: businessType || null,
            website: website || null,
            phone: phone || null,
            tone: tone || null,
            notes: notes || null,
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await req.app.locals.supabase
            .from('client_profiles')
            .upsert(payload, { onConflict: 'email' })
            .select('*')
            .single();

        if (error) {
            logger.error('Client setup save error:', error.message);
            return err(res, 'Could not save client setup', 500);
        }

        return ok(res, {
            success: true,
            message: 'Client setup saved successfully.',
            client: data,
        });
    } catch (error) {
        logger.error('Client setup exception:', error?.message || error);
        return err(res, 'Could not save client setup', 500);
    }
});

router.get('/setup', dashboardAuth, async (req, res) => {
    if (!requireDB(res)) return;

    try {
        const { data, error } = await req.app.locals.supabase
            .from('client_profiles')
            .select('*')
            .eq('email', req.user.email)
            .maybeSingle();

        if (error) {
            logger.error('Client setup fetch error:', error.message);
            return err(res, 'Could not load client setup', 500);
        }

        return ok(res, {
            success: true,
            client: data || null,
        });
    } catch (error) {
        logger.error('Client setup fetch exception:', error?.message || error);
        return err(res, 'Could not load client setup', 500);
    }
});

module.exports = router;
