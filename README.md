# Qontinui Web Builder

**Private Repository** - Closed-source configuration UI for GUI automation projects.

## Overview

Qontinui Web Builder is a web-based configuration interface for creating and managing GUI automation projects. It provides a visual interface for:

- State definition and management
- Element annotation and training
- Transition configuration
- Test scenario creation
- Project deployment

## Architecture

```
qontinui-web/
├── backend/          # FastAPI backend
│   ├── api/         # API endpoints
│   ├── models/      # Data models
│   ├── services/    # Business logic
│   └── database/    # Database operations
└── frontend/        # Next.js frontend
    ├── components/  # React components
    ├── pages/      # Next.js pages
    ├── services/   # API clients
    └── styles/     # CSS/Tailwind styles
```

## Tech Stack

### Backend
- FastAPI (Python 3.12+)
- SQLAlchemy (ORM)
- PostgreSQL (Database)
- Redis (Caching/Sessions)
- Celery (Background tasks)

### Frontend
- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Zustand (State management)
- React Query (Data fetching)

## Getting Started

### Prerequisites
- Python 3.12+
- Node.js 20+
- PostgreSQL 15+
- Redis 7+

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration
uvicorn main:app --reload
```

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local with your configuration
npm run dev
```

## Development

### Running with Docker

```bash
docker-compose up -d
```

### Database Migrations

```bash
cd backend
alembic upgrade head
```

### Running Tests

Backend:
```bash
cd backend
pytest
```

Frontend:
```bash
cd frontend
npm test
```

## License

This is proprietary software. All rights reserved.
