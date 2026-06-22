const { env } = require('../config/env');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';

const toolRoutes = [
    // === VIRAL TOOLS ===
    {
        path: 'ai-humanizer',
        prompt: (t) => `You are an expert AI Humanizer. Rewrite the following text to sound 100% human-written. Remove AI cliches like "delve", "tapestry", "moreover", "furthermore", "in conclusion", "landscape", "realm", "testament", "pivotal", "seamless", "navigating the complexities". Use varied sentence lengths. Add slight imperfections in flow that humans naturally have. Use conversational transitions. Keep the exact same meaning and facts. Do NOT add new information. Do NOT add hashtags or bullet points unless the original had them.\n\nText to humanize: "${t}"\n\nOUTPUT ONLY THE HUMANIZED TEXT. No explanations.`
    },
    {
        path: 'seo-audit-checker',
        prompt: (t) => `Act as a strict Technical SEO Auditor with 15 years of experience. Analyze this website/URL: "${t}". Give a realistic score out of 100. Format STRICTLY as JSON: {"score": 85, "grade": "B", "summary": "One line summary", "critical_issues": [{"issue": "Exact issue name", "impact": "High", "fix": "Exact step to fix"}], "warnings": [{"issue": "Exact issue name", "impact": "Medium", "fix": "Exact step to fix"}], "passed": ["Check name that passed"], "top_recommendation": "The single most important thing to fix first"} Give at least 3 critical issues, 3 warnings, and 3 passed checks. OUTPUT ONLY JSON.`
    },
    {
        path: 'youtube-to-blog',
        prompt: (t) => `Convert this YouTube video transcript/content into a highly engaging, SEO-optimized blog post: "${t}". Requirements: 1. Write a catchy H1 title with primary keyword. 2. Write a 150-char meta description. 3. Break into 5-6 H2 sections with engaging subheadings. 4. Remove all filler words. 5. Add bullet points for key takeaways. 6. Include internal link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. 7. Add conclusion with CTA. OUTPUT ONLY HTML.`
    },

    // === CONTENT CREATION ===
    {
        path: 'ai-website-builder',
        prompt: (t) => `Create a COMPLETE single-page website for "${t}". Inline CSS only. Include: sticky navbar with "PilotStaff" logo, hero with gradient and CTA, 6 feature cards in grid, how-it-works 3 steps, 3 testimonials with stars, pricing table 3 plans (Free/$0, Pro/$29, Enterprise/$99) with Pro highlighted, FAQ accordion, footer. Modern, responsive. OUTPUT ONLY HTML.`
    },
    {
        path: 'blog-writer-free',
        prompt: (t) => `Write a 1500+ word SEO blog about "${t}". H1 with keyword. First 155 chars as meta description. 5-6 H2 sections. Short paragraphs. Bullet lists. Include: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a> and <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">AI blog writer</a>. Conclusion with CTA. OUTPUT ONLY HTML.`
    },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    {
        path: 'paragraph-rewriter',
        prompt: (t) => `Rewrite this paragraph to be more engaging, professional, and readable. Improve vocabulary and flow while keeping ALL original facts and meaning. Do NOT add new information. Make it sound human-written, not AI-generated.\n\nParagraph: "${t}"\n\nOUTPUT ONLY THE REWRITTEN PARAGRAPH. No explanations.`
    },
    {
        path: 'ad-copy-generator',
        prompt: (t) => `Generate 5 ad copies for "${t}". 2 Facebook, 2 Google, 1 Instagram. Each with headline and body. Use AIDA framework. OUTPUT JSON: {"copy":[{"platform":"facebook","headline":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'email-writer',
        prompt: (t) => `Write 3 emails for "${t}". Cold outreach, follow-up, newsletter. Each with subject line under 50 chars. OUTPUT JSON: {"emails":[{"type":"cold","subject":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'landing-page-copywriter',
        prompt: (t) => `Write 3 landing page copy variations for "${t}" using AIDA framework. Each with headline, subheadline, CTA, benefits, social proof. OUTPUT JSON: {"copy":[{"headline":"...","subheadline":"...","cta":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'ai-code-generator',
        prompt: (t) => `Generate code for: "${t}". Include working code, explanation, and usage example. OUTPUT JSON: {"code":"...","explanation":"...","usage":"..."} No markdown.`
    },
    {
        path: 'meeting-notes-generator',
        prompt: (t) => `Convert these meeting notes into a structured format: "${t}". OUTPUT JSON: {"meeting_title":"...","date":"...","attendees":["..."],"key_decisions":["..."],"action_items":[{"task":"...","assignee":"...","deadline":"..."}],"summary":"..."} No markdown.`
    },

    // === DESIGN & MEDIA ===
    {
        path: 'youtube-thumbnail-prompt',
        prompt: (t) => `Generate 5 viral YouTube thumbnail concepts for: "${t}". Each with emotion, text overlay, visual description, color scheme. OUTPUT JSON: {"thumbnails":[{"emotion":"...","text":"...","visual":"...","colors":"..."}]} No markdown.`
    },

    // === SEO & MARKETING ===
    {
        path: 'meta-tag-generator',
        prompt: (t) => `Generate SEO meta tags for "${t}". Title under 60 chars, description 150-155 chars, 10 keywords, og_title, og_description. OUTPUT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.`
    },
    {
        path: 'youtube-seo',
        prompt: (t) => `Generate 5 YouTube titles (under 70 chars, high CTR) and 10 SEO tags for "${t}". OUTPUT JSON: {"titles":["..."],"tags":["..."]} No markdown.`
    },
    {
        path: 'ai-hashtag-generator',
        prompt: (t) => `Generate 1 engaging caption and 20 viral hashtags for "${t}". Mix small, medium, and large hashtags. OUTPUT JSON: {"caption":"...","hashtags":["#..."]} No markdown.`
    },
    {
        path: 'website-auditor',
        prompt: (t) => `Perform a complete SEO audit for: "${t}". Cover: technical SEO, on-page SEO, content quality, backlink profile, mobile optimization, page speed. Give specific actionable fixes with priority levels. OUTPUT CLEAN TEXT.`
    },
    {
        path: 'competitor-analyzer',
        prompt: (t) => `Analyze competitor "${t}". Find: keyword gaps, content gaps, backlink opportunities, traffic sources, top performing pages, content strategy. Give actionable steps to outrank them. OUTPUT CLEAN TEXT.`
    },
    {
        path: 'schema-generator',
        prompt: (t) => `Generate 4 JSON-LD schemas for "${t}": BlogPosting, Product, FAQPage, Organization. Valid structured data. OUTPUT JSON: {"schemas":[{"@type":"BlogPosting",...}]} No markdown.`
    },
    {
        path: 'content-calendar',
        prompt: (t) => `30-day content calendar for "${t}". Each day: topic, keyword, content type, platform. OUTPUT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"Website"}]} No markdown.`
    },
    {
        path: 'content-repurposer',
        prompt: (t) => `Repurpose "${t}" into 5 formats: Twitter thread, LinkedIn post, newsletter section, Instagram caption, YouTube hook. Platform-optimized. OUTPUT JSON: {"formats":[{"type":"...","content":"..."}]} No markdown.`
    },

    // === BUSINESS & LEGAL ===
    {
        path: 'business-name-generator',
        prompt: (t) => `Generate 20 business names for "${t}". Format: "Name — Tagline | domain.com". Creative, memorable, brandable. OUTPUT JSON: {"names":["..."]} No markdown.`
    },
    {
        path: 'startup-ideas',
        prompt: (t) => `Generate 5 startup ideas for "${t}". Each: name, problem, market size, revenue model, startup cost, 5 launch steps. OUTPUT JSON: {"ideas":[{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["..."]}]} No markdown.`
    },
    {
        path: 'product-description',
        prompt: (t) => `Write 3 product descriptions for "${t}". E-commerce optimized with benefits, features, social proof, SEO keywords. OUTPUT JSON: {"descriptions":[{"headline":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'invoice-generator',
        prompt: (t) => `Create invoice for "${t}". INV-${Math.floor(Math.random() * 9000) + 1000}. Date: ${new Date().toLocaleDateString()}. Professional inline CSS. OUTPUT ONLY HTML.`
    },
    {
        path: 'privacy-policy-generator',
        prompt: (t) => `Write complete Privacy Policy for ${t}. 10 sections. Legal tone. OUTPUT ONLY HTML.`
    },
    {
        path: 'terms-generator',
        prompt: (t) => `Write complete Terms of Service for ${t}. 10 sections. Legal tone. OUTPUT ONLY HTML.`
    },

    // === SOCIAL & PERSONAL ===
    {
        path: 'social-bio-generator',
        prompt: (t) => `Generate bios for "${t}". Instagram (150 chars), Twitter (160 chars), LinkedIn (260 chars), TikTok (80 chars). Each engaging and platform-optimized. OUTPUT JSON: {"platforms":[{"platform":"instagram","bio":"..."},{"platform":"twitter","bio":"..."},{"platform":"linkedin","bio":"..."},{"platform":"tiktok","bio":"..."}]} No markdown.`
    },
    {
        path: 'resume-builder',
        prompt: (t) => `Create ATS-friendly resume for ${t}. Header, summary, experience with metrics, skills, education. Clean inline CSS. OUTPUT ONLY HTML.`
    },
    {
        path: 'review-response-generator',
        prompt: (t) => `Write professional responses for review: "${t}". Generate responses for 1-star, 3-star, and 5-star reviews. Each empathetic and brand-positive. OUTPUT JSON: {"responses":[{"stars":1,"response":"..."},{"stars":3,"response":"..."},{"stars":5,"response":"..."}]} No markdown.`
    },

    // === PRODUCTIVITY ===
    {
        path: 'ai-translator',
        prompt: (t) => `Detect language and translate to English. If already English, translate to Spanish. Text: "${t}". OUTPUT JSON: {"detected_language":"...","translated_text":"...","pronunciation":"..."} No markdown.`
    },
    {
        path: 'ai-quote-generator',
        prompt: (t) => `Generate 10 original, shareable quotes about "${t}". Each with the quote and a fictional author name + category. OUTPUT JSON: {"quotes":[{"quote":"...","author":"...","category":"..."}]} No markdown.`
    },
    {
        path: 'website-roaster',
        prompt: (t) => `You are a savage, hilarious website reviewer. Roast this website: "${t}". FORMAT STRICTLY AS:\n🔥 FIRST IMPRESSION (1-2 sentences)\n🎭 DESIGN ROAST\n📝 CONTENT ROAST\n🔍 SEO ROAST\n⚖️ THE VERDICT\n💡 ACTUALLY USEFUL ADVICE (3 bullet points)\nBe sarcastic and funny. Use emojis. Under 300 words. OUTPUT CLEAN TEXT.`
    },
];

module.exports = { toolRoutes };
