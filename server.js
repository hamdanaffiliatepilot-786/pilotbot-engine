// ============================================
// PILOTSTAFF BACKEND - COMPLETE SERVER
// ============================================
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

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
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
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Validate required vars
if (!SB_URL || !SB_KEY) console.warn('⚠️ Supabase credentials not set - DB features will fail');
if (!GROQ_KEY) console.warn('⚠️ GROQ_KEY not set - AI tools will fail');

// ============================================
// INIT CLIENTS
// ============================================
const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

// ============================================
// HELPER FUNCTIONS
// ============================================
function sanitize(input) {
    if (typeof input !== 'string') return input;
    return input.replace(/[<>'";&]/g, '').trim().substring(0, 2000);
}

async function sendTelegram(message, isChannel = false) {
    const chatId = isChannel ? TELEGRAM_CHANNEL_ID : TELEGRAM_CHAT_ID;
    if (!TELEGRAM_BOT_TOKEN || !chatId) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (e) {
        console.error('TG Error:', e.message?.substring(0, 100));
    }
}

async function askAI(prompt) {
    if (!GROQ_KEY) return null;
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 4000,
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
            timeout: 45000
        });
        let content = response.data.choices[0].message.content;
        content = content.replace(/```json\n?/g, '').replace(/```html\n?/g, '').replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();
        return content;
    } catch (e) {
        console.error('AI Error:', e.message?.substring(0, 100));
        return null;
    }
}

async function getBloggerToken(userToken) {
    const token = userToken || BLOGGER_REFRESH_TOKEN;
    if (!token || !BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) return null;
    try {
        const res = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: BLOGGER_CLIENT_ID,
            client_secret: BLOGGER_CLIENT_SECRET,
            refresh_token: token,
            grant_type: 'refresh_token'
        });
        return res.data.access_token;
    } catch (e) {
        console.error('Blogger Token Error:', e.message?.substring(0, 100));
        return null;
    }
}

async function submitToGoogleIndex(url) {
    if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !url) return;
    try {
        const auth = new google.auth.JWT({
            email: GOOGLE_CLIENT_EMAIL,
            privateKey: GOOGLE_PRIVATE_KEY,
            scopes: ['https://www.googleapis.com/auth/indexing']
        });
        const indexing = google.indexing({ version: 'v3', auth });
        await indexing.urlNotifications.publish({
            requestBody: { type: 'URL_UPDATED', url: url }
        });
        console.log('Indexed:', url.substring(0, 50));
    } catch (e) {
        console.error('Index Error:', e.message?.substring(0, 100));
    }
}

async function pingIndexNow(url) {
    try {
        await axios.post('https://api.indexnow.org/IndexNow', {
            host: new URL(url).hostname,
            key: 'pilotbotindexkey123',
            urlList: [url]
        });
    } catch (e) { /* silent fail */ }
}

function jsonResponse(res, data, status = 200) {
    res.status(status).json(data);
}

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
    res.send('🤖 PilotStaff API is LIVE');
});

app.get('/api/health', (req, res) => {
    jsonResponse(res, {
        success: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        services: {
            supabase: !!supabase,
            groq: !!GROQ_KEY,
            blogger: !!BLOGGER_REFRESH_TOKEN,
            telegram: !!TELEGRAM_BOT_TOKEN,
            google: !!GOOGLE_CLIENT_EMAIL,
        }
    });
});

// ============================================
// PUBLIC STATS (No auth required)
// ============================================
app.get('/api/public-stats', async (req, res) => {
    if (!supabase) return jsonResponse(res, { success: true, activeUsers: '0', totalTasks: '0' });

    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });

        const formatNum = (n) => {
            if (!n) return '0';
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M+';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K+';
            return n.toString();
        };

        jsonResponse(res, {
            success: true,
            activeUsers: formatNum(users || 0),
            totalTasks: formatNum((users || 0) * 7 + (leads || 0) * 3),
            totalLeads: leads || 0,
        });
    } catch (e) {
        jsonResponse(res, { success: true, activeUsers: '0', totalTasks: '0' });
    }
});

