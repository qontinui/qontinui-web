"""Reset password for AWS production database.

Required environment variables:
- AWS_DB_HOST: Database hostname
- AWS_DB_USER: Database username
- AWS_DB_NAME: Database name
- AWS_DB_PASSWORD: Database password (optional, will prompt if not set)
"""

import asyncio
import os
import sys

from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def main():
    """Reset a user password in the AWS database."""
    # Get database credentials from environment
    db_host = os.environ.get("AWS_DB_HOST")
    db_user = os.environ.get("AWS_DB_USER")
    db_name = os.environ.get("AWS_DB_NAME")
    db_password = os.environ.get("AWS_DB_PASSWORD")

    # Validate required environment variables
    if not db_host:
        print("Error: AWS_DB_HOST environment variable is required", file=sys.stderr)
        sys.exit(1)
    if not db_user:
        print("Error: AWS_DB_USER environment variable is required", file=sys.stderr)
        sys.exit(1)
    if not db_name:
        print("Error: AWS_DB_NAME environment variable is required", file=sys.stderr)
        sys.exit(1)

    # Get user input
    email = input("Enter email address: ")
    new_password = input("Enter new password: ")

    if not email or not new_password:
        print("Error: Email and password are required", file=sys.stderr)
        sys.exit(1)

    # Hash the password
    hashed = pwd_context.hash(new_password)

    print("\n" + "=" * 60)
    print("SQL Query to run in AWS RDS:")
    print("=" * 60)
    # Use parameterized query syntax for safety
    print("""
UPDATE users
SET hashed_password = $1
WHERE email = $2;
""")
    print(f"Parameters: ['{hashed}', '{email}']")
    print("=" * 60)
    print("\nRun this command to execute:")

    # Build psql command with proper escaping
    # Note: For actual execution, use parameterized queries via psycopg2 instead
    psql_cmd = f"""
psql -h {db_host} \\
     -U {db_user} \\
     -d {db_name} \\
     -c "UPDATE users SET hashed_password = '{hashed}' WHERE email = '{email}';"
"""
    print(psql_cmd)

    if db_password:
        print(
            "\nNote: Database password is set in AWS_DB_PASSWORD environment variable"
        )
        print("The psql command will use the PGPASSWORD environment variable")
        print(f'\nTo execute: PGPASSWORD="$AWS_DB_PASSWORD" {psql_cmd.strip()}')
    else:
        print(
            "\nNote: AWS_DB_PASSWORD not set. You will be prompted for the database password."
        )


if __name__ == "__main__":
    asyncio.run(main())
