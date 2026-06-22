const { Router } = require('express');
const { dashboardAuth, optionalAuth } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { sendTelegram } = require('../services/telegram.service');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

// Get subscriptions - works with JWT or email param
router.get('/my-subscriptions', dashboardAuth, async (req, res) => {
    if (!requireDB(res)) return;
    try {
        const { data: staffSubs } = await req.app.locals.supabase
            .from('subscriptions').select('*')
            .eq('email', req.user.email).eq('active', true);

        const { data: toolSub } = await req.app.locals.supabase
            .from('tool_subscriptions').select('*')
            .eq('email', req.user.email).eq('active', true).single();

        ok(res, { success: true, subs: staffSubs || [], toolsPlan: toolSub });
    } catch (e) {
        logger.error('Subs fetch error:', e.message);
        ok(res, { success: true, subs: [], toolsPlan: null });
    }
});

// Subscribe to AI Staff - works with email from body (PayPal callback)
router.post('/subscribe', async (req, res) => {
    if (!requireDB(res)) return;

    const email = sanitizeText(req.body.email || '', 200);
    const agentId = sanitizeText(req.body.agentId || '', 100);
    const planName = sanitizeText(req.body.planName || '', 100);
    const price = sanitizeText(req.body.price || '', 50);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!email || !agentId) return err(res, 'Email and Agent ID required', 400);

    try {
        await req.app.locals.supabase.from('subscriptions')
            .update({ active: false })
            .eq('email', email).eq('agent_id', agentId);

        const { error } = await req.app.locals.supabase.from('subscriptions').insert({
            email, agent_id: agentId, plan_name: planName, price, paypal_order_id: paypalOrderId, active: true
        });

        if (error) {
            logger.error('Subscription save error:', error.message);
            return err(res, 'Failed to save subscription', 500);
        }

        await sendTelegram(`🚀 <b>New Sub!</b>\n${planName}\n${price}/mo\n${email}`);
        logger.info('New subscription:', planName, 'for:', email);
        ok(res, { success: true, message: 'Subscribed!', email });
    } catch (e) {
        logger.error('Subscription exception:', e.message);
        err(res, 'Failed to save subscription', 500);
    }
});

// Subscribe to Tools Plan
router.post('/subscribe-tools', async (req, res) => {
    if (!requireDB(res)) return;

    const email = sanitizeText(req.body.email || '', 200);
    const planName = sanitizeText(req.body.planName || '', 100);
    const price = sanitizeText(req.body.price || '', 50);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!email) return err(res, 'Email required', 400);

    try {
        const { error } = await req.app.locals.supabase.from('tool_subscriptions').upsert({
            email, plan_name: planName, price, paypal_order_id: paypalOrderId, active: true
        }, { onConflict: 'email' });

        if (error) {
            logger.error('Tool subscription error:', error.message);
            return err(res, 'Failed to save subscription', 500);
        }

        await sendTelegram(`🔧 <b>Tools Sub!</b>\n${planName}\n${price}/mo\n${email}`);
        ok(res, { success: true, message: 'Subscribed!', email });
    } catch (e) {
        logger.error('Tool subscription exception:', e.message);
        err(res, 'Failed to save subscription', 500);
    }
});

// PayPal Webhook
router.post('/paypal-webhook', async (req, res) => {
    const { orderID, plan, price, payerEmail } = req.body;
    logger.info('PayPal webhook:', { orderID, plan, price, payerEmail });
    await sendTelegram(`💰 <b>Payment!</b>\nPlan: ${plan}\nPrice: ${price}\nEmail: ${payerEmail || 'N/A'}`);
    ok(res, { success: true, message: 'Payment recorded' });
});

module.exports = router;
