// Docker healthcheck for the mongo service: `mongosh --quiet --norc /opt/zuvo-mongo/healthcheck.js`.
// It signs in as root from the container's environment, so no password is ever on a command line
// (other users of the shared server could read it with `ps`).
// First start: turns this single node into the replica set rs0 (host mongo:27017). Zuvo uses
// transactions, which MongoDB allows only on a replica set. Healthy = this node is the writable primary.
const admin = db.getSiblingDB('admin');
admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
try {
  rs.status();
} catch (e) {
  if (e.codeName !== 'NotYetInitialized') throw e;
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
}
quit(admin.hello().isWritablePrimary ? 0 : 1);
