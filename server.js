require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
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
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://affiliatepilot-frontend.vercel.app';

if (!SB_URL || !SB_KEY) console.warn('⚠️ Supabase not set');
if (!GROQ_KEY) console.warn('⚠️ GROQ_KEY not set');
if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) console.warn('⚠️ Blogger not set');

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
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 10000 });
    } catch (e) { console.error('TG Error:', e.message?.substring(0, 80)); }
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
    } catch (e) { console.error('AI Error:', e.message?.substring(0, 100)); return null; }
}

async function getBloggerToken(userToken) {
    const token = userToken || BLOGGER_REFRESH_TOKEN;
    if (!token || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) return null;
    try {
        const r = await axios.post('https://oauth2.googleapis.com/token', { client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET, refresh_token: token, grant_type: 'refresh_token' }, { timeout: 10000 });
        return r.data.access_token;
    } catch (e) { console.error('Blogger Auth Error:', e.message?.substring(0, 100)); return null; }
}

async function pingIndexNow(url) {
    try { await axios.post('https://api.indexnow.org/IndexNow', { host: new URL(url).hostname, key: 'pilotbotindexkey123', urlList: [url] }, { timeout: 5000 }); } catch (e) {}
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

// ===== BASIC ROUTES =====
app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));

app.get('/api/health', (req, res) => ok(res, {
    success: true, uptime: process.uptime(),
    services: { supabase: !!supabase, groq: !!GROQ_KEY, blogger: !!BLOGGER_REFRESH_TOKEN, telegram: !!TELEGRAM_BOT_TOKEN }
}));

app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return ok(res, { success: true, activeUsers: '0', totalTasks: '0' });
    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const fmt = n => !n ? '0' : n >= 1000 ? (n / 1000).toFixed(1) + 'K+' : n.toString();
        ok(res, { success: true, activeUsers: fmt(users), totalTasks: fmt((users || 0) * 7) });
    } catch (e) { ok(res, { success: true, activeUsers: '0', totalTasks: '0' }); }
});

app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) return err(res, 'Blogger not configured. Set BLOGGER_REFRESH_TOKEN and BLOG_ID in .env', 400);
    try {
        const token = await getBloggerToken();
        if (!token) return err(res, 'Blogger authentication failed. Check your BLOGGER_REFRESH_TOKEN', 401);
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
        const posts = (data.items || []).map(p => ({ id: p.id, title: p.title, url: p.url, published: p.published, image: p.images?.[0]?.url }));
        ok(res, { success: true, posts });
    } catch (e) { err(res, 'Failed to fetch posts: ' + e.message, 500); }
});

app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body; if (!message || !sessionId) return err(res, 'Missing data', 400);
    const cm = sanitizeStrict(message), cs = sanitizeStrict(sessionId).substring(0, 100);
    let memText = '';
    if (supabase) { try { const { data: mem } = await supabase.from('chat_memories').select('summary').eq('session_id', cs).single(); if (mem?.summary) memText = mem.summary; } catch(e){} }
    const result = await askAI(`You are PilotStaff AI assistant. Helpful, concise, professional. ${memText ? `Previous context: ${memText}\n` : ''}User: ${cm}\n\nRespond in HTML (<b>,<br>,<ul>,<li>). Under 200 words.`);
    if (!result) return err(res, 'AI failed', 503);
    ok(res, { success: true, reply: result });
});

app.post('/api/auth', async (req, res) => {
    if (!supabase) return err(res, 'DB not configured', 500);
    const { email } = req.body; if (!email) return err(res, 'Email required', 400);
    const { data: user } = await supabase.from('users').select('*').eq('email', sanitizeStrict(email)).single();
    if (user) return ok(res, { success: true, user });
    const { data: newUser, error } = await supabase.from('users').insert({ email: sanitizeStrict(email) }).select().single();
    if (error) return err(res, error.message, 400);
    ok(res, { success: true, user: newUser });
});

app.post('/api/admin-login', (req, res) => {
    if (!ADMIN_PASSWORD) return err(res, 'Not configured', 500);
    ok(res, { success: req.body.password === ADMIN_PASSWORD });
});

app.get('/api/admin/stats', async (req, res) => {
    if (!supabase) return err(res, 'No database', 500);
    const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
    ok(res, { success: true, totalUsers: users || 0, totalLeads: leads || 0 });
});

