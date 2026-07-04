# Setup Guide - Shopify Price Intelligence

Complete setup instructions for the Shopify Price Intelligence platform.

## Quick Start

### Prerequisites

- Node.js 22.13.0 or higher
- Python 3.11 or higher
- pnpm (or npm)
- Git

### 1. Clone or Extract the Project

```bash
cd shopify-price-intelligence
```

### 2. Backend Setup

#### Step 1: Create Virtual Environment

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

#### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

#### Step 3: Configure Environment

Create a `.env` file in the backend directory:

```env
# Database Configuration
DATABASE_URL=sqlite:///./shopify_price_intelligence.db

# Frontend Configuration
FRONTEND_URL=http://localhost:3000

# Shopify Configuration (get these from Shopify App)
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SHOPIFY_SCOPES=write_products,read_products,write_orders,read_orders

# Email Configuration (for notifications)
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SENDER_EMAIL=noreply@shopifypriceintell.com

# API Configuration
API_PORT=8000
API_HOST=0.0.0.0
DEBUG=True
```

#### Step 4: Initialize Database

```bash
alembic upgrade head
```

#### Step 5: Start Backend Server

```bash
python main.py
```

The API will be available at `http://localhost:8000`
API documentation: `http://localhost:8000/docs`

### 3. Frontend Setup

#### Step 1: Install Dependencies

```bash
cd frontend
pnpm install
```

#### Step 2: Configure Environment

Create a `.env.local` file in the frontend directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SHOPIFY_API_KEY=your_shopify_api_key
```

#### Step 3: Start Development Server

```bash
pnpm dev
```

The frontend will be available at `http://localhost:3000`

## Shopify App Setup

### 1. Create a Shopify App

1. Go to [Shopify Partner Dashboard](https://partners.shopify.com)
2. Create a new app
3. Choose "Custom app" or "Public app" depending on your needs
4. Configure the app with required scopes:
   - `write_products`
   - `read_products`
   - `write_orders`
   - `read_orders`

### 2. Get API Credentials

1. In your app settings, find:
   - API Key
   - API Secret
   - Access Token (for custom apps)

2. Add these to your `.env` file

### 3. Configure OAuth Redirect URI

1. In your Shopify app settings, set the OAuth redirect URI to:

   ```
   http://localhost:3000/api/auth/callback
   ```

2. For production, use your production domain:
   ```
   https://yourdomain.com/api/auth/callback
   ```

## Database Setup

### Using SQLite (Development)

SQLite is configured by default. The database file will be created automatically at:

```
backend/shopify_price_intelligence.db
```

### Using SQL Server (Production)

1. Create a SQL Server database
2. Update the `DATABASE_URL` in `.env`:

   ```
   DATABASE_URL=mssql+pyodbc://username:password@server/database?driver=ODBC+Driver+17+for+SQL+Server
   ```

3. Run migrations:
   ```bash
   alembic upgrade head
   ```

## Email Configuration

### Using Gmail

1. Enable 2-Factor Authentication on your Gmail account
2. Create an App Password: https://myaccount.google.com/apppasswords
3. Add to `.env`:
   ```env
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your_email@gmail.com
   SMTP_PASSWORD=your_app_password
   ```

### Using Other Email Services

Update the SMTP configuration in `.env` with your provider's details.

## Verification

### Backend Health Check

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{ "status": "ok", "service": "Shopify Price Intelligence API" }
```

### Frontend Check

Open `http://localhost:3000` in your browser. You should see the landing page.

## Common Issues

### Issue: "ModuleNotFoundError: No module named 'app'"

**Solution**: Make sure you're running the backend from the `backend` directory:

```bash
cd backend
python main.py
```

### Issue: "Cannot find module 'recharts'"

**Solution**: Reinstall frontend dependencies:

```bash
cd frontend
pnpm install
```

### Issue: "Database is locked" (SQLite)

**Solution**: This happens when multiple processes access the database. For development, use only one instance of the backend.

### Issue: CORS errors when connecting frontend to backend

**Solution**: Verify the `FRONTEND_URL` in backend `.env` matches your frontend URL:

```env
FRONTEND_URL=http://localhost:3000
```

## Development Workflow

### Making Database Changes

1. Create a migration:

   ```bash
   cd backend
   alembic revision --autogenerate -m "Description of changes"
   ```

2. Review the migration file in `migrations/versions/`

3. Apply the migration:
   ```bash
   alembic upgrade head
   ```

### Adding New API Endpoints

1. Create a new router file in `backend/app/api/`
2. Define your routes using FastAPI
3. Include the router in `backend/main.py`

### Adding New Frontend Pages

1. Create a new file in `frontend/app/` following the Next.js App Router structure
2. Use existing components and styling patterns
3. Import and use Recharts for charts

## Production Deployment

### Backend Deployment

1. Set up a production SQL Server database
2. Configure environment variables on your hosting platform
3. Update `FRONTEND_URL` to your production frontend URL
4. Set `DEBUG=False`
5. Deploy the backend code

### Frontend Deployment

1. Build the frontend:

   ```bash
   cd frontend
   pnpm build
   ```

2. Deploy to Vercel, Netlify, or your preferred platform
3. Set environment variables:
   - `NEXT_PUBLIC_API_URL=https://your-api-domain.com`
   - `NEXT_PUBLIC_SHOPIFY_API_KEY=your_key`

### Shopify OAuth for Production

1. Update your Shopify app's OAuth redirect URI to your production domain
2. Update the redirect URI in your frontend code if needed

## Monitoring and Maintenance

### Check Backend Logs

```bash
# If running locally, logs appear in the terminal
# For production, check your hosting platform's logs
```

### Database Backups

For SQLite (development):

```bash
cp backend/shopify_price_intelligence.db backend/shopify_price_intelligence.db.backup
```

For SQL Server (production):
Use SQL Server's built-in backup tools or your hosting provider's backup service.

### Clearing Cache

If you encounter issues, clear browser cache:

1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty cache and hard refresh"

## Support

For issues or questions:

1. Check the main README.md
2. Review API documentation at `http://localhost:8000/docs`
3. Check browser console for frontend errors
4. Check terminal output for backend errors

## Next Steps

1. Test the OAuth flow by connecting a Shopify store
2. Add some test products
3. Add competitor URLs
4. Monitor price changes
5. Configure email notifications
6. Test alert generation

Enjoy using Shopify Price Intelligence!
