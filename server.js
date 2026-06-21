require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

function env(key) {
    let val = process.env[key];
    if (!val) return '';
    return val.replace(/^['"`\s]+|['"`\s]+$/g, '').trim();
}

function normalizeOrigin(url) {
    return (url || '').trim().replace(/\/+$/, '');
}

function sanitizeInput(input, max = 5000) {
    if (typeof input !== 'string') return input;
    return input
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/on\w+\s*=\s*["']?[^"']*["']?/gi, '')
        .replace(/javascript\s*:/gi, '')
        .trim()
        .substring(0, max);
}

function toIso(date) {
    return new Date(date).toISOString();
}

function computeNextRun(scheduleType, fromDate = new Date()) {
    const now = new Date(fromDate);
    if (scheduleType === 'daily') {
        const next = new Date(now);
        next.setDate(next.getDate() + 1);
        return toIso(next);
    }
    if (scheduleType === 'weekly') {
        const next = new Date(now);
        next.setDate(next.getDate() + 7);
        return toIso(next);
    }
    return null;
}

const configuredOrigins = [
    env('FRONTEND_URL'),
    ...env('FRONTEND_URLS').split(',').map(normalizeOrigin).filter(Boolean),
    'http://localhost:3000'
].map(normalizeOrigin).filter(Boolean);

const allowVercelPreviews = env('ALLOW_VERCEL_PREVIEWS') === 'true';

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const normalizedOrigin = normalizeOrigin(origin);
        const isAllowed =
            configuredOrigins.includes(normalizedOrigin) ||
            (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin));

        if (isAllowed) return callback(null, true);
        return callback(new Error('Not allowed'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-cron-secret']
}));

app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, message: { success: false, error: 'Too many requests.' } });
const toolLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 35, message: { success: false, error: 'Tool limit reached. Upgrade to Pro for unlimited.' } });
app.use('/api/tool/', toolLimiter);
app.use('/api/agent/', toolLimiter);
app.use('/api/', limiter);

const SB_URL = env('SB_URL');
const SB_KEY = env('SB_KEY');
const GROQ_KEY = env('GROQ_KEY');
const GEMINI_KEY = env('GEMINI_KEY');
const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';
const INTERNAL_CRON_SECRET = env('CRON_SECRET');
const IS_VERCEL = !!process.env.VERCEL;

console.log('🤖 PilotStaff API |', IS_VERCEL ? 'Vercel' : 'Traditional');
console.log('Gemini:', GEMINI_KEY ? '✅' : '❌', '| Groq:', GROQ_KEY ? '✅' : '❌');

const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

async function sendTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        }, { timeout: 10000 });
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
            const c = r.data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (c) return c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        } catch (e) {
            console.log('Gemini fail:', e.message?.substring(0, 80));
        }
    }

    if (!GROQ_KEY) return null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: IS_VERCEL ? 2000 : 4000,
            }, {
                headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
                timeout: AI_TIMEOUT
            });
            const c = r.data.choices?.[0]?.message?.content;
            if (c) return c.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
        } catch (e) {
            if (attempt === retries) return null;
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return null;
}

function ok(res, data) { res.status(200).json(data); }
function err(res, msg, code) { res.status(code || 500).json({ success: false, error: msg }); }

function requireSupabase(res) {
    if (!supabase) {
        err(res, 'Supabase not configured', 500);
        return false;
    }
    return true;
}

