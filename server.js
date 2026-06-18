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
- TikTok: Max 150 chars, 1-2 emojis, casual/fun tone, trending style

Each bio should be different (not just shortened versions of each other).

OUTPUT STRICT JSON: {"platforms":[{"platform":"Instagram","bio":"..."},{"platform":"Twitter","bio":"..."},{"platform":"LinkedIn","bio":"..."},{"platform":"TikTok","bio":"..."}]}
No markdown. No code blocks.`
    },
    {
        path: 'product-description',
        prompt: (t) => `Write 3 e-commerce product descriptions for: "${t}"

For EACH description provide:
- headline: Benefit-focused with emotional hook (under 10 words)
- body: Problem paragraph + solution paragraph + bullet features list (5 items with ✓) + urgency line + CTA
- Include 2-3 SEO keywords naturally in each description
- Different angles: Description 1 = value/price focused, Description 2 = quality/premium focused, Description 3 = convenience/time-saving focused

OUTPUT STRICT JSON: {"descriptions":[{"headline":"...","body":"..."},{"headline":"...","body":"..."},{"headline":"...","body":"..."}]}
No markdown. No code blocks.`
    },
    {
        path: 'startup-ideas',
        prompt: (t) => `Generate 5 detailed startup ideas for: "${t}"

For EACH idea provide exactly these fields:
- name: Creative, memorable, 1-2 words
- problem: Specific pain point (2 sentences)
- market: Specific target customer (not "everyone" - be specific like "Indian SaaS founders aged 25-35")
- revenue: Exact monetization model with pricing
- cost: Estimated startup cost in USD with breakdown
- steps: Exactly 3 actionable first steps (numbered)

OUTPUT STRICT JSON: {"ideas":[{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["1. ...","2. ...","3. ..."]},{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["1. ...","2. ...","3. ..."]}]}
No markdown. No code blocks.`
    },
    {
        path: 'content-repurposer',
        prompt: (t) => `Repurpose this content into 5 different formats: "${t}"

FORMAT 1 - Twitter/X Thread:
Tweet 1: Hook (standalone, creates curiosity)
Tweet 2: Key point 1
Tweet 3: Key point 2
Tweet 4: Key point 3
Tweet 5: Summary + CTA + hashtags

FORMAT 2 - LinkedIn Post:
Professional tone, 1200 chars max, personal experience angle, question at end, 3 hashtags

FORMAT 3 - Email Newsletter:
Subject line (6-8 words, curiosity-driven)
Body: Opening hook + 3 key takeaways + CTA link

FORMAT 4 - Instagram Caption:
Hook first line + value + emoji-rich + CTA + 10 hashtags

FORMAT 5 - YouTube Hook:
First 5 seconds script (under 50 chars) to stop scroll

OUTPUT STRICT JSON: {"formats":[{"type":"Twitter Thread","content":"Tweet 1:\\nTweet 2:\\n..."},{"type":"LinkedIn Post","content":"..."},{"type":"Newsletter","content":"Subject: ...\\n\\nBody..."},{"type":"Instagram Caption","content":"..."},{"type":"YouTube Hook","content":"..."}]}
No markdown. No code blocks.`
    },
    {
        path: 'website-auditor',
        prompt: (t) => `Perform a detailed SEO audit for: "${t}"

Organize into 4 sections with clear headers:

TECHNICAL SEO (Priority: CRITICAL)
- Page Speed: Check estimate and recommendation
- Mobile Responsiveness: Status and fixes
- HTTPS/SSL: Status check
- Robots.txt: Status and recommendation
- Canonical Tags: Status and recommendation
- Structured Data: Status and recommendation
- Image Optimization: Status and recommendation

CONTENT QUALITY (Priority: HIGH)
- H1 Tag: Status
- Title Tag: Status and optimization
- Meta Description: Status and optimization
- Keyword Usage: Assessment
- Internal Linking: Assessment
- Heading Hierarchy: Assessment
- Content Length: Assessment
- Image Alt Tags: Assessment

