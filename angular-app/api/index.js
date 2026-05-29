const { createApp } = require('../backend/server');

let appPromise;

function getApp() {
  if (!appPromise) {
    appPromise = createApp();
  }
  return appPromise;
}

module.exports = async (req, res) => {
  const app = await getApp();
  app(req, res);
};
