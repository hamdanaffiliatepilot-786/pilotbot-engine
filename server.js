require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;
const BLOG_ID = process.env.BLOG_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://affiliatepilotfrontend.vercel.app';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!SB_URL || !SB_KEY) console.warn('⚠️ Supabase not set');
if (!GROQ_KEY) console.warn('⚠️ GROQ_KEY not set');

const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

function sanitize(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>'";&]/g, '').trim().substring(0, 2000);
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) { console.error('TG:', e.message?.substring(0, 80)); }
}

async function askAI(prompt) {
    if (!GROQ_KEY) return null;
    try {
        const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 4000,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }, timeout: 45000 });
        let c = r.data.choices[0].message.content;
        c = c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        return c;
    } catch (e) { console.error('AI:', e.message?.substring(0, 80)); return null; }
}

async function getBloggerToken(userToken) {
    const token = userToken || BLOGGER_REFRESH_TOKEN;
    if (!token || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) return null;
    try {
        const r = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: token, grant_type: 'refresh_token' });
        return r.data.access_token;
    } catch (e) { console.error('Blogger:', e.message?.substring(0, 80)); return null; }
}

async function pingIndexNow(url) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: new URL(url).hostname, key: 'pilotbotindexkey123', urlList: [url] }); } catch (e) {}
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));
app.get('/api/health', (req, res) => ok(res, { success: true, uptime: process.uptime(), services: { supabase: !!supabase, groq: !!GROQ_KEY, blogger: !!BLOGGER_REFRESH_TOKEN, telegram: !!TELEGRAM_BOT_TOKEN } }));

app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return ok(res, { success: true, activeUsers: '0', totalTasks: '0' });
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
        const fmt = n => { if (!n) return '0'; if (n >= 1000) return (n / 1000).toFixed(1) + 'K+'; return n.toString(); };
        ok(res, { success: true, activeUsers: fmt(users), totalTasks: fmt((users || 0) * 7 + (leads || 0) * 3) });
    } catch (e) { ok(res, { success: true, activeUsers: '0', totalTasks: '0' }); }
});

