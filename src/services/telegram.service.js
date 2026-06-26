const { env } = require('../config/env');
const logger = require('../utils/logger');

const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');

async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: String(message).substring(0, 4000),
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
                signal: controller.signal,
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            logger.warn('Telegram send failed:', data?.description || `HTTP ${response.status}`);
        }
    } catch (e) {
        const msg = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown');
        logger.warn('Telegram send failed:', msg.substring(0, 100));
    }
}

module.exports = { sendTelegram };
