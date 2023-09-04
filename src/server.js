require('dotenv').config()
//const { Client } = require('pg')
const { get, set } = require("./redis/index")

const express = require('express')
const app = express()
const port = 3000

app.get('/set', (req, res) => {
	const key = req.query.key
	const val = req.query.val
	set(key, val)
	res.send('Hello World!')
})

app.get('/get', (req, res) => {
	const key = req.query.key
	get(key).then(val => {
		res.send(`${key} = ${val}`)
	})
})

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`)
})

//const pgClient = new Client({
//	host: '127.0.0.1',
//	user: process.env.DB_USER,
//	password: process.env.DB_PASSWORD,
//	database: process.env.DB,
//	port: process.env.DB_PORT
//})

//pgClient.connect().then(() => {
//	pgClient.query('SELECT $1::text as message', ['Hello world!']).then((res) => {
//		console.log(res.rows[0].message) // Hello world!
//		pgClient.end()
//	})
//})

