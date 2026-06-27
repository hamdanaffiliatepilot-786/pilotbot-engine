const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { CACHE_TTL } = require("../../config/constants");

const router = Router();

router.post("/video-scriptwriter", async (req, res) => {

    const topic = sanitizeText(req.body.topic || "", 500);
    const platform = sanitizeText(req.body.platform || "youtube", 50);
    const duration = sanitizeText(req.body.duration || "10 minutes", 50);
    const tone = sanitizeText(req.body.tone || "engaging", 100);

    if (!topic) {
        return err(res, "Topic is required", 400);
    }

    return runAgent({
        req,
        res,
        agent: "video-scriptwriter",
        prompt: prompts.videoScriptwriter({
            topic,
            platform,
            duration,
            tone,
        }),
        cacheKey: `video:${topic}:${platform}:${duration}`,
        ttl: CACHE_TTL.AGENT_RESULT,
    });

});

module.exports = router;
