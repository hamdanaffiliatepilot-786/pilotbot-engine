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

module.exports = router;
