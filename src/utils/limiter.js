const moment = require('moment');
const redis = require('../redis/index');

class Limiter {
  #tries = {
    last: null,
    safe_try_after: 0,
    blocked: false,
  };

  constructor(limitName, deviceId) {
    this.limitName = limitName;
    this.deviceId = deviceId;
  }

  async getStatus(cb) {
    try {
      let tries = await redis.hGet(this.limitName, this.deviceId);
      if (!tries) return cb(null, { isBlocked: false });

      this.#tries = JSON.parse(tries);
      if (this.#tries.blocked === false) return cb(null, { isBlocked: false });

      const unblockAt = moment(this.#tries.last).add(120, 'seconds');
      const timeLeft = unblockAt.diff(moment(), 'seconds');

      if (timeLeft > 0) return cb(null, { isBlocked: true, timeLeft });

      this.#tries.blocked = false;
      this.#tries.last = null;
      await redis.hSet(this.limitName, this.deviceId, JSON.stringify(this.#tries));

      return cb(null, { isBlocked: false });
    } catch (error) {
      cb(error);
    }
  }

  async record(increaseAttempt, cb) {
    try {
      if (increaseAttempt) {
        const triedSafe = this.#tries.last
          ? moment().isAfter(moment(this.#tries.last).add(this.#tries.safe_try_after, 'seconds'))
          : true;

        if (triedSafe) {
          this.#tries.safe_try_after = this.#tries.last
            ? Math.max(120 - moment().diff(this.#tries.last, 'seconds'), 0)
            : 0;
        } else {
          this.#tries.blocked = true;
          this.#tries.safe_try_after = 0;
        }

        this.#tries.last = moment().valueOf();

        await redis.hSet(this.limitName, this.deviceId, JSON.stringify(this.#tries));

        const canTryAgain = !this.#tries.blocked;
        const newTimeLeft = canTryAgain ? undefined : 120;
        cb({ error: null, canTryAgain, timeLeft: newTimeLeft });
      } else {
        redis.hDel(this.limitName, this.deviceId);
        cb({});
      }
    } catch (error) {
      cb({ error });
    }
  }
}

module.exports = Limiter;
