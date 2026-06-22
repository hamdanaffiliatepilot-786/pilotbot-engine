const { Router } = require('express');
const { askAI } = require('../services/ai.service');
const { sanitizeText, extractJSON } = require('../utils/sanitize');
const { env } = require('../config/env');
const { ok, err } = require('../utils/helpers');

const router = Router();
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';

// ─── Receptionist ───
router.post('/receptionist', async (req, res) => {
    const question = sanitizeText(req.body.question || '', 2000);
    const customerName = sanitizeText(req.body.customerName || '', 100);
    const businessType = sanitizeText(req.body.businessType || '', 200);

    if (!question) return err(res, 'Question is required', 400);

    const answer = await askAI(
        `You are Sarah, a friendly receptionist at ${businessType || 'our company'}. Customer ${customerName || 'says'}: "${question}"
RESPONSIBILITIES:
- Greet warmly by name if provided
- Answer common questions about services/pricing/hours
- Qualify leads by asking relevant questions
- Offer to book appointments
- Collect name, phone, email when appropriate
- Handle objections gracefully
- NEVER say you are AI
Respond in HTML format. Keep under 150 words. Be warm and professional.`
    );

    if (!answer) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer });
});

// ─── Sales Agent ───
router.post('/sales-agent', async (req, res) => {
    const question = sanitizeText(req.body.question || '', 2000);
    const product = sanitizeText(req.body.product || '', 500);
    const price = sanitizeText(req.body.price || '', 50);

    if (!question) return err(res, 'Question is required', 400);

    const answer = await askAI(
        `You are Alex, an experienced sales agent selling: ${product || 'AI services'} at ${price || '$29/month'}.
Prospect says: "${question}"
SALES PROCESS:
1. Build rapport first
2. Ask qualifying questions (budget, timeline, needs)
3. Handle objections with empathy + facts
4. Create urgency (limited spots, price increasing)
5. Close with clear CTA
6. NEVER be pushy, be consultative
7. NEVER say you are AI
Use persuasive language. Include ROI calculations. Respond in HTML. Under 200 words.`
    );

    if (!answer) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer });
});

// ─── Support Agent ───
router.post('/support-agent', async (req, res) => {
    const question = sanitizeText(req.body.question || '', 2000);
    const orderNumber = sanitizeText(req.body.orderNumber || '', 100);
    const issueType = sanitizeText(req.body.issueType || '', 100);

    if (!question) return err(res, 'Question is required', 400);

    const answer = await askAI(
        `You are Mike, a patient customer support agent.
Issue type: ${issueType || 'general'}
Order: ${orderNumber || 'N/A'}
Customer says: "${question}"
SUPPORT APPROACH:
1. Acknowledge the frustration first
2. Apologize sincerely
3. Ask clarifying questions if needed
4. Provide step-by-step solution
5. Offer alternative if first solution doesn't work
6. Escalate if beyond your scope
7. NEVER say you are AI
Be empathetic, patient, thorough. Respond in HTML. Under 200 words.`
    );

    if (!answer) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, answer });
});

// ─── Social Staff ───
router.post('/social-staff', async (req, res) => {
    const niche = sanitizeText(req.body.niche || '', 500);
    const days = Math.min(Math.max(parseInt(req.body.days) || 7, 1), 30);
    const platforms = sanitizeText(req.body.platforms || 'Instagram, Twitter, LinkedIn', 500);

    if (!niche) return err(res, 'Niche is required', 400);

    const content = await askAI(
        `Create ${days} days of social media content for "${niche}".
Platforms: ${platforms}
For EACH day, create posts for each platform:
- Hook (attention-grabbing first line)
- Content (valuable, engaging)
- Hashtags (10-15 relevant ones)
- Best posting time
- Content type (carousel, reel, story, post)
OUTPUT JSON: {"days":[{"day":1,"posts":[{"platform":"instagram","hook":"...","content":"...","hashtags":["#..."],"time":"9:00 AM","type":"carousel"}]}]} No markdown.`
    );

    if (!content) return err(res, 'AI generation failed', 503);

    const parsed = extractJSON(content);
    if (parsed) return ok(res, { success: true, data: parsed });
    ok(res, { success: true, text: content });
});