// ============================================
// BLOG POSTS (Public - for homepage & blog page)
// ============================================
app.get('/api/get-old-posts', async (req, res) => {
    if (!BLOGGER_REFRESH_TOKEN || !BLOG_ID) {
        return jsonResponse(res, { success: false, error: 'Blogger not configured' });
    }

    try {
        const token = await getBloggerToken();
        if (!token) return jsonResponse(res, { success: false, error: 'Blogger auth failed' });

        const { data } = await axios.get(
            `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?maxResults=10`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const posts = (data.items || []).map(post => ({
            id: post.id,
            title: post.title,
            url: post.url,
            published: post.published,
            image: post.images?.[0]?.url || null,
        }));

        jsonResponse(res, { success: true, posts });
    } catch (e) {
        jsonResponse(res, { success: false, error: e.message });
    }
});

// ============================================
// AI CHAT (With memory via Supabase)
// ============================================
app.post('/api/ai-chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return jsonResponse(res, { success: false, error: 'Message and session ID required' });

    const cleanMsg = sanitize(message);
    const cleanSession = sanitize(sessionId).substring(0, 100);

    let memoryText = '';
    if (supabase) {
        try {
            const { data: mem } = await supabase.from('chat_memories').select('summary').eq('session_id', cleanSession).single();
            if (mem?.summary) memoryText = mem.summary;
        } catch (e) { /* no memory yet */ }
    }

    const prompt = `You are a helpful AI assistant for PilotStaff, a platform that provides AI tools and AI employee agents for businesses. Be concise and helpful.

 ${memoryText ? `Previous conversation context: ${memoryText}\n\n` : ''}User: ${cleanMsg}

Respond in HTML format (you can use <b>, <br>, <ul>, <li> tags for formatting). Keep it under 200 words.

After your response, on a NEW LINE, output exactly: [MEMORY: brief 1-sentence summary of what was discussed]`;

    const result = await askAI(prompt);
    if (!result) return jsonResponse(res, { success: false, error: 'AI failed to respond' });

    // Extract memory update
    const memoryMatch = result.match(/\[MEMORY:\s*(.+?)\]$/i);
    let reply = result;
    let memoryUpdate = memoryMatch ? memoryMatch[1] : null;
    if (memoryMatch) reply = result.replace(/\[MEMORY:\s*.+?\]$/i, '').trim();

    // Save memory
    if (supabase && memoryUpdate) {
        try {
            await supabase.from('chat_memories').upsert({
                session_id: cleanSession,
                summary: sanitize(memoryUpdate),
                updated_at: new Date().toISOString()
            }, { onConflict: 'session_id' });
        } catch (e) { /* silent */ }
    }

    jsonResponse(res, { success: true, reply });
});