app.post('/api/paypal-webhook', async (req, res) => {
    const { orderID, plan, price, payerEmail } = req.body;
    console.log(`💰 Payment: ${orderID} | ${plan} | ${payerEmail}`);
    if (supabase && payerEmail) {
        try { await supabase.from('users').upsert({ email: payerEmail, plan, upgraded_at: new Date().toISOString() }, { onConflict: 'email' }); } catch(e){}
    }
    await sendTelegram(`💰 <b>New Sale!</b>\nPlan: ${plan}\nPrice: ${price}\nEmail: ${payerEmail}`, true);
    ok(res, { success: true });
});

// ===== 25 AI TOOLS (IMPROVED PROMPTS FOR PERFECT RESULTS) =====
const toolRoutes = [
    {
        path: 'website-builder',
        prompt: (t) => `You are an expert web developer. Create a COMPLETE, production-ready single-page website.

TOPIC: "${t}"

Build this EXACT structure with inline CSS only:
1. STICKY NAVBAR: Logo "PilotStaff" on left, links (Home, Features, Pricing, Contact) on right, CTA button "Get Started" in blue
2. HERO SECTION: Full-width gradient background (linear-gradient(135deg, #2563eb, #7c3aed)), large white heading, subheading in semi-transparent white, blue CTA button with white text, rounded corners
3. FEATURES SECTION: 6 cards in 3-column grid. Each card has icon emoji, bold title, description. Cards have white bg, subtle shadow, rounded corners, hover effect
4. HOW IT WORKS: 3 steps with numbered circles (1,2,3) connected by a horizontal line. Each step has title and description
5. TESTIMONIALS: 3 cards with fake names, star ratings (★★★★★), quote text, avatar placeholder (colored circle with initial)
6. PRICING TABLE: 3 columns (Basic $0, Pro $29, Enterprise $99). Pro column highlighted with blue border and "MOST POPULAR" badge. Checkmarks for features, X for missing
7. FAQ SECTION: 4-5 questions as accordion-style (just show them, no JS needed)
8. FOOTER: Dark background (#0f172a), white text, 4 columns of links, copyright line at bottom

CSS REQUIREMENTS:
- font-family: system-ui, sans-serif
- Max-width 1200px, centered
- Smooth hover transitions on all interactive elements
- Mobile responsive (use @media or flexbox wrapping)
- Clean spacing: sections have py-20 padding
- Colors: Primary #2563eb, Dark #0f172a, Light bg #f8fafc, Border #e2e8f0

OUTPUT ONLY VALID HTML. No markdown, no code blocks, no explanation. Start with <div> and end with </div>.`
    },
    {
        path: 'blog-writer-free',
        prompt: (t) => `You are a senior SEO content writer with 15 years experience. Write a comprehensive blog article.

TOPIC: "${t}"

STRUCTURE (follow exactly):
- H1: Compelling title with primary keyword near start (under 60 characters)
- First paragraph: 2-3 sentences introducing the topic. First 155 characters should work as meta description. Include primary keyword naturally.
- 5-6 H2 sections, each covering a subtopic. Use secondary keyword variations in H2 tags.
- Each H2 section: 2-3 short paragraphs (3-4 sentences max) + 1 bullet list (3-5 items)
- Include these internal links naturally in the text:
  * <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">free AI blog writer</a>
  * <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>
  * <a href="${WEBSITE_URL}/tools/ai-website-builder" style="color:#2563eb;font-weight:600;">AI website builder</a>
- CONCLUSION: H2 "Conclusion" that summarizes key points, includes primary keyword once more, and has a CTA sentence: "Try our <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a> to automate your workflow."

REQUIREMENTS:
- Minimum 1500 words
- Short paragraphs (3-4 sentences max) for readability
- Use LSI keywords naturally throughout
- Professional but conversational tone
- No fluff - every sentence adds value
- Use <strong> for important terms

OUTPUT ONLY CLEAN HTML. No <html>, <body>, <head> tags. No markdown. No code blocks. No explanation.`
    },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    {
        path: 'business-name-generator',
        prompt: (t) => `Generate 20 creative business name ideas for: "${t}"

For EACH name provide: "Name — Tagline | suggested-domain.com"

Requirements:
- Names should be catchy, memorable, easy to pronounce, max 3 words
- Taglines should be descriptive (5-8 words)
- Domains should be short, no numbers/hyphens at start or end
- Mix of styles: modern tech, playful, professional, descriptive
- No generic names like "BestSolution" or "ProService"

OUTPUT STRICT JSON: {"names": ["Name1 — Tagline | domain.com", "Name2 — Tagline | domain.com", ...]}
No markdown. No code blocks. No explanation.`
    },
    {
        path: 'meta-tag-generator',
        prompt: (t) => `Generate perfectly optimized SEO meta tags for: "${t}"

RULES:
- title: Under 60 characters, primary keyword at start, power word at beginning (Best/Top/Ultimate/Free/How to)
- description: Exactly 150-155 characters, primary keyword included, ends with CTA
- keywords: Exactly 10 relevant keywords (primary + 9 LSI/related)
- og_title: Different wording from meta title, still includes keyword, under 60 chars
- og_description: Different from meta description, emotional hook, under 155 chars

OUTPUT STRICT JSON: {"title":"...","description":"...","keywords":["kw1","kw2","kw3","kw4","kw5","kw6","kw7","kw8","kw9","kw10"],"og_title":"...","og_description":"..."}
No markdown. No code blocks.`
    },
    {
        path: 'privacy-policy-generator',
        prompt: (t) => `Write a complete, professional Privacy Policy for: ${t}

Include ALL 10 sections with H2 headings:
1. Information We Collect (email, name, usage data, device info, cookies, analytics data)
2. How We Use Your Information (each use case clearly explained)
3. Cookies & Tracking Technologies (session cookies, analytics cookies, pixel tags, how to manage)
4. Third-Party Services (list: Google Analytics, payment processors, email services)
5. Data Security Measures (TLS encryption, AES-256 at rest, access controls, regular audits)
6. Data Sharing Practices (who, why, legal basis)
7. Your Rights (access, delete, export, portability, how to exercise)
8. Children's Privacy (COPPA compliance if applicable)
9. Changes to This Policy (notification method, effective date)
10. Contact Information (email, address placeholder)

Professional legal tone. Complete HTML only with H2 tags. No html/body/head. No markdown.`
    },
    {
        path: 'terms-generator',
        prompt: (t) => `Write complete Terms of Service for: ${t}

Include ALL 10 sections with H2 headings:
1. Acceptance of Terms (binding agreement, last updated date)
2. Description of Services (what you offer, modifications right)
3. User Responsibilities (acceptable use, restrictions, account security)
4. Payment Terms (pricing, billing cycle, refund policy, late payments)
5. Intellectual Property (content ownership, licensing, user-generated content)
6. Limitation of Liability (disclaimers, damage caps, exclusions)
7. Indemnification (user responsibility for claims)
8. Termination (conditions, process, post-termination data handling)
9. Governing Law & Jurisdiction
10. Contact Information

Professional legal tone. Complete HTML only with H2 tags. No html/body/head. No markdown.`
    },
    {
        path: 'resume-builder',
        prompt: (t) => `Create a professional ATS-friendly resume for: ${t}

SECTIONS (in order):
1. HEADER: Full name (large, bold), professional email, phone, city/state, LinkedIn URL
2. PROFESSIONAL SUMMARY: 2-3 powerful sentences highlighting key achievements, years of experience, target role
3. WORK EXPERIENCE: For each job: Company name (bold), Job title, Date range, 4-5 bullet points starting with action verbs (Achieved, Led, Developed, Increased) with measurable results (%, $, numbers)
4. SKILLS: Organized in 2 columns - Technical Skills and Soft Skills
5. EDUCATION: Degree, Institution, Year, GPA if notable
6. CERTIFICATIONS: Name, Issuing Organization, Year

Inline CSS: Clean layout, light gray (#f8fafc) background, dark text, proper spacing, subtle borders between sections. Font: system-ui. No html/body/head. No markdown.`
    },
    {
        path: 'paragraph-rewriter',
        prompt: (t) => `Rewrite the following paragraph with these requirements:
- Same exact meaning, no facts changed or added
- More professional and polished vocabulary
- Better sentence flow and variety in sentence length
- Remove any redundancy or wordiness
- Maintain the original tone (formal stays formal, casual stays casual)
- Keep all numbers, names, and specific data points exactly as they are

PARAGRAPH:
"${t}"

OUTPUT ONLY the rewritten paragraph. No markdown. No explanation. No quotation marks.`
    },
    {
        path: 'ad-copy-generator',
        prompt: (t) => `Generate 5 high-converting ad copies for: "${t}"

FORMAT for each ad:
[Platform] Tone: [tone type]
Headline: [attention-grabbing]
Body: [2-3 lines with benefit + CTA]

Ad 1: [Facebook] Tone: Urgency/FOMO
Ad 2: [Facebook] Tone: Social proof
Ad 3: [Google Search] Tone: Benefit-focused
Ad 4: [Google Search] Tone: Question hook
Ad 5: [Instagram] Tone: Aspirational/lifestyle

OUTPUT STRICT JSON: {"copy": ["[Platform] Tone: ...\nHeadline: ...\nBody: ...", ...]}
No markdown. No code blocks.`
    },
    {
        path: 'email-writer',
        prompt: (t) => `Write 3 professional emails for: "${t}"

FORMAT for each:
Subject: [compelling, curiosity-driven, 6-10 words]
[blank line]
[Body: 2-3 paragraphs, professional tone, clear CTA at end]

Email 1: Cold Outreach (introduction + value proposition + CTA to meeting)
Email 2: Follow-Up (gentle reminder + additional value + CTA)
Email 3: Newsletter format (value summary + one link + CTA)

OUTPUT STRICT JSON: {"emails": ["Subject: ...\n\nBody...", "Subject: ...\n\nBody...", "Subject: ...\n\nBody..."]}
No markdown. No code blocks.`
    },
    {
        path: 'hashtag-generator',
        prompt: (t) => `Generate 1 Instagram/TikTok caption and 20 hashtags for: "${t}"

CAPTION RULES:
- First line: Hook (question, bold statement, or surprising fact)
- Second line: Value statement
- Third line: CTA with "Link in bio" or "Follow for more"
- Include 2-3 relevant emojis

HASHTAG RULES:
- Mix: 5 popular (1M+ posts), 10 niche (10K-1M posts), 5 trending/seasonal
- No banned or spam hashtags
- Include 1 branded hashtag #PilotStaff
- Format: #word (no spaces, no special characters except underscore)

OUTPUT STRICT JSON: {"caption":"...","hashtags":["#tag1","#tag2",...]}
No markdown. No code blocks.`
    },
    {
        path: 'youtube-seo',
        prompt: (t) => `Generate YouTube SEO metadata for: "${t}"

5 TITLES (each using a different formula):
1. Number + How-to: "How to [verb] [topic] in [year] ([number] ways)"
2. Number + Topic: "[Number] [topic] tips that actually work in [year]"
3. Target audience: "[Topic] for [audience] (beginner to advanced)"
4. Comparison: "[Topic A] vs [Topic B] - which is better in [year]?"
5. Why/Question: "Why [surprising claim about topic]? (the truth)"

10 TAGS: Mix of short-tail (2-3 words) and long-tail (5-8 words) keywords

OUTPUT STRICT JSON: {"titles":["...","...","...","...","..."],"tags":["...","...",...]}
No markdown. No code blocks.`
    },
    {
        path: 'invoice-generator',
        prompt: (t) => `Create a professional invoice in HTML for: "${t}"

LAYOUT (use inline CSS, clean professional design):
- TOP: Company header with "INVOICE" in large bold text, invoice number INV-${Math.floor(Math.random()*9000)+1000}, date: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}
- BILL TO SECTION: Name, address, email (extract from input or use placeholders)
- TABLE: Header row (Description | Hours | Rate | Amount) with light blue background, data rows with alternating white/light gray
- TOTALS SECTION: Right-aligned - Subtotal, Tax (10%), Total (bold, larger)
- PAYMENT TERMS: "Payment due within 30 days of invoice date"
- FOOTER: "Thank you for your business!" centered, company name

CSS: Clean sans-serif font, proper borders on table, adequate padding, professional color scheme (dark text, blue accents). No html/body/head. No markdown.`
    },
    {
        path: 'social-bio-generator',
        prompt: (t) => `Generate platform-specific social media bios for: "${t}"

RULES for each:
- Instagram: Max 150 chars, 1-2 emojis, end with CTA, line breaks allowed
- Twitter/X: Max 160 chars, 1 emoji, concise, include relevant hashtag
- LinkedIn: Max 220 chars, professional tone, no emojis, include expertise keywords
- TikTok: Max 150 chars, 1-2 emojis, casual/
