const axios = require('axios');
const { CRM_API_URL } = require('../config/secrets');

const crmClient = axios.create({
  baseURL: CRM_API_URL,
});

// interceptors
// crmClient.interceptors.request.use(
//   (config) => {
//     return config;
//   },
//   (error) => {
//     return Promise.reject(error);
//   }
// );

// crmClient.interceptors.response.use(
//   (response) => {
//     return response;
//   },
//   (error) => {
//     return Promise.reject(error);
//   }
// );

module.exports = crmClient;
