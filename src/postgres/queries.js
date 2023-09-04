const usersQuery = {
  post: "insert into users(name)values($1) returning *",
  getAll: "select * from users",
};

module.exports = { usersQuery };