ON-PAGE SEO (Priority: MEDIUM)
- URL Structure: Assessment
- Open Graph Tags: Status
- Twitter Cards: Status

OFF-PAGE SEO (Priority: LOW)
- Backlink Profile: General assessment
- Social Signals: Assessment

For each issue use this format:
❌ Issue: [description]
✅ Fix: [specific action]
⚡ Priority: [CRITICAL/HIGH/MEDIUM/LOW]

OUTPUT CLEAN TEXT ONLY. No markdown. No code blocks. No # symbols for headers.`
    },
    {
        path: 'landing-page-copywriter',
        prompt: (t) => `Write 3 landing page copy variations for: "${t}"

EACH variation needs:
- HEADLINE: Large, bold, attention-grabbing (under 12 words)
- SUBHEADLINE: Supporting benefit statement (under 20 words)
- BODY: 3 short paragraphs (problem → solution → CTA)
- CTA BUTTON TEXT: Action-oriented (under 6 words)

Variation 1: URGENCY-focused (limited time, scarcity, FOMO)
Variation 2: BENEFIT-focused (specific outcomes, ROI, time saved)
Variation 3: SOCIAL PROOF-focused (numbers, testimonials, trust indicators)

OUTPUT STRICT JSON: {"copy":["HEADLINE: ...\\nSUBHEADLINE: ...\\n\\nBody paragraph 1\\n\\nBody paragraph 2\\n\\nBody paragraph 3\\n\\n[CTA BUTTON TEXT]","HEADLINE: ...\\n...","HEADLINE: ...\\n..."]}
No markdown. No code blocks.`
    },
    {
        path: 'competitor-analyzer',
        prompt: (t) => `Perform a detailed competitor analysis for: "${t}"

Provide analysis in these sections:

KEYWORD GAPS
(List 5-8 keywords they rank for that you should target)

CONTENT GAPS
(List 5-8 topics they cover that you're missing)

BACKLINK OPPORTUNITIES
(List 5 types of sites that link to them that you could approach)

TRAFFIC SOURCES
(Estimate breakdown: Organic, Social, Direct, Referral, Paid)

MONETIZATION ANALYSIS
(How they make money: ads, subscription, affiliate, products, services)

TECHNICAL ANALYSIS
(Site speed estimate, mobile optimization, tech stack if visible)

YOUR COMPETITIVE ADVANTAGE
(3 specific angles you can target that they're missing or doing poorly)

For each item be specific, not generic. OUTPUT CLEAN TEXT ONLY. No markdown. No code blocks.`
    },
    {
        path: 'schema-generator',
        prompt: (t) => `Generate 4 JSON-LD structured data schemas for: "${t}"

Schema 1 - Article (BlogPosting):
@type: BlogPosting, name, headline (different from name), datePublished (today), author (Person with name), publisher (Organization), description

Schema 2 - Product:
@type: Product, name, description, brand, offers (Offer with price, priceCurrency, availability)

Schema 3 - FAQPage:
@type: FAQPage, mainEntity array with 3 FAQ items, each with Question (name) and Answer (acceptedAnswer with text)

Schema 4 - Organization:
@type: Organization, name, url, logo, sameAs, contactPoint

ALL schemas must have @context: "https://schema.org"
ALL values must be filled (no empty strings, no null)
Valid JSON-LD syntax only.

OUTPUT STRICT JSON: {"schemas":[{"@context":"https://schema.org","@type":"BlogPosting",...},{"@context":"https://schema.org","@type":"Product",...},{"@context":"https://schema.org","@type":"FAQPage",...},{"@context":"https://schema.org","@type":"Organization",...}]}
No markdown. No code blocks.`
    },
    {
        path: 'content-calendar',
        prompt: (t) => `Create a 30-day content calendar for: "${t}"

RULES:
- Days 1-7: AWARENESS content (top-of-funnel, educational, entertaining)
- Days 8-15: ENGAGEMENT content (polls, questions, stories, behind-the-scenes)
- Days 16-22: CONSIDERATION content (comparison, case study, how-to, demo)
- Days 23-30: CONVERSION content (offer, testimonial, urgency, FAQ)

Each day needs: day (number), topic (specific, not generic), keyword (primary SEO keyword), type (Blog/Instagram/Twitter/LinkedIn/Email/YouTube), platform (specific platform name), funnel_stage (Awareness/Engagement/Consideration/Conversion)

OUTPUT STRICT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"Website","funnel_stage":"Awareness"},{"day":2,"topic":"...","keyword":"...","type":"Instagram","platform":"Instagram","funnel_stage":"Awareness"},{"day":3,...}]}
Exactly 30 days. No markdown. No code blocks.`
    },
    {
        path: 'review-response-generator',
        prompt: (t) => `Write professional review responses for: "${t}"

Generate responses for star ratings 5, 4, 3, 2, and 1:

5-STAR: Express genuine gratitude, mention specific feature/aspect, invite to share with friends
4-STAR: Thank them, acknowledge the minor concern, explain how you're improving it
3-STAR: Apologize for mixed experience, ask for specific feedback, offer direct contact
2-STAR: Take seriously, apologize, offer immediate resolution, provide contact method
1-STAR: Polite but firm, acknowledge frustration, offer escalation path, keep it brief

Each response: 2-4 sentences, professional tone, on-brand, no defensive language.

OUTPUT STRICT JSON: {"responses":[{"stars":5,"response":"..."},{"stars":4,"response":"..."},{"stars":3,"response":"..."},{"stars":2,"response":"..."},{"stars":1,"response":"..."}]}
No markdown. No code blocks.`
    },
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
            const prompts = [
                `minimal flat vector logo for "${input}", white background, no text, single color, clean design`,
                `modern gradient badge logo for "${input}", rounded rectangle, text "${input}", blue purple gradient`,
                `luxury monogram logo of "${input}", serif font, gold on dark background, elegant`,
                `icon plus text logo for "${input}", professional, modern, clean lines, blue color`
            ];
            return ok(res, { success: true, imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompts[Math.floor(Math.random() * prompts.length)])}?width=1024&height=1024&nologo=true&seed=${seed}` });
        }

        const result = await askAI(route.prompt(input));
        if (!result) return err(res, 'AI generation failed. Please try again.', 503);

        try {
            if (result.trim().startsWith('{') || result.trim().startsWith('[')) {
                return ok(res, { success: true, data: JSON.parse(result) });
            }
            return ok(res, { success: true, article: result });
        } catch (e) {
            return ok(res, { success: true, text: result });
        }
    });
});

// ===== HIGH SEO BLOG GENERATOR + IMMEDIATE POST =====
const TRENDING_TOPICS = [
    'How to Use AI Tools to Save 10 Hours Every Day in 2025',
    '15 Free AI Websites That Do Work of Paid Software',
    'AI Website Builder vs Hiring a Developer: Complete Cost Comparison',
    'How Small Businesses Are Replacing Employees with AI Agents',
    'Free AI Blog Writer That Writes Better Than ChatGPT - Honest Review',
    'Best AI Logo Makers in 2025: Tested and Compared',
    'How to Generate Meta Tags That Actually Rank on Google',
    'AI Content Writing vs Human Writing: What Google Actually Wants',
    '10 AI Tools Every Freelancer Needs to Double Their Income',
    'How to Start an AI Automation Business with Zero Investment',
    'Free AI Image Generators That Don\'t Suck in 2025',
    'How to Write a Resume That Passes ATS Systems Using AI',
    'AI Social Media Manager: Post Daily Without Lifting a Finger',
    'The Complete Guide to AI SEO Tools for Beginners',
    'How to Create a Business Name That Stands Out Using AI',
    'Free Invoice Generator: Create Professional Invoices in Seconds',
    'AI Email Writer: Write Emails That Get Replies Every Time',
    'How to Build a Content Calendar Using AI in 15 Minutes',
    'YouTube SEO in 2025: How AI Tools Can Get You More Views',
    'Privacy Policy Generator: Why Every Website Needs One in 2025',
    'AI Ad Copy Generators: Do They Actually Convert?',
    'How to Repurpose One Piece of Content Into 5 Formats Using AI',
    'Free Schema Generator: Boost Your Google Rankings with Structured Data',
    'Startup Ideas 2025: AI Business Opportunities Under $1000',
    'Competitor Analysis Using AI: Find Their Weaknesses in Minutes',
    'Landing Page Copy That Converts: AI-Powered Formulas That Work',
    'Hashtag Strategy 2025: How to Go Viral on Instagram and TikTok',
    'AI Resume Builder vs Traditional Resume Writing Services',
    'Product Description Writing with AI: E-Commerce Sales Booster',
    'Review Response Templates That Turn Angry Customers Into Loyal Fans',
];

async function publishSEOBlog(topic, blogId, userBloggerToken) {
    const ct = sanitizeStrict(topic);
    const cb = sanitizeStrict(blogId);
    
    const blogHTML = await askAI(`You are an expert SEO content writer. Write a HIGH-QUALITY, SEO-optimized blog post.

