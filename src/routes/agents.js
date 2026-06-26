const { Router } = require('express');
const { optionalAuth } = require('../middleware/auth');
const { askAI } = require('../services/ai.service');
const { sanitizeText, extractJSON } = require('../utils/sanitize');
const { env } = require('../config/env');
const { ok, err } = require('../utils/helpers');

const router = Router();
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';

// Optional auth — req.user available if logged in, but doesn't block demo usage
router.use(optionalAuth);

// === FREE DEMO AGENTS ===

router.post('/receptionist', async (req, res) => {
    const question = sanitizeText(req.body.question || '', 2000);
    const customerName = sanitizeText(req.body.customerName || '', 100);
    const businessType = sanitizeText(req.body.businessType || '', 200);
    if (!question) return err(res, 'Question is required', 400);

    const answer = await askAI(`You are Sarah, a friendly receptionist at ${businessType || 'our company'}. Customer ${customerName || 'says'}: "${question}"
RESPONSIBILITIES: Greet warmly. Answer questions about services/pricing/hours. Qualify leads. Offer to book appointments. Collect contact info. NEVER say you are AI. Respond in HTML. Under 150 words.`);
    if (!answer) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer });
});

router.post('/sales-agent', async (req, res) => {
    const question = sanitizeText(req.body.question || '', 2000);
    const product = sanitizeText(req.body.product || '', 500);
    const price = sanitizeText(req.body.price || '', 50);
    if (!question) return err(res, 'Question is required', 400);

    const answer = await askAI(`You are Alex, an experienced sales agent selling: ${product || 'AI services'} at ${price || '$29/month'}.
Prospect says: "${question}"
SALES PROCESS: Build rapport → Ask qualifying questions → Handle objections → Create urgency → Close. NEVER be pushy. NEVER say you are AI. Respond in HTML. Under 200 words.`);
    if (!answer) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer });
});

router.post('/support-agent', async (req, res) => {
    const question = sanitizeText(req.body.question || '', 2000);
    const orderNumber = sanitizeText(req.body.orderNumber || '', 100);
    const issueType = sanitizeText(req.body.issueType || '', 100);
    if (!question) return err(res, 'Question is required', 400);

    const answer = await askAI(`You are Mike, a patient support agent. Issue: ${issueType || 'general'} Order: ${orderNumber || 'N/A'}
Customer says: "${question}"
SUPPORT: Acknowledge frustration → Apologize → Ask clarifying questions → Step-by-step solution → Escalate if needed. NEVER say you are AI. Respond in HTML. Under 200 words.`);
    if (!answer) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer });
});

router.post('/social-staff', async (req, res) => {
    const niche = sanitizeText(req.body.niche || '', 500);
    const days = Math.min(Math.max(parseInt(req.body.days) || 7, 1), 30);
    const platforms = sanitizeText(req.body.platforms || 'Instagram, Twitter, LinkedIn', 500);
    if (!niche) return err(res, 'Niche is required', 400);

    const content = await askAI(`Create ${days} days of social media content for "${niche}". Platforms: ${platforms}
For EACH day: platform, hook, content, 10-15 hashtags, best time, content type.
OUTPUT JSON: {"days":[{"day":1,"posts":[{"platform":"instagram","hook":"...","content":"...","hashtags":["#..."],"time":"9:00 AM","type":"carousel"}]}]} No markdown.`);
    if (!content) return err(res, 'AI generation failed', 503);
    const parsed = extractJSON(content);
    ok(res, { success: true, data: parsed || content, text: parsed ? null : content });
});

router.post('/content-writer', async (req, res) => {
    const topic = sanitizeText(req.body.topic || '', 500);
    const wordCount = Math.min(Math.max(parseInt(req.body.wordCount) || 1500, 300), 5000);
    const tone = sanitizeText(req.body.tone || 'professional', 100);
    if (!topic) return err(res, 'Topic is required', 400);

    const html = await askAI(`Write a ${wordCount}+ word ${tone} SEO blog about: "${topic}".
Requirements: Compelling H1 with keyword. Meta description 155 chars. 5-6 H2 sections. Short paragraphs. Bullet lists. Internal link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. Conclusion with CTA. OUTPUT ONLY HTML.`);
    if (!html) return err(res, 'AI generation failed', 503);
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    ok(res, { success: true, articles: [{ title: titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '') : topic, content: html, words: html.split(/\s+/).length }] });
});

router.post('/seo-expert', async (req, res) => {
    const url = sanitizeText(req.body.url || '', 500);
    const niche = sanitizeText(req.body.niche || '', 500);
    const goal = sanitizeText(req.body.goal || 'rank higher', 200);
    if (!url && !niche) return err(res, 'URL or niche is required', 400);

    const audit = await askAI(`You are Dr. SEO with 15 years experience. Goal: ${goal} Target: "${url || niche}"
Provide: 1) TOP 20 KEYWORDS with difficulty 2) ON-PAGE CHECKLIST 3) TECHNICAL ISSUES 4) CONTENT GAPS 5) BACKLINK STRATEGY 6) 30-DAY ACTION PLAN. OUTPUT CLEAN TEXT.`);
    if (!audit) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, audit });
});