app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return err(res, 'Blogger not configured', 200);
    try {
        const token = await getBloggerToken();
        if (!token) return err(res, 'Blogger auth failed', 200);
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` } });
        const posts = (data.items || []).map(p => ({ id: p.id, title: p.title, url: p.url, published: p.published, image: p.images?.[0]?.url || null }));
        ok(res, { success: true, posts });
    } catch (e) { err(res, e.message, 200); }
});

app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return err(res, 'Message and session ID required');
    const cm = sanitize(message), cs = sanitize(sessionId).substring(0, 100);
    let memText = '';
    if (supabase) { try { const { data: mem } = await supabase.from('chat_memories').select('summary').eq('session_id', cs).single(); if (mem?.summary) memText = mem.summary; } catch (e) {} }
    const prompt = `You are a helpful AI assistant for PilotStaff (pilotstaff.com). Be concise. ${memText ? `Previous context: ${memText}\n\n` : ''}User: ${cm}\n\nRespond in HTML (use <b>, <br>, <ul>, <li>). Under 200 words. On NEW LINE write: [MEMORY: brief summary]`;
    const result = await askAI(prompt);
    if (!result) return err(res, 'AI failed');
    const mm = result.match(/\[MEMORY:\s*(.+?)\]$/i);
    let reply = result, memUpdate = mm ? mm[1] : null;
    if (mm) reply = result.replace(/\[MEMORY:\s*.+?\]$/i, '').trim();
    if (supabase && memUpdate) { try { await supabase.from('chat_memories').upsert({ session_id: cs, summary: sanitize(memUpdate), updated_at: new Date().toISOString() }, { onConflict: 'session_id' }); } catch (e) {} }
    ok(res, { success: true, reply });
});

app.get('/api/crm/leads', async (req, res) => {
    if (!supabase) return ok(res, { success: true, leads: [] });
    try { const { data: leads } = await supabase.from('leads').select('*').order('created_at', { ascending: false }); ok(res, { success: true, leads: leads || [] }); } catch (e) { ok(res, { success: true, leads: [] }); }
});

app.post('/api/crm/leads', async (req, res) => {
    if (!supabase) return err(res, 'DB not configured');
    const { name, email, phone, status, value } = req.body;
    const { data, error } = await supabase.from('leads').insert({ name: sanitize(name), email: sanitize(email), phone: sanitize(phone), status: sanitize(status) || 'new', value: sanitize(value) }).select().single();
    if (error) return err(res, error.message);
    ok(res, { success: true, lead: data });
});

app.post('/api/auth', async (req, res) => {
    if (!supabase) return err(res, 'DB not configured');
    const { email } = req.body;
    if (!email) return err(res, 'Email required');
    const { data: user } = await supabase.from('users').select('*').eq('email', sanitize(email)).single();
    if (user) return ok(res, { success: true, user });
    const { data: newUser, error } = await supabase.from('users').insert({ email: sanitize(email) }).select().single();
    if (error) return err(res, error.message);
    ok(res, { success: true, user: newUser });
});

app.post('/api/admin-login', (req, res) => {
    if (!ADMIN_PASSWORD) return err(res, 'Not configured');
    ok(res, { success: req.body.password === ADMIN_PASSWORD });
});

app.get('/api/admin/stats', async (req, res) => {
    if (!supabase) return err(res, 'No database');
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
        ok(res, { success: true, totalUsers: users || 0, totalLeads: leads || 0, totalRevenue: '0', totalProfit: '0', totalCJCost: '0', totalOrders: 0, trafficSources: { Direct: '40%', Google: '35%', Social: '15%', Other: '10%' }, statusCounts: { Active: users || 0, New: leads || 0 } });
    } catch (e) { err(res, e.message); }
});

// ============================================================
// 25 FREE AI TOOLS - Professional Prompts
// ============================================================

// 1. Website Builder
app.post('/api/tool/website-builder', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Prompt required');
    const code = await askAI(`You are a senior full-stack web developer with 15 years of experience. Create a complete, production-ready single-page website.

TOPIC: "${input}"

REQUIREMENTS:
- Sticky navigation bar with logo placeholder text "PilotStaff", and links: Home, Tools, Pricing, About
- Hero section: Large heading with gradient background (blue-500 to blue-600), subheading, and a prominent CTA button "Get Started Free"
- Features section: 6 feature cards in a 3-column grid with icons (🚀, 📊, 🛠️, 📈, 🤖, 🎯). Each card needs title, description, and a small icon
- How It Works: 3-step process section with numbered circles (1. Search 2. Compare 3. Save) with connecting lines between them
- Testimonials: 3 testimonial cards with fake names (Sarah Chen, Mike Johnson, Priya Sharma) with 5-star ratings, text, and avatar placeholder images
- Pricing table: 3 plans (Free, Pro, Enterprise) with feature comparison checkmarks and "Most Popular" badge on Pro
- Footer with links: About, Privacy, Terms, FAQ, Contact
- Modern design: Rounded corners, subtle shadows, proper spacing, hover effects, smooth scroll behavior
- Use system-ui font family, 16px base size
- Colors: Primary blue-600, text slate-900, bg white, bg-slate-100 for alternating sections
- Include CSS animations for hover effects
- Make it look like a $5000 landing page, not a basic HTML page
- OUTPUT ONLY valid HTML. Inline CSS only. No markdown. No code blocks. No explanation.`);

    if (code) ok(res, { success: true, code }); else err(res, 'AI failed');
});

// 2. Blog Writer
app.post('/api/tool/blog-writer-free', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const article = await askAI(`You are a senior SEO content strategist with 15 years of experience. Write a comprehensive, SEO-optimized blog article.

TOPIC: "${input}"

REQUIREMENTS:
- Word count: 1500-2000 words minimum
- H1 title: Include primary keyword near the start, under 60 characters, compelling
- First 155 characters must be a compelling meta description (Google shows this in search results)
- Include primary keyword naturally in first paragraph
- Use LSI keywords naturally throughout the article (related phrases like "best [topic] in [year]" etc.)
- H2 subheadings: 5-6 sections, each with a secondary keyword variation
- Short paragraphs (3-4 sentences max) for readability
- Include 2-3 bullet point lists in the article
- Include 1 internal link using: <a href="https://affiliatepilotfrontend.vercel.app/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">free AI blog writer</a>
- Include 1 internal link using: <a href="https://affiliatepilotfrontend.vercel.app/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
- Conclusion: Summarize key points and include the primary keyword once more
- OUTPUT ONLY clean HTML. No <html>, <body>, <head> tags. No markdown. No code blocks.`);

    if (article) ok(res, { success: true, article }); else err(res, 'AI failed');
});

// 3. Image Generator
app.post('/api/tool/image-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Prompt required');
    const seed = Math.floor(Math.random() * 999999);
    ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}` });
});

