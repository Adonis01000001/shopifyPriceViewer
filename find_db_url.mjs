import { execSync } from 'child_process';

try {
  const output = execSync(
    'powershell -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddHours(-1) } | ForEach-Object { $_.Environment.GetEnumerator() | Where-Object { $_.Key -match \'DATABASE|PG\' } | ForEach-Object { \"$($_.Key)=$($_.Value)\" } }"',
    { encoding: 'utf8', timeout: 10000 }
  );
  console.log(output);
} catch (err) {
  console.log('Error:', err.message);
}
