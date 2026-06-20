require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

const ALLOWED_ORIGINS = [
    process.env.FRONTEND_URL || 'https://pilotstaff.com',
    'http://localhost:3000'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
        else callback(new Error('Not allowed'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { success: false, error: 'Too many requests.' } });
const toolLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 25, message: { success: false, error: 'Tool limit reached. Upgrade to Pro for unlimited.' } });
app.use('/api/tool/', toolLimiter);
app.use('/api/agent/', toolLimiter);
app.use('/api/', limiter);

function env(key) {
    let val = process.env[key];
    if (!val) return '';
    return val.replace(/^['"`\s]+|['"`\s]+$/g, '').trim();
}

const SB_URL = env('SB_URL');
const SB_KEY = env('SB_KEY');
const GROQ_KEY = env('GROQ_KEY');
const GEMINI_KEY = env('GEMINI_KEY');
const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';
const IS_VERCEL = !!process.env.VERCEL;

console.log('🤖 PilotStaff API |', IS_VERCEL ? 'Vercel' : 'Traditional');
console.log('Gemini:', GEMINI_KEY ? '✅' : '❌', '| Groq:', GROQ_KEY ? '✅' : '❌');

const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=\s*["']?[^"']*["']?/gi, '').replace(/javascript\s*:/gi, '').trim().substring(0, 5000);
}

async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 10000 });
    } catch (e) {}
}

const AI_TIMEOUT = IS_VERCEL ? 25000 : 60000;

async function askAI(prompt, retries = 2) {
    if (GEMINI_KEY) {
        try {
            const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: IS_VERCEL ? 2000 : 4000 }
            }, { timeout: AI_TIMEOUT });
            let c = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (c) return c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        } catch (e) { console.log('Gemini fail:', e.message?.substring(0, 80)); }
    }
    if (!GROQ_KEY) return null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: IS_VERCEL ? 2000 : 4000,
            }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: AI_TIMEOUT });
            let c = r.data.choices[0].message.content;
            return c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        } catch (e) {
            if (attempt === retries) return null;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));
app.get('/api/health', (req, res) => ok(res, { success: true, platform: IS_VERCEL ? 'Vercel' : 'Traditional', uptime: process.uptime(), ai: { gemini: !!GEMINI_KEY, groq: !!GROQ_KEY } }));

