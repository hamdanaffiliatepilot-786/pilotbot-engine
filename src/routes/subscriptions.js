const { Router } = require('express');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { sendTelegram } = require('../services/telegram.service');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err, getErrorMessage } = require('../utils/helpers');
const { TABLES, CACHE_TTL } = require('../config/constants');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const { verifyOrder, verifyWebhookSignature } = require('../services/paypal.service');

const router = Router();

// ─── Get subscriptions ───

router.get('/my-subscriptions', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const db = req.app.locals.supabase;
    const cacheKey = `subs:${req.user.email}`;

    try {
        const cached = cache.get(cacheKey);
        if (cached) return ok(res, cached);

        const [staffResult, toolResult] = await Promise.all([
            db
                .from(TABLES.SUBSCRIPTIONS)
                .select('id, agent_id, plan_name, price, active, created_at')
                .eq('email', req.user.email)
                .eq('active', true),
            db
                .from(TABLES.TOOL_SUBSCRIPTIONS)
                .select('id, plan_name, price, active, created_at')
                .eq('email', req.user.email)
                .eq('active', true)
                .maybeSingle(),
        ]);

        const response = { success: true, subs: staffResult.data || [], toolsPlan: toolResult.data || null };
        cache.set(cacheKey, response, CACHE_TTL.SUBSCRIPTIONS);
        ok(res, response);
    } catch (e) {
        logger.error('Subs fetch error:', e.message);
        ok(res, { success: true, subs: [], toolsPlan: null });
    }
});

// ─── Subscribe to AI Staff ───

router.post('/subscribe', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const db = req.app.locals.supabase;

    const agentId = sanitizeText(req.body.agentId || '', 100);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!agentId || !paypalOrderId) {
        return err(res, 'Agent ID and PayPal Order ID required', 400);
    }

    try {
        const { data: existingTx } = await db
            .from(TABLES.TRANSACTIONS)
            .select('id, status')
            .eq('paypal_order_id', paypalOrderId)
            .maybeSingle();

        if (existingTx) {
            if (existingTx.status === 'COMPLETED') {
                logger.payment('DUPLICATE_BLOCKED', { email: req.user.email, orderId: paypalOrderId, requestId: req.requestId });
                return err(res, 'This payment has already been processed.', 409);
            }
            return err(res, 'This order is already being processed.', 409);
        }

        let order;
        try {
            order = await verifyOrder(paypalOrderId);
        } catch (verifyError) {
            logger.payment('VERIFY_FAILED', { email: req.user.email, agentId, orderId: paypalOrderId, error: verifyError.message, requestId: req.requestId });
            return err(res, 'Payment verification failed. If you were charged, contact support with your order ID.', 500);
        }

        const { data: result, error: rpcError } = await db.rpc('subscribe_with_tx', {
            p_user_id: req.user.id,
            p_email: req.user.email,
            p_agent_id: agentId,
            p_plan_name: '',
            p_price: '',
            p_paypal_order_id: paypalOrderId,
            p_amount: order.amount,
            p_currency: order.currency,
            p_capture_id: order.captureId,
            p_payer_email: order.payerEmail,
            p_raw: order.raw,
        });

        if (rpcError) {
            logger.payment('RPC_FAILED', { email: req.user.email, agentId, orderId: paypalOrderId, error: rpcError.message, requestId: req.requestId });
            return err(res, 'Subscription failed. Contact support with your order ID.', 500);
        }

        if (!result || result.success === false) {
            logger.payment('TX_FAILED', { email: req.user.email, agentId, orderId: paypalOrderId, reason: result?.error, requestId: req.requestId });
            return err(res, result?.error || 'Subscription failed. Contact support.', 400);
        }

        cache.delete(`subs:${req.user.email}`);

        logger.payment('SUBSCRIPTION_SUCCESS', { userId: req.user.id, email: req.user.email, agentId, plan: result.plan, amount: `${order.currency} ${order.amount}`, orderId: paypalOrderId, captureId: order.captureId, ip: req.ip, requestId: req.requestId });
        logger.activity(req.user.id, req.user.email, 'SUBSCRIBE', { agentId, amount: order.amount, orderId: paypalOrderId, requestId: req.requestId });

        await sendTelegram(
            `🚀 <b>New Sub!</b>\n${result.plan || agentId}\n$${order.amount}/mo\n${req.user.email}\nOrder: ${paypalOrderId}`
        );

        ok(res, { success: true, message: 'Subscribed!' });
    } catch (e) {
        logger.reportError(e, { endpoint: 'POST /subscribe' });
        logger.error('Subscription exception:', e.message);
        err(res, 'Failed to process subscription', 500);
    }
});

