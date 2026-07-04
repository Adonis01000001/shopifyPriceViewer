# API Documentation

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

All endpoints (except `/auth/register` and `/auth/login`) require authentication via JWT token.

Include the token in the `Authorization` header:

```
Authorization: Bearer <token>
```

## Endpoints

### Authentication

#### Register User

```
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "username",
  "password": "password",
  "full_name": "John Doe"
}

Response: 200 OK
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": true,
  "is_verified": false,
  "email_notifications": true,
  "notification_frequency": "daily",
  "created_at": "2024-01-01T00:00:00",
  "updated_at": "2024-01-01T00:00:00",
  "last_login": null
}
```

#### Login User

```
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}

Response: 200 OK
{
  "user_id": "uuid",
  "email": "user@example.com",
  "message": "Login successful"
}
```

#### Shopify OAuth Callback

```
GET /auth/shopify/callback?code=<code>&shop=<shop>

Response: 200 OK
{
  "status": "success",
  "message": "Shopify store connected"
}
```

### Products

#### Create Product

```
POST /products
Content-Type: application/json
Authorization: Bearer <token>

{
  "shopify_store_id": "store-uuid",
  "title": "Product Title",
  "description": "Product description",
  "sku": "SKU123",
  "price": 99.99,
  "compare_at_price": 129.99,
  "category": "Electronics",
  "vendor": "Vendor Name"
}

Response: 200 OK
{
  "id": "product-uuid",
  "shopify_store_id": "store-uuid",
  "title": "Product Title",
  "description": "Product description",
  "sku": "SKU123",
  "price": 99.99,
  "compare_at_price": 129.99,
  "quantity": 0,
  "category": "Electronics",
  "vendor": "Vendor Name",
  "is_active": true,
  "is_tracked": false,
  "created_at": "2024-01-01T00:00:00",
  "updated_at": "2024-01-01T00:00:00",
  "synced_at": "2024-01-01T00:00:00"
}
```

#### Get Product

```
GET /products/{product_id}
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "product-uuid",
  "shopify_store_id": "store-uuid",
  "title": "Product Title",
  ...
}
```

#### List Store Products

```
GET /products/store/{store_id}?skip=0&limit=100
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "product-uuid",
    "title": "Product Title",
    ...
  }
]
```

#### Update Product

```
PUT /products/{product_id}
Content-Type: application/json
Authorization: Bearer <token>

{
  "title": "Updated Title",
  "price": 89.99,
  "is_tracked": true
}

Response: 200 OK
{
  "id": "product-uuid",
  "title": "Updated Title",
  "price": 89.99,
  "is_tracked": true,
  ...
}
```

#### Delete Product

```
DELETE /products/{product_id}
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Product deleted"
}
```

#### Track Product

```
POST /products/{product_id}/track
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Product tracking enabled",
  "product_id": "product-uuid"
}
```

#### Untrack Product

```
POST /products/{product_id}/untrack
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Product tracking disabled",
  "product_id": "product-uuid"
}
```

#### Add Competitor Product

```
POST /products/{product_id}/competitors
Content-Type: application/json
Authorization: Bearer <token>

{
  "competitor_name": "Amazon",
  "competitor_url": "https://amazon.com/product",
  "title": "Competitor Product",
  "price": 79.99,
  "currency": "USD"
}

Response: 200 OK
{
  "id": "competitor-uuid",
  "product_id": "product-uuid",
  "competitor_name": "Amazon",
  "competitor_url": "https://amazon.com/product",
  "title": "Competitor Product",
  "price": 79.99,
  "currency": "USD",
  "match_score": 0.0,
  "match_method": "embedding",
  "is_active": true,
  "is_verified": false,
  "created_at": "2024-01-01T00:00:00",
  "updated_at": "2024-01-01T00:00:00",
  "last_scraped": null
}
```

#### Get Competitor Products

```
GET /products/{product_id}/competitors
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "competitor-uuid",
    "competitor_name": "Amazon",
    "price": 79.99,
    "match_score": 0.85,
    ...
  }
]
```

### Alerts

#### Create Alert