// ===== TOOL ROUTES =====
const toolRoutes = [
    { path: 'website-builder', prompt: (t) => `Create a COMPLETE single-page website for "${t}". Inline CSS only. Include: sticky navbar with "PilotStaff" logo, hero with gradient and CTA, 6 feature cards in grid, how-it-works 3 steps, 3 testimonials with stars, pricing table 3 plans (Free/$0, Pro/$29, Enterprise/$99) with Pro highlighted, FAQ accordion, footer. Modern, responsive. OUTPUT ONLY HTML.` },
    { path: 'blog-writer-free', prompt: (t) => `Write a 1500+ word SEO blog about "${t}". H1 with keyword. First 155 chars as meta description. 5-6 H2 sections. Short paragraphs. Bullet lists. Include: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a> and <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">AI blog writer</a>. Conclusion with CTA. OUTPUT ONLY HTML.` },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    { path: 'business-name-generator', prompt: (t) => `Generate 20 business names for "${t}". Format: "Name — Tagline | domain.com". OUTPUT JSON: {"names":["..."]} No markdown.` },
    { path: 'meta-tag-generator', prompt: (t) => `Generate SEO meta tags for "${t}". Title under 60 chars, description 150-155 chars, 10 keywords, og_title, og_description. OUTPUT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.` },
    { path: 'privacy-policy-generator', prompt: (t) => `Write complete Privacy Policy for ${t}. 10 sections. Legal tone. OUTPUT ONLY HTML.` },
    { path: 'terms-generator', prompt: (t) => `Write complete Terms of Service for ${t}. 10 sections. Legal tone. OUTPUT ONLY HTML.` },
    { path: 'resume-builder', prompt: (t) => `Create ATS-friendly resume for ${t}. Header, summary, experience, skills, education. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'paragraph-rewriter', prompt: (t) => `Rewrite this professionally: "${t}". Better vocabulary, improved flow. OUTPUT ONLY TEXT.` },
    { path: 'ad-copy-generator', prompt: (t) => `Generate 5 ad copies for "${t}". 2 Facebook, 2 Google, 1 Instagram. OUTPUT JSON: {"copy":["..."]} No markdown.` },
    { path: 'email-writer', prompt: (t) => `Write 3 emails for "${t}". Cold, follow-up, newsletter. Each with subject. OUTPUT JSON: {"emails":["Subject: ...\n\nBody..."]} No markdown.` },
    { path: 'hashtag-generator', prompt: (t) => `Generate 1 caption + 20 hashtags for "${t}". OUTPUT JSON: {"caption":"...","hashtags":["#..."]} No markdown.` },
    { path: 'youtube-seo', prompt: (t) => `Generate 5 YouTube titles and 10 SEO tags for "${t}". OUTPUT JSON: {"titles":["..."],"tags":["..."]} No markdown.` },
    { path: 'invoice-generator', prompt: (t) => `Create invoice for "${t}". INV-${Math.floor(Math.random() * 9000) + 1000}. Date: ${new Date().toLocaleDateString()}. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'social-bio-generator', prompt: (t) => `Generate bios for "${t}". Instagram (150), Twitter (160), LinkedIn (220), TikTok (150). OUTPUT JSON: {"platforms":[{"platform":"Instagram","bio":"..."}]} No markdown.` },
    { path: 'product-description', prompt: (t) => `Write 3 product descriptions for "${t}". OUTPUT JSON: {"descriptions":[{"headline":"...","body":"..."}]} No markdown.` },
    { path: 'startup-ideas', prompt: (t) => `Generate 5 startup ideas for "${t}". Each: name, problem, market, revenue, cost, steps. OUTPUT JSON: {"ideas":[{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["..."]}]} No markdown.` },
    { path: 'content-repurposer', prompt: (t) => `Repurpose "${t}" into 5 formats: Twitter, LinkedIn, newsletter, Instagram, YouTube hook. OUTPUT JSON: {"formats":[{"type":"...","content":"..."}]} No markdown.` },
    { path: 'website-auditor', prompt: (t) => `Audit "${t}" for SEO. Technical, Content, On-page, Off-page. OUTPUT CLEAN TEXT.` },
    { path: 'landing-page-copywriter', prompt: (t) => `Write 3 landing page copies for "${t}". OUTPUT JSON: {"copy":["HEADLINE: ...\\nSUBHEADLINE: ...\\n\\n..."]} No markdown.` },
    { path: 'competitor-analyzer', prompt: (t) => `Analyze competitor "${t}". Keyword gaps, content gaps, backlinks. OUTPUT CLEAN TEXT.` },
    { path: 'schema-generator', prompt: (t) => `Generate 4 JSON-LD schemas for "${t}": BlogPosting, Product, FAQPage, Organization. OUTPUT JSON: {"schemas":[{"@type":"BlogPosting",...}]} No markdown.` },
    { path: 'content-calendar', prompt: (t) => `30-day content calendar for "${t}". OUTPUT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"Website"}]} No markdown.` },
    { path: 'review-response-generator', prompt: (t) => `Write review responses for "${t}". 5,4,3,2,1 star. OUTPUT JSON: {"responses":[{"stars":5,"response":"..."}]} No markdown.` },
    { path: 'ai-translator', prompt: (t) => `Detect language and translate to English. If English, translate to Spanish. Text: "${t}". OUTPUT JSON: {"detected_language":"...","translated_text":"...","pronunciation":"..."} No markdown.` },
    { path: 'ai-code-generator', prompt: (t) => `Generate code for: "${t}". Include code, explanation, usage. OUTPUT JSON: {"code":"...","explanation":"...","usage":"..."} No markdown.` },
    { path: 'youtube-thumbnail-prompt', prompt: (t) => `Generate 5 YouTube thumbnail concepts for "${t}". OUTPUT JSON: {"thumbnails":[{"visual":"...","text":"...","colors":"...","emotion":"..."}]} No markdown.` },
    { path: 'ai-quote-generator', prompt: (t) => `Generate 10 quotes about "${t}". OUTPUT JSON: {"quotes":[{"quote":"...","author":"...","category":"..."}]} No markdown.` },
    { path: 'meeting-notes-generator', prompt: (t) => `Convert meeting notes: "${t}". OUTPUT JSON: {"meeting_title":"...","attendees":["..."],"key_decisions":["..."],"action_items":[{"task":"...","assignee":"...","deadline":"..."}],"summary":"..."} No markdown.` },
    { path: 'website-roaster', prompt: (t) => `You are a savage, hilarious website reviewer. Roast this website: "${t}". 
FORMAT STRICTLY AS:
🔥 FIRST IMPRESSION (1-2 sentences, savage but funny)
🎨 DESIGN ROAST (mock the colors, layout, fonts)
📝 CONTENT ROAST (mock the copy, grammar, cringe factors)
🔍 SEO ROAST (mock their SEO efforts)
💀 THE VERDICT (1-2 sentences funny conclusion)
✅ ACTUALLY USEFUL ADVICE (3 bullet points of real, actionable advice)

Be sarcastic and funny, but don't be mean. Use emojis. Keep it under 300 words total. OUTPUT CLEAN TEXT.` },
];

