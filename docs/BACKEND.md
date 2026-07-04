# Backend Architecture

## Overview

The backend is built with **FastAPI** and **Python 3.11**, providing a modern, high-performance REST API for the Shopify Price Intelligence platform.

## Technology Stack

- **Framework**: FastAPI 0.104+
- **Database**: Microsoft SQL Server with SQLAlchemy ORM
- **Task Queue**: Celery + Redis
- **Authentication**: JWT + OAuth (Shopify)
- **Web Scraping**: Playwright
- **ML/Embeddings**: OpenAI API

## Project Structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI application entry point
│   ├── config.py              # Configuration management
│   ├── database.py            # Database connection and session
│   ├── models/                # SQLAlchemy ORM models
│   │   ├── user.py
│   │   ├── shopify_store.py
│   │   ├── product.py
│   │   ├── competitor_product.py
│   │   ├── price_history.py
│   │   ├── product_embedding.py
│   │   ├── alert.py
│   │   └── recommendation.py
│   ├── schemas/               # Pydantic request/response schemas
│   ├── api/                   # API route handlers
│   │   ├── auth.py
│   │   ├── products.py
│   │   ├── alerts.py
│   │   └── recommendations.py
│   ├── services/              # Business logic services
│   │   ├── product_service.py
│   │   ├── alert_service.py
│   │   └── recommendation_service.py
│   ├── matching/              # Hybrid matching engine
│   │   └── engine.py
│   ├── crawlers/              # Web scrapers
│   ├── tasks/                 # Celery background tasks
│   └── utils/                 # Utility functions
├── migrations/                # Alembic database migrations
├── requirements.txt           # Python dependencies
├── run.py                     # Development server runner
└── alembic.ini               # Alembic configuration
```

## Database Models

### Core Models

**User**

- User account management
- Shopify OAuth integration
- Email notification preferences

**ShopifyStore**

- Connected Shopify stores
- OAuth token storage
- Sync status tracking

**Product**

- Shopify products
- Pricing and inventory
- Tracking status

**CompetitorProduct**

- Competitor product tracking
- Match scoring
- Price monitoring

**PriceHistory**

- Historical price data
- Price change tracking
- Trend analysis

**ProductEmbedding**

- Text embeddings for matching
- Vector storage (JSON format)
- Similarity calculation

**Alert**

- Price alert configuration
- Trigger conditions
- Notification preferences

**Recommendation**

- Pricing recommendations
- Confidence scoring
- Implementation tracking

## API Endpoints

### Authentication

- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/auth/shopify/callback` - Shopify OAuth callback

### Products

- `POST /api/v1/products/` - Create product
- `GET /api/v1/products/{product_id}` - Get product
- `GET /api/v1/products/store/{store_id}` - List store products
- `PUT /api/v1/products/{product_id}` - Update product
- `DELETE /api/v1/products/{product_id}` - Delete product
- `POST /api/v1/products/{product_id}/track` - Enable tracking
- `POST /api/v1/products/{product_id}/untrack` - Disable tracking
- `POST /api/v1/products/{product_id}/competitors` - Add competitor
- `GET /api/v1/products/{product_id}/competitors` - List competitors

### Alerts

- `POST /api/v1/alerts/` - Create alert
- `GET /api/v1/alerts/{alert_id}` - Get alert
- `GET /api/v1/alerts/user/{user_id}` - List user alerts
- `PUT /api/v1/alerts/{alert_id}` - Update alert
- `DELETE /api/v1/alerts/{alert_id}` - Delete alert
- `POST /api/v1/alerts/{alert_id}/activate` - Activate alert
- `POST /api/v1/alerts/{alert_id}/deactivate` - Deactivate alert

### Recommendations

- `GET /api/v1/recommendations/{recommendation_id}` - Get recommendation
- `GET /api/v1/recommendations/product/{product_id}` - List recommendations
- `GET /api/v1/recommendations/product/{product_id}/latest` - Latest recommendation
- `POST /api/v1/recommendations/{product_id}/calculate` - Calculate recommendation
- `POST /api/v1/recommendations/{recommendation_id}/implement` - Implement recommendation
- `GET /api/v1/recommendations/high-confidence/list` - High confidence recommendations

## Hybrid Matching Engine

The matching engine uses a hybrid approach combining multiple techniques:

### 1. **Embedding-Based Matching** (50% weight)

- Uses OpenAI text embeddings
- Cosine similarity calculation
- Stored in SQL Server as JSON arrays

### 2. **Taxonomy-Based Matching** (30% weight)

- Category matching
- Vendor matching
- Keyword extraction and Jaccard similarity

### 3. **Merchant Feedback** (20% weight)

- Manual verification by merchants
- Confirmed matches boost confidence

### 4. **Price Similarity** (Filtering)

- Products within 20% price range considered similar
- Used for filtering, not scoring

## Configuration

Environment variables are loaded from `.env` file:

```env
# Database
DATABASE_URL=mssql+pyodbc://sa:password@localhost:1433/shopify_price_intelligence?driver=ODBC+Driver+17+for+SQL+Server

# API
API_HOST=0.0.0.0
API_PORT=8000
SECRET_KEY=your-secret-key

# Shopify
SHOPIFY_API_KEY=your-key
SHOPIFY_API_SECRET=your-secret

# OpenAI
OPENAI_API_KEY=your-key

# Redis
REDIS_URL=redis://localhost:6379/0

# Email
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email
SMTP_PASSWORD=your-password
```

## Running the Backend

### Development

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Access API at `http://localhost:8000`
Access API docs at `http://localhost:8000/docs`

### Production

```bash
gunicorn -w 4 -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:8000
```

## Database Migrations

### Create Migration

```bash
alembic revision --autogenerate -m "Add new table"
```

### Apply Migration

```bash
alembic upgrade head
```

### Rollback

```bash
alembic downgrade -1
```

## Services

### ProductService

- Product CRUD operations
- Embedding storage and retrieval
- Product tracking management

### AlertService

- Alert CRUD operations
- Alert activation/deactivation
- Alert triggering and notification

### RecommendationService

- Recommendation calculation
- Price analysis based on competitors
- Recommendation implementation tracking

## Background Tasks (Celery)

Planned background tasks:

- Product synchronization from Shopify
- Competitor price scraping
- Embedding generation
- Alert checking and notification
- Recommendation generation

## Security

- Password hashing with bcrypt
- JWT token authentication
- CORS configuration
- SQL injection prevention (SQLAlchemy)
- Environment variable management

## Error Handling

- Comprehensive exception handling
- Proper HTTP status codes
- Detailed error messages in development
- Generic error messages in production

## Testing

```bash
pytest tests/
pytest --cov=app tests/  # With coverage
```

## Performance Optimization

- Connection pooling
- Query optimization
- Caching with Redis
- Async task processing
- Database indexing on frequently queried columns