TOPIC: "${ct}"
TODAY'S DATE: ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}

CRITICAL SEO REQUIREMENTS:
- H1: Must include the exact topic keywords near the start. Under 60 characters. Compelling and click-worthy.
- First 155 characters of the first paragraph MUST be a compelling meta description that includes the primary keyword.
- Primary keyword must appear naturally in: first paragraph, at least 2 H2 sections, and the conclusion.
- Use 5-6 H2 sections with secondary keyword variations.
- Each H2 section: 2-3 short paragraphs (3-4 sentences) + 1 bullet list (4-5 items with <li> tags).
- Minimum 1800 words of actual content.

INTERNAL LINKS (include ALL of these naturally in the text):
1. Early in the article: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;text-decoration:underline;">free AI tools</a>
2. Middle of article: <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;text-decoration:underline;">AI blog writer</a>
3. Another section: <a href="${WEBSITE_URL}/agents" style="color:#2563eb;font-weight:600;text-decoration:underline;">AI employees</a>
4. Near end: <a href="${WEBSITE_URL}/pricing" style="color:#2563eb;font-weight:600;text-decoration:underline;">affordable AI plans</a>
5. In conclusion: <a href="${WEBSITE_URL}" style="color:#2563eb;font-weight:600;text-decoration:underline;">PilotStaff</a>

