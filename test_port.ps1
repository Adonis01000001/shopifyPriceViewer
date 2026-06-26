$tcp = New-Object System.Net.Sockets.TcpClient
try {
    $tcp.Connect("127.0.0.1", 3002)
    Write-Host "Connected: True"
    $tcp.Close()
} catch {
    Write-Host "Connected: False - $($_.Exception.Message)"
}
