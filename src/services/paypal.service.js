const { env } = require('../config/env');
const logger = require('../utils/logger');

const PAYPAL_CLIENT_ID = env('PAYPAL_CLIENT_ID');
const PAYPAL_CLIENT_SECRET = env('PAYPAL_CLIENT_SECRET');
const PAYPAL_WEBHOOK_ID = env('PAYPAL_WEBHOOK_ID');
const PAYPAL_MODE = env('PAYPAL_MODE') || 'sandbox';

const BASE_URL = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }

  const timer = logger.startTimer('pay:auth');

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  logger.endTimer(timer);

  if (!response.ok) {
    throw new Error(`PayPal auth failed: ${data.error_description || data.error || response.status}`);
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

  return cachedToken;
}

async function verifyOrder(orderId) {
  const timer = logger.startTimer('pay:verify-order');

  try {
    const token = await getAccessToken();

    const response = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    logger.endTimer(timer);

    if (!response.ok) {
      throw new Error(`PayPal order fetch failed: ${data.message || data.name || response.status}`);
    }

    if (data.status !== 'COMPLETED') {
      throw new Error(`Order not completed. Status: ${data.status}`);
    }

    const purchaseUnit = data.purchase_units?.[0] || {};
    const capture = purchaseUnit.payments?.captures?.[0] || {};

    return {
      orderId: data.id,
      status: data.status,
      amount: purchaseUnit.amount?.value || '0',
      currency: purchaseUnit.amount?.currency_code || 'USD',
      captureId: capture.id || '',
      payerEmail: data.payer?.email_address || '',
      customId: purchaseUnit.custom_id || '',
      raw: data,
    };
  } catch (error) {
    logger.endTimer(timer);
    throw error;
  }
}

async function verifyWebhookSignature(headers, body) {
  if (!PAYPAL_WEBHOOK_ID) {
    throw new Error('PAYPAL_WEBHOOK_ID not configured');
  }

  const timer = logger.startTimer('pay:webhook-verify');

  try {
    const token = await getAccessToken();

    const response = await fetch(`${BASE_URL}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: PAYPAL_WEBHOOK_ID,
        webhook_event: body,
      }),
    });

    const data = await response.json();
    logger.endTimer(timer);

    if (!response.ok) {
      throw new Error(`Webhook verify API failed: ${data.message || response.status}`);
    }

    return data.verification_status === 'SUCCESS';
  } catch (error) {
    logger.endTimer(timer);
    throw error;
  }
}

module.exports = { verifyOrder, verifyWebhookSignature };
