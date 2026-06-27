const { GEMINI_KEY, GROQ_KEY, AI_TIMEOUT, MAX_TOKENS, AI_MODELS } = require('../config/ai');
const logger = require('../utils/logger');
const { dedupRequest } = require('../utils/helpers');
const cache = require('../utils/cache');

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

// ─── Rough token estimation (~4 chars per token for English) ───
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ─── Call Gemini ───
async function callGemini(prompt) {
  const timer = logger.startTimer('ai:gemini');

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODELS.GEMINI}:generateContent?key=${GEMINI_KEY}`,
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
  const ms = logger.endTimer(timer);

  if (response.ok) {
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      const cleaned = text.replace(/```(?:json|html)?\s*\n?/g, '').replace(/```\s*$/g, '').trim();
      const inputTokens = estimateTokens(prompt);
      const outputTokens = estimateTokens(cleaned);
      logger.trackAI(AI_MODELS.GEMINI, inputTokens, outputTokens, true);
      logger.debug(`Gemini success: ${cleaned.length} chars, ~${inputTokens + outputTokens} tokens, ${ms}ms`);
      return { text: cleaned, model: AI_MODELS.GEMINI, inputTokens, outputTokens, durationMs: ms };
    }
  }

  logger.trackAI(AI_MODELS.GEMINI, estimateTokens(prompt), 0, false);
  logger.warn(`Gemini failed (${ms}ms):`, data?.error?.message || `HTTP ${response.status}`);
  return null;
}

// ─── Call Groq ───
async function callGroq(prompt) {
  const timer = logger.startTimer('ai:groq');

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODELS.GROQ,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: MAX_TOKENS,
      }),
    }
  );

  const data = await response.json();
  const ms = logger.endTimer(timer);

  if (response.ok) {
    const text = data?.choices?.[0]?.message?.content;
    if (text) {
      const cleaned = text.replace(/```(?:json|html)?\s*\n?/g, '').replace(/```\s*$/g, '').trim();
      const inputTokens = data?.usage?.prompt_tokens || estimateTokens(prompt);
      const outputTokens = data?.usage?.completion_tokens || estimateTokens(cleaned);
      logger.trackAI(AI_MODELS.GROQ, inputTokens, outputTokens, true);
      logger.debug(`Groq success: ${cleaned.length} chars, ${inputTokens + outputTokens} tokens, ${ms}ms`);
      return { text: cleaned, model: AI_MODELS.GROQ, inputTokens, outputTokens, durationMs: ms };
    }
  }

  logger.trackAI(AI_MODELS.GROQ, estimateTokens(prompt), 0, false);
  logger.warn(`Groq failed (${ms}ms):`, data?.error?.message || `HTTP ${response.status}`);
  return null;
}

// ─── Main AI Function with retry, fallback, dedup, timing ───
async function askAI(prompt, retries = 2) {
  if (!GEMINI_KEY && !GROQ_KEY) {
    logger.error('askAI called but no AI keys configured');
    return null;
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    logger.warn('askAI called with empty prompt');
    return null;
  }

  // Request deduplication — same prompt within 5s returns same result
  const dedupKey = `ai:${prompt.substring(0, 200)}`;
  return dedupRequest(dedupKey, async () => {
    return _executeAI(prompt, retries);
  }, 5000);
}

async function _executeAI(prompt, retries) {
  // 1. Try Gemini first
  if (GEMINI_KEY) {
    try {
      const result = await callGemini(prompt);
      if (result && _validateOutput(result.text)) {
        return result.text;
      }
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown');
      logger.warn('Gemini exception:', msg.substring(0, 120));
    }
  }

  // 2. Fallback to Groq with retries
  if (!GROQ_KEY) {
    logger.error('Gemini failed and no Groq key configured');
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await callGroq(prompt);
      if (result && _validateOutput(result.text)) {
        return result.text;
      }

      // If Groq returned text but validation failed, still return it (soft validation)
      if (result) return result.text;
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Timeout' : (e.message || 'Unknown');
      logger.warn(`Groq attempt ${attempt + 1} exception:`, msg.substring(0, 120));
    }

    if (attempt < retries) {
      const delay = 1000 * (attempt + 1);
      logger.debug(`Groq retry ${attempt + 1}/${retries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  logger.error('All AI providers failed');
  return null;
}

// ─── Output Validation (soft — logs warning but doesn't block) ───
function _validateOutput(text) {
  if (!text || text.trim().length < 10) {
    logger.warn('AI output validation: response too short');
    return false;
  }
  if (text.length > 100000) {
    logger.warn('AI output validation: response suspiciously long, truncating');
    return true; // Still return, caller can truncate
  }
  return true;
}

// ─── Get AI Metrics (for dashboard/monitoring) ───
function getMetrics() {
  return logger.getAIMetrics();
}

module.exports = { askAI, getMetrics };
