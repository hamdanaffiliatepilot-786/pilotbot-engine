const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText, extractJSON } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { CACHE_TTL } = require("../../config/constants");

const router = Router();

router.post("/social-staff", async (req, res) => {

    const niche = sanitizeText(req.body.niche || "", 500);
    const days = Math.min(Math.max(parseInt(req.body.days) || 7, 1), 30);
    const platforms = sanitizeText(
        req.body.platforms || "Instagram, Facebook, LinkedIn, X",
        300
    );

    if (!niche) {
        return err(res, "Niche is required", 400);
    }

    return runAgent({
        req,
        res,
        agent: "social-staff",
        prompt: prompts.socialStaff({
            niche,
            days,
            platforms,
        }),
        cacheKey: `social:${niche}:${days}:${platforms}`,
        parser: extractJSON,
        ttl: CACHE_TTL.AGENT_RESULT,
    });

});

module.exports = router;
