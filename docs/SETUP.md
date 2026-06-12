# Setup Instructions

## Prerequisites

- Python 3.11+
- Node.js 18+
- Microsoft SQL Server 2019+ (local or remote)
- Redis (for task queue)
- Git

## Windows Local Development Setup

### 1. Install SQL Server

Download and install Microsoft SQL Server 2019 or later from [Microsoft SQL Server](https://www.microsoft.com/en-us/sql-server/sql-server-downloads).

Create a database:
```sql
CREATE DATABASE shopify_price_intelligence;
```

### 2. Install Redis

Download and install Redis from [Redis Windows](https://github.com/microsoftarchive/redis/releases) or use Windows Subsystem for Linux (WSL).

### 3. Clone and Setup Project

```bash
git clone <repository-url>
cd shopify-price-intelligence
cp .env.example .env
```

### 4. Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env` file in backend directory:
```env
DATABASE_URL=mssql+pyodbc://sa:YourPassword@localhost:1433/shopify_price_intelligence?driver=ODBC+Driver+17+for+SQL+Server
REDIS_URL=redis://localhost:6379/0
SHOPIFY_API_KEY=your_key
SHOPIFY_API_SECRET=your_secret
OPENAI_API_KEY=your_key
SECRET_KEY=your-secret-key-change-in-production
```

Run migrations:
```bash
alembic upgrade head
```

Start backend server:
```bash
python run.py
```

Backend will be available at `http://localhost:8000`

### 5. Frontend Setup

```bash
cd frontend
npm install
```

Create `.env.local` file:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=Shopify Price Intelligence
```

Start frontend development server:
```bash
npm run dev
```

Frontend will be available at `http://localhost:3000`

### 6. Celery Worker (Optional)

In a new terminal:
```bash
cd backend
venv\Scripts\activate
celery -A app.tasks worker --loglevel=info
```

## Access the Application

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- API Documentation: `http://localhost:8000/docs`

## Database Migrations

### Create a new migration
```bash
cd backend
alembic revision --autogenerate -m "Description of changes"
```

### Apply migrations
```bash
alembic upgrade head
```

### Rollback migrations
```bash
alembic downgrade -1
```

## Environment Variables

### Backend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| DATABASE_URL | SQL Server connection string | mssql+pyodbc://sa:password@localhost:1433/db |
| REDIS_URL | Redis connection string | redis://localhost:6379/0 |
| SHOPIFY_API_KEY | Shopify app API key | your_key |
| SHOPIFY_API_SECRET | Shopify app API secret | your_secret |
| OPENAI_API_KEY | OpenAI API key | sk-... |
| SECRET_KEY | JWT secret key | your-secret |
| API_HOST | API host | 0.0.0.0 |
| API_PORT | API port | 8000 |
| ENVIRONMENT | Environment | development |

### Frontend (.env.local)

| Variable | Description | Example |
|----------|-------------|---------|
| NEXT_PUBLIC_API_URL | Backend API URL | http://localhost:8000 |
| NEXT_PUBLIC_APP_NAME | Application name | Shopify Price Intelligence |

## Troubleshooting

### SQL Server Connection Issues

1. Ensure SQL Server is running
2. Check connection string in .env
3. Verify ODBC driver is installed: `pip install pyodbc`
4. On Windows, install "ODBC Driver 17 for SQL Server"

### Redis Connection Issues

1. Ensure Redis is running
2. Check Redis URL in .env
3. Test connection: `redis-cli ping`

### Python Dependencies Issues

```bash
# Clear pip cache
pip cache purge

# Reinstall dependencies
pip install -r requirements.txt --force-reinstall
```

### Node Dependencies Issues

```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
npm install --force
```

## Production Deployment

See `docs/DEPLOYMENT.md` for production deployment instructions.

## Development Tips

1. Use `npm run dev` for hot-reload frontend development
2. Use `python run.py` for auto-reloading backend (requires `reload=True` in config)
3. Check API docs at `http://localhost:8000/docs` for available endpoints
4. Use browser DevTools to debug frontend issues
5. Check backend logs for API errors

## Testing

### Backend Tests
```bash
cd backend
pytest tests/
pytest --cov=app tests/  # With coverage
```

### Frontend Tests
```bash
cd frontend
npm test
npm run test:coverage  # With coverage
```

## Common Commands

### Backend
```bash
# Start development server
python run.py

# Run migrations
alembic upgrade head

# Create migration
alembic revision --autogenerate -m "message"

# Start Celery worker
celery -A app.tasks worker --loglevel=info

# Run tests
pytest

# Format code
black app/

# Lint code
flake8 app/
```

### Frontend
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint

# Format code
npm run format
```

## Next Steps

1. Configure Shopify OAuth credentials
2. Set up email notifications (SMTP)
3. Configure OpenAI API key for embeddings
4. Connect your first Shopify store
5. Add products to track
6. Set up price alerts
7. Monitor competitor prices
