const { Router } = require('express');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { sendTelegram } = require('../services/telegram.service');
const { sanitizeText } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');
const { verifyOrder, verifyWebhookSignature } = require('../services/paypal.service');

const router = Router();

// ─── Helper ───

function getErrorMessage(error, fallback) {
    const message = String(error?.message || error || '');
    if (!message || message.length > 300) return fallback;
    return message;
}

// ─── Get subscriptions — JWT only ───

router.get('/my-subscriptions', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const db = req.app.locals.supabase;

    try {
        const { data: staffSubs } = await db
            .from('subscriptions').select('*')
            .eq('email', req.user.email).eq('active', true);

        const { data: toolSub } = await db
            .from('tool_subscriptions').select('*')
            .eq('email', req.user.email).eq('active', true).single();

        ok(res, { success: true, subs: staffSubs || [], toolsPlan: toolSub });
    } catch (e) {
        logger.error('Subs fetch error:', e.message);
        ok(res, { success: true, subs: [], toolsPlan: null });
    }
});

// ─── Subscribe to AI Staff — JWT + PayPal verify + Server pricing ───

router.post('/subscribe', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const db = req.app.locals.supabase;

    const agentId = sanitizeText(req.body.agentId || '', 100);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!agentId || !paypalOrderId) {
        return err(res, 'Agent ID and PayPal Order ID required', 400);
    }

    try {
        // 1. Duplicate order check
        const { data: existingTx } = await db
            .from('transactions')
            .select('id, status')
            .eq('paypal_order_id', paypalOrderId)
            .maybeSingle();

        if (existingTx) {
            if (existingTx.status === 'COMPLETED') {
                return err(res, 'This payment has already been processed.', 409);
            }
            return err(res, 'This order is already being processed.', 409);
        }

        // 2. Server-side pricing — DB se real price fetch karo
        //    NOTE: Agar tumhari table ka naam alag hai toh 'ai_staff' change karo
        const { data: agent, error: agentError } = await db
            .from('ai_staff')
            .select('id, name, price')
            .eq('id', agentId)
            .maybeSingle();

        if (agentError || !agent) {
            logger.error('Agent lookup failed:', agentError?.message || 'not found', agentId);
            return err(res, 'AI Staff plan not found', 404);
        }

        // 3. PayPal se order verify karo
        let order;
        try {
            order = await verifyOrder(paypalOrderId);
        } catch (verifyError) {
            logger.error('PayPal verify error:', verifyError.message, 'order:', paypalOrderId);
            return err(res, 'Payment verification failed. If you were charged, contact support with your order ID.', 500);
        }

        // 4. Amount match karo — server price vs PayPal amount
        const serverAmount = Number(agent.price).toFixed(2);
        const paypalAmount = Number(order.amount).toFixed(2);

        if (paypalAmount !== serverAmount) {
            logger.error('Price mismatch:', { server: serverAmount, paypal: paypalAmount, order: paypalOrderId, agent: agentId });
            return err(res, 'Payment amount does not match the plan price. If you were charged, contact support.', 400);
        }

        // 5. Transaction log karo
        const { error: txError } = await db.from('transactions').insert({
            user_id: req.user.id,
            email: req.user.email,
            paypal_order_id: paypalOrderId,
            agent_id: agentId,
            plan_name: agent.name,
            amount: paypalAmount,
            currency: order.currency,
            status: 'COMPLETED',
            paypal_capture_id: order.captureId,
            payer_email: order.payerEmail,
            raw_response: order.raw,
            source: 'checkout',
        });

        if (txError) {
            logger.error('Transaction save error:', txError.message);
            return err(res, 'Payment verified but logging failed. Contact support with your order ID.', 500);
        }

        // 6. Subscription activate karo
        await db.from('subscriptions')
            .update({ active: false })
            .eq('email', req.user.email)
            .eq('agent_id', agentId);

        const { error: subError } = await db.from('subscriptions').insert({
            email: req.user.email,
            agent_id: agentId,
            plan_name: agent.name,
            price: `$${agent.price}/mo`,
            paypal_order_id: paypalOrderId,
            active: true,
        });

        if (subError) {
            logger.error('Subscription save error:', subError.message);
            return err(res, 'Payment verified but activation failed. Contact support with your order ID.', 500);
        }

        await sendTelegram(`🚀 <b>New Sub!</b>\n${agent.name}\n$${agent.price}/mo\n${req.user.email}\nOrder: ${paypalOrderId}`);
        logger.info('New subscription:', agent.name, 'for:', req.user.email, 'order:', paypalOrderId);

        ok(res, { success: true, message: 'Subscribed!' });
    } catch (e) {
        logger.error('Subscription exception:', e.message);
        err(res, 'Failed to process subscription', 500);
    }
});

// ─── Subscribe to Tools Plan — JWT + PayPal verify + Server pricing ───