```
POST /alerts
Content-Type: application/json
Authorization: Bearer <token>

{
  "user_id": "user-uuid",
  "alert_type": "price_drop",
  "product_id": "product-uuid",
  "trigger_price": 79.99,
  "trigger_condition": "below",
  "notify_email": true,
  "notify_in_app": true,
  "description": "Alert when price drops below $80"
}

Response: 200 OK
{
  "id": "alert-uuid",
  "user_id": "user-uuid",
  "alert_type": "price_drop",
  "product_id": "product-uuid",
  "trigger_price": 79.99,
  "trigger_condition": "below",
  "is_active": true,
  "is_triggered": false,
  "notify_email": true,
  "notify_in_app": true,
  "created_at": "2024-01-01T00:00:00",
  "updated_at": "2024-01-01T00:00:00",
  "expires_at": null
}
```

#### Get Alert

```
GET /alerts/{alert_id}
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "alert-uuid",
  "alert_type": "price_drop",
  ...
}
```

#### List User Alerts

```
GET /alerts/user/{user_id}
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "alert-uuid",
    "alert_type": "price_drop",
    ...
  }
]
```

#### Update Alert

```
PUT /alerts/{alert_id}
Content-Type: application/json
Authorization: Bearer <token>

{
  "alert_type": "price_increase",
  "trigger_price": 99.99
}

Response: 200 OK
{
  "id": "alert-uuid",
  "alert_type": "price_increase",
  "trigger_price": 99.99,
  ...
}
```

#### Delete Alert

```
DELETE /alerts/{alert_id}
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Alert deleted"
}
```

#### Activate Alert

```
POST /alerts/{alert_id}/activate
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Alert activated",
  "alert_id": "alert-uuid"
}
```

#### Deactivate Alert

```
POST /alerts/{alert_id}/deactivate
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Alert deactivated",
  "alert_id": "alert-uuid"
}
```

### Recommendations

#### Get Recommendation

```
GET /recommendations/{recommendation_id}
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "recommendation-uuid",
  "product_id": "product-uuid",
  "current_price": 99.99,
  "recommended_price": 89.99,
  "price_change": -10.00,
  "price_change_percent": -10.01,
  "recommendation_reason": "Based on 5 competitors...",
  "confidence_score": 0.92,
  "factors": {...},
  "is_active": true,
  "is_implemented": false,
  "created_at": "2024-01-01T00:00:00",
  "updated_at": "2024-01-01T00:00:00",
  "implemented_at": null
}
```

#### List Product Recommendations

```
GET /recommendations/product/{product_id}
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "recommendation-uuid",
    "current_price": 99.99,
    "recommended_price": 89.99,
    ...
  }
]
```

#### Get Latest Recommendation

```
GET /recommendations/product/{product_id}/latest
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "recommendation-uuid",
  "current_price": 99.99,
  "recommended_price": 89.99,
  ...
}
```

#### Calculate Recommendation

```
POST /recommendations/{product_id}/calculate
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "recommendation-uuid",
  "current_price": 99.99,
  "recommended_price": 89.99,
  ...
}
```

#### Implement Recommendation

```
POST /recommendations/{recommendation_id}/implement
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Recommendation implemented",
  "recommendation_id": "recommendation-uuid"
}
```

#### Get High Confidence Recommendations

```
GET /recommendations/high-confidence/list?min_confidence=0.7
Authorization: Bearer <token>

Response: 200 OK
[
  {
    "id": "recommendation-uuid",
    "confidence_score": 0.92,
    ...
  }
]
```

## Error Responses

### 400 Bad Request

```json
{
  "detail": "Invalid request data"
}
```

### 401 Unauthorized

```json
{
  "detail": "Invalid credentials"
}
```

### 404 Not Found

```json
{
  "detail": "Resource not found"
}
```

### 500 Internal Server Error

```json
{
  "detail": "Internal server error"
}
```

## Rate Limiting

Currently no rate limiting is implemented. This should be added for production.

## Pagination

List endpoints support pagination via query parameters:

- `skip`: Number of items to skip (default: 0)
- `limit`: Number of items to return (default: 100, max: 1000)

## Sorting

Sorting can be implemented by adding `sort_by` and `order` parameters to list endpoints.

## Filtering

Filtering can be implemented by adding filter parameters to list endpoints.

## Webhooks

Webhooks for real-time events can be implemented for:

- Price changes
- Alert triggers
- Recommendation updates
- Product synchronization

## Rate Limits (Recommended)

- 100 requests per minute for authenticated users
- 10 requests per minute for unauthenticated endpoints
- 1000 requests per hour for bulk operations

## Versioning

The API uses URL-based versioning (`/api/v1`). Future versions will be available at `/api/v2`, etc.

## CORS

CORS is enabled for the following origins:

- http://localhost:3000
- http://localhost:8000

Additional origins can be configured in `.env`.
