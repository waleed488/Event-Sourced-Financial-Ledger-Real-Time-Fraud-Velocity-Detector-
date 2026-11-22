# ============================================================================
# stop-local-rs.ps1
# Cleanly stops the isolated local 3-node MongoDB replica set (ports 27027-27029).
# ============================================================================

$ports = @(27027, 27028, 27029)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $procId = $conn.OwningProcess | Select-Object -First 1
        Write-Host "[local-rs] Stopping process $procId on port $port..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "[local-rs] All local replica set nodes stopped."