toolRoutes.forEach(route => {
    app.post(`/api/tool/${route.path}`, async (req, res) => {
        const input = sanitizeInput(req.body.topic || req.body.prompt);
        if (!input) return err(res, 'Prompt required', 400);
        if (route.type === 'image') {
            const seed = Math.floor(Math.random() * 999999);
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }
        if (route.type === 'logo') {
            const seed = Math.floor(Math.random() * 999999);
            const prompts = [`minimal flat logo "${input}" white bg`, `gradient badge logo "${input}"`, `luxury monogram "${input}"`, `icon+text logo "${input}" modern`];
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompts[Math.floor(Math.random() * prompts.length)])}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }
        const result = await askAI(route.prompt(input));
        if (!result) return err(res, 'AI generation failed. Try again.', 503);
        try {
            if (result.trim().startsWith('{') || result.trim().startsWith('[')) return ok(res, { success: true, data: JSON.parse(result) });
            return ok(res, { success: true, article: result });
        } catch (e) { return ok(res, { success: true, text: result }); }
    });
});

// ===== SPECIALIZED AI STAFF ROUTES =====
app.post('/api/agent/receptionist', async (req, res) => {
    const { question, customerName, businessType } = req.body;
    if (!question) return err(res, 'Question required', 400);
    const answer = await askAI(`You are Sarah, a friendly receptionist at ${businessType || 'our company'}. 
Customer ${customerName || 'says'}: "${question}"
RESPONSIBILITIES:
- Greet warmly by name if provided
- Answer common questions about services/pricing/hours
- Qualify leads by asking relevant questions
- Offer to book appointments
- Collect name, phone, email when appropriate
- Handle objections gracefully
- NEVER say you are AI
Respond in HTML format. Keep under 150 words. Be warm and professional.`);
    if (!answer) return err(res, 'AI failed', 503);
    ok(res, { success: true, answer });
});

app.post('/api/agent/sales-agent', async (req, res) => {
    const { question, product, price } = req.body;
    if (!question) return err(res, 'Question required', 400);
    const answer = await askAI(`You are Alex, an experienced sales agent selling: ${product || 'AI services'} at ${price || '$29/month'}.
Prospect says: "${question}"
SALES PROCESS:
1. Build rapport first
2. Ask qualifying questions (budget, timeline, needs)
3. Handle objections with empathy + facts
4. Create urgency (limited spots, price increasing)
5. Close with clear CTA
6. NEVER be pushy, be consultative
7. NEVER say you are AI
Use persuasive language. Include ROI calculations. Respond in HTML. Under 200 words.`);
    if (!answer) return err(res, 'AI failed', 503);
    ok(res, { success: true, answer });
});

