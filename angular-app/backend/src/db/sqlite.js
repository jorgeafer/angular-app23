const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.resolve(process.cwd(), 'backend', 'data');
function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function resolveDatabasePath(databaseName = 'portfolio.db') {
  return path.join(dataDir, databaseName);
}

function openDatabase(databaseName = 'portfolio.db') {
  ensureDataDir();

  return new sqlite3.Database(resolveDatabasePath(databaseName));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  all,
  close,
  exec,
  get,
  openDatabase,
  resolveDatabasePath,
  run
};
