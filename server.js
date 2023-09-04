require('dotenv').config()
const { createClient } = require('redis');
const { Client } = require('pg')

const pgClient = new Client({
	host: '127.0.0.1',
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB,
	port: process.env.DB_PORT
})
pgClient.connect().then(() => {
	pgClient.query('SELECT $1::text as message', ['Hello world!']).then((res) => {
		console.log(res.rows[0].message) // Hello world!
		pgClient.end()
	})
})

const redisClient = createClient({
	url: 'redis://127.0.0.1:6379'
});

redisClient.on('error', err => console.log('Redis Client Error', err));

redisClient.connect().then(() => {
	redisClient.set('key', 'value').then(() => {
		redisClient.get('key').then((data) => {
			console.log(data)
			redisClient.disconnect();
		})
	})
});