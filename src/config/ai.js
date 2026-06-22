const { env } = require('./env');
const logger = require('../utils/logger');

const GEMINI_KEY = env('GEMINI_KEY');
const GROQ_KEY = env('GROQ_KEY');

// Render pe koi 10s limit nahi hai — full timeout use karo
const AI_TIMEOUT = 60000;
const MAX_TOKENS = 4000;

if (!GEMINI_KEY && !GROQ_KEY) {
    logger.error('CRITICAL: No AI keys configured! Set GEMINI_KEY or GROQ_KEY in Render env vars');
}

module.exports = { GEMINI_KEY, GROQ_KEY, AI_TIMEOUT, MAX_TOKENS };
