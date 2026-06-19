require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

function env(key) {
    let val = process.env[key];
    if (!val) return '';
    return val.replace(/^['"`\s]+|['"`\s]+$/g, '').trim();
}

const SB_URL = env('SB_URL');
const SB_KEY = env('SB_KEY');
const GROQ_KEY = env('GROQ_KEY');
const GEMINI_KEY = env('GEMINI_KEY');
const BLOGGER_CLIENT_ID = env('BLOGGER_CLIENT_ID');
const BLOGGER_CLIENT_SECRET = env('BLOGGER_CLIENT_SECRET');
const BLOGGER_REFRESH_TOKEN = env('BLOGGER_REFRESH_TOKEN');
const BLOG_ID = env('BLOG_ID');
const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');
const TELEGRAM_CHANNEL_ID = env('TELEGRAM_CHANNEL_ID');
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://affiliatepilot-frontend.vercel.app';

console.log('🤖 PilotStaff API Starting...');
console.log('GROQ:', GROQ_KEY ? '✅' : '❌', '| Gemini:', GEMINI_KEY ? '✅' : '❌', '| Blogger:', (BLOGGER_REFRESH_TOKEN && BLOG_ID) ? '✅' : '❌');

const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

function sanitize(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '').replace(/javascript:/gi, '').trim().substring(0, 5000);
}
function sanitizeStrict(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>'";&]/g, '').trim().substring(0, 2000);
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 10000 }); } catch (e) {}
}

// ===== DUAL AI ENGINE (Groq + Gemini) =====
async function askAI(prompt, retries = 2) {
    // Try Gemini first (free, high quality)
    if (GEMINI_KEY) {
        try {
            const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
            }, { timeout: 60000 });
            let c = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (c) return c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        } catch (e) { console.log('Gemini failed, trying Groq:', e.message?.substring(0, 50)); }
    }
    // Fallback to Groq
    if (!GROQ_KEY) return null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 4000,
            }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });
            let c = r.data.choices[0].message.content;
            return c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        } catch (e) {
            if (attempt === retries) return null;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return null;
}

async function getBloggerToken() {
    if (!BLOGGER_REFRESH_TOKEN || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) return null;
    try {
        const r = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token'
        }, { timeout: 15000 });
        return r.data.access_token;
    } catch (e) { console.error('Blogger token error:', e.response?.data?.error || e.message); return null; }
}

async function pingIndexNow(url) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: new URL(url).hostname, key: 'pilotbotindexkey123', urlList: [url] }, { timeout: 5000 }); } catch (e) {}
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

// ===== HEALTH & STATS =====
app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));

app.get('/api/health', (req, res) => ok(res, {
    success: true, uptime: process.uptime(), memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    ai: { gemini: !!GEMINI_KEY, groq: !!GROQ_KEY },
    blogger: { token: !!BLOGGER_REFRESH_TOKEN, clientId: !!BLOGGER_CLIENT_ID, secret: !!BLOGGER_CLIENT_SECRET, blogId: !!BLOG_ID },
    telegram: !!TELEGRAM_BOT_TOKEN, supabase: !!supabase
}));

app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return ok(res, { success: true, activeUsers: '2.1K+', totalTasks: '15K+', blogPosts: '30+' });
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const fmt = n => !n ? '0' : n >= 1000 ? (n / 1000).toFixed(1) + 'K+' : n.toString();
        ok(res, { success: true, activeUsers: fmt(users), totalTasks: fmt((users || 0) * 7) });
    } catch (e) { ok(res, { success: true, activeUsers: '2.1K+', totalTasks: '15K+' }); }
});

