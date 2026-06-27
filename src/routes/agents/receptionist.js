const { Router } = require("express");

const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");

const router = Router();

router.post("/receptionist", async (req, res) => {

    const question = sanitizeText(req.body.question || "", 2000);
    const customerName = sanitizeText(req.body.customerName || "", 100);
    const businessType = sanitizeText(req.body.businessType || "", 200);

    if (!question) {
        return err(res, "Question is required", 400);
    }

    const prompt = prompts.receptionist({
        question,
        customerName,
        businessType,
    });

    return runAgent({
        req,
        res,
        agent: "receptionist",
        prompt,
    });

});

module.exports = router;
