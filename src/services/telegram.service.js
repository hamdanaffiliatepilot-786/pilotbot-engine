const axios = require('axios');
const { env } = require('../config/env');
const logger = require('../utils/logger');

const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');

async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                chat_id: TELEGRAM_CHAT_ID,
                text: String(message).substring(0, 4000),
                parse_mode: 'HTML',
                disable_web_page_preview: true
            },
            { timeout: 10000 }
        );
    } catch (e) {
        logger.warn('Telegram send failed:', e.message?.substring(0, 100));
    }
}

module.exports = { sendTelegram };
