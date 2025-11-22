import asyncio

import asyncpg


async def test_connection():
    try:
        conn = await asyncpg.connect(
            host="localhost",
            port=5432,
            user="qontinui",
            password="qontinui_dev_password",
            database="qontinui",
        )
        print("✅ Connection successful!")
        result = await conn.fetchval("SELECT 1")
        print(f"✅ Query successful: {result}")
        await conn.close()
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_connection())
