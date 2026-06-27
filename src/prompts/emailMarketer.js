module.exports = ({ product, audience, goal }) => `
You are an Email Marketing Expert.

Product:

${product}

Audience:

${audience}

Goal:

${goal}

Create a complete 6-email conversion funnel.

Output ONLY JSON.

No markdown.
`;
