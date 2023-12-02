const { CRM_SMS_SERVICE_SECRET } = require('../config/secrets');
const crmClient = require('./crmClient'); // axios instance

const sendSms = async (phone, msg) => {
  const response = await crmClient.post(
    '/customer/send-sms',
    { phone, msg },
    {
      headers: {
        secret: CRM_SMS_SERVICE_SECRET,
      },
    }
  );

  return response;
};

const sendVerification = async (phone, code) => {
  try {
    const msg = `AttoPay: Your verification code is ${code}`;
    const response = await sendSms(phone, msg);
    return response;
  } catch (error) {
    throw error;
  }
};

module.exports = { sendVerification };
