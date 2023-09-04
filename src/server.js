require("dotenv").config();
const fetchDB = require("./postgres");
const { usersQuery } = require("./postgres/queries");
const { get, set } = require("./redis/index");

const express = require("express");
const app = express();
const port = 3000;
app.use(express.json());
app.get("/set", (req, res) => {
  const key = req.query.key;
  const val = req.query.val;
  set(key, val);
  res.send("Hello World!");
});

app.get("/get", (req, res) => {
  const key = req.query.key;
  get(key).then((val) => {
    res.send(`${key} = ${val}`);
  });
});

app.post("/users", (req, res) => {
  const { name } = req.body;

  fetchDB(usersQuery.post, name).then((response) => {
    res.json({ user: response.rows });
  });
});

app.get("/users", (req, res) => {
  
  fetchDB(usersQuery.getAll).then((response) => {
    res.json({ user: response.rows });
  })
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