router.post('/subscribe-tools', authenticate, async (req, res) => {
    if (!requireDB(res)) return;

    const db = req.app.locals.supabase;

    const planId = sanitizeText(req.body.planId || '', 100);
    const paypalOrderId = sanitizeText(req.body.paypalOrderId || '', 200);

    if (!planId || !paypalOrderId) {
        return err(res, 'Plan ID and PayPal Order ID required', 400);
    }

    try {
        // 1. Duplicate check
        const { data: existingTx } = await db
            .from('transactions')
            .select('id, status')
            .eq('paypal_order_id', paypalOrderId)
            .maybeSingle();

        if (existingTx) {
            if (existingTx.status === 'COMPLETED') {
                return err(res, 'This payment has already been processed.', 409);
            }
            return err(res, 'This order is already being processed.', 409);
        }

        // 2. Server-side pricing
        //    NOTE: Agar table ka naam ya column alag hai toh change karo
        const { data: plan, error: planError } = await db
            .from('tools_plans')
            .select('id, name, price')
            .eq('id', planId)
            .maybeSingle();

        if (planError || !plan) {
            logger.error('Tools plan lookup failed:', planError?.message || 'not found', planId);
            return err(res, 'Tools plan not found', 404);
        }

        // 3. PayPal verify
        let order;
        try {
            order = await verifyOrder(paypalOrderId);
        } catch (verifyError) {
            logger.error('Tools PayPal verify error:', verifyError.message, 'order:', paypalOrderId);
            return err(res, 'Payment verification failed. Contact support with your order ID.', 500);
        }

        // 4. Amount match
        const serverAmount = Number(plan.price).toFixed(2);
        const paypalAmount = Number(order.amount).toFixed(2);

        if (paypalAmount !== serverAmount) {
            logger.error('Tools price mismatch:', { server: serverAmount, paypal: paypalAmount, order: paypalOrderId });
            return err(res, 'Payment amount does not match the plan price. Contact support.', 400);
        }

        // 5. Transaction log
        await db.from('transactions').insert({
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

        // 6. Activate
        const { error: subError } = await db.from('tool_subscriptions').upsert({
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

        await sendTelegram(`🔧 <b>Tools Sub!</b>\n${plan.name}\n$${plan.price}/mo\n${req.user.email}\nOrder: ${paypalOrderId}`);
        logger.info('Tools subscription:', plan.name, 'for:', req.user.email);

        ok(res, { success: true, message: 'Subscribed!' });
    } catch (e) {
        logger.error('Tool subscription exception:', e.message);
        err(res, 'Failed to process subscription', 500);
    }
});

// ─── PayPal Webhook — Verified signature + Fallback activation ───

router.post('/paypal-webhook', optionalAuth, async (req, res) => {
    const body = req.body;

    // 1. Signature verify
    try {
        const valid = await verifyWebhookSignature(req.headers, body);
        if (!valid) {
            logger.warn('Webhook signature verification failed');
            return err(res, 'Invalid webhook signature', 401);
        }
    } catch (verifyError) {
        logger.error('Webhook verify error:', verifyError.message);
        return err(res, 'Webhook verification failed', 500);
    }

    const eventType = body.event_type || '';
    logger.info('PayPal webhook received:', eventType);

    // 2. Sirf PAYMENT.CAPTURE.COMPLETED process karo
    if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
        return ok(res, { success: true, message: 'Event ignored' });
    }

    const resource = body.resource || {};
    const orderId = resource.supplementary_data?.related_ids?.order_id
        || resource.id
        || '';

    if (!orderId) {
        logger.warn('Webhook: no order ID found');
        return ok(res, { success: true, message: 'No order ID' });
    }

    if (!requireDB(res)) return;
    const db = req.app.locals.supabase;

    try {
        // 3. Check if already processed by main /subscribe flow
        const { data: existingTx } = await db
            .from('transactions')
            .select('id, status')
            .eq('paypal_order_id', orderId)
            .maybeSingle();

        if (existingTx && existingTx.status === 'COMPLETED') {
            logger.info('Webhook: order already processed', orderId);
            return ok(res, { success: true, message: 'Already processed' });
        }

        // 4. PayPal se order details lo
        let order;
        try {
            order = await verifyOrder(orderId);
        } catch {
            logger.warn('Webhook: could not verify order', orderId);
            return ok(res, { success: true, message: 'Order verification failed' });
        }

        const amount = order.amount;
        const payerEmail = (order.payerEmail || '').trim().toLowerCase();
        const customId = order.customId || '';

        if (!payerEmail) {
            logger.warn('Webhook: no payer email', orderId);
            return ok(res, { success: true, message: 'No payer email' });
        }

        // 5. User dhundo
        const { data: user } = await db
            .from('users')
            .select('id, email')
            .eq('email', payerEmail)
            .maybeSingle();

        if (!user) {
            logger.warn('Webhook: user not found for payer email', payerEmail, orderId);
            return ok(res, { success: true, message: 'User not found' });
        }

        // 6. Duplicate check again (race condition safety)
        if (existingTx && existingTx.status !== 'COMPLETED') {
            await db.from('transactions')
                .update({ status: 'COMPLETED' })
                .eq('id', existingTx.id);
        } else {
            // Transaction log
            await db.from('transactions').insert({
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

        // 7. Activate subscription if agentId available (from custom_id)
        if (customId) {
            const { data: agent } = await db
                .from('ai_staff')
                .select('id, name, price')
                .eq('id', customId)
                .maybeSingle();

            if (agent) {
                const { data: existingSub } = await db
                    .from('subscriptions')
                    .select('id')
                    .eq('email', user.email)
                    .eq('agent_id', customId)
                    .eq('active', true)
                    .maybeSingle();

                if (!existingSub) {
                    await db.from('subscriptions')
                        .update({ active: false })
                        .eq('email', user.email)
                        .eq('agent_id', customId);

                    await db.from('subscriptions').insert({
                        email: user.email,
                        agent_id: customId,
                        plan_name: agent.name,
                        price: `$${agent.price}/mo`,
                        paypal_order_id: orderId,
                        active: true,
                    });

                    await sendTelegram(`🔔 <b>Webhook Sub!</b>\n${agent.name}\n$${agent.price}/mo\n${user.email}\nOrder: ${orderId}`);
                    logger.info('Webhook activated subscription:', agent.name, 'for:', user.email);
                }
            }
        }

        await sendTelegram(`💰 <b>Webhook Payment!</b>\nOrder: ${orderId}\nAmount: ${