// ===== 30 FREE AI TOOLS (ALL WORKING) =====
const toolRoutes = [
    { path: 'website-builder', prompt: (t) => `Create a COMPLETE single-page website for "${t}". Inline CSS only. Include: sticky navbar with "PilotStaff" logo and links, hero with gradient background and CTA button, 6 feature cards in grid, how-it-works section with 3 steps, 3 testimonial cards with stars, pricing table with 3 plans (Free/$0, Pro/$29, Enterprise/$99) with Pro highlighted, FAQ accordion, and footer with links. Modern, clean, responsive. OUTPUT ONLY HTML.` },
    { path: 'blog-writer-free', prompt: (t) => `Write a 1800+ word SEO blog about "${t}". H1 with keyword. First 155 chars as meta description. 5-6 H2 sections with secondary keywords. Short paragraphs. Bullet lists. Include: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a> and <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">AI blog writer</a>. Conclusion with CTA. OUTPUT ONLY HTML.` },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    { path: 'business-name-generator', prompt: (t) => `Generate 20 business names for "${t}". Format: "Name — Tagline | domain.com". Creative, memorable, max 3 words. OUTPUT JSON: {"names":["..."]} No markdown.` },
    { path: 'meta-tag-generator', prompt: (t) => `Generate SEO meta tags for "${t}". Title under 60 chars, description 150-155 chars, 10 keywords, og_title, og_description. OUTPUT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.` },
    { path: 'privacy-policy-generator', prompt: (t) => `Write complete Privacy Policy for ${t}. 10 sections with H2: Information Collection, How We Use Data, Cookies, Third-Party Services, Data Security, Data Sharing, Your Rights, Children's Privacy, Changes, Contact. Professional legal tone. OUTPUT ONLY HTML.` },
    { path: 'terms-generator', prompt: (t) => `Write complete Terms of Service for ${t}. 10 sections with H2: Acceptance, Services, User Responsibilities, Payments, IP, Liability, Indemnification, Termination, Governing Law, Contact. Legal tone. OUTPUT ONLY HTML.` },
    { path: 'resume-builder', prompt: (t) => `Create ATS-friendly resume for ${t}. Header with name, email, phone. Professional summary. Work experience with bullet points starting with action verbs and metrics. Skills in 2 columns (Technical + Soft). Education. Certifications. Inline CSS, clean layout. OUTPUT ONLY HTML.` },
    { path: 'paragraph-rewriter', prompt: (t) => `Rewrite this professionally keeping exact meaning: "${t}". Better vocabulary, improved flow, same facts. OUTPUT ONLY TEXT.` },
    { path: 'ad-copy-generator', prompt: (t) => `Generate 5 ad copies for "${t}". 2 Facebook (emoji-rich), 2 Google (search-focused), 1 Instagram (lifestyle). Each: hook headline + 2-3 line body. OUTPUT JSON: {"copy":["..."]} No markdown.` },
    { path: 'email-writer', prompt: (t) => `Write 3 emails for "${t}". 1: Cold outreach (intro + value + CTA). 2: Follow-up (reminder + next steps). 3: Newsletter (value + link + CTA). Each with subject line. OUTPUT JSON: {"emails":["Subject: ...\n\nBody..."]} No markdown.` },
    { path: 'hashtag-generator', prompt: (t) => `Generate 1 Instagram/TikTok caption with hook + 20 hashtags for "${t}". Mix popular, niche, trending. Include #PilotStaff. OUTPUT JSON: {"caption":"...","hashtags":["#..."]} No markdown.` },
    { path: 'youtube-seo', prompt: (t) => `Generate 5 YouTube titles (different formulas: number, how-to, comparison, question, why) and 10 SEO tags for "${t}". OUTPUT JSON: {"titles":["..."],"tags":["..."]} No markdown.` },
    { path: 'invoice-generator', prompt: (t) => `Create invoice for "${t}". INV-${Math.floor(Math.random()*9000)+1000}. Date: ${new Date().toLocaleDateString()}. Company header, Bill To, table (Description/Hours/Rate/Amount), subtotal, tax 10%, total. Payment terms: 30 days. Inline CSS. OUTPUT ONLY HTML.` },
    { path: 'social-bio-generator', prompt: (t) => `Generate bios for "${t}". Instagram (150 chars), Twitter (160 chars), LinkedIn (220 chars), TikTok (150 chars). Each different, with emoji, with CTA. OUTPUT JSON: {"platforms":[{"platform":"Instagram","bio":"..."}]} No markdown.` },
    { path: 'product-description', prompt: (t) => `Write 3 product descriptions for "${t}". Each: headline + problem paragraph + features list (5 items with ✓) + urgency + CTA. Different angles: value, quality, convenience. OUTPUT JSON: {"descriptions":[{"headline":"...","body":"..."}]} No markdown.` },
    { path: 'startup-ideas', prompt: (t) => `Generate 5 startup ideas for "${t}". Each: name, problem, specific target market, revenue model with pricing, startup cost in USD, 3 launch steps. OUTPUT JSON: {"ideas":[{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["1.","2.","3."]}]} No markdown.` },
    { path: 'content-repurposer', prompt: (t) => `Repurpose "${t}" into 5 formats: Twitter thread (5 tweets), LinkedIn post (1200 chars), email newsletter (subject + body), Instagram caption (hook + hashtags), YouTube hook (50 chars). OUTPUT JSON: {"formats":[{"type":"...","content":"..."}]} No markdown.` },
    { path: 'website-auditor', prompt: (t) => `Audit "${t}" for SEO. 4 sections: Technical (speed, mobile, HTTPS, robots, canonical, schema, images), Content (H1, title, meta, keywords, links, headings, alt tags), On-page (URL, OG, Twitter cards), Off-page (backlinks, social signals). Format: ❌ Issue / ✅ Fix / ⚡ Priority. OUTPUT CLEAN TEXT. No markdown.` },
    { path: 'landing-page-copywriter', prompt: (t) => `Write 3 landing page copies for "${t}". Each: HEADLINE (under 12 words) / SUBHEADLINE / 3 body paragraphs (problem→solution→CTA) / CTA button text. Variations: urgency, benefit, social proof. OUTPUT JSON: {"copy":["HEADLINE: ...\\nSUBHEADLINE: ...\\n\\n..."]} No markdown.` },
    { path: 'competitor-analyzer', prompt: (t) => `Analyze competitor "${t}". 5-8 keyword gaps, 5-8 content gaps, 5 backlink opportunity types, traffic source estimates, monetization analysis, technical issues, 3 competitive advantages you can target. OUTPUT CLEAN TEXT. No markdown.` },
    { path: 'schema-generator', prompt: (t) => `Generate 4 JSON-LD schemas for "${t}": BlogPosting (with author, date), Product (with price, availability), FAQPage (3 questions), Organization (with logo, contact). All must have @context. OUTPUT JSON: {"schemas":[{"@context":"https://schema.org","@type":"BlogPosting",...}]} No markdown.` },
    { path: 'content-calendar', prompt: (t) => `30-day content calendar for "${t}". Days 1-7: Awareness, 8-15: Engagement, 16-22: Consideration, 23-30: Conversion. Each day: day, topic, keyword, type (Blog/Instagram/Twitter/LinkedIn/Email/YouTube), platform, funnel_stage. OUTPUT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"Website","funnel_stage":"Awareness"}]} No markdown.` },
    { path: 'review-response-generator', prompt: (t) => `Write review responses for "${t}". 5, 4, 3, 2, 1 star ratings. 5-star: grateful + mention feature. 4-star: thank + address concern. 3-star: apologize + ask feedback. 2-star: serious + offer resolution. 1-star: polite + firm. 2-4 sentences each. OUTPUT JSON: {"responses":[{"stars":5,"response":"..."}]} No markdown.` },
    // ===== 5 NEW TOOLS =====
    { path: 'ai-translator', prompt: (t) => `Detect the language and translate to English. If already English, translate to Spanish. Text: "${t}". Provide: detected_language, translated_text, pronunciation_guide (for non-English). OUTPUT JSON: {"detected_language":"...","translated_text":"...","pronunciation":"..."} No markdown.` },
    { path: 'ai-code-generator', prompt: (t) => `Generate clean, working code for: "${t}". Include: code with comments, brief explanation of how it works, how to use it. Use modern best practices. OUTPUT JSON: {"code":"...","explanation":"...","usage":"..."} No markdown.` },
    { path: 'youtube-thumbnail-prompt', prompt: (t) => `Generate 5 YouTube thumbnail concepts for: "${t}". Each: visual description (what's in image), text overlay (max 6 words), color scheme, emotion to evoke. OUTPUT JSON: {"thumbnails":[{"visual":"...","text":"...","colors":"...","emotion":"..."}]} No markdown.` },
    { path: 'ai-quote-generator', prompt: (t) => `Generate 10 original, impactful quotes about "${t}". Each quote: the quote, author attribution (can be "Unknown" or create a name), category (motivation/business/life/leadership). Make them shareable and Instagram-worthy. OUTPUT JSON: {"quotes":[{"quote":"...","author":"...","category":"..."}]} No markdown.` },
    { path: 'meeting-notes-generator', prompt: (t) => `Convert these meeting notes into structured format: "${t}". Generate: meeting_title, date, attendees (extract or create), key_decisions (3-5), action_items (3-5 with assignee and deadline), next_steps (2-3), summary (2 sentences). OUTPUT JSON: {"meeting_title":"...","date":"...","attendees":["..."],"key_decisions":["..."],"action_items":[{"task":"...","assignee":"...","deadline":"..."}],"next_steps":["..."],"summary":"..."} No markdown.` },
];

