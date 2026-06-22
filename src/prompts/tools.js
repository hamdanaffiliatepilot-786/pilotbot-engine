const { env } = require('../config/env');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';

const toolRoutes = [
    // ─── VIRAL TOOLS (Sabse upar — SEO ranking ke liye) ───
    {
        path: 'ai-humanizer',
        prompt: (t) => `You are an expert AI Humanizer. Rewrite the following text to make it sound 100% human-written. Remove AI cliches like "delve", "tapestry", "moreover", "furthermore", "in conclusion", "landscape", "realm", "testament", "pivotal", "seamless", "navigating the complexities". Use varied sentence lengths (some very short, some longer). Add slight imperfections in flow that humans naturally have. Use conversational transitions. Keep the exact same meaning and facts. Do NOT add new information. Do NOT add hashtags or bullet points unless the original had them.\n\nText to humanize: "${t}"\n\nOUTPUT ONLY THE HUMANIZED TEXT. No explanations. No markdown wrappers.`
    },
    {
        path: 'seo-audit-checker',
        prompt: (t) => `Act as a strict Technical SEO Auditor with 15 years of experience. Analyze this website/URL: "${t}". Give a realistic score out of 100. Format STRICTLY as JSON: {"score": 85, "grade": "B", "summary": "One line summary", "critical_issues": [{"issue": "Exact issue name", "impact": "High", "fix": "Exact step to fix"}], "warnings": [{"issue": "Exact issue name", "impact": "Medium", "fix": "Exact step to fix"}], "passed": ["Check name that passed"], "top_recommendation": "The single most important thing to fix first"} Give at least 3 critical issues, 3 warnings, and 3 passed checks. Be realistic with the score. OUTPUT ONLY JSON. No markdown.`
    },
    {
        path: 'youtube-to-blog',
        prompt: (t) => `Convert this YouTube video transcript/content into a highly engaging, SEO-optimized blog post: "${t}". Requirements: 1. Write a catchy H1 title (include primary keyword). 2. Write a 150-char meta description. 3. Break into 5-6 H2 sections with engaging subheadings. 4. Remove all filler words (um, uh, like, you know, basically, actually). 5. Add bullet points for key takeaways after each section. 6. Include internal link: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a>. 7. Add a conclusion with CTA. OUTPUT ONLY HTML. No markdown.`
    },

    // ─── HIGH TRAFFIC TOOLS ───
    {
        path: 'website-builder',
        prompt: (t) => `Create a COMPLETE single-page website for "${t}". Inline CSS only. Include: sticky navbar with "PilotStaff" logo, hero with gradient and CTA, 6 feature cards in grid, how-it-works 3 steps, 3 testimonials with stars, pricing table 3 plans (Free/$0, Pro/$29, Enterprise/$99) with Pro highlighted, FAQ accordion, footer. Modern, responsive. OUTPUT ONLY HTML.`
    },
    {
        path: 'blog-writer-free',
        prompt: (t) => `Write a 1500+ word SEO blog about "${t}". H1 with keyword. First 155 chars as meta description. 5-6 H2 sections. Short paragraphs. Bullet lists. Include: <a href="${WEBSITE_URL}/tools" style="color:#2563eb;font-weight:600;">free AI tools</a> and <a href="${WEBSITE_URL}/tools/ai-blog-writer" style="color:#2563eb;font-weight:600;">AI blog writer</a>. Conclusion with CTA. OUTPUT ONLY HTML.`
    },
    { path: 'image-generator', type: 'image' },
    { path: 'logo-maker', type: 'logo' },
    {
        path: 'meta-tag-generator',
        prompt: (t) => `Generate SEO meta tags for "${t}". Title under 60 chars, description 150-155 chars, 10 keywords, og_title, og_description. OUTPUT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.`
    },
    {
        path: 'schema-generator',
        prompt: (t) => `Generate 4 JSON-LD schemas for "${t}": BlogPosting, Product, FAQPage, Organization. OUTPUT JSON: {"schemas":[{"@type":"BlogPosting",...}]} No markdown.`
    },
    {
        path: 'ad-copy-generator',
        prompt: (t) => `Generate 5 ad copies for "${t}". 2 Facebook, 2 Google, 1 Instagram. Each with headline and body. OUTPUT JSON: {"copy":[{"platform":"facebook","headline":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'email-writer',
        prompt: (t) => `Write 3 emails for "${t}". Cold, follow-up, newsletter. Each with subject. OUTPUT JSON: {"emails":[{"type":"cold","subject":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'hashtag-generator',
        prompt: (t) => `Generate 1 caption + 20 hashtags for "${t}". OUTPUT JSON: {"caption":"...","hashtags":["#..."]} No markdown.`
    },
    {
        path: 'youtube-seo',
        prompt: (t) => `Generate 5 YouTube titles and 10 SEO tags for "${t}". OUTPUT JSON: {"titles":["..."],"tags":["..."]} No markdown.`
    },
    {
        path: 'product-description',
        prompt: (t) => `Write 3 product descriptions for "${t}". OUTPUT JSON: {"descriptions":[{"headline":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'startup-ideas',
        prompt: (t) => `Generate 5 startup ideas for "${t}". Each: name, problem, market, revenue, cost, steps. OUTPUT JSON: {"ideas":[{"name":"...","problem":"...","market":"...","revenue":"...","cost":"...","steps":["..."]}]} No markdown.`
    },
    {
        path: 'content-repurposer',
        prompt: (t) => `Repurpose "${t}" into 5 formats: Twitter thread, LinkedIn post, newsletter section, Instagram caption, YouTube hook. OUTPUT JSON: {"formats":[{"type":"...","content":"..."}]} No markdown.`
    },
    {
        path: 'competitor-analyzer',
        prompt: (t) => `Analyze competitor "${t}". Keyword gaps, content gaps, backlink opportunities. Give actionable steps. OUTPUT CLEAN TEXT.`
    },
    {
        path: 'content-calendar',
        prompt: (t) => `30-day content calendar for "${t}". OUTPUT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"Website"}]} No markdown.`
    },
    {
        path: 'ai-translator',
        prompt: (t) => `Detect language and translate to English. If English, translate to Spanish. Text: "${t}". OUTPUT JSON: {"detected_language":"...","translated_text":"...","pronunciation":"..."} No markdown.`
    },
    {
        path: 'ai-code-generator',
        prompt: (t) => `Generate code for: "${t}". Include code, explanation, usage. OUTPUT JSON: {"code":"...","explanation":"...","usage":"..."} No markdown.`
    },
    {
        path: 'landing-page-copywriter',
        prompt: (t) => `Write 3 landing page copies for "${t}". OUTPUT JSON: {"copy":[{"headline":"...","subheadline":"...","cta":"...","body":"..."}]} No markdown.`
    },
    {
        path: 'business-name-generator',
        prompt: (t) => `Generate 20 business names for "${t}". Format: "Name — Tagline | domain.com". OUTPUT JSON: {"names":["..."]} No markdown.`
    },

    // ─── UTILITY TOOLS (Neeche — kam traffic) ───
    {
        path: 'privacy-policy-generator',
        prompt: (t) => `Write complete Privacy Policy for ${t}. 10 sections. Legal tone. OUTPUT ONLY HTML.`
    },
    {
        path: 'terms-generator',
        prompt: (t) => `Write complete Terms of Service for ${t}. 10 sections. Legal tone. OUTPUT ONLY HTML.`
    },
    {
        path: 'resume-builder',
        prompt: (t) => `Create ATS-friendly resume for ${t}. Header, summary, experience, skills, education. Inline CSS. OUTPUT ONLY HTML.`
    },
    {
        path: 'invoice-generator',
        prompt: (t) => `Create invoice for "${t}". INV-${Math.floor(Math.random() * 9000) + 1000}. Date: ${new Date().toLocaleDateString()}. Inline CSS. OUTPUT ONLY HTML.`
    },
    {
        path: 'website-roaster',
        prompt: (t) => `You are a savage, hilarious website reviewer. Roast this website: "${t}". FORMAT STRICTLY AS:\n🔥 FIRST IMPRESSION (1-2 sentences, savage but funny)\n🎨 DESIGN ROAST (mock the colors, layout, fonts)\n📝 CONTENT ROAST (mock the copy, grammar, cringe factors)\n🔍 SEO ROAST (mock their SEO efforts)\n⚖️ THE VERDICT (1-2 sentences funny conclusion)\n💡 ACTUALLY USEFUL ADVICE (3 bullet points of real, actionable advice)\n\nBe sarcastic and funny, but don't be mean. Use emojis. Keep it under 300 words total. OUTPUT CLEAN TEXT.`
    },
];

module.exports = { toolRoutes };
