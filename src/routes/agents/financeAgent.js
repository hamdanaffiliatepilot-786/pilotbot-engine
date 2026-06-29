const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.post("/finance-agent", optionalAuth, async (req, res) => {
    const question = sanitizeText(req.body.question || "", 2000);
    const businessType = sanitizeText(req.body.businessType || "", 200);
    const revenue = sanitizeText(req.body.revenue || "", 100);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = `You are a CFO-level Finance Expert with 20 years of experience helping businesses optimize their finances.

BUSINESS CONTEXT:
- Type: ${businessType || "General business"}
- Revenue Level: ${revenue || "Not specified"}

USER QUESTION: ${question}

Provide expert financial advice covering:
1. Direct answer to the question
2. Key financial considerations
3. Risk factors to watch
4. Actionable next steps
5. Tools or metrics to track

Be specific, practical, and professional. Use numbers and percentages where relevant.
Output your response in a clear, structured format.`;

    return runAgent({
        req,
        res,
        agent: "finance-agent",
        prompt,
    });
});

module.exports = router;
