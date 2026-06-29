const { Router } = require("express");
const { runAgent } = require("../../services/agentRunner");
const prompts = require("../../prompts");
const { sanitizeText } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.post("/reputation-manager", optionalAuth, async (req, res) => {

    const task = sanitizeText(
        req.body.prompt || req.body.question || "",
        5000
    );

    if (!task) {
        return err(res, "Task is required", 400);
    }

    return runAgent({
        req,
        res,
        agent: "reputation-manager",
        prompt: prompts.reputationManager({
            task,
        }),
    });

});

module.exports = router;
