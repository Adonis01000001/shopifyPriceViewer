Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddHours(-1) } | ForEach-Object {
    $proc = $_
    $proc.Environment.GetEnumerator() | Where-Object { $_.Key -match 'DATABASE|PG|JWT|NODE_ENV' } | ForEach-Object {
        Write-Host "PID=$($proc.Id) $($_.Key)=$($_.Value)"
    }
}