CONCLUSION SECTION (H2 "Conclusion"):
- Summarize the 3-4 key takeaways
- Include the primary keyword one final time
- End with: "Start using <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;text-decoration:underline;">PilotStaff's free AI tools</a> today to transform your workflow. Visit <a href="${WEBSITE_URL}" style="color:#2563eb;font-weight:600;text-decoration:underline;">PilotStaff.com</a> to explore all 25+ free tools."

STYLE:
- Professional but conversational (like a knowledgeable friend)
- Short paragraphs for readability
- Use <strong> for key terms and important points
- No fluff or filler sentences
- Every paragraph must add value

OUTPUT ONLY CLEAN HTML. Start with <h1> and end with the conclusion paragraph.
No <html>, <body>, <head> tags. No markdown. No code blocks. No explanation.`);

    if (!blogHTML) throw new Error('AI failed to generate blog content');

    const titleMatch = blogHTML.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const postTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').substring(0, 100) : ct;

    const token = await getBloggerToken(userBloggerToken);
    if (!token) throw new Error('Blogger authentication failed. Check BLOGGER_REFRESH_TOKEN in .env');

    await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cb}/posts/`, {
        kind: 'blogger#post',
        title: postTitle,
        content: blogHTML,
        labels: [ct.split(' ').slice(0, 3).join(' '), 'AI Tools', 'Free Tools', '2025', 'Guide', 'PilotStaff', 'AI', 'Automation'],
    }, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });

    const blogUrl = `https://${cb}.blogspot.com`;
    pingIndexNow(blogUrl);
    
    await sendTelegram(`📝 <b>New Blog Published!</b>\n📐 ${postTitle.substring(0, 80)}\n🔗 ${blogUrl}\n🏷️ ${ct.split(' ').slice(0, 3).join(', ')}\n📅 ${new Date().toLocaleDateString()}`, true);
    
    console.log(`✅ Blog published: ${postTitle.substring(0, 50)}...`);
    return postTitle;
}

