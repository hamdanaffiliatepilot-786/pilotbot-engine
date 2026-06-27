const { Router } = require("express");
const { sanitizeText, extractJSON } = require("../../utils/sanitize");
const { err } = require("../../utils/helpers");
const { CACHE_TTL } = require("../../config/constants");
const { runAgent } = require("../../services/agentRunner");

const router = Router();

/*
|--------------------------------------------------------------------------
| Social Staff
|--------------------------------------------------------------------------
*/

router.post("/social-staff", async (req, res) => {

    const niche = sanitizeText(req.body.niche || "", 500);
    const days = Math.min(Math.max(parseInt(req.body.days) || 7, 1), 30);
    const platforms = sanitizeText(
        req.body.platforms || "Instagram, Twitter, LinkedIn",
        500
    );

    if (!niche)
        return err(res, "Niche is required", 400);

    return runAgent({

        req,
        res,

        agent: "social-staff",

        cacheKey: `social:${niche}:${days}:${platforms}`,

        ttl: CACHE_TTL.AGENT_RESULT,

        parser: extractJSON,

        prompt: `
Create ${days} days social media content.

Niche:
${niche}

Platforms:
${platforms}

Return ONLY JSON.

{
 "days":[]
}
`
    });

});

/*
|--------------------------------------------------------------------------
| Content Writer
|--------------------------------------------------------------------------
*/

router.post("/content-writer", async (req, res) => {

    const topic = sanitizeText(req.body.topic || "", 500);
    const wordCount = Math.min(Math.max(parseInt(req.body.wordCount) || 1500, 300), 5000);
    const tone = sanitizeText(req.body.tone || "professional", 100);

    if (!topic)
        return err(res, "Topic required", 400);

    return runAgent({

        req,
        res,

        agent: "content-writer",

        cacheKey: `content:${topic}:${wordCount}:${tone}`,

        ttl: CACHE_TTL.AGENT_RESULT,

        prompt: `
Write ${wordCount} words SEO article.

Topic:

${topic}

Tone:

${tone}

Return HTML only.
`

    });

});

/*
|--------------------------------------------------------------------------
| SEO Expert
|--------------------------------------------------------------------------
*/

router.post("/seo-expert", async (req, res) => {

    const url = sanitizeText(req.body.url || "", 500);
    const niche = sanitizeText(req.body.niche || "", 500);
    const goal = sanitizeText(req.body.goal || "rank higher", 200);

    if (!url && !niche)
        return err(res, "URL or niche required", 400);

    return runAgent({

        req,
        res,

        agent: "seo-expert",

        cacheKey: `seo:${url || niche}:${goal}`,

        ttl: CACHE_TTL.AGENT_RESULT,

        prompt: `
Act as Senior SEO Consultant.

Target:

${url || niche}

Goal:

${goal}

Provide:

Top keywords

Technical audit

Content gaps

Backlinks

30 day action plan.
`

    });

});

/*
|--------------------------------------------------------------------------
| Email Marketer
|--------------------------------------------------------------------------
*/

router.post("/email-marketer", async (req, res) => {

    const product = sanitizeText(req.body.product || "", 500);
    const audience = sanitizeText(req.body.audience || "", 500);

    if (!product)
        return err(res, "Product required", 400);

    return runAgent({

        req,
        res,

        agent: "email-marketer",

        cacheKey: `email:${product}:${audience}`,

        ttl: CACHE_TTL.AGENT_RESULT,

        parser: extractJSON,

        prompt: `
Create 6 email marketing sequence.

Product:

${product}

Audience:

${audience}

Return ONLY JSON.
`

    });

});

/*
|--------------------------------------------------------------------------
| Video Script Writer
|--------------------------------------------------------------------------
*/

router.post("/video-scriptwriter", async (req, res) => {

    const topic = sanitizeText(req.body.topic || "", 500);
    const platform = sanitizeText(req.body.platform || "youtube", 100);
    const duration = sanitizeText(req.body.duration || "10 minutes", 50);

    if (!topic)
        return err(res, "Topic required", 400);

    return runAgent({

        req,
        res,

        agent: "video-scriptwriter",

        cacheKey: `video:${topic}:${platform}:${duration}`,

        ttl: CACHE_TTL.AGENT_RESULT,

        prompt: `
Write a professional video script.

Topic:

${topic}

Platform:

${platform}

Duration:

${duration}

Include:

Hook

Intro

Body

CTA

Outro
`

    });

});

module.exports = router;
