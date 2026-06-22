const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { sendTelegram } = require('../services/telegram.service');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

// ─── Get my subscriptions ───
router.get('/my-subscriptions', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    try {
        const { data: staffSubs } = await req.app.locals.supabase
            .from('subscriptions')
            .select('*')
            .eq('email', req.user.email)
            .eq('active', true);

        const { data: toolSub } = await req.app.locals.supabase
            .from('tool_subscriptions')
            .select('*')
            .eq('email', req.user.email)
            .eq('active', true)
            .single();

        ok(res, { success: true, subs: staffSubs || [], toolsPlan: toolSub });
    } catch (e) {
        logger.error('Subscriptions fetch error:', e.message);
        ok(res, { success: true, subs: [], toolsPlan: null });
    }
});

// ─── Subscribe to AI Staff ───
router.post('/subscribe', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const agentId = sanitizeText(req.body.agentId || '', 100);
    const planName = sanitizeText(req.body.planName || '', 100);
    const price = sanitizeText(req.body.price || '', 50);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!agentId) return err(res, 'Agent ID is required', 400);

    try {
        await req.app.locals.supabase
            .from('subscriptions')
            .update({ active: false })
            .eq('email', req.user.email)
            .eq('agent_id', agentId);

        const { error } = await req.app.locals.supabase.from('subscriptions').insert({
            email: req.user.email,
            agent_id: agentId,
            plan_name: planName,
            price,
            paypal_order_id: paypalOrderId,
            active: true
        });

        if (error) {
            logger.error('Subscription save error:', error.message);
            return err(res, 'Failed to save subscription', 500);
        }

        await sendTelegram(`🚀 <b>New Sub!</b>\n${planName}\n${price}/mo\n${req.user.email}`);
        logger.info('New subscription:', planName, 'for:', req.user.email);
        ok(res, { success: true, message: 'Subscribed!' });
    } catch (e) {
        logger.error('Subscription exception:', e.message);
        err(res, 'Failed to save subscription', 500);
    }
});

// ─── Subscribe to Tools Plan ───
router.post('/subscribe-tools', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const planName = sanitizeText(req.body.planName || '', 100);
    const price = sanitizeText(req.body.price || '', 50);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    try {
        const { error } = await req.app.locals.supabase.from('tool_subscriptions').upsert({
            email: req.user.email,
            plan_name: planName,
            price,
            paypal_order_id: paypalOrderId,
            active: true
        }, { onConflict: 'email' });

        if (error) {
            logger.error('Tool subscription error:', error.message);
            return err(res, 'Failed to save subscription', 500);
        }

        await sendTelegram(`🔧 <b>Tools Sub!</b>\n${planName}\n${price}/mo\n${req.user.email}`);
        ok(res, { success: true, message: 'Subscribed!' });
    } catch (e) {
        logger.error('Tool subscription exception:', e.message);
        err(res, 'Failed to save subscription', 500);
    }
});

// ─── PayPal Webhook (bahar se aata hai — auth nahi) ───
router.post('/paypal-webhook', async (req, res) => {
    const { orderID, plan, price, payerEmail } = req.body;
    logger.info('PayPal webhook:', { orderID, plan, price, payerEmail });
    await sendTelegram(`💰 <b>Payment!</b>\nPlan: ${plan}\nPrice: ${price}\nEmail: ${payerEmail || 'N/A'}`);
    ok(res, { success: true, message: 'Payment recorded' });
});

module.exports = router;
