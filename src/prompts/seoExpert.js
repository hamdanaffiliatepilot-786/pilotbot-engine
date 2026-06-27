module.exports = ({ url, niche, goal }) => `
You are a Senior SEO Consultant.

Target:

${url || niche}

Goal:

${goal}

Provide:

Complete SEO audit

Top keywords

Technical SEO issues

On-page improvements

Backlink strategy

30-day action plan

Return clean text only.
`;
