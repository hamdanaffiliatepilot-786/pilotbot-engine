const cache = require("../utils/cache");
const logger = require("../utils/logger");
const { CACHE_TTL } = require("../config/constants");
const { ok, err } = require("../utils/helpers");
const { askAI } = require("./ai.service");

async function runAgent({
    req,
    res,
    agent,
    prompt,
    cacheKey = null,
    parser = null,
    ttl = CACHE_TTL.AGENT_RESULT,
}) {
    const timer = logger.startTimer(`ai:${agent}`);

    logger.ai(agent, req.user?.email || null, {
        ip: req.ip,
        requestId: req.requestId,
    });

    try {
        if (cacheKey) {
            const cached = cache.get(cacheKey);

            if (cached) {
                return ok(res, {
                    success: true,
                    output: cached.output,
                    data: cached.data || null,
                    meta: {
                        agent,
                        cached: true,
                        requestId: req.requestId || null,
                    },
                });
            }
        }

        const started = Date.now();

        const aiResult = await askAI(prompt);

        logger.endTimer(timer);

        if (!aiResult) {
            return err(res, "AI generation failed", 503);
        }

        let output = aiResult;
        let data = null;

        if (parser) {
            try {
                data = parser(aiResult);
            } catch {
                data = null;
            }
        }

        const response = {
            success: true,
            output,
            data,
            meta: {
                agent,
                cached: false,
                processingTime: Date.now() - started,
                requestId: req.requestId || null,
            },
        };

        if (cacheKey) {
            cache.set(cacheKey, response, ttl);
        }

        return ok(res, response);
    } catch (e) {
        logger.error(`${agent} failed:`, e.message);

        return err(
            res,
            "AI service temporarily unavailable.",
            503
        );
    }
}

module.exports = {
    runAgent,
};
