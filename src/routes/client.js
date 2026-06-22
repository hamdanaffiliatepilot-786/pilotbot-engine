const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { sendTelegram } = require('../services/telegram.service');
const { sanitizeText } = require('../utils/sanitize');
const { validate } = require('../middleware/validator');
const { toIso, ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

router.use(authenticate);

// ─── Get client setup ───
router.get('/setup', async (req, res) => {
    if (!requireDB(res)) return;

    try {
        const { data, error } = await req.app.locals.supabase
            .from('client_setups')
            .select('*')
            .eq('email', req.user.email)
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.error('Setup fetch error:', error.message);
            return err(res, 'Failed to fetch setup', 500);
        }

        ok(res, { success: true, setup: data || null });
    } catch (e) {
        logger.error('Setup fetch exception:', e.message);
        err(res, 'Failed to fetch setup', 500);
    }
});

// ─── Save client setup ───
router.post('/setup', async (req, res) => {
    if (!requireDB(res)) return;

    const payload = {
        businessName: req.body.businessName,
        businessType: req.body.businessType,
        websiteUrl: req.body.websiteUrl,
        targetAudience: req.body.targetAudience,
        goals: req.body.goals,
        brandTone: req.body.brandTone,
        services: req.body.services,
        offers: req.body.offers,
        channels: req.body.channels,
        faq: req.body.faq
    };

    const validationErrors = validate(payload, {
        businessName: { required: true, type: 'string', max: 200 },
        businessType: { required: false, type: 'string', max: 120 },
        websiteUrl: { required: false, type: 'string', max: 300, pattern: /^https?:\/\/.+/ },
        targetAudience: { required: false, type: 'string', max: 500 },
        goals: { required: false, type: 'string', max: 1000 },
        brandTone: { required: false, type: 'string', max: 300 },
        services: { required: false, type: 'string', max: 2000 },
        offers: { required: false, type: 'string', max: 1000 },
        channels: { required: false, type: 'string', max: 500 },
        faq: { required: false, type: 'string', max: 3000 }
    });

    if (validationErrors.length > 0) {
        return err(res, `Validation: ${validationErrors[0].message}`, 400);
    }

    const dbPayload = {
        email: req.user.email,
        business_name: sanitizeText(payload.businessName, 200),
        business_type: sanitizeText(payload.businessType, 120),
        website_url: sanitizeText(payload.websiteUrl, 300),
        target_audience: sanitizeText(payload.targetAudience, 500),
        goals: sanitizeText(payload.goals, 1000),
        brand_tone: sanitizeText(payload.brandTone, 300),
        services: sanitizeText(payload.services, 2000),
        offers: sanitizeText(payload.offers, 1000),
        channels: sanitizeText(payload.channels, 500),
        faq: sanitizeText(payload.faq, 3000),
        updated_at: toIso(new Date())
    };

    try {
        const { error } = await req.app.locals.supabase.from('client_setups').upsert({
            ...dbPayload,
            created_at: toIso(new Date())
        }, { onConflict: 'email' });

        if (error) {
            logger.error('Setup save error:', error.message);
            return err(res, 'Failed to save setup', 500);
        }

        await sendTelegram(`📋 <b>Client Setup Saved</b>\n${dbPayload.business_name}\n${req.user.email}`);
        ok(res, { success: true, message: 'Setup saved successfully' });
    } catch (e) {
        logger.error('Setup save exception:', e.message);
        err(res, 'Failed to save setup', 500);
    }
});

module.exports = router;
