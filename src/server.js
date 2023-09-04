require('dotenv').config()
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

app.post('/users',(req,res)=>{
    
})

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`)
})


