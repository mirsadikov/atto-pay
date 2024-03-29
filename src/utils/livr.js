const LIVR = require('livr');
const extraRules = require('livr-extra-rules');
const moment = require('moment');
const luhn = require('fast-luhn');

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
  past_date(offset = 0) {
    return (value) => {
      if (!value) return;

      const date = moment(value, 'DD/MM/YYYY');
      if (!date.isValid()) return 'INVALID_DATE';

      date.add(offset, 'hours');

      if (!date.isBefore(moment())) return 'INVALID_DATE';
      return;
    };
  },

  valid_pan() {
    return (value) => {
      if (!value) return;

      if (!luhn(value) || !value.match(/^\d{16}$/)) return 'PAN_NOT_VALID';
      return;
    };
  },
});

module.exports = LIVR;
