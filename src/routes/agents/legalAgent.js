const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.post("/legal-agent", optionalAuth, async (req, res) => {
    const question = sanitizeText(req.body.question || "", 2000);
    const businessType = sanitizeText(req.body.businessType || "", 200);
    const jurisdiction = sanitizeText(req.body.jurisdiction || "US", 100);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = `You are a Business Legal Advisor with expertise in ${jurisdiction} business law.

BUSINESS CONTEXT:
- Type: ${businessType || "General business"}
- Jurisdiction: ${jurisdiction}

USER QUESTION: ${question}

IMPORTANT DISCLAIMER: You are an AI assistant providing general business information, not legal advice. Always recommend consulting with a qualified attorney for specific legal matters.

Provide:
1. General legal principles relevant to the question
2. Common pitfalls to avoid
3. Best practices for businesses
4. When to consult a lawyer
5. Useful resources or next steps

Be thorough but practical. Do not provide binding legal advice.
Output your response in a clear, structured format.`;

    return runAgent({
        req,
        res,
        agent: "legal-agent",
        prompt,
    });
});

module.exports = router;
