/**
 * Strip ALL HTML — DB mein store karne ke liye
 */
function sanitizeText(input, max = 5000) {
    if (typeof input !== 'string') return input;
    let str = input.trim().substring(0, max);
    str = str.replace(/<[^>]*>/g, '');
    str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    str = str.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    return str;
}

/**
 * Structural HTML allow karo but dangerous elements hatao — AI generated content ke liye
 */
function sanitizeHTML(html, max = 50000) {
    if (typeof html !== 'string') return html;
    let str = html.trim().substring(0, max);
    str = str.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
    str = str.replace(/<script[\s\S]*$/gi, '');
    str = str.replace(/<style[\s\S]*?<\/style\s*>/gi, '');
    str = str.replace(/<style[\s\S]*$/gi, '');
    str = str.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    str = str.replace(/\s+on\w+\s*=\s*[^\s"'>]+/gi, '');
    str = str.replace(/href\s*=\s*["']?\s*javascript\s*:/gi, 'href="#"');
    str = str.replace(/src\s*=\s*["']?\s*javascript\s*:/gi, 'src="#"');
    str = str.replace(/src\s*=\s*["']?\s*data\s*:/gi, 'src="#"');
    str = str.replace(/vbscript\s*:/gi, '');
    str = str.replace(/<(object|embed|iframe|form|input|button|select|textarea|base|link|meta)[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    str = str.replace(/<(object|embed|iframe|form|input|button|select|textarea|base|link|meta)[^>]*\/?>/gi, '');
    str = str.replace(/style\s*=\s*["'][^"']*expression\s*\([^"']*["']/gi, 'style=""');
    str = str.replace(/style\s*=\s*["'][^"']*url\s*\(\s*javascript\s*:[^"']*["']/gi, 'style=""');
    return str;
}

/**
 * AI response se JSON extract karo (markdown wrappers handle karo)
 */
function extractJSON(text) {
    if (!text) return null;
    text = text.trim();
    try { return JSON.parse(text); } catch {}

    const patterns = [
        /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/,
        /\{[\s\S]*\}/,
        /\[[\s\S]*\]/
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            try { return JSON.parse(match[1] || match[0]); } catch {}
        }
    }
    return null;
}

module.exports = { sanitizeText, sanitizeHTML, extractJSON };
