const { Router } = require("express");

const receptionist = require("./receptionist");
const salesAgent = require("./salesAgent");
const supportAgent = require("./supportAgent");
const socialStaff = require("./socialStaff");
const contentWriter = require("./contentWriter");
const seoExpert = require("./seoExpert");
const emailMarketer = require("./emailMarketer");
const videoScriptwriter = require("./videoScriptwriter");
const conversionFunnel = require("./conversionFunnel");
const reputationManager = require("./reputationManager");
const linkedinGrowth = require("./linkedinGrowth");
const financeAgent = require("./financeAgent");
const legalAgent = require("./legalAgent");
const hrAgent = require("./hrAgent");
const marketingAgent = require("./marketingAgent");
const growthAgent = require("./growthAgent");
const newAgents = require("./newAgents");

const router = Router();

router.use(receptionist);
router.use(salesAgent);
router.use(supportAgent);
router.use(socialStaff);
router.use(contentWriter);
router.use(seoExpert);
router.use(emailMarketer);
router.use(videoScriptwriter);
router.use(conversionFunnel);
router.use(reputationManager);
router.use(linkedinGrowth);
router.use(financeAgent);
router.use(legalAgent);
router.use(hrAgent);
router.use(marketingAgent);
router.use(growthAgent);
router.use(newAgents);

module.exports = router;
