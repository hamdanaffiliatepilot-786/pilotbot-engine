// --- ADD THESE 4 ROUTES IN server.js ---

// TOOL 5: AI Blog Writer (Just Text, no blogger post - for SEO traffic)
app.post('/api/tool/blog-writer-free', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Write a highly SEO optimized, 1000-word article about "${topic}". Use H1, H2, H3 tags. Make it engaging. Output ONLY clean HTML.`);
    if (result) res.json({ success: true, article: result.replace(/```html/g, '').replace(/```/g, '') });
    else res.json({ success: false });
});

// TOOL 6: AI Image Generator (Pollinations - Massive Traffic Magnet)
app.post('/api/tool/image-generator', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.json({ success: false });
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
    res.json({ success: true, imageUrl });
});

// TOOL 7: Instagram/TikTok Hashtag & Caption Generator
app.post('/api/tool/hashtag-generator', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give me 1 highly engaging Instagram caption and 20 viral hashtags for a post about "${topic}". Output STRICTLY as JSON: {"caption": "...", "hashtags": ["tag1", "tag2"]}`);
    try {
        const data = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, data });
    } catch(e) { res.json({ success: false }); }
});

// TOOL 8: YouTube Title & Tags Generator
app.post('/api/tool/youtube-seo', async (req, res) => {
    const { topic } = req.body;
    const result = await askAI(`Give me 5 viral YouTube video titles and 10 SEO tags for a video about "${topic}". Output STRICTLY as JSON: {"titles": ["t1", "t2"], "tags": ["tag1", "tag2"]}`);
    try {
        const data = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, data });
    } catch(e) { res.json({ success: false }); }
});
