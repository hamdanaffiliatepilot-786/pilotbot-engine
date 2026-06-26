const { GEMINI_KEY, GROQ_KEY, AI_TIMEOUT, MAX_TOKENS } = require('../config/ai');
const logger = require('../utils/logger');

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

async function askAI(prompt, retries = 2) {
    if (!GEMINI_KEY && !GROQ_KEY) {
        logger.error('askAI called but no AI keys configured');
        return null;
    }

    // Gemini pehle try karo
    if (GEMINI_KEY) {
        try {
            const response = await fetchWithTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: MAX_TOKENS }
                    }),
                }
            );

            const data = await response.json();

            if (response.ok) {
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    const cleaned = text.replace(/```(?:json|html)?\s*\n?/g, '').replace(/```\s*$/g, '').trim();
                    logger.debug('Gemini success, length:', cleaned.length);
                    return cleaned;
                }
            }

            logger.warn('Gemini failed:', data?.error?.message || `HTTP ${response.status}`);
        } catch (e) {
            const msg = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown');
            logger.warn('Gemini failed:', msg.substring(0, 120));
        }
    }

    // Groq fallback
    if (!GROQ_KEY) return null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetchWithTimeout(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${GROQ_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'llama-3.3-70b-versatile',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.7,
                        max_tokens: MAX_TOKENS,
                    }),
                }
            );

            const data = await response.json();

            if (response.ok) {
                const text = data?.choices?.[0]?.message?.content;
                if (text) {
                    const cleaned = text.replace(/```(?:json|html)?\s*\n?/g, '').replace(/```\s*$/g, '').trim();
                    logger.debug('Groq success, length:', cleaned.length);
                    return cleaned;
                }
            }

            logger.warn(`Groq attempt ${attempt + 1} failed:`, data?.error?.message || `HTTP ${response.status}`);
        } catch (e) {
            const msg = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown');
            logger.warn(`Groq attempt ${attempt + 1} failed:`, msg.substring(0, 120));
        }

        if (attempt < retries) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }

    logger.error('All AI providers failed');
    return null;
}

module.exports = { askAI };
