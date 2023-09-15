const LIVR = require('livr');
const extraRules = require('livr-extra-rules');
LIVR.Validator.registerDefaultRules(extraRules);

LIVR.Validator.registerAliasedDefaultRule({
  name: 'alphanumeric',
  rules: { like: '^(?=.*[a-zA-Z])(?=.*\\d)[a-zA-Z\\d]+$' },
  error: 'ONLY_ALPHANUMERIC_ALLOWED',
});

module.exports = LIVR;
