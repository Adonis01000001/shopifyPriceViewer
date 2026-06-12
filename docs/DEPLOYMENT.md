# Production Deployment Guide

## Architecture Overview

The application uses a modular monolith architecture with:
- **Frontend**: Next.js served via Nginx/IIS
- **Backend**: FastAPI served via Gunicorn
- **Database**: Microsoft SQL Server
- **Cache/Queue**: Redis
- **Process Management**: Systemd (Linux) or Windows Services

## Prerequisites

- Ubuntu 20.04+ or Windows Server 2019+
- Microsoft SQL Server 2019+
- Redis 6.0+
- Python 3.11+
- Node.js 18+
- Nginx (Linux) or IIS (Windows)

## Linux Deployment (Ubuntu 20.04+)

### 1. System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3.11 python3.11-venv python3-pip nodejs npm nginx redis-server

# Install ODBC driver for SQL Server
curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl https://packages.microsoft.com/config/ubuntu/20.04/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
sudo apt update
sudo apt install -y msodbcsql17

# Create application user
sudo useradd -m -s /bin/bash priceint
```

### 2. Deploy Backend

```bash
# Clone repository
sudo -u priceint git clone <repo-url> /home/priceint/app
cd /home/priceint/app/backend

# Setup Python environment
sudo -u priceint python3.11 -m venv venv
sudo -u priceint venv/bin/pip install -r requirements.txt
sudo -u priceint venv/bin/pip install gunicorn

# Create .env file
sudo -u priceint cp .env.example .env
# Edit .env with production settings
sudo -u priceint nano .env

# Run migrations
sudo -u priceint venv/bin/alembic upgrade head
```

### 3. Setup Backend Service

Create `/etc/systemd/system/priceint-api.service`:

```ini
[Unit]
Description=Shopify Price Intelligence API
After=network.target redis-server.service

[Service]
Type=notify
User=priceint
WorkingDirectory=/home/priceint/app/backend
Environment="PATH=/home/priceint/app/backend/venv/bin"
ExecStart=/home/priceint/app/backend/venv/bin/gunicorn \
    -w 4 \
    -k uvicorn.workers.UvicornWorker \
    -b 127.0.0.1:8000 \
    app.main:app

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable priceint-api
sudo systemctl start priceint-api
```

### 4. Setup Celery Worker

Create `/etc/systemd/system/priceint-worker.service`:

```ini
[Unit]
Description=Shopify Price Intelligence Celery Worker
After=network.target redis-server.service priceint-api.service

[Service]
Type=forking
User=priceint
WorkingDirectory=/home/priceint/app/backend
Environment="PATH=/home/priceint/app/backend/venv/bin"
ExecStart=/home/priceint/app/backend/venv/bin/celery -A app.tasks worker \
    --loglevel=info \
    --logfile=/var/log/priceint/celery-worker.log \
    --pidfile=/var/run/priceint/celery-worker.pid

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo mkdir -p /var/log/priceint /var/run/priceint
sudo chown priceint:priceint /var/log/priceint /var/run/priceint
sudo systemctl daemon-reload
sudo systemctl enable priceint-worker
sudo systemctl start priceint-worker
```

### 5. Deploy Frontend

```bash
# Build frontend
cd /home/priceint/app/frontend
sudo -u priceint npm install
sudo -u priceint npm run build

# Setup Next.js service
sudo -u priceint npm install -g pm2
```

Create `/etc/systemd/system/priceint-web.service`:

```ini
[Unit]
Description=Shopify Price Intelligence Web
After=network.target

[Service]
Type=simple
User=priceint
WorkingDirectory=/home/priceint/app/frontend
Environment="NODE_ENV=production"
Environment="NEXT_PUBLIC_API_URL=https://api.yourdomain.com"
ExecStart=/usr/bin/node /home/priceint/app/frontend/node_modules/.bin/next start -p 3000

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6. Configure Nginx

Create `/etc/nginx/sites-available/priceint`:

```nginx
upstream api {
    server 127.0.0.1:8000;
}

upstream web {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # API proxy
    location /api/ {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Frontend
    location / {
        proxy_pass http://web;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable Nginx site:
```bash
sudo ln -s /etc/nginx/sites-available/priceint /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 7. Setup SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d yourdomain.com -d www.yourdomain.com
```

## Windows Server Deployment

### 1. Install Prerequisites

- Download and install Python 3.11
- Download and install Node.js 18+
- Download and install Microsoft SQL Server 2019+
- Download and install Redis for Windows

### 2. Deploy Backend

```powershell
# Clone repository
git clone <repo-url> C:\apps\priceint
cd C:\apps\priceint\backend

# Setup Python environment
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
pip install gunicorn

# Create .env file
copy .env.example .env
# Edit .env with production settings

