require("dotenv").config();
const { createClient } = require("redis");
const fetchDB = require("./postgres");
const redisClient = createClient({
  url: "redis://127.0.0.1:6379",
});

redisClient.on("error", (err) => console.log("Redis Client Error", err));


fetchDB("select $1 say","hello !!!")

redisClient.connect().then(() => {
  redisClient.set("key", "value").then(() => {
    redisClient.get("key").then((data) => {
      console.log(data);
      redisClient.disconnect();
    });
  });
});
