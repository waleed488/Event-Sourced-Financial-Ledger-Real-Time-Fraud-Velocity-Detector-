# ============================================================================
# start-local-rs.ps1
# Starts an isolated 3-node MongoDB 8.0 replica set ("rs0") on Windows ports
# 27027, 27028, and 27029 (avoids colliding with any standalone service on 27017).
# ============================================================================

param(
    [switch]$Wait
)

$ErrorActionPreference = "Stop"

$MongodExe = "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DataRoot = Join-Path $ProjectRoot ".local-mongo-rs"

if (-not (Test-Path $MongodExe)) {
    throw "mongod.exe not found at $MongodExe"
}

$nodes = @(
    @{ Name = "node1"; Port = 27027 },
    @{ Name = "node2"; Port = 27028 },
    @{ Name = "node3"; Port = 27029 }
)

$startedProcs = @()

foreach ($node in $nodes) {
    $dbPath = Join-Path $DataRoot "$($node.Name)\db"
    $logPath = Join-Path $DataRoot "$($node.Name)\mongod.log"
    New-Item -ItemType Directory -Force -Path $dbPath | Out-Null

    $listening = Get-NetTCPConnection -LocalPort $node.Port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        Write-Host "[local-rs] Port $($node.Port) ($($node.Name)) is already listening."
        continue
    }

    Write-Host "[local-rs] Starting $($node.Name) on port $($node.Port)..."
    $p = Start-Process -FilePath $MongodExe `
        -ArgumentList "--replSet", "rs0", "--port", "$($node.Port)", "--dbpath", "`"$dbPath`"", "--logpath", "`"$logPath`"", "--bind_ip", "127.0.0.1" `
        -WindowStyle Hidden -PassThru
    $startedProcs += $p
}

Start-Sleep -Seconds 3

$initJs = @"
try {
  const st = rs.status();
  if (st.ok === 1) { print('[local-rs] Replica set rs0 already initialized.'); }
} catch (e) {
  print('[local-rs] Initiating replica set rs0 on localhost:27027/27028/27029...');
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'localhost:27027', priority: 2 },
      { _id: 1, host: 'localhost:27028', priority: 1 },
      { _id: 2, host: 'localhost:27029', priority: 1 }
    ]
  });
}
for (let i = 0; i < 25; i++) {
  try {
    const hello = db.adminCommand({ hello: 1 });
    if (hello.isWritablePrimary) {
      print('[local-rs] PRIMARY is ready at ' + hello.me);
      quit(0);
    }
  } catch (err) {}
  sleep(1000);
}
throw new Error('Timed out waiting for PRIMARY');
"@

mongosh --host localhost --port 27027 --quiet --eval $initJs

if ($Wait -and $startedProcs.Count -gt 0) {
    Write-Host "[local-rs] Keeping replica set nodes running (-Wait)..."
    Wait-Process -Id ($startedProcs | ForEach-Object { $_.Id })
}
