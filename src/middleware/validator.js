const { err } = require('../utils/helpers');

function validate(data, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (rules.required && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) {
      errors.push({ field, message: `${field} is required` });
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rules.type) {
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push({ field, message: `${field} must be text` });
      }
      if (rules.type === 'number' && typeof value !== 'number') {
        errors.push({ field, message: `${field} must be a number` });
      }
      if (rules.type === 'boolean' && typeof value !== 'boolean') {
        errors.push({ field, message: `${field} must be true or false` });
      }
    }

    if (rules.max && typeof value === 'string' && value.length > rules.max) {
      errors.push({ field, message: `${field} must be under ${rules.max} characters` });
    }

    if (rules.min && typeof value === 'string' && value.length < rules.min) {
      errors.push({ field, message: `${field} must be at least ${rules.min} characters` });
    }

    if (rules.enum && !rules.enum.includes(value)) {
      errors.push({ field, message: `${field} must be one of: ${rules.enum.join(', ')}` });
    }

    if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push({ field, message: `${field} must be a valid email` });
    }

    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push({ field, message: `${field} format is invalid` });
    }

    // New: noSpecialChars (alphanumeric + spaces only)
    if (rules.noSpecialChars && !/^[a-zA-Z0-9\s\-_.]+$/.test(value)) {
      errors.push({ field, message: `${field} contains invalid characters` });
    }

    // New: url validation
    if (rules.url && !/^https?:\/\/.+\..+/.test(value)) {
      errors.push({ field, message: `${field} must be a valid URL starting with http:// or https://` });
    }
  }

  return errors;
}

module.exports = { validate };