app.post('/api/agent/support-agent', async (req, res) => {
    const { question, orderNumber, issueType } = req.body;
    if (!question) return err(res, 'Question required', 400);
    const answer = await askAI(`You are Mike, a patient customer support agent.
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
Be empathetic, patient, thorough. Respond in HTML. Under 200 words.`);
    if (!answer) return err(res, 'AI failed', 503);
    ok(res, { success: true, answer });
});

app.post('/api/agent/social-staff', async (req, res) => {
    const { niche, days = 7, platforms } = req.body;
    if (!niche) return err(res, 'Niche required', 400);
    const content = await askAI(`Create ${days} days of social media content for "${niche}".
Platforms: ${platforms || 'Instagram, Twitter, LinkedIn'}
For EACH day, create posts for each platform:
- Hook (attention-grabbing first line)
- Content (valuable, engaging)
- Hashtags (10-15 relevant ones)
- Best posting time
- Content type (carousel, reel, story, post)
OUTPUT JSON: {"days":[{"day":1,"posts":[{"platform":"instagram","hook":"...","content":"...","hashtags":["#..."],"time":"9:00 AM","type":"carousel"}]}]} No markdown.`);
    if (!content) return err(res, 'AI failed', 503);
    try { ok(res, { success: true, data: JSON.parse(content) }); } catch (e) { ok(res, { success: true, text: content }); }
});

app.post('/api/agent/content-writer', async (req, res) => {
    const { topic, wordCount = 1500, tone = 'professional' } = req.body;
    if (!topic) return err(res, 'Topic required', 400);
    const html = await askAI(`Write a ${wordCount}+ word ${tone} SEO blog about: "${topic}".
Requirements:
- Compelling H1 with primary keyword
- Meta description (150-155 chars)
- 5-6 H2 sections with LSI keywords
- Short paragraphs (2-3 sentences max)
- Bullet lists for scannability
- Internal link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
- Conclusion with CTA
- OUTPUT ONLY HTML, no markdown`);
    if (!html) return err(res, 'AI failed', 503);
    const tm = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    ok(res, { success: true, articles: [{ title: tm ? tm[1].replace(/<[^>]*>/g, '') : topic, content: html, words: html.split(/\s+/).length }] });
});

app.post('/api/agent/seo-expert', async (req, res) => {
    const { url, niche, goal = 'rank higher' } = req.body;
    if (!url && !niche) return err(res, 'URL or niche required', 400);
    const audit = await askAI(`You are Dr. SEO, an expert with 15 years experience.
Goal: ${goal}
Target: "${url || niche}"
Provide COMPLETE SEO analysis:
1. TOP 20 KEYWORDS (with monthly volume estimate, difficulty: Easy/Medium/Hard)
2. ON-PAGE CHECKLIST (✅/❌ for each item)
3. TECHNICAL ISSUES (priority: High/Medium/Low)
4. CONTENT GAPS (topics competitors cover that you don't)
5. BACKLINK STRATEGY (5 specific tactics)
6. 30-DAY ACTION PLAN (week by week)
Format clearly with emojis for sections. OUTPUT CLEAN TEXT.`);
    if (!audit) return err(res, 'AI failed', 503);
    ok(res, { success: true, audit });
});

app.post('/api/agent/email-marketer', async (req, res) => {
    const { product, audience, goal = 'convert to customer' } = req.body;
    if (!product) return err(res, 'Product required', 400);
    const funnel = await askAI(`Create a 6-email conversion funnel for "${product}".
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
OUTPUT JSON: {"funnel":[{"day":0,"type":"welcome","subject":"...","preview":"...","body":"...","ps":"..."}]} No markdown.`);
    if (!funnel) return err(res, 'AI failed', 503);
    try { ok(res, { success: true, data: JSON.parse(funnel) }); } catch (e) { ok(res, { success: true, text: funnel }); }
});

