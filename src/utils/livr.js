const LIVR = require('livr');
const extraRules = require('livr-extra-rules');
LIVR.Validator.registerDefaultRules(extraRules);

LIVR.Validator.registerAliasedDefaultRule({
  name: 'alphanumeric',
  rules: { like: '^(?=.*[a-zA-Z])(?=.*\\d)[a-zA-Z\\d]+$' },
  error: 'NOT_ALPHANUMERIC',
});

LIVR.Validator.registerAliasedDefaultRule({
  name: 'is_phone_number',
  rules: { like: '^\\998\\d{9}$' },
  error: 'NOT_PHONE_NUMBER',
});

module.exports = LIVR;
