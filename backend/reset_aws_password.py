"""
Reset password for AWS production database
"""

import asyncio

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def main():
    email = input("Enter email address: ")
    new_password = input("Enter new password: ")

    # Hash the password
    hashed = pwd_context.hash(new_password)

    print("\n" + "=" * 60)
    print("SQL Query to run in AWS RDS:")
    print("=" * 60)
    print(
        f"""
UPDATE users
SET hashed_password = '{hashed}'
WHERE email = '{email}';
"""
    )
    print("=" * 60)
    print("\nRun this command to execute:")
    print(
        f"""
psql -h qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com \\
     -U qontinui_admin \\
     -d postgres \\
     -c "UPDATE users SET hashed_password = '{hashed}' WHERE email = '{email}';"
"""
    )
    print("\nPassword: 2008NawaNawa=")


if __name__ == "__main__":
    asyncio.run(main())