app.post('/api/agent/video-scriptwriter', async (req, res) => {
    const { topic, platform = 'youtube', duration = '10 min', tone = 'engaging' } = req.body;
    if (!topic) return err(res, 'Topic required', 400);
    const script = await askAI(`Write a ${duration} ${tone} ${platform} script about "${topic}".
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
OUTPUT CLEAN TEXT.`);
    if (!script) return err(res, 'AI failed', 503);
    ok(res, { success: true, script });
});

// ===== EMAIL CAPTURE =====
app.post('/api/capture-email', async (req, res) => {
    const { email, source = 'unknown' } = req.body;
    if (!email || !email.includes('@')) return err(res, 'Invalid email', 400);
    if (supabase) {
        try {
            await supabase.from('email_captures').upsert(
                { email, source, captured_at: new Date().toISOString() },
                { onConflict: 'email' }
            );
        } catch (e) {}
    }
    await sendTelegram(`📧 <b>New Lead!</b>\n${email}\nSource: ${source}`);
    ok(res, { success: true, message: 'Subscribed!' });
});

// ===== SUBSCRIPTION SYSTEM =====
app.post('/api/subscribe', async (req, res) => {
    const { email, agentId, planName, price, paypalOrderId } = req.body;
    if (!email || !agentId) return err(res, 'Missing data', 400);
    if (supabase) {
        await supabase.from('subscriptions').update({ active: false }).eq('email', email).eq('agent_id', agentId);
        await supabase from('subscriptions').insert({ email, agent_id: agentId, plan_name: planName, price, paypal_order_id: paypalOrderId, active: true });
    }
    await sendTelegram(`🤖 <b>New Sub!</b>\n${planName}\n${price}/mo\n${email}`);
    ok(res, { success: true, message: 'Subscribed!' });
});

app.post('/api/subscribe-tools', async (req, res) => {
    const { email, planName, price, paypalOrderId } = req.body;
    if (!email) return err(res, 'Email required', 400);
    if (supabase) {
        try {
            await supabase.from('tool_subscriptions').upsert({ email, plan_name: planName, price, paypal_order_id: paypalOrderId, active: true }, { onConflict: 'email' });
        } catch (e) {}
    }
    await sendTelegram(`💰 <b>Tools Sub!</b>\n${planName}\n${price}/mo\n${email}`);
    ok(res, { success: true, message: 'Subscribed!' });
});

app.get('/api/my-subscriptions', async (req, res) => {
    const { email } = req.query;
    if (!email) return err(res, 'Email required', 400);
    if (!supabase) return ok(res, { success: true, subs: [], toolsPlan: null });
    try {
        const { data: staffSubs } = await supabase.from('subscriptions').select('*').eq('email', email).eq('active', true);
        const { data: toolSub } = await supabase.from('tool_subscriptions').select('*').eq('email', email).eq('active', true).single();
        ok(res, { success: true, subs: staffSubs || [], toolsPlan: toolSub });
    } catch (e) { ok(res, { success: true, subs: [], toolsPlan: null }); }
});

app.post('/api/paypal-webhook', async (req, res) => {
    const { orderID, plan, price, payerEmail } = req.body;
    console.log('PayPal:', { orderID, plan, price, payerEmail });
    await sendTelegram(`💰 <b>Payment!</b>\nPlan: ${plan}\nPrice: ${price}\nEmail: ${payerEmail || 'N/A'}`);
    ok(res, { success: true, message: 'Payment recorded' });
});

// ===== ERROR HANDLING =====
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('Error:', err.message); res.status(500).json({ error: 'Internal error' }); });

if (IS_VERCEL) {
    module.exports = app;
} else {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🤖 API on ${PORT}`));
}
