const gmail = require('../utils/gmail');

const sendVerification = async (email, code, callback) => {
  const subject = 'Verify your email';
  const text = `Your verification code is: ${code}`;
  const html = `<p>Your verification code is: <b>${code}</b></p>`;

  const result = await gmail.sendEmail({ to: email, subject, text, html });
  callback(null, result);
};

module.exports = { sendVerification };
