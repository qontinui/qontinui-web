# Qontinui Web Builder

**Private Repository** - Closed-source configuration UI for GUI automation projects.

## Overview

Qontinui Web Builder is a web-based configuration interface for creating and managing GUI automation projects. It provides a visual interface for:

- State definition and management
- Element annotation and training
- Transition configuration
- Test scenario creation
- **Mock execution** for testing automation logic
- Project export for real execution in qontinui-runner

## Mock Execution

Qontinui Web includes built-in mock execution for testing your automation configurations:

**Purpose**: Validate state machines and automation logic without requiring a GUI environment

**Benefits**:
- ✅ Test configurations directly in browser
- ✅ No desktop environment needed
- ✅ Fast iteration during development
- ✅ Safe testing without real system interactions
- ✅ Verify state machine flow and transition logic
- ✅ Debug process sequences before deployment

**Usage**: Use the "Test Run" feature in the web interface to simulate automation execution

**For real automation**: Export your configuration and run it in [qontinui-runner](https://github.com/jspinak/qontinui-runner), which performs actual GUI interactions.

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

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Please note that this project is released with a [Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## License

Licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE) for full terms. Contributing requires signing the [CLA](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contact

For questions or licensing inquiries, please contact jspinak@hotmail.com
