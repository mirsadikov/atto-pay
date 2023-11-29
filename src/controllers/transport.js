const async = require('async');
const crmClient = require('../utils/crmClient');
const redisClient = require('../redis');

function getStations(req, res, next) {
  async.waterfall(
    [
      // get stations from redis
      (cb) => {
        redisClient.get('metro_stations', (err, stations) => {
          if (err) return cb(err);

          if (stations) {
            return cb(null, JSON.parse(stations));
          }

          cb(null, null);
        });
      },
      // get stations from crm
      (stations, cb) => {
        if (stations) {
          return cb(null, stations);
        }

        crmClient
          .get('/station/list')
          .then((response) => {
            const stations = response.data.result;
            redisClient.set('metro_stations', JSON.stringify(stations));
            cb(null, stations);
          })
          .catch((err) => {
            cb(err);
          });
      },
    ],
    (err, stations) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        lines: stations.items,
      });
    }
  );
}

module.exports = {
  getStations,
};
