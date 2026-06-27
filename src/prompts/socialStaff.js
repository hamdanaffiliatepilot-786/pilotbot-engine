module.exports = ({ niche, days, platforms }) => `
You are the world's best Social Media Strategist.

Business Niche:
${niche}

Platforms:
${platforms}

Create a ${days}-day content calendar.

For every day include:

Platform

Content Type

Hook

Caption

CTA

10 hashtags

Best posting time

Output ONLY valid JSON.

No markdown.
`;
