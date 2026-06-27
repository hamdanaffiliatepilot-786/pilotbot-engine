const { Router } = require("express");

const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");

const router = Router();

router.post("/support-agent", async (req, res) => {

    const question = sanitizeText(req.body.question || "", 2000);
    const orderNumber = sanitizeText(req.body.orderNumber || "", 100);
    const issueType = sanitizeText(req.body.issueType || "", 100);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = prompts.supportAgent({
        question,
        orderNumber,
        issueType,
    });

    return runAgent({
        req,
        res,
        agent: "support-agent",
        prompt,
    });

});

module.exports = router;