// 4. Logo Maker (uses image generator with logo-specific prompt)
app.post('/api/tool/logo-maker', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const seed = Math.floor(Math.random() * 999999);
    const logoPrompts = [
        `minimal flat icon logo for "${input}", clean minimalist vector logo, white background, no text, single color`,
        `gradient badge logo for "${input}", modern gradient badge logo, text "${input}", rounded rectangle with gradient background`,
        `lettermark monogram of "${input}" in serif font, luxury feel, elegant`,
        `icon + text logo for "${input}", professional icon next to text "${input}", modern clean`,
        `emblem logo for "${input}", shield shape with text inside, bold professional`
    ];
    const selectedPrompt = logoPrompts[Math.floor(Math.random() * logoPrompts.length)];
    ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(selectedPrompt)}?width=1024&height=1024&nologo=true&seed=${seed}` });
});

// 5. Business Name Generator
app.post('/api/tool/business-name-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Generate 20 creative business name ideas for: "${input}".

For each name include:
- The business name (creative, memorable, easy to pronounce)
- A short tagline describing the business
- Suggested domain name (make it short, no numbers or hyphens at start/end)

OUTPUT STRICT JSON: {"names": ["Name1 - Tagline here", "Name2 - Tagline here", ...]} No markdown. No code blocks.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed to generate'); }
});

// 6. Meta Tag Generator
app.post('/api/tool/meta-tag-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Generate SEO meta tags for: "${input}".

RULES:
- Title: Under 60 characters, include primary keyword near start, power word at start (Best, Top, Ultimate, Free, How to, etc.)
- Description: Under 155 characters, include primary keyword naturally, end with CTA
- Keywords: 8-10 relevant keywords including primary + LSI keywords
- OG Title: Slightly different from meta title, still include keyword
- OG Description: Different from meta description, add emotional hook
- OUTPUT STRICT JSON: {"title": "...", "description": "...", "keywords": ["kw1","kw2",...], "og_title": "...", "og_description": "..."} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 7. Privacy Policy
app.post('/api/privacy-policy-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const html = await askAI(`Write a complete Privacy Policy for: ${input}

Include ALL these sections with professional legal language:
1. Information We Collect (specify: email, name, usage data, device info, cookies, analytics)
2. How We Use Your Information (explain each use case clearly)
3. Cookies & Tracking (session cookies, analytics cookies, pixel tags)
4. Third-Party Services (Google Analytics, payment processor, etc. - list the actual services)
5. Data Security (encryption, storage, access controls)
6. Data Sharing (who, why, legal basis)
7. Your Rights (access, delete, export, portability)
8. Changes to This Policy (how users get notified)
9. Contact Information (email, address)
10. Effective Date

Use H2 for each section. Professional legal tone. Complete HTML only. No html/body/head. No markdown.`);

    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

// 8. Terms Generator
app.post('/api/terms-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const html = await askAI(`Write complete Terms of Service for: ${input}

