const axios = require('axios');
const moment = require('moment');
const {
  CRM_API_URL,
  CRM_AGGREGATOR_NAME,
  CRM_AGGREGATOR_SECRET,
  CRM_USER_LOGIN,
  CRM_USER_PASSWORD,
} = require('../config/secrets');
const CRMError = require('../errors/CRMError');

let access_token = {};
const getCredentials = async () => {
  if (access_token.token && access_token.expires_at > moment().unix()) {
    return access_token.token;
  }

  try {
    const res = await axios.post(`${CRM_API_URL}/login`, {
      login: CRM_USER_LOGIN,
      password: CRM_USER_PASSWORD,
    });

    access_token = {
      token: res.data.data.token,
      expires_at: res.data.data.expiresIn + moment().unix(),
    };

    return res.data.data.token;
  } catch (error) {
    console.log(error);
  }
};

const crmClient = axios.create({
  baseURL: CRM_API_URL,
  headers: { aggregator_name: CRM_AGGREGATOR_NAME, secret: CRM_AGGREGATOR_SECRET },
});

// interceptors
crmClient.interceptors.request.use(
  async (config) => {
    config.headers['access_token'] = await getCredentials();
    console.log(config.headers);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

crmClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    if (error.response.status === 401) {
      access_token = {};
      error.config.headers['access_token'] = await getCredentials();
      return axios.request(error.config);
    }

    return Promise.reject(
      new CRMError(
        error.response && error.response.status < 500
          ? error.response.data.error.message
          : error.message
      )
    );
  }
);

module.exports = crmClient;
