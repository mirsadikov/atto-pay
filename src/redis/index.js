const { createClient } = require('redis');

const redisClient = createClient({
	url: 'redis://127.0.0.1:6379'
});

redisClient.on('error', err => console.log('Redis Client Error', err));

redisClient.connect().then(() => {

});

async function set(key, val) {
	redisClient.set('key', 'value')
}

async function get(key, val) {
	redisClient.get('key')
}

exports.modules = { get, set }
//redisClient.disconnect();