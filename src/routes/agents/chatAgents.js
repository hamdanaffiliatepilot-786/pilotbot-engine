const { Router } = require("express");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { runAgent } = require("../../services/agentRunner");

const router = Router();

/*
|--------------------------------------------------------------------------
| Receptionist
|--------------------------------------------------------------------------
*/

router.post("/receptionist", async (req, res) => {
    const question = sanitizeText(req.body.question || "", 2000);
    const customerName = sanitizeText(req.body.customerName || "", 100);
    const businessType = sanitizeText(req.body.businessType || "", 200);

    if (!question)
        return err(res, "Question is required", 400);

    const prompt = `
You are Sarah, a professional receptionist working for ${businessType || "our company"}.

Customer Name:
${customerName || "Guest"}

Customer Message:
${question}

Responsibilities:

- Welcome warmly
- Answer business questions
- Explain services
- Explain pricing
- Book appointments
- Collect contact information
- Never say you are AI
- Reply in clean HTML
- Maximum 150 words.
`;

    return runAgent({
        req,
        res,
        agent: "receptionist",
        prompt
    });
});

/*
|--------------------------------------------------------------------------
| Sales Agent
|--------------------------------------------------------------------------
*/

router.post("/sales-agent", async (req, res) => {

    const question = sanitizeText(req.body.question || "", 2000);
    const product = sanitizeText(req.body.product || "", 500);
    const price = sanitizeText(req.body.price || "", 100);

    if (!question)
        return err(res, "Question is required", 400);

    const prompt = `
You are Alex, a professional sales closer.

Product:
${product || "AI Services"}

Price:
${price || "$29/month"}

Customer says:

${question}

Rules:

Build rapport

Qualify lead

Handle objections

Create urgency

Close politely

Never mention AI

Return HTML only

Maximum 200 words.
`;

    return runAgent({
        req,
        res,
        agent: "sales-agent",
        prompt
    });

});

/*
|--------------------------------------------------------------------------
| Support Agent
|--------------------------------------------------------------------------
*/

router.post("/support-agent", async (req, res) => {

    const question = sanitizeText(req.body.question || "", 2000);
    const orderNumber = sanitizeText(req.body.orderNumber || "", 100);
    const issueType = sanitizeText(req.body.issueType || "", 100);

    if (!question)
        return err(res, "Question is required", 400);

    const prompt = `
You are Mike, a senior customer support specialist.

Order Number:
${orderNumber || "N/A"}

Issue:
${issueType || "General"}

Customer says:

${question}

Workflow:

Understand issue

Apologize

Diagnose

Give step-by-step solution

Escalate only if necessary

Never mention AI

Return HTML

Maximum 200 words.
`;

    return runAgent({
        req,
        res,
        agent: "support-agent",
        prompt
    });

});

module.exports = router;
