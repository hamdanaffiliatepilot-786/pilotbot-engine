const { Router } = require('express');
const { askAI } = require('../services/ai.service');
const { sanitizeText, extractJSON } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const cache = require('../utils/cache');
const { CACHE_TTL, TABLES } = require('../config/constants');
const { toolRoutes } = require('../prompts/tools');
const logger = require('../utils/logger');
const { supabase } = require('../config/database');
const { optionalAuth } = require('../middleware/auth');

const router = Router();

async function trackUsage(toolPath, req) {
  if (!supabase) return;
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
    await supabase.from(TABLES.TOOL_USAGE).insert({
      ip_address: ip.substring(0, 45),
      tool_slug: toolPath,
      created_at: new Date().toISOString(),
    });
  } catch {}
}

async function getUsageCount(ip) {
  if (!supabase) return 0;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from(TABLES.TOOL_USAGE)
      .select('*', { count: 'exact', head: true })
      .eq('ip_address', ip.substring(0, 45))
      .gte('created_at', today.toISOString());
    return count || 0;
  } catch { return 0; }
}

toolRoutes.forEach(route => {
  router.post(`/${route.path}`, optionalAuth, async (req, res) => {
    const input = sanitizeText(req.body.topic || req.body.prompt || '', 5000);
    if (!input) return err(res, 'Prompt is required', 400);

    // Image tools — no AI call needed. Uses Pollinations' free Flux model with
    // AI prompt-enhancement enabled for significantly higher quality output.
    if (route.type === 'image') {
      const seed = Math.floor(Math.random() * 999999);
      await trackUsage(route.path, req);
      const params = new URLSearchParams({
        width: '1024',
        height: '1024',
        nologo: 'true',
        enhance: 'true',
        safe: 'true',
        model: 'flux',
        seed: String(seed),
      });
      return ok(res, {
        success: true,
        imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?${params.toString()}`,
      });
    }

    if (route.type === 'logo') {
      const seed = Math.floor(Math.random() * 999999);
      const styles = [
        `minimal flat logo "${input}" white bg, vector style, clean lines, professional branding`,
        `gradient badge logo "${input}", modern tech style, high detail`,
        `luxury monogram "${input}", elegant serif, gold accents, premium brand identity`,
        `icon+text logo "${input}" modern, bold geometric shapes, startup branding`,
      ];
      const selected = styles[Math.floor(Math.random() * styles.length)];
      await trackUsage(route.path, req);
      const params = new URLSearchParams({
        width: '1024',
        height: '1024',
        nologo: 'true',
        enhance: 'true',
        safe: 'true',
        model: 'flux',
        seed: String(seed),
      });
      return ok(res, {
        success: true,
        imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(selected)}?${params.toString()}`,
      });
    }

    // Cache check - user-scoped for privacy
    const userId = req.user?.id || req.ip;
    const cacheKey = `tool:${userId}:${route.path}:${input.substring(0, 100)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug('Cache hit:', route.path);
      await trackUsage(route.path, req);
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
      const usesToday = await getUsageCount(ip);
      return ok(res, { ...cached, usesToday });
    }

    // AI call with timing
    const aiTimer = logger.startTimer(`ai:tool:${route.path}`);
    const result = await askAI(route.prompt(input));
    const aiMs = logger.endTimer(aiTimer);

    if (!result) {
      logger.warn(`Tool ${route.path} AI failed after ${aiMs}ms`);
      return err(res, 'AI generation failed. Please try again.', 503);
    }

    await trackUsage(route.path, req);
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
    const usesToday = await getUsageCount(ip);

    // JSON parse with validation
    const trimmed = result.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = extractJSON(result);
      if (parsed && typeof parsed === 'object') {
        const response = { success: true, data: parsed, usesToday };
        cache.set(cacheKey, response, CACHE_TTL.TOOL_RESULT);
        return ok(res, response);
      }
    }

    const response = { success: true, article: result, usesToday };
    cache.set(cacheKey, response, CACHE_TTL.TOOL_RESULT);
    return ok(res, response);
  });
});

router.get('/usage-count', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
  const count = await getUsageCount(ip);
  ok(res, { success: true, usesToday: count, limit: 5 });
});

module.exports = router;
