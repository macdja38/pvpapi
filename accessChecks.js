const r = require("./db");

module.exports = {
  checkPvPClientAccessingOwnDataIDInParams(req, res, next) {
    let clientID = req.params.id;
    if (!clientID) {
      res.status(400).send("id header not present")
    }
    r.table("settingsBot").get(clientID).run().then((settings) => {
      if (settings === null || settings.token !== req.headers.token) {
        res.sendStatus(403);
      }
      next();
    });
  },
  checkPvPClientAccessingOwnDataIDInHeaders(req, res, next) {
    let clientID = req.headers.id;
    if (!clientID) {
      res.status(400).send("id header not present")
    }
    r.table("settingsBot").get(clientID).run().then((settings) => {
      if (settings === null || settings.token !== req.headers.token) {
        res.sendStatus(403);
      }
      next();
    });
  }
};