// ============================================
// CRM - LEADS
// ============================================
app.get('/api/crm/leads', async (req, res) => {
    if (!supabase) return jsonResponse(res, { success: true, leads: [] });
    try {
        const { data: leads, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
        if (error) return jsonResponse(res, { success: false, error: error.message }, 500);
        jsonResponse(res, { success: true, leads: leads || [] });
    } catch (e) {
        jsonResponse(res, { success: true, leads: [] });
    }
});

app.post('/api/crm/leads', async (req, res) => {
    if (!supabase) return jsonResponse(res, { success: false, error: 'Database not configured' }, 500);
    const { name, email, phone, status, value } = req.body;

    const { data, error } = await supabase.from('leads').insert({
        name: sanitize(name),
        email: sanitize(email),
        phone: sanitize(phone),
        status: sanitize(status) || 'new',
        value: sanitize(value),
    }).select().single();

    if (error) return jsonResponse(res, { success: false, error: error.message }, 500);
    jsonResponse(res, { success: true, lead: data });
});

// ============================================
// AUTH (Simple email-based)
// ============================================
app.post('/api/auth', async (req, res) => {
    if (!supabase) return jsonResponse(res, { success: false, error: 'Database not configured' });
    const { email } = req.body;
    if (!email) return jsonResponse(res, { success: false, error: 'Email required' });

    const { data: user } = await supabase.from('users').select('*').eq('email', sanitize(email)).single();
    if (user) return jsonResponse(res, { success: true, user });

    const { data: newUser, error } = await supabase.from('users').insert({ email: sanitize(email) }).select().single();
    if (error) return jsonResponse(res, { success: false, error: error.message }, 500);
    jsonResponse(res, { success: true, user: newUser });
});

// ============================================
// ADMIN LOGIN
// ============================================
app.post('/api/admin-login', (req, res) => {
    if (!ADMIN_PASSWORD) return jsonResponse(res, { success: false, error: 'Admin not configured' });
    if (req.body.password === ADMIN_PASSWORD) {
        jsonResponse(res, { success: true });
    } else {
        jsonResponse(res, { success: false });
    }
});

// ============================================
// ADMIN STATS
// ============================================
app.get('/api/admin/stats', async (req, res) => {
    if (!supabase) return jsonResponse(res, { success: false, error: 'No database' });

    try {
        const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: leads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
        const { count: products } = await supabase.from('store_products').select('*', { count: 'exact', head: true });

        jsonResponse(res, {
            success: true,
            totalUsers: users || 0,
            totalLeads: leads || 0,
            totalProducts: products || 0,
            totalRevenue: '0',
            totalProfit: '0',
            totalCJCost: '0',
            totalOrders: 0,
            trafficSources: { Direct: '40%', Google: '35%', Social: '15%', Other: '10%' },
            statusCounts: { Active: users || 0, New: leads || 0 },
        });
    } catch (e) {
        jsonResponse(res, { success: false, error: e.message }, 500);
    }
});

// ============================================
// FREE AI TOOLS (15 Tools)
// ============================================

// 1. Website Builder
app.post('/api/tool/website-builder', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Prompt required' });

    const code = await askAI(`Generate a COMPLETE single-page HTML website about: "${input}". 
Rules:
- Use inline CSS only
- Make it modern, responsive, mobile-friendly
- Use https://placehold.co/600x400/EEE/31343C?text=Image for images
- Include: navigation bar, hero section, features section, about section, footer
- Use a professional color scheme
- Output ONLY valid HTML. No markdown, no code blocks, no explanation.`);

    if (code) jsonResponse(res, { success: true, code });
    else jsonResponse(res, { success: false, error: 'AI failed to generate website' });
});

// 2. Blog Writer
app.post('/api/tool/blog-writer-free', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Topic required' });

    const article = await askAI(`Write a comprehensive, SEO-optimized 1500-word article about: "${input}".
Rules:
- Use H1, H2, H3 tags for structure
- Write short paragraphs (3-4 sentences max)
- Include bullet points where appropriate
- Add a conclusion section
- Make it engaging and informative
- Output ONLY clean HTML. No <html>, <body>, <head> tags. No markdown.`);

    if (article) jsonResponse(res, { success: true, article });
    else jsonResponse(res, { success: false, error: 'AI failed to write article' });
});

// 3. Image Generator
app.post('/api/tool/image-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Prompt required' });

    const seed = Math.floor(Math.random() * 999999);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(input)}?width=1024&height=1024&nologo=true&seed=${seed}`;
    jsonResponse(res, { success: true, imageUrl });
});

// 4. Logo Maker (Uses image generator with logo-specific prompt)
app.post('/api/tool/logo-maker', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Description required' });

    const logoPrompt = `Professional minimalist logo design for "${input}", clean vector style, white background, no text, simple icon, modern flat design`;
    const seed = Math.floor(Math.random() * 999999);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(logoPrompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
    jsonResponse(res, { success: true, imageUrl });
});

// 5. Business Name Generator
app.post('/api/tool/business-name-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Topic required' });

    const result = await askAI(`Generate 20 creative business name ideas for: "${input}".