// Immediate blog trigger endpoint
app.post('/api/seo-blog-agent', async (req, res) => {
    const { topic, blogId, userBloggerToken } = req.body;
    if (!topic || !blogId) return err(res, 'Topic and Blog ID required', 400);
    try {
        const title = await publishSEOBlog(topic, blogId, userBloggerToken);
        ok(res, { success: true, message: `Published: "${title}"` });
    } catch (e) {
        console.error('Blog publish error:', e.message);
        err(res, e.message, 500);
    }
});

// Trigger trending blog immediately (no topic needed)
app.post('/api/trigger-blog', async (req, res) => {
    if (!BLOG_ID) return err(res, 'BLOG_ID not set in .env', 400);
    const topic = TRENDING_TOPICS[Math.floor(Math.random() * TRENDING_TOPICS.length)];
    try {
        const title = await publishSEOBlog(topic, BLOG_ID);
        ok(res, { success: true, message: `Published: "${title}"`, topic });
    } catch (e) {
        console.error('Trigger blog error:', e.message);
        err(res, e.message, 500);
    }
});

// Trigger multiple blogs
app.post('/api/trigger-bulk-blogs', async (req, res) => {
    const { count = 3 } = req.body;
    if (!BLOG_ID) return err(res, 'BLOG_ID not set', 400);
    const results = [];
    const shuffled = [...TRENDING_TOPICS].sort(() => Math.random() - 0.5).slice(0, count);
    for (const topic of shuffled) {
        try {
            const title = await publishSEOBlog(topic, BLOG_ID);
            results.push({ topic, title, success: true });
        } catch (e) {
            results.push({ topic, error: e.message, success: false });
        }
    }
    ok(res, { success: true, results });
});

// Check blogger status
app.get('/api/blog-status', async (req, res) => {
    try {
        const token = await getBloggerToken();
        if (!token) return ok(res, { connected: false, error: 'Authentication failed. Check BLOGGER_REFRESH_TOKEN' });
        const { data } = await axios.get(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=1`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
        ok(res, { connected: true, totalPosts: data.totalItems || 0, lastPost: data.items?.[0]?.title || 'No posts yet' });
    } catch (e) {
        ok(res, { connected: false, error: e.message });
    }
});

// ===== CRON: Auto-blog daily at 4 AM =====
cron.schedule('0 4 * * *', async () => {
    if (!BLOG_ID || !BLOGGER_REFRESH_TOKEN) return;
    const topic = TRENDING_TOPICS[Math.floor(Math.random() * TRENDING_TOPICS.length)];
    try {
        await publishSEOBlog(topic, BLOG_ID);
        console.log('✅ Auto-blog published:', topic.substring(0, 50));
    } catch (e) {
        console.error('❌ Auto-blog failed:', e.message);
    }
});

// Heartbeat
cron.schedule('*/30 * * * *', () => { console.log(`💓 ${new Date().toLocaleTimeString()} | Mem: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`); });

// 404 + Error handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { console.error('Unhandled:', err.message); res.status(500).json({ error: 'Internal error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 PilotStaff API on ${PORT}`));
