const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { CACHE_TTL } = require("../../config/constants");

const router = Router();

router.post("/seo-expert", async (req, res) => {

    const url = sanitizeText(req.body.url || "", 500);
    const niche = sanitizeText(req.body.niche || "", 500);
    const goal = sanitizeText(req.body.goal || "Rank higher", 100);

    if (!url && !niche) {
        return err(res, "URL or niche is required", 400);
    }

    return runAgent({
        req,
        res,
        agent: "seo-expert",
        prompt: prompts.seoExpert({
            url,
            niche,
            goal,
        }),
        cacheKey: `seo:${url || niche}:${goal}`,
        ttl: CACHE_TTL.AGENT_RESULT,
    });

});

module.exports = router;