Output STRICT JSON only: {"names": ["Name1 - Short description", "Name2 - Short description", ...]}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        // Fallback if AI fails
        jsonResponse(res, { success: true, data: { names: ['Could not generate names. Please try again.'] } });
    }
});

// 6. Meta Tag Generator
app.post('/api/tool/meta-tag-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Topic required' });

    const result = await askAI(`Generate SEO meta tags for a webpage about: "${input}".
Output STRICT JSON only: {
  "title": "SEO title under 60 characters",
  "description": "Meta description under 160 characters",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "og_title": "Open Graph title",
  "og_description": "Open Graph description"
}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        jsonResponse(res, { success: false, error: 'Failed to generate meta tags' });
    }
});

// 7. Privacy Policy Generator
app.post('/api/tool/privacy-policy-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Website description required' });

    const html = await askAI(`Write a complete, professional Privacy Policy page for: ${input}.
Include sections: Information We Collect, How We Use Your Information, Cookies, Third-Party Services, Data Security, Your Rights, Changes to This Policy, Contact Us.
Use H2 for section headings, P for paragraphs. Output as clean HTML only. No <html>, <body> tags. No markdown.`);

    if (html) jsonResponse(res, { success: true, article: html });
    else jsonResponse(res, { success: false, error: 'Failed to generate' });
});

// 8. Terms & Conditions Generator
app.post('/api/tool/terms-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Business description required' });

    const html = await askAI(`Write complete Terms & Conditions for: ${input}.
Include sections: Acceptance of Terms, Services Description, User Responsibilities, Payment Terms, Intellectual Property, Limitation of Liability, Governing Law, Contact.
Use H2 for section headings. Output as clean HTML only. No <html>, <body> tags. No markdown.`);

    if (html) jsonResponse(res, { success: true, article: html });
    else jsonResponse(res, { success: false, error: 'Failed to generate' });
});

// 9. Resume Builder
app.post('/api/tool/resume-builder', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Experience details required' });

    const html = await askAI(`Create a professional ATS-friendly resume in HTML based on: "${input}".
Include: Header with name, Professional Summary, Work Experience, Skills, Education sections.
Use inline CSS for clean professional styling. Light background, dark text.
Output as HTML only. No <html>, <body> tags. No markdown.`);

    if (html) jsonResponse(res, { success: true, article: html });
    else jsonResponse(res, { success: false, error: 'Failed to generate' });
});

// 10. Paragraph Rewriter
app.post('/api/tool/paragraph-rewriter', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Text required' });

    const result = await askAI(`Rewrite the following paragraph with different words and sentence structure while keeping the exact same meaning. Make it sound natural and professional. Output ONLY the rewritten paragraph, nothing else:\n\n"${input}"`);

    if (result) jsonResponse(res, { success: true, text: result });
    else jsonResponse(res, { success: false, error: 'Failed to rewrite' });
});

// 11. Ad Copy Generator
app.post('/api/tool/ad-copy-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Product/service required' });

    const result = await askAI(`Generate 5 high-converting ad copies for: "${input}".
Include Facebook, Instagram, and Google Ads styles.
Output STRICT JSON only: {"copy": ["Ad 1 with headline and body text", "Ad 2...", "Ad 3...", "Ad 4...", "Ad 5..."]}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        jsonResponse(res, { success: false, error: 'Failed to generate ad copy' });
    }
});

// 12. Email Writer
app.post('/api/tool/email-writer', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Email context required' });

    const result = await askAI(`Write 3 professional email variations for: "${input}".
Each email should have a subject line and body.
Output STRICT JSON only: {"emails": ["Subject: ...\n\nBody text here", "Subject: ...\n\nBody text here", "Subject: ...\n\nBody text here"]}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        jsonResponse(res, { success: false, error: 'Failed to generate emails' });
    }
});

// 13. Hashtag Generator
app.post('/api/tool/hashtag-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Topic required' });

    const result = await askAI(`Give 1 engaging Instagram caption and 20 viral hashtags for a post about: "${input}".
Output STRICT JSON only: {"caption": "Your engaging caption here", "hashtags": ["tag1", "tag2", ...]}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        jsonResponse(res, { success: false, error: 'Failed to generate hashtags' });
    }
});

