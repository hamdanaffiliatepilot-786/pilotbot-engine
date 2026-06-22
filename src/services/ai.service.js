const axios = require('axios');
const { GEMINI_KEY, GROQ_KEY, AI_TIMEOUT, MAX_TOKENS } = require('../config/ai');
const logger = require('../utils/logger');

async function askAI(prompt, retries = 2) {
    if (!GEMINI_KEY && !GROQ_KEY) {
        logger.error('askAI called but no AI keys configured');
        return null;
    }

    // Gemini pehle try karo
    if (GEMINI_KEY) {
        try {
            const r = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: MAX_TOKENS }
                },
                { timeout: AI_TIMEOUT }
            );
            const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
                const cleaned = text.replace(/```(?:json|html)?\s*\n?/g, '').replace(/```\s*$/g, '').trim();
                logger.debug('Gemini success, length:', cleaned.length);
                return cleaned;
            }
        } catch (e) {
            logger.warn('Gemini failed:', e.message?.substring(0, 120));
        }
    }

    // Groq fallback
    if (!GROQ_KEY) return null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const r = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: MAX_TOKENS,
                },
                {
                    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
                    timeout: AI_TIMEOUT
                }
            );
            const text = r.data?.choices?.[0]?.message?.content;
            if (text) {
                const cleaned = text.replace(/```(?:json|html)?\s*\n?/g, '').replace(/```\s*$/g, '').trim();
                logger.debug('Groq success, length:', cleaned.length);
                return cleaned;
            }
        } catch (e) {
            logger.warn(`Groq attempt ${attempt + 1} failed:`, e.message?.substring(0, 120));
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }

    logger.error('All AI providers failed');
    return null;
}

module.exports = { askAI };
