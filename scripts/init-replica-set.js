// ============================================================================
// init-replica-set.js
// Runs inside mongo-init (mongosh) to initialize the 3-node replica set "rs0"
// and wait until one node becomes PRIMARY before the API container starts.
// ============================================================================

function waitForPrimary() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const hello = db.adminCommand({ hello: 1 });
      if (hello.isWritablePrimary) {
        print("[mongo-init] Replica set is ready. PRIMARY:", hello.me);
        return;
      }
    } catch (err) {
      // Ignore transient errors while election is in progress
    }
    print(`[mongo-init] Waiting for PRIMARY election (attempt ${attempt}/30)...`);
    sleep(2000);
  }
  throw new Error("Timed out waiting for MongoDB replica set PRIMARY.");
}

// Step 1: Check if replica set is already configured (e.g., on container restart)
let alreadyInitiated = false;
try {
  const status = rs.status();
  if (status.ok === 1) {
    alreadyInitiated = true;
    print("[mongo-init] Replica set 'rs0' is already initialized.");
  }
} catch (err) {
  // Code 94 = NotYetInitialized (expected on first boot)
  if (err.code !== 94) {
    print("[mongo-init] rs.status() check returned:", err.message);
  }
}

// Step 2: Initiate replica set with mongo1 given priority 2 for predictable primary
if (!alreadyInitiated) {
  print("[mongo-init] Initiating replica set 'rs0'...");
  const result = rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongo1:27017", priority: 2 },
      { _id: 1, host: "mongo2:27017", priority: 1 },
      { _id: 2, host: "mongo3:27017", priority: 1 }
    ]
  });
  printjson(result);
}

// Step 3: Block until a writable PRIMARY is available
waitForPrimary();
