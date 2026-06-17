require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ================= CONFIGURATION =================
const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Mrhamdu123@";

const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;

const supabase = createClient(SB_URL, SB_KEY);

// ================= AI BRAIN (GROQ) =================
async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' }
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        console.error("AI Error:", e.message);
        return null;
    }
}

async function getBloggerToken(userRefreshToken) {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: BLOGGER_CLIENT_ID,
        client_secret: BLOGGER_CLIENT_SECRET,
        refresh_token: userRefreshToken || BLOGGER_REFRESH_TOKEN,
        grant_type: 'refresh_token'
    });
    return tokenRes.data.access_token;
}

// ==========================================
// 🚀 API ROUTES
// ==========================================

app.get('/', (req, res) => res.send('🤖 PilotStaff AI Engine is Running!'));

app.post('/api/auth', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false });
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) {
        const { data: newUser } = await supabase.from('users').insert({ email }).select().single();
        return res.json({ success: true, user: newUser });
    }
    res.json({ success: true, user });
});

// TOOL 1: AI Website Builder
app.post('/api/tool/website-builder', async (req, res) => {
    const { prompt } = req.body;
    const systemPrompt = `You are an expert frontend developer. Generate a COMPLETE, single-page HTML website based on this prompt: "${prompt}". 
    Rules: 1. Return ONLY valid HTML code. No markdown, no \`\`\`html tags. 
    2. Use inline CSS or a <style> tag. Make it modern, clean, responsive.
    3. Use placeholder images from https://placehold.co/600x400/EEE/31343C?text=Image.
    4. Include navbar, hero section, features, and footer.`;

    const htmlCode = await askAI(systemPrompt);
    if (htmlCode) res.json({ success: true, code: htmlCode.replace(/```html/g, '').replace(/```/g, '') });
    else res.json({ success: false, error: "Failed to generate" });
});

// TOOL 2: AI Blog Worker
app.post('/api/tool/blog-worker', async (req, res) => {
    const { niche, blogId, userBloggerToken } = req.body;
    try {
        const articleHTML = await askAI(`Write a highly SEO optimized, 800-word blog post about "${niche}". Use H1, H2, H3 tags. Output ONLY clean HTML. Do not include <html> or <body> tags.`);
        if (!articleHTML) return res.json({ success: false, error: "AI failed" });

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Professional blog feature image about ${niche}, high quality`)}?width=1200&height=630&nologo=true`;
        const finalHTML = `<img src="${imageUrl}" alt="${niche}" style="width:100%; border-radius:8px; margin-bottom:20px;" /> ${articleHTML}`;

        const token = await getBloggerToken(userBloggerToken);
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
            kind: 'blogger#post', title: `${niche} - Ultimate Guide (2024)`, content: finalHTML, labels: [niche]
        }, { headers: { Authorization: `Bearer ${token}` } });

        res.json({ success: true, message: "Article posted successfully!" });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// TOOL 3: AI Social Manager
app.post('/api/tool/social-manager', async (req, res) => {
    const { niche, count } = req.body;
    const result = await askAI(`Give me ${count || 3} highly engaging, viral Twitter tweets about "${niche}". Include emojis and hashtags. Output STRICTLY as a JSON array of strings. Example: ["Tweet 1", "Tweet 2"]. No other text.`);
    try {
        const tweets = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, tweets });
    } catch (e) { res.json({ success: false, error: "Failed to parse" }); }
});

// TOOL 4: Video Assets
app.post('/api/tool/video-assets', async (req, res) => {
    const { topic } = req.body;
    const scriptResult = await askAI(`Give me a 30-second viral YouTube Shorts script about "${topic}". Format as JSON: {"hook": "Opening line", "body": "Main points", "cta": "Call to action"}`);
    let script = null;
    try { script = JSON.parse(scriptResult.replace(/```json/g, '').replace(/```/g, '').trim()); } catch(e) {}
    
    const thumbnailUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Clickbait YouTube thumbnail for ${topic}, text overlay space, 8k`)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
    res.json({ success: true, script, thumbnailUrl });
});

app.post('/api/admin-login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
    else res.json({ success: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 PilotStaff Engine LIVE on port ${PORT}`));