// ─── Subscribe to Tools Plan ───

router.post('/subscribe-tools', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const db = req.app.locals.supabase;

    const planId = sanitizeText(req.body.planId || '', 100);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!planId || !paypalOrderId) {
        return err(res, 'Plan ID and PayPal Order ID required', 400);
    }

    try {
        const { data: existingTx } = await db
            .from(TABLES.TRANSACTIONS)
            .select('id, status')
            .eq('paypal_order_id', paypalOrderId)
            .maybeSingle();

        if (existingTx) {
            if (existingTx.status === 'COMPLETED') {
                logger.payment('TOOLS_DUPLICATE_BLOCKED', { email: req.user.email, orderId: paypalOrderId, requestId: req.requestId });
                return err(res, 'This payment has already been processed.', 409);
            }
            return err(res, 'This order is already being processed.', 409);
        }

        const { data: plan, error: planError } = await db
            .from(TABLES.TOOLS_PLANS)
            .select('id, name, price')
            .eq('id', planId)
            .maybeSingle();

        if (planError || !plan) {
            logger.error('Tools plan lookup failed:', planError?.message || 'not found', planId);
            return err(res, 'Tools plan not found', 404);
        }

        let order;
        try {
            order = await verifyOrder(paypalOrderId);
        } catch (verifyError) {
            logger.payment('TOOLS_VERIFY_FAILED', { email: req.user.email, planId, orderId: paypalOrderId, error: verifyError.message, requestId: req.requestId });
            return err(res, 'Payment verification failed. Contact support with your order ID.', 500);
        }

        const serverAmount = Number(plan.price).toFixed(2);
        const paypalAmount = Number(order.amount).toFixed(2);

        if (paypalAmount !== serverAmount) {
            logger.payment('TOOLS_PRICE_MISMATCH', { email: req.user.email, planId, server: serverAmount, paypal: paypalAmount, orderId: paypalOrderId, requestId: req.requestId });
            return err(res, 'Payment amount does not match the plan price. Contact support.', 400);
        }

        await db.from(TABLES.TRANSACTIONS).insert({
            user_id: req.user.id,
            email: req.user.email,
            paypal_order_id: paypalOrderId,
            plan_name: plan.name,
            amount: paypalAmount,
            currency: order.currency,
            status: 'COMPLETED',
            paypal_capture_id: order.captureId,
            payer_email: order.payerEmail,
            raw_response: order.raw,
            source: 'checkout',
        });

        const { error: subError } = await db.from(TABLES.TOOL_SUBSCRIPTIONS).upsert({
            email: req.user.email,
            plan_name: plan.name,
            price: `$${plan.price}/mo`,
            paypal_order_id: paypalOrderId,
            active: true,
        }, { onConflict: 'email' });

        if (subError) {
            logger.error('Tool subscription error:', subError.message);
            return err(res, 'Payment verified but activation failed. Contact support.', 500);
        }

        cache.delete(`subs:${req.user.email}`);

        logger.payment('TOOLS_SUB_SUCCESS', { userId: req.user.id, email: req.user.email, plan: plan.name, amount: `${order.currency} ${order.amount}`, orderId: paypalOrderId, ip: req.ip, requestId: req.requestId });
        logger.activity(req.user.id, req.user.email, 'TOOLS_SUBSCRIBE', { planId, amount: order.amount, orderId: paypalOrderId, requestId: req.requestId });

        await sendTelegram(`🔧 <b>Tools Sub!</b>\n${plan.name}\n$${plan.price}/mo\n${req.user.email}\nOrder: ${paypalOrderId}`);

        ok(res, { success: true, message: 'Subscribed!' });
    } catch (e) {
        logger.reportError(e, { endpoint: 'POST /subscribe-tools' });
        logger.error('Tool subscription exception:', e.message);
        err(res, 'Failed to process subscription', 500);
    }
});

// ─── PayPal Webhook ───

