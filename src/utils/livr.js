const LIVR = require('livr');
const extraRules = require('livr-extra-rules');
const moment = require('moment');
LIVR.Validator.registerDefaultRules(extraRules);

LIVR.Validator.registerAliasedDefaultRule({
  name: 'alphanumeric',
  rules: { like: '^(?=.*[a-zA-Z])(?=.*\\d)[a-zA-Z\\d\\S]+$' },
  error: 'NOT_ALPHANUMERIC',
});

LIVR.Validator.registerAliasedDefaultRule({
  name: 'is_phone_number',
  rules: { like: '^\\998\\d{9}$' },
  error: 'NOT_PHONE_NUMBER',
});

LIVR.Validator.registerDefaultRules({
  valid_date() {
    return (value) => {
      const date = moment(value, 'DD/MM/YYYY');
      return date.isValid() && date.isBefore(moment()) ? undefined : 'INVALID_DATE';
    };
  },
});

module.exports = LIVR;