router.post('/email-marketer', async (req, res) => {
    const product = sanitizeText(req.body.product || '', 500);
    const audience = sanitizeText(req.body.audience || '', 500);
    const goal = sanitizeText(req.body.goal || 'convert to customer', 200);
    if (!product) return err(res, 'Product is required', 400);

    const funnel = await askAI(`Create 6-email funnel for "${product}". Audience: ${audience || 'potential customers'} Goal: ${goal}
Sequence: Welcome(Day0) → Value(Day2) → Story(Day4) → Proof(Day6) → Offer(Day8) → LastChance(Day10)
Each: type, day, subject(<50 chars), preview, body(150-200 words), P.S. line
OUTPUT JSON: {"funnel":[{"day":0,"type":"welcome","subject":"...","preview":"...","body":"...","ps":"..."}]} No markdown.`);
    if (!funnel) return err(res, 'AI generation failed', 503);
    const parsed = extractJSON(funnel);
    ok(res, { success: true, data: parsed || funnel, text: parsed ? null : funnel });
});

router.post('/video-scriptwriter', async (req, res) => {
    const topic = sanitizeText(req.body.topic || '', 500);
    const platform = sanitizeText(req.body.platform || 'youtube', 50);
    const duration = sanitizeText(req.body.duration || '10 min', 30);
    const tone = sanitizeText(req.body.tone || 'engaging', 100);
    if (!topic) return err(res, 'Topic is required', 400);

    const script = await askAI(`Write a ${duration} ${tone} ${platform} script about "${topic}".
Include: [HOOK:] [INTRO:] [SECTION 1-5:] [B-ROLL:] [TEXT ON SCREEN:] [SFX:] [CTA:] [OUTRO:] with timestamps. OUTPUT CLEAN TEXT.`);
    if (!script) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, script });
});

// === PREMIUM AGENTS ===

router.post('/conversion-funnel-architect', async (req, res) => {
    const task = sanitizeText(req.body.prompt || req.body.question || '', 5000);
    if (!task) return err(res, 'Task is required', 400);

    const result = await askAI(`You are a ruthless Conversion Funnel Architect who has built $10M+ funnels.
Task: ${task}
Design a complete money-making funnel. Return EXACTLY:
1. TRAFFIC SOURCE STRATEGY: Specific platforms, ad types, budget split.
2. LEAD MAGNET: Irresistible free offer (title, format, contents).
3. LANDING PAGE: Exact H1, sections, CTA text, social proof placement.
4. EMAIL NURTURE: 5 emails with Day, Subject (<40 chars), Trigger, Body (100-150 words).
5. THE CLOSE: Checkout headline, subheadline, upsell offer.
6. METRICS: Expected conversion rates at each step.
Be brutally specific. No generic fluff.`);
    if (!result) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer: result });
});

router.post('/reputation-manager', async (req, res) => {
    const task = sanitizeText(req.body.prompt || req.body.question || '', 5000);
    if (!task) return err(res, 'Task is required', 400);

    const result = await askAI(`You are a sharp-witted Reputation Manager.
Task: ${task}
Return EXACTLY:
1. 5-STAR REVIEW ACQUISITION: 3 email templates (casual, professional, incentive).
2. NEGATIVE REVIEW BURIAL: 3 SEO/content tactics to push negatives to page 2.
3. REVIEW RESPONSE TEMPLATES: Public response (50-80 words) that turns situations around.
4. SOCIAL LISTENING SETUP: Tools and keywords to monitor.
Give copy-paste templates.`);
    if (!result) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer: result });
});

router.post('/linkedin-growth-hacker', async (req, res) => {
    const task = sanitizeText(req.body.prompt || req.body.question || '', 5000);
    if (!task) return err(res, 'Task is required', 400);

    const result = await askAI(`You are a LinkedIn Growth Hacker who builds personal brands for founders.
Task: ${task}
Return EXACTLY:
1. PROFILE OPTIMIZATION: Headline (120 chars), About hook (first 2 lines), Featured section.
2. CONTENT PILLARS: 3 specific topics to own.
3. 5 VIRAL POSTS: Full text ready to copy-paste. Frameworks: a) Contrarian b) Personal Story c) Data Listicle d) Stop X Start Y e) Client Transformation. Each 150-200 words.
4. DM OUTREACH: 3-message sequence for high-ticket clients.
5. 15-MIN DAILY ROUTINE: Exact actions.`);
    if (!result) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer: result });
});

module.exports = router;
