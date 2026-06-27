const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { CACHE_TTL } = require("../../config/constants");
const { env } = require("../../config/env");

const router = Router();

const WEBSITE_URL =
    env("WEBSITE_URL") || "https://pilotstaff.com";

router.post("/content-writer", async (req, res) => {

    const topic = sanitizeText(req.body.topic || "", 500);
    const tone = sanitizeText(req.body.tone || "professional", 100);

    const wordCount = Math.min(
        Math.max(parseInt(req.body.wordCount) || 1500, 300),
        5000
    );

    if (!topic) {
        return err(res, "Topic is required", 400);
    }

    return runAgent({
        req,
        res,
        agent: "content-writer",
        prompt: prompts.contentWriter({
            topic,
            tone,
            wordCount,
            website: WEBSITE_URL,
        }),
        cacheKey: `content:${topic}:${tone}:${wordCount}`,
        ttl: CACHE_TTL.AGENT_RESULT,
    });

});

module.exports = router;
