const moment = require('moment');
const redis = require('../redis/index');
const CustomError = require('../errors/CustomError');

async function limiter(limitName, deviceId, action, cb) {
  try {
    let tries = await redis.hGet(limitName, deviceId);

    if (tries) {
      tries = JSON.parse(tries);
      console.log(tries);

      if (tries.blocked) {
        const unblockAt = moment(tries.last).add(120, 'seconds');
        const timeLeft = unblockAt.diff(moment(), 'seconds');

        if (timeLeft > 0) {
          throw new CustomError('TRY_AGAIN_AFTER', null, { timeLeft });
        }

        tries.blocked = false;
        tries.last = null;
      }
    } else {
      tries = {
        last: null,
        safe_try_after: 0,
        blocked: false,
      };
    }

    const result = await action();

    const triedSafe = tries.last
      ? moment().isAfter(moment(tries.last).add(tries.safe_try_after, 'seconds'))
      : true;

    if (triedSafe) {
      tries.safe_try_after = tries.last
        ? Math.max(120 - moment().diff(tries.last, 'seconds'), 0)
        : 0;
    } else {
      tries.blocked = true;
      tries.safe_try_after = 0;
    }

    tries.last = moment().valueOf();

    console.log(tries);

    await redis.hSet(limitName, deviceId, JSON.stringify(tries));

    const canTryAgain = !tries.blocked;
    cb(null, canTryAgain, result);
  } catch (error) {
    cb(error);
  }
}

module.exports = limiter;
