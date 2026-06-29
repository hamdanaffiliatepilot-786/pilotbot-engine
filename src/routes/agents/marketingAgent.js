const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.post("/marketing-agent", optionalAuth, async (req, res) => {
    const question = sanitizeText(req.body.question || "", 2000);
    const businessType = sanitizeText(req.body.businessType || "", 200);
    const targetAudience = sanitizeText(req.body.targetAudience || "", 300);
    const budget = sanitizeText(req.body.budget || "not specified", 100);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = `You are a Chief Marketing Officer (CMO) with 15 years of experience in growth marketing.

BUSINESS CONTEXT:
- Type: ${businessType || "General business"}
- Target Audience: ${targetAudience || "General consumers"}
- Budget Level: ${budget}

USER QUESTION: ${question}

Provide strategic marketing guidance including:
1. Direct answer or strategy
2. Channel recommendations with rationale
3. Budget allocation suggestions
4. KPIs to track
5. Quick wins vs long-term plays
6. Competitor considerations
7. Step-by-step implementation plan

Be specific, data-driven, and actionable. Include real tactics that can be implemented today.
Output your response in a clear, structured format.`;

    return runAgent({
        req,
        res,
        agent: "marketing-agent",
        prompt,
    });
});

module.exports = router;
