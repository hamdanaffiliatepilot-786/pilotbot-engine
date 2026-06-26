const logger = require('../utils/logger');

function validateEnv() {
    const isProd = process.env.NODE_ENV === 'production';

    const required = [
        { key: 'JWT_SECRET', name: 'JWT Secret' },
        { key: 'SB_URL', name: 'Supabase URL' },
        { key: 'SB_KEY', name: 'Supabase Key' },
        { key: 'PAYPAL_CLIENT_ID', name: 'PayPal Client ID' },
        { key: 'PAYPAL_CLIENT_SECRET', name: 'PayPal Client Secret' },
        { key: 'PAYPAL_WEBHOOK_ID', name: 'PayPal Webhook ID' },
        { key: 'PAYPAL_MODE', name: 'PayPal Mode' },
    ];

    const optional = [
        { key: 'RESEND_API_KEY', name: 'Resend API Key' },
        { key: 'FRONTEND_URL', name: 'Frontend URL' },
        { key: 'TELEGRAM_BOT_TOKEN', name: 'Telegram Bot Token' },
        { key: 'TELEGRAM_CHAT_ID', name: 'Telegram Chat ID' },
        { key: 'GEMINI_KEY', name: 'Gemini Key' },
        { key: 'GROQ_KEY', name: 'Groq Key' },
    ];

    const missing = [];
    const partial = [];

    for (const { key, name } of required) {
        if (!process.env[key]) missing.push(name);
    }

    // Telegram partially configured
    if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_CHAT_ID) {
        partial.push('Telegram Bot Token set but Chat ID missing');
    }
    if (!process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        partial.push('Telegram Chat ID set but Bot Token missing');
    }

    // AI keys — at least one should exist
    if (!process.env.GEMINI_KEY && !process.env.GROQ_KEY) {
        partial.push('No AI keys configured (GEMINI_KEY or GROQ_KEY)');
    }

    // Frontend URL important for CORS
    if (!process.env.FRONTEND_URL) {
        partial.push('FRONTEND_URL not set — CORS will allow all origins');
    }

    if (isProd && missing.length > 0) {
        logger.error('STARTUP FAILED — Missing required variables:', missing);
        console.error('');
        console.error('  ❌ Missing required variables:');
        missing.forEach((m) => console.error(`     - ${m}`));
        console.error('');
        console.error('  Add them in Render Environment Variables and redeploy.');
        console.error('');
        process.exit(1);
    }

    if (missing.length > 0) {
        logger.warn('Missing variables (non-production):', missing);
        console.warn('');
        console.warn('  ⚠️  Missing required variables:');
        missing.forEach((m) => console.warn(`     - ${m}`));
        console.warn('');
    }

    if (partial.length > 0) {
        logger.warn('Partial configuration:', partial);
        console.warn('');
        console.warn('  ⚠️  Warnings:');
        partial.forEach((p) => console.warn(`     - ${p}`));
        console.warn('');
    }

    logger.info(`Environment validated — ${missing.length === 0 ? 'all required vars present' : `${missing.length} missing`}`);

    return { missing, partial };
}

module.exports = { validateEnv };
