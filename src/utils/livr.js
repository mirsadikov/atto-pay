const LIVR = require('livr');

LIVR.Validator.registerAliasedDefaultRule({
  name: 'alphanumeric',
  rules: { like: '^(?=.*[a-zA-Z])(?=.*\\d)[a-zA-Z\\d]+$' },
  error: 'ONLY_ALPHANUMERIC_ALLOWED',
});

module.exports = LIVR;
