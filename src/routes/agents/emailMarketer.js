const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText, extractJSON } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { CACHE_TTL } = require("../../config/constants");

const router = Router();

router.post("/email-marketer", async (req, res) => {

    const product = sanitizeText(req.body.product || "", 500);
    const audience = sanitizeText(req.body.audience || "", 500);
    const goal = sanitizeText(req.body.goal || "Increase sales", 200);

    if (!product) {
        return err(res, "Product is required", 400);
    }

    return runAgent({
        req,
        res,
        agent: "email-marketer",
        prompt: prompts.emailMarketer({
            product,
            audience,
            goal,
        }),
        cacheKey: `email:${product}:${audience}:${goal}`,
        parser: extractJSON,
        ttl: CACHE_TTL.AGENT_RESULT,
    });

});

module.exports = router;
