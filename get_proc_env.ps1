$proc = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-5) } | Select-Object -First 1
Write-Host "PID: $($proc.Id)"
$proc.Environment.GetEnumerator() | Sort-Object Key | ForEach-Object {
    Write-Host "$($_.Key)=$($_.Value)"
}