Include ALL these sections with professional legal language:
1. Acceptance of Terms (binding agreement)
2. Description of Services (what you offer)
3. User Responsibilities (acceptable/use restrictions)
4. Payment Terms (pricing, billing cycle, refunds)
5. Intellectual Property (content ownership, licensing)
6. Limitation of Liability (disclaimers, caps)
7. Termination (conditions, process, post-termination data)
8. Governing Law (jurisdiction, applicable law)
9. Dispute Resolution (arbitration, mediation, courts)
10. Contact Information (email, address)

Use H2 for each section. Professional legal tone. Complete HTML only. No html/body/head. No markdown.`);

    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

// 9. Resume Builder
app.post('/api/tool/resume-builder', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Details required');
    const html = await askAI(`Create a professional ATS-friendly resume for: ${input}

REQUIREMENTS:
- Header: Full name, professional email, phone number, location
- Professional Summary: 2-3 sentences highlighting key achievements and target role
- Work Experience: 3-5 bullet points per job with: company, role, dates, metrics/results
- Skills: Organized by category (Technical, Soft Skills, Tools)
- Education: Degree, institution, year
- Certifications: Name, issuing org, year
- Use clean inline CSS. Light gray background, dark text. Proper spacing.
- OUTPUT HTML only. No html/body/head. No markdown.`);

    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

// 10. Paragraph Rewriter
app.post('/api/tool/paragraph-rewriter', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Text required');
    const result = await askAI(`Rewrite this paragraph keeping the exact same meaning but with:
- Better vocabulary and professional tone
- Improved flow and readability
- Same facts and data points preserved
- Natural, non-robotic writing style
- No markdown. Output ONLY the rewritten paragraph, nothing else.`);

    if (result) ok(res, { success: true, text: result }); else err(res, 'Failed');
});

// 11. Ad Copy Generator
app.post('/api/tool/ad-copy-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Product details required');
    const result = await askAI(`Generate 5 high-converting ad copies using AIDA framework for: "${input}"