// ─── Content Writer ───
router.post('/content-writer', async (req, res) => {
    const topic = sanitizeText(req.body.topic || '', 500);
    const wordCount = Math.min(Math.max(parseInt(req.body.wordCount) || 1500, 300), 5000);
    const tone = sanitizeText(req.body.tone || 'professional', 100);

    if (!topic) return err(res, 'Topic is required', 400);

    const html = await askAI(
        `Write a ${wordCount}+ word ${tone} SEO blog about: "${topic}".
Requirements:
- Compelling H1 with primary keyword
- Meta description (150-155 chars)
- 5-6 H2 sections with LSI keywords
- Short paragraphs (2-3 sentences max)
- Bullet lists for scannability
- Internal link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
- Conclusion with CTA
- OUTPUT ONLY HTML, no markdown`
    );

    if (!html) return err(res, 'AI generation failed', 503);

    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    ok(res, {
        success: true,
        articles: [{
            title: titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '') : topic,
            content: html,
            words: html.split(/\s+/).length
        }]
    });
});

// ─── SEO Expert ───
router.post('/seo-expert', async (req, res) => {
    const url = sanitizeText(req.body.url || '', 500);
    const niche = sanitizeText(req.body.niche || '', 500);
    const goal = sanitizeText(req.body.goal || 'rank higher', 200);

    if (!url && !niche) return err(res, 'URL or niche is required', 400);

    const audit = await askAI(
        `You are Dr. SEO, an expert with 15 years experience.
Goal: ${goal}
Target: "${url || niche}"
Provide COMPLETE SEO analysis:
1. TOP 20 KEYWORDS (with monthly volume estimate, difficulty: Easy/Medium/Hard)
2. ON-PAGE CHECKLIST (✅/❌ for each item)
3. TECHNICAL ISSUES (priority: High/Medium/Low)
4. CONTENT GAPS (topics competitors cover that you don't)
5. BACKLINK STRATEGY (5 specific tactics)
6. 30-DAY ACTION PLAN (week by week)
Format clearly with emojis for sections. OUTPUT CLEAN TEXT.`
    );

    if (!audit) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, audit });
});

// ─── Email Marketer ───
router.post('/email-marketer', async (req, res) => {
    const product = sanitizeText(req.body.product || '', 500);
    const audience = sanitizeText(req.body.audience || '', 500);
    const goal = sanitizeText(req.body.goal || 'convert to customer', 200);

    if (!product) return err(res, 'Product is required', 400);

    const funnel = await askAI(
        `Create a 6-email conversion funnel for "${product}".
Target audience: ${audience || 'potential customers'}
Goal: ${goal}
EMAIL SEQUENCE:
1. Welcome (Day 0) - Warm introduction
2. Value (Day 2) - Free tip/resource
3. Story (Day 4) - Origin story or case study
4. Proof (Day 6) - Testimonial/results
5. Offer (Day 8) - Main pitch with urgency
6. Last Chance (Day 10) - Final push
Each email needs: type, day, subject (under 50 chars), preview text, body (150-200 words), P.S. line
OUTPUT JSON: {"funnel":[{"day":0,"type":"welcome","subject":"...","preview":"...","body":"...","ps":"..."}]} No markdown.`
    );

    if (!funnel) return err(res, 'AI generation failed', 503);

    const parsed = extractJSON(funnel);
    if (parsed) return ok(res, { success: true, data: parsed });
    ok(res, { success: true, text: funnel });
});

// ─── Video Scriptwriter ───
router.post('/video-scriptwriter', async (req, res) => {
    const topic = sanitizeText(req.body.topic || '', 500);
    const platform = sanitizeText(req.body.platform || 'youtube', 50);
    const duration = sanitizeText(req.body.duration || '10 min', 30);
    const tone = sanitizeText(req.body.tone || 'engaging', 100);

    if (!topic) return err(res, 'Topic is required', 400);

    const script = await askAI(
        `Write a ${duration} ${tone} ${platform} script about "${topic}".
INCLUDE THESE ELEMENTS:
[HOOK:] - First 5 seconds to grab attention
[INTRO:] - Who you are, what this video covers
[SECTION 1-5:] - Main content sections
[B-ROLL:] - Visual suggestions
[TEXT ON SCREEN:] - Key points to display
[SFX:] - Sound effect suggestions
[CTA:] - Call to action (subscribe, like, comment)
[OUTRO:] - Summary + next video teaser
Make it conversational, not robotic. Include estimated timestamps.
OUTPUT CLEAN TEXT.`
    );

    if (!script) return err(res, 'AI generation failed', 503);
    ok(res, { success: true, script });
});

module.exports = router;