function getAgentSystemPrompt(agentId, setup, task) {
    const profile = `
Business Name: ${setup?.business_name || 'Unknown'}
Business Type: ${setup?.business_type || 'General'}
Website: ${setup?.website_url || 'N/A'}
Audience: ${setup?.target_audience || 'General audience'}
Goals: ${setup?.goals || 'Grow business'}
Tone: ${setup?.brand_tone || 'Professional'}
Services: ${setup?.services || 'N/A'}
Offers: ${setup?.offers || 'N/A'}
Channels: ${setup?.channels || 'N/A'}
FAQs: ${setup?.faq || 'N/A'}
`;

    const taskPrompt = sanitizeInput(task?.prompt || '', 8000);

    const prompts = {
        'content-writer': `You are an elite AI Content Writer. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn production-ready content in markdown with clear headings, CTA and SEO angle.`,
        'seo-expert': `You are an AI SEO Expert. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a detailed SEO plan with priorities, technical fixes, content gaps and next steps.`,
        'social-staff': `You are AI Social Staff. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a 7-post content plan with caption, hook, CTA, hashtags and best platform.`,
        'email-marketer': `You are AI Email Marketer. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a conversion-focused email sequence with subjects, preview text and body.`,
        'receptionist': `You are AI Receptionist. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a customer-ready response, qualifying questions and next action.`,
        'sales-agent': `You are AI Sales Agent. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a persuasive sales response, objection handling and close strategy.`,
        'support-agent': `You are AI Support Agent. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a support response with resolution steps and escalation note if needed.`,
        'video-scriptwriter': `You are AI Video Scriptwriter. Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn a high-retention script with hook, sections, CTA and edit notes.`,
    };

    return prompts[agentId] || `Use this business profile:\n${profile}\n\nTask: ${taskPrompt}\n\nReturn the best possible result for the client.`;
}

async function addTaskLog(taskId, email, status, message, output = '') {
    if (!supabase || !taskId) return;
    try {
        await supabase.from('task_logs').insert({
            task_id: taskId,
            email,
            status,
            message: sanitizeInput(message || '', 1000),
            output: typeof output === 'string' ? output.substring(0, 12000) : ''
        });
    } catch (e) {}
}

async function saveOutput(task, output) {
    if (!supabase) return;
    try {
        await supabase.from('generated_outputs').insert({
            email: task.email,
            task_id: task.id,
            agent_id: task.agent_id,
            title: task.title,
            output: output.substring(0, 50000),
            format: 'markdown'
        });
    } catch (e) {}
}

async function executeAutomationTask(task) {
    if (!supabase) return { success: false, error: 'Supabase not configured' };

    const { data: setup } = await supabase.from('client_setups').select('*').eq('email', task.email).single();
    const prompt = getAgentSystemPrompt(task.agent_id, setup, task);

    await addTaskLog(task.id, task.email, 'running', `Task started for ${task.agent_id}`);

    const result = await askAI(prompt);
    if (!result) {
        await supabase.from('automation_tasks').update({
            status: 'failed',
            error_message: 'AI generation failed',
            updated_at: toIso(new Date())
        }).eq('id', task.id);
        await addTaskLog(task.id, task.email, 'failed', 'AI generation failed');
        return { success: false, error: 'AI generation failed' };
    }

    const nextRun = computeNextRun(task.schedule_type, new Date());
    await supabase.from('automation_tasks').update({
        status: task.schedule_type === 'manual' ? 'completed' : 'scheduled',
        output_preview: result.substring(0, 400),
        error_message: null,
        approved: task.requires_approval ? false : task.approved,
        last_run_at: toIso(new Date()),
        next_run_at: nextRun,
        updated_at: toIso(new Date())
    }).eq('id', task.id);

    await saveOutput(task, result);
    await addTaskLog(task.id, task.email, 'completed', 'Task completed successfully', result);

    return { success: true, output: result };
}

async function runDueTasks(limit = 10) {
    if (!supabase) return { success: false, error: 'Supabase not configured', processed: 0 };

    const nowIso = toIso(new Date());
    const { data: tasks, error: tasksError } = await supabase
        .from('automation_tasks')
        .select('*')
        .in('status', ['scheduled', 'pending'])
        .lte('next_run_at', nowIso)
        .eq('approved', true)
        .order('next_run_at', { ascending: true })
        .limit(limit);

    if (tasksError) return { success: false, error: tasksError.message, processed: 0 };

    let processed = 0;
    for (const task of tasks || []) {
        await executeAutomationTask(task);
        processed += 1;
    }

    return { success: true, processed };
}

