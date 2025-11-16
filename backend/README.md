# Qontinui Web Backend

FastAPI backend for the Qontinui web application.

## Setup

1. Install dependencies:
```bash
poetry install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run the development server:
```bash
poetry run uvicorn app.main:app --reload
```

## Testing

Run tests with:
```bash
poetry run pytest
```

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
