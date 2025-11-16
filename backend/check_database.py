#!/usr/bin/env python3
"""Quick database connectivity check"""

import sys
from pathlib import Path

backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

import asyncio
from sqlalchemy import text
from app.db.session import AsyncSessionLocal


async def check_db():
    """Check if database is accessible"""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT 1"))
            result.scalar()
            print("✅ Database connection successful!")
            return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False


if __name__ == "__main__":
    asyncio.run(check_db())
