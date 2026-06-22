const { Router } = require('express');
const { askAI } = require('../services/ai.service');
const { sanitizeText, extractJSON } = require('../utils/sanitize');
const { ok, err } = require('../utils/helpers');
const cache = require('../utils/cache');
const { toolRoutes } = require('../prompts/tools');
const logger = require('../utils/logger');

const router = Router();

toolRoutes.forEach(route => {
    router.post(`/${route.path}`, async (req, res) => {
        const input = sanitizeText(req.body.topic || req.body.prompt || '', 5000);
        if (!input) return err(res, 'Prompt is required', 400);

        // Image tools — koi AI call nahi
        if (route.type === 'image') {
            const seed = Math.floor(Math.random() * 999999);
            return ok(res, {
                success: true,
                imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}`
            });
        }

        if (route.type === 'logo') {
            const seed = Math.floor(Math.random() * 999999);
            const logoPrompts = [
                `minimal flat logo "${input}" white bg`,
                `gradient badge logo "${input}"`,
                `luxury monogram "${input}"`,
                `icon+text logo "${input}" modern`
            ];
            const selected = logoPrompts[Math.floor(Math.random() * logoPrompts.length)];
            return ok(res, {
                success: true,
                imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(selected)}?width=1024&height=1024&nologo=true&seed=${seed}`
            });
        }

        // Cache check
        const cacheKey = `tool:${route.path}:${input}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            logger.debug('Cache hit:', route.path);
            return ok(res, cached);
        }

        // AI call
        const result = await askAI(route.prompt(input));
        if (!result) {
            return err(res, 'AI generation failed. Please try again.', 503);
        }

        // JSON try karo
        const trimmed = result.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            const parsed = extractJSON(result);
            if (parsed) {
                const response = { success: true, data: parsed };
                cache.set(cacheKey, response, 600000);
                return ok(res, response);
            }
        }

        // Text/article return karo
        const response = { success: true, article: result };
        cache.set(cacheKey, response, 600000);
        return ok(res, response);
    });
});

module.exports = router;
