Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-5) } | ForEach-Object {
    $proc = $_
    Write-Host "PID: $($proc.Id) Started: $($proc.StartTime)"
    $proc.Environment.GetEnumerator() | Where-Object { $_.Key -match 'DATABASE|PG|JWT' } | ForEach-Object {
        Write-Host "  $($_.Key)=$($_.Value)"
    }
}
