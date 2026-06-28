// src/config/ai.js
const { env } = require('./env');
const { AI_MODELS } = require('./constants');

const GEMINI_KEY = env('GEMINI_KEY');
const GROQ_KEY = env('GROQ_KEY');

const AI_TIMEOUT = 30000; // 30 seconds
const MAX_TOKENS = 2048;

module.exports = { GEMINI_KEY, GROQ_KEY, AI_TIMEOUT, MAX_TOKENS, AI_MODELS };