app.get('/', (req, res) => res.send('🤖 PilotStaff API LIVE'));
app.get('/api/health', (req, res) => ok(res, {
    success: true,
    platform: IS_VERCEL ? 'Vercel' : 'Traditional',
    uptime: process.uptime(),
    ai: { gemini: !!GEMINI_KEY, groq: !!GROQ_KEY },
    automation: { supabase: !!supabase, cronSecret: !!INTERNAL_CRON_SECRET }
}));

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
        try {
            await supabase.from('subscriptions').update({ active: false }).eq('email', email).eq('agent_id', agentId);
            await supabase.from('subscriptions').insert({ email, agent_id: agentId, plan_name: planName, price, paypal_order_id: paypalOrderId, active: true });
        } catch (e) {
            return err(res, 'Subscription save failed', 500);
        }
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

// ===== CLIENT SETUP =====
app.get('/api/client/setup', async (req, res) => {
    const email = sanitizeInput(req.query.email || '', 200);
    if (!email) return err(res, 'Email required', 400);
    if (!requireSupabase(res)) return;

    try {
        const { data, error } = await supabase.from('client_setups').select('*').eq('email', email).single();
        if (error && error.code !== 'PGRST116') return err(res, error.message, 500);
        return ok(res, { success: true, setup: data || null });
    } catch (e) {
        return err(res, 'Setup fetch failed', 500);
    }
});

app.post('/api/client/setup', async (req, res) => {
    const payload = {
        email: sanitizeInput(req.body.email || '', 200),
        business_name: sanitizeInput(req.body.businessName || '', 200),
        business_type: sanitizeInput(req.body.businessType || '', 120),
        website_url: sanitizeInput(req.body.websiteUrl || '', 300),
        target_audience: sanitizeInput(req.body.targetAudience || '', 500),
        goals: sanitizeInput(req.body.goals || '', 1000),
        brand_tone: sanitizeInput(req.body.brandTone || '', 300),
        services: sanitizeInput(req.body.services || '', 2000),
        offers: sanitizeInput(req.body.offers || '', 1000),
        channels: sanitizeInput(req.body.channels || '', 500),
        faq: sanitizeInput(req.body.faq || '', 3000),
        updated_at: toIso(new Date())
    };

    if (!payload.email || !payload.business_name) return err(res, 'Email and business name required', 400);
    if (!requireSupabase(res)) return;

    try {
        const { error } = await supabase.from('client_setups').upsert({
            ...payload,
            created_at: toIso(new Date())
        }, { onConflict: 'email' });
        if (error) return err(res, error.message, 500);
        await sendTelegram(`🧠 <b>Client Setup Saved</b>\n${payload.business_name}\n${payload.email}`);
        return ok(res, { success: true, message: 'Setup saved successfully' });
    } catch (e) {
        return err(res, 'Setup save failed', 500);
    }
});

// ===== AUTOMATION TASKS =====
app.get('/api/tasks', async (req, res) => {
    const email = sanitizeInput(req.query.email || '', 200);
    if (!email) return err(res, 'Email required', 400);
    if (!requireSupabase(res)) return;

    try {
        const { data, error } = await supabase
            .from('automation_tasks')
            .select('*')
            .eq('email', email)
            .order('created_at', { ascending: false });
        if (error) return err(res, error.message, 500);
        return ok(res, { success: true, tasks: data || [] });
    } catch (e) {
        return err(res, 'Tasks fetch failed', 500);
    }
});

