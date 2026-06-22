const { sanitizeText } = require('../utils/sanitize');

function getAgentSystemPrompt(agentId, setup, task) {
    const profile = `Business Name: ${setup?.business_name || 'Unknown'}
Business Type: ${setup?.business_type || 'General'}
Website: ${setup?.website_url || 'N/A'}
Audience: ${setup?.target_audience || 'General audience'}
Goals: ${setup?.goals || 'Grow business'}
Tone: ${setup?.brand_tone || 'Professional'}
Services: ${setup?.services || 'N/A'}
Offers: ${setup?.offers || 'N/A'}
Channels: ${setup?.channels || 'N/A'}
FAQs: ${setup?.faq || 'N/A'}`;

    const taskPrompt = sanitizeText(task?.prompt || '', 8000);

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

module.exports = { getAgentSystemPrompt };
