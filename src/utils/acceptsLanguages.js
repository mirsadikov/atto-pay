const acceptsLanguages = (req) => req.acceptsLanguages('en', 'ru', 'uz') || 'en';

module.exports = acceptsLanguages;
