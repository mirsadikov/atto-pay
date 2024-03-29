const fetchDB = require('../postgres/index');
const { categoriesQuery } = require('../postgres/queries');
const acceptsLanguages = require('../utils/acceptsLanguages');

function getCategories(req, res, next) {
  const lang = acceptsLanguages(req);

  fetchDB(categoriesQuery.getAll, [lang], (err, result) => {
    if (err) return next(err);

    res.status(200).send({
      count: result.rowCount,
      categories: result.rows,
    });
  });
}

module.exports = {
  getCategories,
};