toolRoutes.forEach(route => {
    app.post(`/api/tool/${route.path}`, async (req, res) => {
        const input = sanitizeStrict(req.body.topic || req.body.prompt);
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

// ===== 6 WORKING AI AGENTS =====
app.post('/api/agent/content-writer', async (req, res) => {
    const { topic, count = 1 } = req.body;
    if (!topic) return err(res, 'Topic required', 400);
    const results = [];
    for (let i = 0; i < Math.min(count, 5); i++) {
        const html = await askAI(`Write a 1800+ word SEO blog about: "${topic}". H1, 5-6 H2, bullets. Include: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. OUTPUT ONLY HTML.`);
        if (html) { const tm = html.match(/<h1[^>]*>(.*?)<\/h1>/i); results.push({ title: tm ? tm[1].replace(/<[^>]*>/g, '') : topic, content: html, words: html.split(/\s+/).length }); }
    }
    ok(res, { success: true, articles: results, message: `Generated ${results.length} articles` });
});

app.post('/api/agent/seo-expert', async (req, res) => {
    const { url, niche } = req.body;
    if (!url && !niche) return err(res, 'URL or niche required', 400);
    const audit = await askAI(`Complete SEO analysis for: "${url || niche}". 1) Top 20 keywords with difficulty. 2) On-page checklist with ✅/❌. 3) 10 blog title ideas. 4) Technical recommendations. 5) Backlink strategy with 10 site types. OUTPUT CLEAN TEXT.`);
    if (!audit) return err(res, 'AI failed', 503);
    ok(res, { success: true, audit });
});

app.post('/api/agent/social-manager', async (req, res) => {
    const { niche, days = 7 } = req.body;
    if (!niche) return err(res, 'Niche required', 400);
    const content = await askAI(`Create ${days} days of social content for "${niche}". Platforms: Instagram, Twitter, LinkedIn. Each day: hook, post content, hashtags, best time. OUTPUT JSON: {"days":[{"day":1,"posts":[{"platform":"instagram","hook":"...","content":"...","hashtags":["#..."],"time":"9:00 AM"}]}]} No markdown.`);
    if (!content) return err(res, 'AI failed', 503);
    try { ok(res, { success: true, data: JSON.parse(content) }); } catch (e) { ok(res, { success: true, text: content }); }
});

app.post('/api/agent/email-marketer', async (req, res) => {
    const { product } = req.body;
    if (!product) return err(res, 'Product required', 400);
    const funnel = await askAI(`Create 6-email funnel for "${product}". Welcome, Value, Story, Proof, Offer, Last Chance. Each: subject (6-10 words), preview text, body (3-4 paragraphs), P.S. line. OUTPUT JSON: {"funnel":[{"day":0,"type":"welcome","subject":"...","body":"...","ps":"..."}]} No markdown.`);
    if (!funnel) return err(res, 'AI failed', 503);
    try { ok(res, { success: true, data: JSON.parse(funnel) }); } catch (e) { ok(res, { success: true, text: funnel }); }
});

app.post('/api/agent/support-agent', async (req, res) => {
    const { question } = req.body;
    if (!question) return err(res, 'Question required', 400);
    const answer = await askAI(`You are a friendly customer support agent for PilotStaff AI Tools. Question: "${question}". Respond in HTML. Warm, helpful, under 200 words. Never say you're AI.`);
    if (!answer) return err(res, 'AI failed', 503);
    ok(res, { success: true, answer });
});

app.post('/api/agent/video-scriptwriter', async (req, res) => {
    const { topic, platform = 'youtube' } = req.body;
    if (!topic) return err(res, 'Topic required', 400);
    const script = await askAI(`Write a ${platform === 'youtube' ? '10 min' : '30 sec'} ${platform} script about "${topic}". Include [HOOK:], [B-ROLL:], [TEXT ON SCREEN:], [SFX:], [CTA:]. Engaging, conversational. OUTPUT CLEAN TEXT.`);
    if (!script) return err(res, 'AI failed', 503);
    ok(res, { success: true, script });
});

// ===== BLOG SYSTEM - AUTO DAILY POSTING =====
const TRENDING_TOPICS = [
    'How AI Tools Are Replacing $5000/Month Employees in 2025',
    '15 Free AI Websites That Do Everything Paid Software Does',
    'AI Website Builder vs Hiring a Developer: Complete Cost Breakdown',
    'How Small Businesses Use AI Agents to Compete with Big Companies',
    'Free AI Blog Writer That Actually Produces Rankable Content',
    'Best AI Logo Makers in 2025: We Tested 10 Free Tools',
    'How to Write Meta Tags That Get Clicks on Google Search',
    'AI Content vs Human Content: What Google Algorithms Actually Prefer',
    '10 AI Tools Every Freelancer Needs to Double Their Income',
    'How to Start an AI Automation Business with Zero Investment',
    'Free AI Image Generators That Produce Professional Results in 2025',
    'How to Write an ATS-Friendly Resume Using Free AI Tools',
    'AI Social Media Manager: How to Post Daily Without Doing Anything',
    'The Complete Beginner Guide to AI SEO Tools',
    'How to Create a Business Name That People Actually Remember',
    'Free Invoice Generator: Create Professional Invoices in 30 Seconds',
    'AI Email Writer: How to Write Emails That Get Replies Every Time',
    'How to Build a 30-Day Content Calendar Using AI in 15 Minutes',
    'YouTube SEO in 2025: Free AI Tools That Boost Your Views',
    'Why Every Single Website Needs a Privacy Policy in 2025',
    'AI Ad Copy Generators: Do They Actually Convert Better Than Humans',
    'How to Repurpose One Piece of Content Into 5 Different Formats',
    'Free Schema Markup Generator: The Easiest Way to Boost Google Rankings',
    'Startup Ideas 2025: 10 AI Business Opportunities Under $1000',
    'How to Do Competitor Analysis Using Free AI Tools',
    'Landing Page Copy That Converts: AI Formulas Used by Top Brands',
    'Instagram and TikTok Hashtag Strategy That Actually Goes Viral in 2025',
    'AI Resume Builder vs Traditional Resume Services: Which Gets More Interviews',
    'How to Write Product Descriptions That Sell Using Free AI Tools',
    'How to Respond to Every Type of Customer Review Using AI',
];

async function publishSEOBlog(topic) {
    const ct = sanitizeStrict(topic);
    const html = await askAI(`Write a HIGH-QUALITY 1800+ word SEO blog post.

TOPIC: "${ct}"
DATE: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}

STRUCTURE:
- H1: Primary keyword near start, under 60 chars, compelling
- First 155 chars = meta description with keyword
- 5-6 H2 sections with secondary keyword variations
- Short paragraphs (3-4 sentences max)
- Bullet point lists in each section
- Professional but conversational tone

PROMOTION LINKS (include ALL naturally in the text):
1. Early: <a href="${WEBSITE_URL}" style="color:#2563eb;font-weight:600;text-decoration:underline;">PilotStaff</a> - mention as "I found this amazing platform called PilotStaff"
2. Middle: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;text-decoration:underline;">25 free AI tools</a> - mention as "they offer 25 free AI tools"
3. Another section: <a href="${WEBSITE_URL}/agents" style="color:#2563eb;font-weight:600;text-decoration:underline;">AI employees</a> - mention as "hire AI employees"
4. Near end: <a href="${WEBSITE_URL}/pricing" style="color:#2563eb;font-weight:600;text-decoration:underline;">affordable plans starting at $19/month</a>

CONCLUSION:
- Summarize 3-4 key takeaways
- Include primary keyword one final time
- End with: "Check out <a href="${WEBSITE_URL}" style="color:#2563eb;font-weight:600;text-decoration:underline;">PilotStaff.com</a> to explore their free AI tools and see how AI can transform your workflow."

RULES:
- Every link must feel NATURAL in the sentence, not forced
- Use <strong> for important terms
- No fluff sentences
- OUTPUT ONLY HTML starting with <h1>. No html/body/head. No markdown.`);

    if (!html) throw new Error('AI failed');
    
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').substring(0, 100) : ct;

    const token = await getBloggerToken();
    if (!token) throw new Error('Blogger auth failed');

    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
        kind: 'blogger#post', title: postTitle, content: html,
        labels: [ct.split(' ').slice(0, 2).join(' '), 'AI Tools', 'Free Tools', '2025', 'Guide', 'PilotStaff', 'AI Automation'],
    }, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });

    const blogUrl = `https://${BLOG_ID}.blogspot.com`;
    pingIndexNow(blogUrl);
    await sendTelegram(`📝 <b>Daily Blog Published!</b>\n📐 ${postTitle.substring(0, 70)}\n🔗 ${blogUrl}\n📅 ${new Date().toLocaleDateString()}`);
    console.log(`✅ Auto-blog: ${postTitle.substring(0, 50)}...`);
    return postTitle;
}

// Manual trigger
app.post('/api/trigger-blog', async (req, res) => {
    if (!BLOG_ID || !BLOGGER_REFRESH_TOKEN) return err(res, 'Blogger not configured. Set BLOGGER_REFRESH_TOKEN and BLOG_ID in Render env.', 400);
    const topic = TRENDING_TOPICS[Math.floor(Math.random() * TRENDING_TOPICS.length)];
    try { const title = await publishSEOBlog(topic); ok(res, { success: true, message: `Published: "${title}"`, topic }); }
    catch (e) { err(res, e.message, 500); }
});

app.post('/api/trigger-bulk-blogs', async (req, res) => {
    const { count = 3 } = req.body;
    if (!BLOG_ID || !BLOGGER_REFRESH_TOKEN) return err(res, 'Blogger not configured', 400);
    const results = [];
    const shuffled = [...TRENDING_TOPICS].sort(() => Math.random() - 0.5).slice(0, Math.min(count, 10));
    for (const topic of shuffled) {
        try { const title = await publishSEOBlog(topic); results.push({ topic, title, success: true }); }
        catch (e) { results.push({ topic, error: e.message, success: false }); }
    }
    ok(res, { success: true, results });
});

app.get('/api/blog-status', async (req, res) => {
    try {
        const token = await getBloggerToken();
        if (!token) return ok(res, { connected: false, error: 'Auth failed', debug: { token: !!BLOGGER_REFRESH_TOKEN, clientId: !!BLOGGER_CLIENT_ID, secret: !!BLOGGER_CLIENT_SECRET, blogId: BLOG_ID || 'NOT SET' } });
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=1`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
        ok(res, { connected: true, totalPosts: data.totalItems || 0, lastPost: data.items?.[0]?.title || 'None', blogUrl: `https://${BLOG_ID}.blogspot.com` });
    } catch (e) {
        ok(res, { connected: false, error: e.response?.data?.error?.message || e.message, debug: { token: !!BLOGGER_REFRESH_TOKEN, clientId: !!BLOGGER_CLIENT_ID, secret: !!BLOGGER_CLIENT_SECRET, blogId: BLOG_ID || 'NOT SET' } });
    }
});

app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return err(res, 'Blogger not configured', 400);
    try {
        const token = await getBloggerToken(); if (!token) return err(res, 'Auth failed', 401);
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
        ok(res, { success: true, posts: (data.items || []).map(p => ({ id: p.id, title: p.title, url: p.url, published: p.published, image: p.images?.[0]?.url })), total: data.totalItems || 0 });
    } catch (e) { err(res, e.message, 500); }
});

// ===== CRON: AUTO DAILY BLOG AT 4 AM + 4 PM =====
let lastAutoBlog = '';
cron.schedule('0 4,16 * * *', async () => {
    if (!BLOG_ID || !BLOGGER_REFRESH_TOKEN) return;
    // Pick a topic not recently used
    let available = TRENDING_TOPICS.filter(t => !t.includes(lastAutoBlog.split(' ').slice(0, 3).join(' ')));
    if (available.length === 0) available = TRENDING_TOPICS;
    const topic = available[Math.floor(Math.random() * available.length)];
    lastAutoBlog = topic;
    try { await publishSEOBlog(topic); console.log('✅ Cron blog:', topic.substring(0, 40)); }
    catch (e) { console.error('❌ Cron blog failed:', e.message); }
});

// Heartbeat
cron.schedule('*/30 * * * *', () => { console.log(`💓 ${new Date().toLocaleTimeString()} | ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`); });

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('Unhandled:', err.message); res.status(500).json({ error: 'Internal error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotStaff API on ${PORT}`));