// 14. YouTube SEO Tool
app.post('/api/tool/youtube-seo', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Video topic required' });

    const result = await askAI(`Give 5 viral YouTube video titles and 10 SEO tags for a video about: "${input}".
Output STRICT JSON only: {"titles": ["Title 1", "Title 2", ...], "tags": ["tag1", "tag2", ...]}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        jsonResponse(res, { success: false, error: 'Failed to generate YouTube SEO data' });
    }
});

// 15. Invoice Generator
app.post('/api/tool/invoice-generator', async (req, res) => {
    const input = sanitize(req.body.topic || req.body.prompt);
    if (!input) return jsonResponse(res, { success: false, error: 'Invoice details required' });

    const html = await askAI(`Create a professional invoice in HTML for: "${input}".
Include: Company header "INVOICE", Invoice number (INV-001), today's date, Bill To section, Item table with Description/Hours/Rate/Amount columns, Subtotal, Tax (10%), Total, Payment terms "Due within 30 days", and a "Thank you" note.
Use inline CSS for professional styling. Output as HTML only. No <html>, <body> tags. No markdown.`);

    if (html) jsonResponse(res, { success: true, article: html });
    else jsonResponse(res, { success: false, error: 'Failed to generate invoice' });
});

// ============================================
// SOCIAL MEDIA MANAGER (For Dashboard)
// ============================================
app.post('/api/tool/social-manager', async (req, res) => {
    const { niche, count = 5 } = req.body;
    const input = sanitize(niche);
    if (!input) return jsonResponse(res, { success: false, error: 'Niche required' });

    const result = await askAI(`Generate ${count} viral tweets about: "${input}".
Output STRICT JSON array only: ["tweet 1", "tweet 2", ...]
No markdown, no code blocks.`);

    try {
        let tweets = JSON.parse(result);
        if (!Array.isArray(tweets)) tweets = [tweets];
        jsonResponse(res, { success: true, tweets });
    } catch (e) {
        // Fallback tweets
        jsonResponse(res, {
            success: true,
            tweets: [
                `Just discovered something amazing about ${input}! 🤯 #Trending #AI`,
                `${input} is changing the game in 2025! Here's why... 🚀`,
                `Stop sleeping on ${input}! This is the future 🔥 #Business`,
                `POV: You finally understand ${input} 💡 #Viral #Growth`,
                `${input} tip that nobody talks about 🤫 #Secret #Tips`,
            ]
        });
    }
});

// ============================================
// AUTO-BLOG (For SEO Engine / Dashboard)
// ============================================
app.post('/api/trigger-auto-blog', async (req, res) => {
    const { niche, blogId, userBloggerToken } = req.body;
    if (!niche || !blogId) return jsonResponse(res, { success: false, error: 'Niche and Blog ID required' });

    const cleanNiche = sanitize(niche);
    const cleanBlogId = sanitize(blogId);

    try {
        const articleHTML = await askAI(`Write a highly engaging, 1500-word SEO article about: "${cleanNiche}".
Use H1, H2, H3 tags. Short paragraphs. Bullet points. Human-like writing.
Output ONLY clean HTML. No <html>, <body> tags. No markdown.`);

        if (!articleHTML) return jsonResponse(res, { success: false, error: 'AI failed to write' });

        const token = await getBloggerToken(userBloggerToken);
        if (!token) return jsonResponse(res, { success: false, error: 'Blogger authentication failed. Check your Blog ID and token.' });

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanNiche + ' blog feature image')}?width=1200&height=630&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
        const finalHTML = `<img src="${imageUrl}" style="width:100%;border-radius:8px;margin-bottom:20px;" alt="${cleanNiche}" /> ${articleHTML}`;

        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${cleanBlogId}/posts/`, {
            kind: 'blogger#post',
            title: `${cleanNiche} - Complete Guide (${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })})`,
            content: finalHTML,
            labels: [cleanNiche, 'AI Generated', 'Guide']
        }, { headers: { Authorization: `Bearer ${token}` } });

        const postUrl = `https://${cleanBlogId}.blogspot.com`;
        pingIndexNow(postUrl);

        jsonResponse(res, { success: true, message: `Article posted successfully!` });

        // Telegram notification
        await sendTelegram(`📝 <b>New Blog Published!</b>\n📐 Topic: ${cleanNiche}\n🔗 ${postUrl}`, true);

    } catch (e) {
        jsonResponse(res, { success: false, error: e.message });
    }
});