# Run migrations
alembic upgrade head
```

### 3. Setup Windows Service for Backend

Create `install-service.ps1`:

```powershell
$serviceName = "PriceIntAPI"
$pythonPath = "C:\apps\priceint\backend\venv\Scripts\python.exe"
$scriptPath = "C:\apps\priceint\backend\run_gunicorn.py"

# Create run_gunicorn.py
@"
import subprocess
subprocess.run([
    'gunicorn',
    '-w', '4',
    '-k', 'uvicorn.workers.UvicornWorker',
    '-b', '127.0.0.1:8000',
    'app.main:app'
])
"@ | Out-File $scriptPath

# Install service
nssm install $serviceName $pythonPath $scriptPath
nssm set $serviceName AppDirectory "C:\apps\priceint\backend"
nssm start $serviceName
```

### 4. Deploy Frontend

```powershell
cd C:\apps\priceint\frontend
npm install
npm run build
npm install -g pm2

# Start with PM2
pm2 start "npm start" --name "priceint-web"
pm2 save
pm2 startup
```

### 5. Configure IIS

1. Install IIS with URL Rewrite module
2. Create new website pointing to frontend build directory
3. Configure reverse proxy for API calls

## Database Backup

### Linux

```bash
# Backup
BACKUP_FILE="/backups/priceint_$(date +%Y%m%d_%H%M%S).bak"
sqlcmd -S localhost -U sa -P $SA_PASSWORD -Q "BACKUP DATABASE shopify_price_intelligence TO DISK='$BACKUP_FILE'"

# Automated daily backup (cron)
0 2 * * * /usr/local/bin/backup-priceint.sh
```

### Windows

```powershell
# Backup
$backupPath = "C:\Backups\priceint_$(Get-Date -Format 'yyyyMMdd_HHmmss').bak"
sqlcmd -S localhost -U sa -P $env:SA_PASSWORD -Q "BACKUP DATABASE shopify_price_intelligence TO DISK='$backupPath'"

# Scheduled task for daily backup
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$action = New-ScheduledTaskAction -Execute "C:\Scripts\backup-priceint.ps1"
Register-ScheduledTask -TaskName "PriceInt-Backup" -Trigger $trigger -Action $action
```

## Monitoring and Logging

### Backend Logs

```bash
# View logs
sudo journalctl -u priceint-api -f

# View Celery logs
sudo tail -f /var/log/priceint/celery-worker.log
```

### Database Maintenance

```sql
-- Check database size
SELECT 
    name,
    CAST(size * 8 / 1024.0 AS DECIMAL(10,2)) AS SizeMB
FROM sys.master_files
WHERE database_id = DB_ID('shopify_price_intelligence');

-- Rebuild indexes
ALTER INDEX ALL ON products REBUILD;
ALTER INDEX ALL ON competitor_products REBUILD;

-- Update statistics
UPDATE STATISTICS products;
UPDATE STATISTICS competitor_products;
```

## Performance Tuning

### SQL Server

```sql
-- Enable query optimization
ALTER DATABASE shopify_price_intelligence SET COMPATIBILITY_LEVEL = 150;

-- Create indexes for common queries
CREATE INDEX idx_products_store ON products(shopify_store_id);
CREATE INDEX idx_competitor_products_match ON competitor_products(match_score);
CREATE INDEX idx_price_history_date ON price_history(recorded_at);
```

### Redis

```bash
# Optimize memory
redis-cli CONFIG SET maxmemory-policy allkeys-lru
redis-cli CONFIG SET maxmemory 2gb
```

### Application

- Use connection pooling
- Enable caching headers
- Compress responses
- Use CDN for static assets

## Security Checklist

- [ ] Enable HTTPS/SSL
- [ ] Set strong database passwords
- [ ] Configure firewall rules
- [ ] Enable SQL Server authentication
- [ ] Rotate API keys regularly
- [ ] Enable audit logging
- [ ] Set up intrusion detection
- [ ] Regular security updates
- [ ] Backup encryption
- [ ] VPN for admin access

## Scaling

For high-traffic scenarios:

1. **Horizontal Scaling**
   - Multiple API servers behind load balancer
   - Multiple Celery workers
   - Redis cluster for caching

2. **Database Scaling**
   - SQL Server Always On availability groups
   - Read replicas for reporting
   - Partitioning for large tables

3. **Frontend Scaling**
   - CDN for static assets
   - Multiple frontend servers
   - Load balancer

## Disaster Recovery

1. **Regular backups**: Daily database backups
2. **Backup verification**: Test restore procedures
3. **Documentation**: Keep deployment documentation updated
4. **Runbooks**: Create incident response procedures
5. **Monitoring**: Set up alerts for critical systems

## Support

For deployment issues, refer to:
- Backend documentation: `docs/BACKEND.md`
- Setup guide: `docs/SETUP.md`
- API documentation: `http://api.yourdomain.com/docs`