Each ad should have:
- Headline with a hook (question, number, how-to, comparison, emotional trigger)
- Body with benefit, feature, and CTA
- Different tones: urgent/fear-based, curiosity-driven, benefit-focused, social-proof-based
- 2 ads for Facebook (short, engaging, emoji-rich), 2 for Google (search-focused), 1 for Instagram (visual/lifestyle)
- Each ad 2-3 lines max
- OUTPUT STRICT JSON: {"copy": ["Ad 1 here", "Ad 2 here", "Ad 3 here", "Ad 4 here", "Ad 5 here"]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 12. Email Writer
app.post('/api/tool/email-writer', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Context required');
    const result = await askAI(`Write 4 professional emails for: "${input}"

Each email should have:
- Subject line (compelling, curiosity-driven, no clickbait)
- Body: 2-3 paragraphs, professional tone, clear CTA
- Type 1: Cold Outreach (introduction + value prop + CTA)
- Type 2: Follow-Up (reminder + next steps + CTA)
- Type 3: Newsletter (value summary + link + CTA)
- OUTPUT STRICT JSON: {"emails": ["Subject: ...\n\nBody here", "Subject: ...\n\nBody here", "Subject: ...\n\nBody here"]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 13. Hashtag Generator
app.post('/api/tool/hashtag-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Generate 1 engaging Instagram/TikTok caption and 20 viral hashtags for: "${input}"

REQUIREMENTS:
- Caption: First line hook (question, bold statement, creates curiosity)
- Hashtags: Mix of popular + niche + trending + seasonal hashtags
- Include branded hashtag
- Hashtag format: #word or #word1#word2
- 20 hashtags total
- OUTPUT STRICT JSON: {"caption": "Caption here", "hashtags": ["#tag1", "#tag2", ...]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 14. YouTube SEO
app.post('/api/tool/youtube-seo', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Topic required');
    const result = await askAI(`Generate 5 viral YouTube title formulas and 10 SEO tags for: "${input}"

TITLE FORMULAS:
- Number + "How to" + topic
- Number + "Topic" + year
- "Topic" + "for" + target audience
- "How to" + verb + topic + "like a pro"
- "Why" + question hook
- Comparison: "Topic vs Alternative"

TAGS: Include 10 SEO tags mixing short-tail and long-tail keywords

OUTPUT STRICT JSON: {"titles": ["Title 1", "Title 2", ...], "tags": ["tag1", "tag2", ...]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 15. Invoice Generator
app.post('/api/tool/invoice-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Details required');
    const html = await askAI(`Create a professional invoice in HTML for: "${input}"

Include:
- Company header: "INVOICE" in bold + company name
- Invoice number: INV-${Math.floor(Math.random()*9000)+1000)}
- Date: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
- Bill To: extracted from input (name, address, email)
- Table: Header row (Description, Hours, Rate, Amount) + data rows
- Subtotal, Tax (10%), Total
- Payment terms: "Due within 30 days"
- Footer: "Thank you for your business!" + company name
- Use inline CSS: Light gray bg, dark text, proper table borders, clean sans-serif font
- OUTPUT HTML only. No html/body/head. No markdown.`);

    if (html) ok(res, { success: true, article: html }); else err(res, 'Failed');
});

// 16. Social Bio Generator
app.post('/api/tool/social-bio-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const result = await askAI(`Generate 4 social media bios for: "${input}"

Each bio should:
- Platform-specific length limits (Instagram 150 chars, Twitter/X 160 chars, LinkedIn 220 chars, TikTok 150 chars)
- Include 1-2 relevant emojis
- End with a call-to-action (link, follow, link in bio)
- Professional but friendly tone
- OUTPUT STRICT JSON: {"platforms": [{"platform": "Instagram", "bio": "..."}, {"platform": "Twitter", "bio": "..."}, {"platform": "LinkedIn", "bio": "..."}, {"platform": "TikTok", "bio": "..."}]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 17. Product Description
app.post('/api/tool/product-description', async (req, res) => { 
    const input = sanitize(req.body.topic || req.body.prompt); 
    if (!input) return err(res, 'Product details required'); 
    const result = await askAI(`Write 3 e-commerce product descriptions for: "${input}"

Each description should have:
- Headline: Benefit-focused with emotional hook
- Body paragraph 1: Problem statement + solution
- Body paragraph 2: Features list (bullet points with icons)
- Body paragraph 3: Social proof + urgency element + CTA button
- Include 2-3 SEO keywords naturally
- OUTPUT STRICT JSON: {"descriptions": [{"headline": "...", "body": "...", "features": ["...", ...}, {"headline": "...", "body": "...", ...}, {"headline": "...", "body": "...", ...}]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch(e) { err(res, 'Failed'); } 
});

// 18. Startup Ideas
app.post('/api/tool/startup-ideas', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Industry required');
    const result = await askAI(`Generate 5 detailed startup ideas for: "${input}"

Each idea must include:
- Name: Creative, memorable business name
- Problem: What specific pain point does it solve?
- Market: Who exactly needs this? (be specific: "Indian SaaS founders aged 22-35", not just "businesses")
- Revenue model: How does it make money? (freemium + premium, subscription, one-time, etc.)
- Startup cost: Estimated initial investment needed
- First 3 steps to launch
- OUTPUT STRICT JSON: {"ideas": [{"name": "...", "problem": "...", "market": "...", "revenue": "...", "cost": "...", "steps": ["1.", "2.", "3."]}]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 19. Content Repurposer
app.post('/api/tool/content-repurposer', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Content required');
    const result = await askAI(`Repurpose this content into 5 different formats for: "${input}"

REQUIREMENTS for each format:
- Twitter/X Thread: Hook + 3-5 tweets in a thread, conversational tone, with hashtags
- LinkedIn Post: Professional, insightful, 1300 chars max, with hashtags
- Email Newsletter: Subject line + body, professional, value-driven
- Instagram Caption: Short, engaging, emoji-rich, with CTA
- YouTube Hook: Hook line (first 40 chars only) to grab attention
- OUTPUT STRICT JSON: {"formats": [{"type": "Twitter Thread", "content": "..."}, {"type": "LinkedIn Post", "content": "..."}, {"type": "Newsletter", "content": "..."}, {"type": "Instagram Caption", "content": "..."}, {"type": "YouTube Hook", "content": "..."}]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 20. Website Auditor
app.post('/api/tool/website-auditor', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const result = await askAI(`As a senior SEO auditor, audit this website: "${input}"

Provide a detailed audit with these sections:

🔍 TECHNICAL SEO (Priority: CRITICAL)
- Page speed score (check: <3s, needs improvement: >3.5s)
- Mobile responsiveness (check viewport meta tag, CSS media queries)
- HTTPS/SSL (check if SSL is valid and up to date)
- Robots.txt (check if it exists and is not blocking important pages)
- Canonical tags (check if properly set)
- Structured data (check for JSON-LD)
- Image optimization (check lazy loading, WebP, proper sizes)

📝 CONTENT QUALITY (Priority: HIGH)
- H1 tag present and only one
- Title tag present and optimized
- Meta description present and 155-160 chars
- First 100 words have primary keyword
- Internal links present
- Heading hierarchy (H1→H2→H3)
- Paragraph length appropriate (3-4 sentences)
- Images have alt tags
- No keyword stuffing

🔍 ON-PAGE SEO (Priority: MEDIUM)
- URL structure (clean, readable, hyphens not underscores)
- Open Graph tags present
- Twitter card tags present
- Canonical URL set correctly

🔍 OFF-PAGE SEO (Priority: LOW)
- Too many H1 tags
- Missing alt tags on images
- Broken internal links
- Duplicate meta descriptions
- No schema markup
- Slow page speed

For each issue provide:
- ❌ Current Status: [what it is now]
- ✅ Fix: [specific action to fix]
- Priority: [CRITICAL/HIGH/MEDIUM/LOW]

OUTPUT: Clean, well-structured text with sections. No markdown. No code blocks.`);

    if (result) ok(res, { success: true, text: result }); else err(res, 'Failed');
});

// ====== NEW TOOLS (21-25) =====

// 21. Landing Page Copywriter
app.post('/api/tool/landing-page-copywriter', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const result = await askAI(`Write high-converting landing page copy using AIDA framework for: "${input}"

REQUIREMENTS:
- Headline: Attention-grabbing (question, number, how-to, comparison, emotional)
- Subhead: Interest-building (benefit, feature, urgency)
- Body: 3 paragraphs (problem → solution → CTA)
- CTA: Clear, action-oriented (Get Started, Try Free, Start Free Trial)
- Include urgency element (limited time offer, limited spots, exclusive access)
- 3 variations: urgency-focused, benefit-focused, social-proof-based
- OUTPUT STRICT JSON: {"copy": ["Variation 1...", "Variation 2...", "Variation 3..."]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 22. Competitor Analyzer
app.post('/api/competitor-analyzer', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'URL or description required');
    const result = await askAI(`Perform a detailed competitor analysis for: "${input}"

Analyze and report:

🔍 KEYWORD GAPS: What keywords is the competitor ranking for that you're missing?
📝 CONTENT GAPS: What topics/content is the competitor covering that you're not?
🔗 BACKLINK GAPS: What sites link to this competitor that don't link to you?
📊 TRAFFIC SOURCES: Where is their traffic coming from?
📈 TECHNICAL SEO ISSUES: Site speed, mobile responsiveness, SSL, structured data
💰 MONETIZATION: How are they monetizing? What's their pricing model?
🎯 YOUR EDGE: What unique angle can you target that they're missing?

Provide specific, actionable recommendations. Each with priority level: CRITICAL / HIGH / MEDIUM / LOW

OUTPUT: Clean, well-structured text with sections. No markdown. No code blocks.`);

    if (result) ok(res, { success: true, text: result }); else err(res, 'Failed');
});

// 23. Schema Generator
app.post('/api/tool/schema-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Description required');
    const result = await askAI(`Generate proper JSON-LD structured data for: "${input}"

Generate 4 JSON-LD schemas:
1. Article schema (BlogPosting) - for blog posts with title, datePublished, author
2. Product schema (Product) - for e-commerce product pages
3. FAQ schema (FAQPage) - for pages with Q&A sections
4. Organization schema (Organization) - for company info

Each must have:
- @context set to "https://schema.org"
- Proper @type
- All required fields filled
- Valid JSON-LD syntax
- No markdown formatting in strings

OUTPUT STRICT JSON: {"schemas": [{"@context":"https://schema.org","@type":"BlogPosting","@type":"Article","name":"...","headline":"...","datePublished":"...","author":{"@type":"Person","name":"..."}},{"@context":"https://schema.org","@type":"Product","@type":"Product","name":"...","description":"...","offers":..."}},{"@context":"https://schema.org","@type":"FAQPage","@type":"FAQPage","mainEntity":{"@type":"Question","name":"...","acceptedAnswer":{"@type":"Answer","text":"..."}},{"@context":"https://schema.org","@type":"Organization","name":"...","url":"..."}]}]}

No markdown. Output ONLY valid JSON-LD.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 24. Content Calendar
app.post('/api/tool/content-calendar', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Niche required');
    const result = await askAI(`Create a 30-day content calendar for: "${input}"

REQUIREMENTS:
- 30 days of content
- Each day: specific topic, primary keyword, secondary keyword, content type (blog/social/thread/email), target platform
- First 7 days: Awareness content (top-of-funnel content)
- Days 8-21: Consideration content (mid-funnel)
- Days 22-30: Conversion content (bottom-funnel)
- Sort by priority: Day 1 = highest priority
- Include platform labels: [Blog], [Instagram], [Twitter], [Email]
- OUTPUT STRICT JSON: {"calendar": [{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"..."},{"day":2",...},{"day":3",...},{"day":4",...},...}]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// 25. Review Response Generator
app.post('/api/tool/review-response-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return err(res, 'Review details required');
    const result = await askAI(`Write a professional, on-brand review response for: "${input}"

REQUIREMENTS:
- If 5-star review: Express genuine gratitude, mention specific feature, build trust
- If 4-star review: Acknowledge concern, offer solution, show improvement
- If 3-star review: Apologize, ask for feedback, offer to make it right
- If 2-star review: Serious concern → escalate to support
- If 1-star review: Polite but firm response
- Include contact info or link to support page
- Tone: Empathetic, professional, on-brand
- 3 different variations
- OUTPUT STRICT JSON: {"responses": [{"stars": 5, "response": "..."}, {"stars": 4, "response": "..."}, {"stars": 3, "response": "..."}, {"stars": 2, "response": "..."}]} No markdown.`);

    try { ok(res, { success: true, data: JSON.parse(result) }); } catch (e) { err(res, 'Failed'); }
});

// ===== SOCIAL MANAGER =====
app.post('/api/tool/social-manager', async (req, res) => {
    const { niche, count = 5 } = req.body;
    const input = sanitize(niche);
    if (!input) return err(res, 'Niche required');
    const result = await askAI(`Generate ${count} viral tweets about: "${input}"
OUTPUT STRICT JSON array: ["tweet1","tweet2","tweet3","tweet4","tweet5"] No markdown.`);
    try { let tweets = JSON.parse(result); if (!Array.isArray(tweets)) tweets = [tweets]; ok(res, { success: true, tweets }); }
    catch (e) { ok(res, { success: true, tweets: [`Just discovered ${input}! 🤯 #Trending #AI`, `${input} is changing the game! 🚀`, `Stop sleeping on ${input}! 🔥 #viral`, `POV: You understand ${input} 💡 #Smart`, `${input} tip nobody talks about 🤫 #Secret`]); } });
});

// ===== BLOG AGENT =====
app.post('/api/seo-blog-agent', async (req, res) => {
    const { topic, blogId, userBloggerToken } = req.body;
    if (!topic || !blogId) return err(res, 'Topic and Blog ID required');
    const ct = sanitize(topic), cb = sanitize(blogId);
    const img1 = `https://image.pollinations.ai/prompt/${encodeURIComponent(ct + ' professional banner modern clean')}?width=1200&height=630&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
    const img2 = `https://image.pollinations.ai/prompt/${encodeURIComponent(ct + ' infographic illustration')}?width=800&height=500&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
    const img3 = `https://image.pollinations.ai/prompt/${encodeURIComponent(ct + ' concept art professional')}?width=800&height=500&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
    const blogHTML = await askAI(`You are an expert SEO content strategist with 15 years experience. Write a 1500+ word SEO blog post about: "${ct}"

REQUIREMENTS:
- H1 Title: Include primary keyword near start, under 60 chars, compelling
- First 155 chars = meta description (Google shows this in search results)
- Primary keyword in first paragraph naturally
- 5-6 H2 subheadings with secondary keyword variations
- Short paragraphs (3-4 sentences max)
- 2-3 bullet point sections
- 3 images placed naturally: after intro, middle, before conclusion
- Internal links: 
  - <a href="https://affiliatepilotfrontend.vercel.app/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">free AI blog writer</a>
  - <a href="https://affiliatepilotfrontend.vercel.app/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
- CTA block at end with gradient background linking to homepage
- Labels: [niche, "AI Generated", "Guide", "2025", "PilotStaff"]
- OUTPUT HTML only. No html/body/head. No markdown. No code blocks.`);

    if (!blogHTML) return err(res, 'AI failed');
    try {
        const titleMatch = blogHTML.match(/<h1[^>]*>(.*?)<\/h1>/i);
        const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').substring(0, 100) : `${ct} - Complete Guide (${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})`;
        const token = await getBloggerToken(userBloggerToken);
        if (!token) return err(res, 'Blogger auth failed');
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cb}/posts/`, {
            kind: 'blogger#post', title: postTitle, content: blogHTML, labels: [ct, 'AI Generated', 'Guide', '2025', 'PilotStaff']
        }, { headers: { Authorization: `Bearer ${token}` } });
        pingIndexNow(`https://${cb}.blogspot.com`);
        await sendTelegram(`📝 <b>SEO Blog Published!</b>\n📐 ${postTitle.substring(0, 80)}\n🔗 https://${cb}.blogspot.com\n🏷️ Tags: ${ct}, AI Tools, Guide, 2025`, true);
        ok(res, { success: true, message: `Published: "${postTitle.substring(0, 60)}..."` });
    } catch (e) { err(res, e.message); }
});

// ===== CRON JOBS =====
cron.schedule('0 4 * * *', async () => {
    if (!TELEGRAM_CHANNEL_ID || !BLOGGER_REFRESH_TOKEN || !BLOG_ID) return;
    const topics = ['20 Free AI Tools That Save 100+ Hours Weekly', 'How to Hire AI Employees in 2025', 'AI Website Builder vs Hiring a Developer', 'Free AI Blog Writer: 1500 Words in 10 Seconds', 'Best AI Logo Maker Without Design Skills', 'Meta Tag Generator: Rank #1 on Google', 'AI SEO Tools: Rank #1 on Google', 'Small Business Automation: 6 AI Agents Replace Entire Team', 'AI Image Generator: No Photoshop Needed', 'Start an AI Business with Zero Investment', 'AI Content Writing vs Human Writing in 2025'];
    const t = topics[Math.floor(Math.random() * topics.length)];
    try {
        await axios.post(`http://localhost:${process.env.PORT || 3000}/api/seo-blog-agent`, { topic: t, blogId: BLOG_ID });
        console.log('✅ Auto-blog:', t.substring(0, 40));
    } catch (e) { console.error('❌ Auto-blog:', e.message); }
});

cron.schedule('0 4 * * *', async () => {
    if (!TELEGRAM_CHANNEL_ID) return;
    const tip = await askAI('Give one short actionable business or marketing tip (1-2 sentences). Specific and practical.');
    if (tip) await sendTelegram(`💡 <b>Daily Tip</b>\n\n${tip}\n\n🤖 by PilotStaff\n🔗 ${WEBSITE_URL}\n\n#BusinessTips #AI #Marketing`);
});

cron.schedule('*/25 * * *', () => { console.log(`💓 ${new Date().toLocaleTimeString()}`); });

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotStaff API on ${PORT}`));