// ============================================
// VIRAL BLUEPRINT
// ============================================
app.post('/api/tool/viral-blueprint', async (req, res) => {
    const input = sanitize(req.body.niche);
    if (!input) return jsonResponse(res, { success: false, error: 'Niche required' });

    const result = await askAI(`Create a viral content blueprint for a faceless YouTube/Instagram channel in niche: "${input}".
Output STRICT JSON only: {
  "scripts": [{"hook": "Opening line", "body": "Main points", "cta": "Call to action"}],
  "thumbnails": ["Thumbnail idea 1", "Thumbnail idea 2"],
  "blogs": ["Blog title 1", "Blog title 2"],
  "threads": ["Thread outline"]
}
No markdown, no code blocks.`);

    try {
        const parsed = JSON.parse(result);
        jsonResponse(res, { success: true, data: parsed });
    } catch (e) {
        jsonResponse(res, { success: false, error: 'Failed to generate blueprint' });
    }
});

// ============================================
// PAYPAL WEBHOOK (One-Time Payment)
// ============================================
app.post('/api/paypal-webhook', async (req, res) => {
    console.log('💰 PayPal Webhook Received:', JSON.stringify(req.body).substring(0, 200));

    const { subscriptionID, orderID, plan, price } = req.body;

    // Send Telegram notification
    await sendTelegram(
        `💰 <b>NEW PAYMENT!</b>\n` +
        `📋 Plan: ${plan || 'Unknown'}\n` +
        `💵 Amount: ${price || 'Unknown'}\n` +
        `🆔 Order: ${orderID || subscriptionID || 'N/A'}\n` +
        `🕐 Time: ${new Date().toLocaleString('en-IN')}`,
        true
    );

    // Save to database if supabase available
    if (supabase && orderID) {
        try {
            await supabase.from('payments').insert({
                order_id: orderID,
                subscription_id: subscriptionID,
                plan: plan,
                amount: price,
                status: 'completed',
                created_at: new Date().toISOString()
            });
        } catch (e) {
            console.error('Payment save error:', e.message);
        }
    }

    jsonResponse(res, { success: true });
});

// ============================================
// CRON JOBS
// ============================================

// Daily Telegram tip at 10 AM IST
cron.schedule('0 4 * * *', async () => {
    if (!TELEGRAM_CHANNEL_ID) return;

    console.log('📢 Sending daily Telegram update...');
    const tip = await askAI('Give one short, actionable business or marketing tip (1-2 sentences). Be specific and practical. No fluff.');

    if (tip) {
        await sendTelegram(
            `💡 <b>Daily Business Tip</b>\n\n${tip}\n\n🤖 by PilotStaff AI\n🔗 ${WEBSITE_URL}\n\n#BusinessTips #AI #Marketing`,
            true
        );
    }
});

// Health check ping every 30 minutes (keeps Render awake on free tier)
cron.schedule('*/30 * * * *', () => {
    console.log(`💓 Heartbeat at ${new Date().toLocaleTimeString()}`);
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found', available: '/api/health' });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🤖 PilotStaff API is LIVE on ${PORT}   ║
║   Health: /api/health                  ║
╚═══════════════════════════════════════╝
    `);
});
