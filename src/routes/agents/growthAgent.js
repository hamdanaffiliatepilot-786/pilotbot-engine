const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.post("/growth-agent", optionalAuth, async (req, res) => {
    const question = sanitizeText(req.body.question || "", 2000);
    const product = sanitizeText(req.body.product || "", 300);
    const stage = sanitizeText(req.body.stage || "growth", 100);
    const goals = sanitizeText(req.body.goals || "", 200);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = `You are a Growth Hacker and Product Marketing expert specializing in rapid scaling.

PRODUCT CONTEXT:
- Product: ${product || "Digital product"}
- Stage: ${stage}
- Growth Goals: ${goals || "User acquisition and revenue growth"}

USER QUESTION: ${question}

Provide growth-focused guidance including:
1. Growth strategy or answer
2. Viral loops and referral mechanisms
3. Acquisition channels ranked by ROI
4. Retention and engagement tactics
5. A/B testing ideas
6. Metrics to track (pirate metrics: AARRR)
7. 30-60-90 day action plan

Be experimental, creative, and data-driven. Focus on high-leverage, low-cost tactics first.
Output your response in a clear, structured format.`;

    return runAgent({
        req,
        res,
        agent: "growth-agent",
        prompt,
    });
});

module.exports = router;
