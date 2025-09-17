# Qontinui Backend API

FastAPI backend for the Qontinui visual automation configuration builder.

## Features

- User authentication with JWT tokens
- Project persistence and management
- RESTful API endpoints
- SQLite database for development
- Auto-generated API documentation

## Setup

1. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Run the server:
```bash
python run.py
```

The API will be available at http://localhost:8000

## API Documentation

- Interactive docs: http://localhost:8000/docs
- OpenAPI schema: http://localhost:8000/api/v1/openapi.json

## Default Admin User

- Email: admin@qontinui.com
- Password: admin123

## API Endpoints

### Authentication
- POST `/api/v1/auth/register` - Register new user
- POST `/api/v1/auth/login` - Login (returns JWT tokens)
- POST `/api/v1/auth/refresh` - Refresh access token

### Users
- GET `/api/v1/users/me` - Get current user
- PUT `/api/v1/users/me` - Update current user

### Projects
- GET `/api/v1/projects/` - List user's projects
- POST `/api/v1/projects/` - Create new project
- GET `/api/v1/projects/{id}` - Get project details
- PUT `/api/v1/projects/{id}` - Update project
- DELETE `/api/v1/projects/{id}` - Delete project

## Project Structure

```
backend/
├── app/
│   ├── api/           # API endpoints
│   ├── core/          # Core configuration
│   ├── crud/          # Database operations
│   ├── db/            # Database setup
│   ├── models/        # SQLAlchemy models
│   └── schemas/       # Pydantic schemas
├── tests/             # Test files
├── .env               # Environment variables
├── requirements.txt   # Python dependencies
└── run.py            # Server entry point
```