const { Router } = require("express");

const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");

const router = Router();

router.post("/sales-agent", async (req, res) => {

    const question = sanitizeText(req.body.question || "", 2000);
    const product = sanitizeText(req.body.product || "", 500);
    const price = sanitizeText(req.body.price || "", 100);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = prompts.salesAgent({
        question,
        product,
        price,
    });

    return runAgent({
        req,
        res,
        agent: "sales-agent",
        prompt,
    });

});

module.exports = router;
