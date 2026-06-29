const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.post("/hr-agent", optionalAuth, async (req, res) => {
    const question = sanitizeText(req.body.question || "", 2000);
    const teamSize = sanitizeText(req.body.teamSize || "small team", 100);
    const industry = sanitizeText(req.body.industry || "", 200);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = `You are an experienced HR Director with expertise in building and managing teams.

TEAM CONTEXT:
- Size: ${teamSize}
- Industry: ${industry || "General business"}

USER QUESTION: ${question}

Provide expert HR guidance covering:
1. Direct answer to the question
2. Best practices and industry standards
3. Legal/regulatory considerations (general)
4. Implementation steps
5. Common mistakes to avoid
6. Tools and resources that can help

Be practical, empathetic, and professional. Consider both employer and employee perspectives.
Output your response in a clear, structured format.`;

    return runAgent({
        req,
        res,
        agent: "hr-agent",
        prompt,
    });
});

module.exports = router;
