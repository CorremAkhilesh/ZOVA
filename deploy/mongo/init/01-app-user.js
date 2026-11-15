// Runs ONCE, on the first start of an empty data folder (official mongo image, /docker-entrypoint-initdb.d).
// Creates the app's own user with readWrite on the app database only (enough for db:sync-indexes too).
// The root user comes from MONGO_INITDB_ROOT_*. Values come from deploy/.env.prod; nothing secret is here.
const dbName = process.env.MONGODB_DB || 'zuvo_prod';
const user = process.env.ZUVO_DB_USER;
const pwd = process.env.ZUVO_DB_PASSWORD;
if (!user || !pwd)
  throw new Error('ZUVO_DB_USER / ZUVO_DB_PASSWORD are missing in deploy/.env.prod');
db.getSiblingDB(dbName).createUser({ user, pwd, roles: [{ role: 'readWrite', db: dbName }] });
print(`created user ${user} (readWrite on ${dbName})`);
