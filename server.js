// ==========================================
// 🆕 NEW TOOL ENDPOINTS
// ==========================================

app.post('/api/tool/business-name-generator', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Topic required" });
    const result = await askAI(`Generate 20 catchy business names for "${input}". For each name, suggest if the .com domain might be available. Output STRICT JSON: {"names": ["Name1 (domain likely available)", "Name2", ...]}`);
    try {
        const parsed = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch(e) { res.json({ success: false, error: "Failed to generate names" }); }
});

app.post('/api/tool/meta-tag-generator', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Topic required" });
    const result = await askAI(`Generate perfect SEO meta tags for a page about "${input}". Output STRICT JSON: {"title": "SEO title (under 60 chars)", "description": "Meta description (under 160 chars)", "keywords": ["kw1", "kw2"], "og_title": "Open Graph title", "og_description": "OG description", "og_type": "website"}`);
    try {
        const parsed = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch(e) { res.json({ success: false, error: "Failed to generate meta tags" }); }
});

app.post('/api/tool/privacy-policy-generator', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Website description required" });
    const html = await askAI(`Write a complete, professional Privacy Policy for: ${input}. Include sections: Information Collection, How We Use Data, Cookies, Third Parties, Data Security, User Rights, Changes to Policy, Contact. Output as clean HTML with proper h2, h3, p tags. No markdown.`);
    if (html) res.json({ success: true, article: html });
    else res.json({ success: false, error: "Failed to generate" });
});

app.post('/api/tool/terms-generator', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Business description required" });
    const html = await askAI(`Write complete Terms & Conditions for: ${input}. Include: Service Description, User Responsibilities, Payments, Intellectual Property, Prohibited Use, Limitation of Liability, Governing Law, Contact. Output as clean HTML. No markdown.`);
    if (html) res.json({ success: true, article: html });
    else res.json({ success: false, error: "Failed to generate" });
});

app.post('/api/tool/resume-builder', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Experience/skills required" });
    const html = await askAI(`Create a professional, ATS-friendly resume in HTML format based on: "${input}". Include: Header with name/contact, Professional Summary, Work Experience, Skills, Education. Use clean styling with inline CSS. Make it look professional. Output as HTML only.`);
    if (html) res.json({ success: true, article: html });
    else res.json({ success: false, error: "Failed to generate" });
});

app.post('/api/tool/paragraph-rewriter', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Text required" });
    const result = await askAI(`Rewrite the following paragraph while keeping the exact same meaning but using different words and sentence structure. Make it sound natural and professional:\n\n"${input}"\n\nOutput ONLY the rewritten paragraph, nothing else.`);
    if (result) res.json({ success: true, text: result });
    else res.json({ success: false, error: "Failed to rewrite" });
});

app.post('/api/tool/ad-copy-generator', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Product/service required" });
    const result = await askAI(`Generate 5 high-converting ad copies for: "${input}". Include copies for Facebook, Instagram, and Google Ads. Output STRICT JSON: {"copy": ["Ad copy 1 with headline and body", "Ad copy 2", ...]}`);
    try {
        const parsed = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch(e) { res.json({ success: false, error: "Failed to generate ad copy" }); }
});

app.post('/api/tool/email-writer', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Email context required" });
    const result = await askAI(`Write 3 professional email variations for: "${input}". Output STRICT JSON: {"emails": ["Email option 1 with subject line and body", "Email option 2", "Email option 3"]}`);
    try {
        const parsed = JSON.parse(result.replace(/```json/g, '').replace(/```/g, '').trim());
        res.json({ success: true, data: parsed });
    } catch(e) { res.json({ success: false, error: "Failed to generate emails" }); }
});

app.post('/api/tool/invoice-generator', async (req, res) => {
    const { topic, prompt } = req.body;
    const input = sanitize(topic || prompt);
    if (!input) return res.json({ success: false, error: "Invoice details required" });
    const html = await askAI(`Create a professional invoice in HTML format for: "${input}". Include: Company header, Invoice number, Date, Bill To, Item description, Hours/Qty, Rate, Amount, Subtotal, Tax, Total, Payment terms, Bank details. Use inline CSS for professional styling. Output as HTML only.`);
    if (html) res.json({ success: true, article: html });
    else res.json({ success: false, error: "Failed to generate invoice" });
});

// ==========================================
// 📲 TELEGRAM PAYMENT NOTIFICATION
// ==========================================
app.post('/api/paypal-webhook', async (req, res) => {
    console.log("✅ PayPal Webhook hit:", JSON.stringify(req.body));
    
    // Send Telegram notification
    const amount = req.body?.purchase_units?.[0]?.amount?.value || 'Unknown';
    const email = req.body?.payer?.email_address || 'Unknown';
    
    await sendTelegram(
        `💰 <b>NEW PAYMENT RECEIVED!</b>\n` +
        `💵 Amount: $${amount}\n` +
        `👤 Email: ${email}\n` +
        `🕐 Time: ${new Date().toLocaleString('en-IN')}\n` +
        `📅 Plan: Pro Bundle`,
        true // Send to channel
    );
    
    // TODO: Verify webhook signature
    // TODO: Update user plan in Supabase
    // TODO: Send welcome email via Resend
    
    res.status(200).send('OK');
});

// ==========================================
// 📢 DAILY TELEGRAM CHANNEL UPDATE
// ==========================================
// Schedule daily update at 10 AM
cron.schedule('0 10 * * *', async () => {
    if (!TELEGRAM_CHANNEL_ID) return;
    
    const tip = await askAI('Give one short, actionable business tip (1-2 sentences) that small business owners would find valuable. Be specific and practical.');
    
    if (tip) {
        await sendTelegram(
            `💡 <b>Daily Business Tip</b>\n\n${tip}\n\n🤖 Powered by PilotStaff AI\n🔗 https://pilotstaff.vercel.app\n\n#BusinessTips #AI #PilotStaff`,
            true
        );
    }
    
    console.log('📢 Daily Telegram update sent');
});