router.post('/paypal-webhook', optionalAuth, async (req, res) => {
    const body = req.body;

    try {
        const valid = await verifyWebhookSignature(req.headers, body);
        if (!valid) {
            logger.payment('WEBHOOK_INVALID_SIG', { requestId: req.requestId });
            return err(res, 'Invalid webhook signature', 401);
        }
    } catch (verifyError) {
        logger.payment('WEBHOOK_SIG_ERROR', { error: verifyError.message, requestId: req.requestId });
        return err(res, 'Webhook verification failed', 500);
    }

    const eventType = body.event_type || '';
    logger.payment('WEBHOOK_RECEIVED', { eventType, requestId: req.requestId });

    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
        return ok(res, { success: true, message: 'Event ignored' });
    }

    const resource = body.resource || {};
    const orderId = resource.supplementary_data?.related_ids?.order_id || resource.id || '';

    if (!orderId) {
        logger.warn('Webhook: no order ID found');
        return ok(res, { success: true, message: 'No order ID' });
    }

    if (!requireDB(res)) return;
    const db = req.app.locals.supabase;

    try {
        const { data: existingTx } = await db
            .from(TABLES.TRANSACTIONS)
            .select('id, status')
            .eq('paypal_order_id', orderId)
            .maybeSingle();

        if (existingTx && existingTx.status === 'COMPLETED') {
            logger.payment('WEBHOOK_DUPLICATE', { orderId, requestId: req.requestId });
            return ok(res, { success: true, message: 'Already processed' });
        }

        let order;
        try {
            order = await verifyOrder(orderId);
        } catch {
            logger.payment('WEBHOOK_ORDER_VERIFY_FAILED', { orderId, requestId: req.requestId });
            return ok(res, { success: true, message: 'Order verification failed' });
        }

        const amount = order.amount;
        const payerEmail = (order.payerEmail || '').trim().toLowerCase();
        const customId = order.customId || '';

        if (!payerEmail) {
            logger.warn('Webhook: no payer email', orderId);
            return ok(res, { success: true, message: 'No payer email' });
        }

        const { data: user } = await db
            .from(TABLES.USERS)
            .select('id, email')
            .eq('email', payerEmail)
            .maybeSingle();

        if (!user) {
            logger.payment('WEBHOOK_USER_NOT_FOUND', { payerEmail, orderId, requestId: req.requestId });
            return ok(res, { success: true, message: 'User not found' });
        }

        if (existingTx && existingTx.status !== 'COMPLETED') {
            await db.from(TABLES.TRANSACTIONS)
                .update({ status: 'COMPLETED' })
                .eq('id', existingTx.id);
        } else {
            await db.from(TABLES.TRANSACTIONS).insert({
                user_id: user.id,
                email: user.email,
                paypal_order_id: orderId,
                agent_id: customId || null,
                plan_name: customId ? null : 'Webhook Payment',
                amount: amount,
                currency: order.currency,
                status: 'COMPLETED',
                paypal_capture_id: order.captureId,
                payer_email: payerEmail,
                raw_response: order.raw,
                source: 'webhook',
            });
        }

        if (customId) {
            const { data: agent } = await db
                .from(TABLES.AI_STAFF)
                .select('id, name, price')
                .eq('id', customId)
                .maybeSingle();

            if (agent) {
                const { data: existingSub } = await db
                    .from(TABLES.SUBSCRIPTIONS)
                    .select('id')
                    .eq('email', user.email)
                    .eq('agent_id', customId)
                    .eq('active', true)
                    .maybeSingle();

                if (!existingSub) {
                    await db.from(TABLES.SUBSCRIPTIONS)
                        .update({ active: false })
                        .eq('email', user.email)
                        .eq('agent_id', customId);

                    await db.from(TABLES.SUBSCRIPTIONS).insert({
                        email: user.email,
                        agent_id: customId,
                        plan_name: agent.name,
                        price: `$${agent.price}/mo`,
                        paypal_order_id: orderId,
                        active: true,
                    });

                    logger.payment('WEBHOOK_SUB_ACTIVATED', { userId: user.id, email: user.email, agentId: customId, agent: agent.name, amount: `${order.currency} ${amount}`, orderId, requestId: req.requestId });
                    logger.activity(user.id, user.email, 'WEBHOOK_SUB', { agentId: customId, amount, orderId, requestId: req.requestId });

                    await sendTelegram(`🔔 <b>Webhook Sub!</b>\n${agent.name}\n$${agent.price}/mo\n${user.email}\nOrder: ${orderId}`);
                }
            }
        }

        logger.payment('WEBHOOK_PROCESSED', { orderId, payerEmail, amount: `${order.currency} ${amount}`, requestId: req.requestId });
        await sendTelegram(`💰 <b>Webhook Payment!</b>\nOrder: ${orderId}\nAmount: ${amount} ${order.currency}\nEmail: ${payerEmail}`);
        ok(res, { success: true, message: 'Webhook processed' });
    } catch (e) {
        logger.reportError(e, { endpoint: 'POST /paypal-webhook' });
        logger.error('Webhook processing error:', e.message);
        ok(res, { success: true, message: 'Webhook received' });
    }
});

module.exports = router;
