try {
    $result = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue
    Write-Host "TcpTestSucceeded: $($result.TcpTestSucceeded)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
