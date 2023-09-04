const { createClient } = require('redis');

const redisClient = createClient({
	url: 'redis://127.0.0.1:6379'
});

redisClient.on('error', err => console.log('Redis Client Error', err));

redisClient.connect()

function set(key, val) {
	redisClient.set(key, val)
}

function get(key) {	
	return redisClient.get(key).then((val) => val)
}

module.exports = { get, set }
//redisClient.disconnect();