app.post('/api/tasks', async (req, res) => {
    const email = sanitizeInput(req.body.email || '', 200);
    const title = sanitizeInput(req.body.title || '', 200);
    const agentId = sanitizeInput(req.body.agentId || '', 100);
    const prompt = sanitizeInput(req.body.prompt || '', 8000);
    const scheduleType = sanitizeInput(req.body.scheduleType || 'manual', 20);
    const requiresApproval = !!req.body.requiresApproval;

    if (!email || !title || !agentId || !prompt) return err(res, 'Missing task data', 400);
    if (!requireSupabase(res)) return;

    const allowedSchedules = ['manual', 'daily', 'weekly'];
    if (!allowedSchedules.includes(scheduleType)) return err(res, 'Invalid schedule type', 400);

    const now = new Date();
    const insertPayload = {
        email,
        title,
        agent_id: agentId,
        prompt,
        schedule_type: scheduleType,
        requires_approval: requiresApproval,
        approved: !requiresApproval,
        status: scheduleType === 'manual' ? 'pending' : 'scheduled',
        next_run_at: scheduleType === 'manual' ? toIso(now) : computeNextRun(scheduleType, now),
        created_at: toIso(now),
        updated_at: toIso(now)
    };

    try {
        const { data, error } = await supabase.from('automation_tasks').insert(insertPayload).select('*').single();
        if (error) return err(res, error.message, 500);
        await addTaskLog(data.id, email, 'created', `Task created: ${title}`);
        return ok(res, { success: true, task: data });
    } catch (e) {
        return err(res, 'Task create failed', 500);
    }
});

app.post('/api/tasks/:id/approve', async (req, res) => {
    if (!requireSupabase(res)) return;
    const taskId = sanitizeInput(req.params.id || '', 100);
    const approved = req.body.approved !== false;

    try {
        const { data: task, error: fetchError } = await supabase.from('automation_tasks').select('*').eq('id', taskId).single();
        if (fetchError || !task) return err(res, 'Task not found', 404);

        const { error } = await supabase.from('automation_tasks').update({
            approved,
            status: approved && task.schedule_type !== 'manual' ? 'scheduled' : task.status,
            updated_at: toIso(new Date())
        }).eq('id', taskId);
        if (error) return err(res, error.message, 500);

        await addTaskLog(taskId, task.email, approved ? 'approved' : 'paused', approved ? 'Task approved for automation' : 'Task approval revoked');
        return ok(res, { success: true, message: approved ? 'Task approved' : 'Task paused' });
    } catch (e) {
        return err(res, 'Approval update failed', 500);
    }
});

app.post('/api/tasks/:id/run', async (req, res) => {
    if (!requireSupabase(res)) return;
    const taskId = sanitizeInput(req.params.id || '', 100);

    try {
        const { data: task, error: fetchError } = await supabase.from('automation_tasks').select('*').eq('id', taskId).single();
        if (fetchError || !task) return err(res, 'Task not found', 404);

        const result = await executeAutomationTask({
            ...task,
            approved: true
        });

        if (!result.success) return err(res, result.error || 'Task run failed', 500);
        return ok(res, { success: true, output: result.output });
    } catch (e) {
        return err(res, 'Task run failed', 500);
    }
});

app.get('/api/outputs', async (req, res) => {
    const email = sanitizeInput(req.query.email || '', 200);
    if (!email) return err(res, 'Email required', 400);
    if (!requireSupabase(res)) return;

    try {
        const { data, error } = await supabase
            .from('generated_outputs')
            .select('*')
            .eq('email', email)
            .order('created_at', { ascending: false })
            .limit(30);
        if (error) return err(res, error.message, 500);
        return ok(res, { success: true, outputs: data || [] });
    } catch (e) {
        return err(res, 'Outputs fetch failed', 500);
    }
});

app.post('/api/internal/run-automation', async (req, res) => {
    const secret = req.headers['x-cron-secret'] || req.body.secret || req.query.secret;
    if (!INTERNAL_CRON_SECRET || secret !== INTERNAL_CRON_SECRET) return err(res, 'Unauthorized', 401);

    const result = await runDueTasks(12);
    if (!result.success) return err(res, result.error || 'Automation failed', 500);
    return ok(res, { success: true, processed: result.processed });
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
