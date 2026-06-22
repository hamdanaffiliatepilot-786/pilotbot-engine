const { env } = require('../config/env');
const WEBSITE_URL = env('WEBSITE_URL') || 'https://pilotstaff.com';

const toolRoutes = [
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
        path: 'business-name-generator',
        prompt: (t) => `Generate 20 business names for "${t}". Format: "Name — Tagline | domain.com". OUTPUT JSON: {"names":["..."]} No markdown.`
    },
    {
        path: 'meta-tag-generator',
        prompt: (t) => `Generate SEO meta tags for "${t}". Title under 60 chars, description 150-155 chars, 10 keywords, og_title, og_description. OUTPUT JSON: {"title":"...","description":"...","keywords":["..."],"og_title":"...","og_description":"..."} No markdown.`
    },
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
        path: 'paragraph-rewriter',
        prompt: (t) => `Rewrite this professionally: "${t}". Better vocabulary, improved flow. OUTPUT ONLY TEXT.`
    },
    {
        path: 'ad-copy-generator',
        prompt: (t) => `Generate 5 ad copies for "${t}". 2 Facebook, 2 Google, 1 Instagram. OUTPUT JSON: {"copy":["..."]} No markdown.`
    },
    {
        path: 'email-writer',
        prompt: (t) => `Write 3 emails for "${t}". Cold, follow-up, newsletter. Each with subject. OUTPUT JSON: {"emails":["Subject: ...\n\nBody..."]} No markdown.`
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
        path: 'invoice-generator',
        prompt: (t) => `Create invoice for "${t}". INV-${Math.floor(Math.random() * 9000) + 1000}. Date: ${new Date().toLocaleDateString()}. Inline CSS. OUTPUT ONLY HTML.`
    },
    {
        path: 'social-bio-generator',
        prompt: (t) => `Generate bios for "${t}". Instagram (150), Twitter (160), LinkedIn (220), TikTok (150). OUTPUT JSON: {"platforms":[{"platform":"Instagram","bio":"..."}]} No markdown.`
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
        prompt: (t) => `Repurpose "${t}" into 5 formats: Twitter, LinkedIn, newsletter, Instagram, YouTube hook. OUTPUT JSON: {"formats":[{"type":"...","content":"..."}]} No markdown.`
    },
    {
        path: 'website-auditor',
        prompt: (t) => `Audit "${t}" for SEO. Technical, Content, On-page, Off-page. OUTPUT CLEAN TEXT.`
    },
    {
        path: 'landing-page-copywriter',
        prompt: (t) => `Write 3 landing page copies for "${t}". OUTPUT JSON: {"copy":["HEADLINE: ...\\nSUBHEADLINE: ...\\n\\n..."]} No markdown.`
    },
    {
        path: 'competitor-analyzer',
        prompt: (t) => `Analyze competitor "${t}". Keyword gaps, content gaps, backlinks. OUTPUT CLEAN TEXT.`
    },
    {
        path: 'schema-generator',
        prompt: (t) => `Generate 4 JSON-LD schemas for "${t}": BlogPosting, Product, FAQPage, Organization. OUTPUT JSON: {"schemas":[{"@type":"BlogPosting",...}]} No markdown.`
    },
    {
        path: 'content-calendar',
        prompt: (t) => `30-day content calendar for "${t}". OUTPUT JSON: {"calendar":[{"day":1,"topic":"...","keyword":"...","type":"Blog","platform":"Website"}]} No markdown.`
    },
    {
        path: 'review-response-generator',
        prompt: (t) => `Write review responses for "${t}". 5,4,3,2,1 star. OUTPUT JSON: {"responses":[{"stars":5,"response":"..."}]} No markdown.`
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
        path: 'youtube-thumbnail-prompt',
        prompt: (t) => `Generate 5 YouTube thumbnail concepts for "${t}". OUTPUT JSON: {"thumbnails":[{"visual":"...","text":"...","colors":"...","emotion":"..."}]} No markdown.`
    },
    {
        path: 'ai-quote-generator',
        prompt: (t) => `Generate 10 quotes about "${t}". OUTPUT JSON: {"quotes":[{"quote":"...","author":"...","category":"..."}]} No markdown.`
    },
    {
        path: 'meeting-notes-generator',
        prompt: (t) => `Convert meeting notes: "${t}". OUTPUT JSON: {"meeting_title":"...","attendees":["..."],"key_decisions":["..."],"action_items":[{"task":"...","assignee":"...","deadline":"..."}],"summary":"..."} No markdown.`
    },
    {
        path: 'website-roaster',
        prompt: (t) => `You are a savage, hilarious website reviewer. Roast this website: "${t}". FORMAT STRICTLY AS:
🔥 FIRST IMPRESSION (1-2 sentences, savage but funny)
🎨 DESIGN ROAST (mock the colors, layout, fonts)
📝 CONTENT ROAST (mock the copy, grammar, cringe factors)
🔍 SEO ROAST (mock their SEO efforts)
⚖️ THE VERDICT (1-2 sentences funny conclusion)
💡 ACTUALLY USEFUL ADVICE (3 bullet points of real, actionable advice)

Be sarcastic and funny, but don't be mean. Use emojis. Keep it under 300 words total. OUTPUT CLEAN TEXT.`
    },
];

module.exports = { toolRoutes };
