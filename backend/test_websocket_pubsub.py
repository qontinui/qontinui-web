#!/usr/bin/env python3
"""
Test script for WebSocket Redis Pub/Sub functionality.

This script demonstrates broadcasting messages to WebSocket clients via Redis Pub/Sub.
Run this script while WebSocket clients are connected to see real-time message delivery.
"""

import asyncio
import json
import sys
from datetime import UTC, datetime

from redis import asyncio as aioredis

from app.core.config import settings


async def broadcast_test_message(session_id: str, message_type: str = "test_event"):
    """
    Broadcast a test message to all WebSocket clients monitoring a session.

    Args:
        session_id: Automation session ID
        message_type: Type of message to send
    """
    print(f"\n{'=' * 60}")
    print("WebSocket Redis Pub/Sub Test")
    print(f"{'=' * 60}\n")

    # Connect to Redis
    redis_url = (
        f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    )
    print(f"Connecting to Redis: {redis_url}")

    try:
        redis = await aioredis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=5,
        )
        print("✓ Connected to Redis\n")
    except Exception as e:
        print(f"✗ Failed to connect to Redis: {e}")
        print("\nMake sure Redis is running:")
        print("  docker-compose -f docker-compose.dev.yml up -d redis")
        sys.exit(1)

    # Test Redis connection
    try:
        await redis.ping()
        print("✓ Redis ping successful\n")
    except Exception as e:
        print(f"✗ Redis ping failed: {e}")
        await redis.close()
        sys.exit(1)

    # Prepare message
    channel = f"ws:session:{session_id}"
    message = {
        "type": message_type,
        "message": "Test message from broadcast script",
        "data": {
            "test_id": "12345",
            "priority": "high",
            "status": "success",
        },
        "timestamp": datetime.now(UTC).isoformat() + "Z",
    }

    print(f"Channel: {channel}")
    print(f"Message: {json.dumps(message, indent=2)}\n")

    # Check active subscribers
    try:
        channels = await redis.pubsub_channels("ws:session:*")
        subscriber_count = await redis.pubsub_numsub(channel)
        print(f"Active channels: {len(channels)}")
        print(
            f"Subscribers to {channel}: {subscriber_count[channel] if subscriber_count else 0}\n"
        )
    except Exception as e:
        print(f"Warning: Could not check subscribers: {e}\n")

    # Publish message
    try:
        published = await redis.publish(channel, json.dumps(message))
        print("✓ Message published successfully!")
        print(f"  Delivered to {published} subscriber(s)\n")

        if published == 0:
            print("ℹ No active subscribers detected.")
            print("  Make sure WebSocket clients are connected to:")
            print(
                f"    ws://localhost:8000/api/v1/ws/automation/monitor/{session_id}?token=YOUR_TOKEN"
            )
    except Exception as e:
        print(f"✗ Failed to publish message: {e}")
        await redis.close()
        sys.exit(1)

    # Cleanup
    await redis.close()
    print(f"\n{'=' * 60}")
    print("Test complete!")
    print(f"{'=' * 60}\n")


async def continuous_broadcast(session_id: str, interval: int = 5):
    """
    Continuously broadcast messages for testing.

    Args:
        session_id: Automation session ID
        interval: Seconds between messages
    """
    print(f"\n{'=' * 60}")
    print("Continuous WebSocket Broadcast Test")
    print(f"{'=' * 60}\n")
    print(f"Broadcasting to session: {session_id}")
    print(f"Interval: {interval} seconds")
    print("Press Ctrl+C to stop\n")

    # Connect to Redis
    redis_url = (
        f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    )
    redis = await aioredis.from_url(redis_url, encoding="utf-8", decode_responses=True)

    channel = f"ws:session:{session_id}"
    message_count = 0

    try:
        while True:
            message_count += 1

            message = {
                "type": "continuous_test",
                "message": f"Continuous test message #{message_count}",
                "data": {
                    "message_number": message_count,
                    "status": "broadcasting",
                },
                "timestamp": datetime.now(UTC).isoformat() + "Z",
            }

            published = await redis.publish(channel, json.dumps(message))
            print(
                f"[{datetime.now(UTC).strftime('%H:%M:%S')}] "
                f"Message #{message_count} → {published} subscriber(s)"
            )

            await asyncio.sleep(interval)

    except KeyboardInterrupt:
        print(f"\n\n✓ Sent {message_count} messages")
        print("Stopping...")
    finally:
        await redis.close()


async def check_redis_status():
    """Check Redis connection and active channels."""
    print(f"\n{'=' * 60}")
    print("Redis Status Check")
    print(f"{'=' * 60}\n")

    redis_url = (
        f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    )
    print(f"Redis URL: {redis_url}\n")

    try:
        redis = await aioredis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=5,
        )
        print("✓ Connected to Redis\n")

        # Ping
        await redis.ping()
        print("✓ Redis ping successful\n")

        # Get active channels
        channels = await redis.pubsub_channels("ws:session:*")
        print(f"Active WebSocket channels: {len(channels)}")

        if channels:
            print("\nChannels:")
            for channel in channels[:10]:  # Show first 10
                # Get subscriber count
                numsub = await redis.pubsub_numsub(channel)
                subscribers = numsub[channel] if numsub else 0
                print(f"  - {channel} ({subscribers} subscribers)")

            if len(channels) > 10:
                print(f"  ... and {len(channels) - 10} more")
        else:
            print("  (No active channels)")

        print()

        # Redis info
        info = await redis.info("stats")
        print("Redis Stats:")
        print(f"  Total connections: {info.get('total_connections_received', 'N/A')}")
        print(f"  Total commands: {info.get('total_commands_processed', 'N/A')}")

        await redis.close()

    except Exception as e:
        print(f"✗ Error: {e}")
        print("\nMake sure Redis is running:")
        print("  docker-compose -f docker-compose.dev.yml up -d redis")
        sys.exit(1)

    print(f"\n{'=' * 60}\n")


def print_usage():
    """Print usage information."""
    print("\nUsage:")
    print("  python test_websocket_pubsub.py <command> [session_id]")
    print("\nCommands:")
    print("  status              - Check Redis status and active channels")
    print("  broadcast <id>      - Send a single test message to session")
    print("  continuous <id>     - Continuously broadcast messages (5s interval)")
    print("\nExamples:")
    print("  python test_websocket_pubsub.py status")
    print(
        "  python test_websocket_pubsub.py broadcast 550e8400-e29b-41d4-a716-446655440000"
    )
    print(
        "  python test_websocket_pubsub.py continuous 550e8400-e29b-41d4-a716-446655440000"
    )
    print()


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "status":
        asyncio.run(check_redis_status())

    elif command == "broadcast":
        if len(sys.argv) < 3:
            print("Error: Session ID required for broadcast command")
            print_usage()
            sys.exit(1)

        session_id = sys.argv[2]
        asyncio.run(broadcast_test_message(session_id))

    elif command == "continuous":
        if len(sys.argv) < 3:
            print("Error: Session ID required for continuous command")
            print_usage()
            sys.exit(1)

        session_id = sys.argv[2]
        asyncio.run(continuous_broadcast(session_id))

    else:
        print(f"Error: Unknown command '{command}'")
        print_usage()
        sys.exit(1)


if __name__ == "__main__":
    main()
