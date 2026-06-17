require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SB_URL = process.env.SB_URL;
const SB_KEY = process.env.SB_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Mrhamdu123@";
const BLOGGER_CLIENT_ID = process.env.BLOGGER_CLIENT_ID;
const BLOGGER_CLIENT_SECRET = process.env.BLOGGER_CLIENT_SECRET;
const BLOGGER_REFRESH_TOKEN = process.env.BLOGGER_REFRESH_TOKEN;

const supabase = createClient(SB_URL, SB_KEY);

async function askAI(prompt) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
        }, { headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } });
        return response.data.choices[0].message.content;
    } catch (e) { console.error("AI Error:", e.message); return null; }
}

async function getBloggerToken(userToken) {
    const res = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: BLOGGER_CLIENT_ID, client_secret: BLOGGER_CLIENT_SECRET,
        refresh_token: userToken || BLOGGER_REFRESH_TOKEN, grant_type: 'refresh_token'
    });
    return res.data.access_token;
}

app.get('/', (req, res) => res.send('🤖 PilotStaff Engine Live'));

app.post('/api/auth', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ success: false });
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) { const { data: newUser } = await supabase.from('users').insert({ email }).select().single(); return res.json({ success: true, user: newUser }); }
    res.json({ success: true, user });
});

// TOOL 1: Website Builder
app.post('/api/tool/website-builder', async (req, res) => {
    const { prompt } = req.body;
    const code = await askAI(`Generate a COMPLETE, single-page HTML website about: "${prompt}". Return ONLY valid HTML. Use inline CSS. Make it modern, responsive. Use https://placehold.co/600x400/EEE/31343C?text=Image for images. No markdown.`);
    if (code) res.json({ success: true, code: code.replace(/```html/g, '').replace(/```/g, '') });
    else res.json({ success: false });
});

// TOOL 2: Blog Writer
app.post('/api/tool/blog-writer-free', async (req, res) => {
    const { topic } = req.body;
    const article = await askAI(`Write a 1000-word SEO article about "${topic}". Use H1, H2, H3. Output ONLY clean HTML.`);
    if (article) res.json({ success: true, article: article.replace(/```html/g, '').replace(/```/g, '') });
    else res.json({ success: false });
});

// TOOL 3: Image Generator
app.post('/api/tool/image-generator', async (req, res) => {
    const { prompt } = req.body;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
    res.json({ success: true, imageUrl });
});

// TOOL 4: Hashtag Generator
app.post('/api/tool/hashtag-generator', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give 1 viral Instagram caption and 20 hashtags for "${topic}". Output STRICT JSON: {"caption": "...", "hashtags": ["tag1", "tag2"]}`);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// TOOL 5: YouTube SEO
app.post('/api/tool/youtube-seo', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give 5 viral YouTube titles and 10 SEO tags for "${topic}". Output STRICT JSON: {"titles": ["t1"], "tags": ["tag1"]}`);
    try { res.json({ success: true, data: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// TOOL 6: Social Manager
app.post('/api/tool/social-manager', async (req, res) => {
    const { niche, count } = req.body;
    const result = await askAI(`Give ${count || 3} viral tweets about "${niche}". Output STRICT JSON array: ["tweet1", "tweet2"]`);
    try { res.json({ success: true, tweets: JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim()) }); }
    catch(e) { res.json({ success: false }); }
});

// TOOL 7: Video Assets
app.post('/api/tool/video-assets', async (req, res) => {
    const { topic } = req.body;
    const scriptResult = await askAI(`30-sec viral YouTube Shorts script about "${topic}". JSON: {"hook": "...", "body": "...", "cta": "..."}`);
    let script = null;
    try { script = JSON.parse(scriptResult.replace(/```json/g, '').replace(/```/g, '').trim()); } catch(e) {}
    const thumbnailUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Clickbait YouTube thumbnail for ${topic}`)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000)}`;
    res.json({ success: true, script, thumbnailUrl });
});

// TOOL 8: Pro Auto Blogger
app.post('/api/tool/blog-worker', async (req, res) => {
    const { niche, blogId, userBloggerToken } = req.body;
    try {
        const articleHTML = await askAI(`Write 800-word SEO blog about "${niche}". Output ONLY HTML.`);
        if (!articleHTML) return res.json({ success: false, error: "AI failed" });
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`Blog feature image about ${niche}`)}?width=1200&height=630&nologo=true`;
        const finalHTML = `<img src="${imageUrl}" style="width:100%;border-radius:8px;margin-bottom:20px;" /> ${articleHTML}`;
        const token = await getBloggerToken(userBloggerToken);
        await axios.post(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
            kind: 'blogger#post', title: `${niche} - Ultimate Guide`, content: finalHTML, labels: [niche]
        }, { headers: { Authorization: `Bearer ${token}` } });
        res.json({ success: true, message: "Posted!" });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/admin-login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
    else res.json({ success: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 PilotStaff LIVE on ${PORT}`));
