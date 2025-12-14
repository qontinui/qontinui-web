# Test Notification System

A comprehensive notification system for test failures, deficiencies, and coverage alerts in qontinui-web.

## Overview

The test notification system provides multi-channel notifications for:
- **Test run completion** - Sent when test runs complete (success or failure)
- **Critical deficiencies** - Immediate alerts for critical/high severity bugs
- **Coverage drops** - Warnings when test coverage falls below threshold

## Architecture

```
Test Event
    ↓
TestNotificationService
    ↓
┌─────────────┬──────────────┬────────────┬──────────────┐
│  WebSocket  │    Email     │   Slack    │   Webhook    │
└─────────────┴──────────────┴────────────┴──────────────┘
    ↓              ↓              ↓              ↓
 Dashboard      Recipients     Channel    External System
```

## Components

### 1. Models

#### `TestNotificationPreferences` (`app/models/test_notification_preferences.py`)

Project-level notification settings:
- Event preferences (which events to notify on)
- Severity filters (critical, high, medium, low)
- Coverage threshold
- Channel configurations (WebSocket, email, Slack, webhook)

#### `NotificationType` (extended in `app/models/notification.py`)

Added test notification types:
- `TEST_RUN_COMPLETED` - Test run finished successfully
- `TEST_RUN_FAILED` - Test run failed/timed out
- `DEFICIENCY_DETECTED` - Bug/issue discovered
- `COVERAGE_DROP` - Coverage below threshold

### 2. Schemas

#### `TestRunNotification` (`app/schemas/test_notifications.py`)

Comprehensive test run summary:
- Status and timing
- Transition statistics (total, successful, failed, skipped)
- Coverage metrics
- Deficiency counts by severity
- Dashboard and report URLs

#### `DeficiencyNotification`

Deficiency alert data:
- Severity and type
- Description and reproduction steps
- Screenshots and video
- Environment context
- Occurrence tracking

#### `CoverageAlertNotification`

Coverage drop alert:
- Current vs previous coverage
- Threshold comparison
- States and transitions covered
- Trend analysis

#### `TestNotificationPreferences` (Create/Update/Response)

Preference management schemas with full validation.

### 3. Services

#### `TestNotificationService` (`app/services/test_notification_service.py`)

Main notification orchestration:
- `notify_test_run_completed()` - Send test run notifications
- `notify_critical_deficiency()` - Alert on critical bugs
- `notify_coverage_drop()` - Warn on coverage regression
- Multi-channel delivery logic
- Preference management

### 4. Integrations

#### `SlackIntegration` (`app/integrations/slack.py`)

Rich Slack message formatting:
- Color-coded attachments (green/yellow/red)
- Formatted statistics
- Action buttons (View Dashboard, View Report, View Deficiencies)
- Custom fields for each notification type

## Usage

### Setting Up Notifications

```python
from app.services.test_notification_service import test_notification_service

# Get or create preferences for a project
preferences = await test_notification_service.get_project_preferences(
    db, project_id
)

# Update preferences
await test_notification_service.update_project_preferences(
    db,
    project_id,
    {
        "notify_critical_deficiency": True,
        "notify_coverage_drop": True,
        "coverage_drop_threshold": Decimal("85.00"),
        "slack_config": {
            "enabled": True,
            "slack_enabled": True,
            "slack_webhook_url": "https://hooks.slack.com/...",
            "slack_channel": "#testing-alerts",
        },
    },
)
```

### Sending Notifications

```python
# Test run completed
await test_notification_service.notify_test_run_completed(
    db=db,
    test_run_id=test_run.id,
    project_id=project.id,
    frontend_url="https://qontinui.io",
)

# Critical deficiency detected
await test_notification_service.notify_critical_deficiency(
    db=db,
    deficiency_id=deficiency.id,
    project_id=project.id,
    frontend_url="https://qontinui.io",
)

# Coverage dropped
await test_notification_service.notify_coverage_drop(
    db=db,
    test_run_id=test_run.id,
    project_id=project.id,
    current_coverage=Decimal("75.50"),
    previous_coverage=Decimal("82.30"),
    frontend_url="https://qontinui.io",
)
```

## Notification Channels

### WebSocket (Real-time Dashboard)

Enabled by default. Broadcasts events to all users viewing the project dashboard.

**Configuration:**
```python
"websocket_config": {
    "enabled": True,
    "websocket_enabled": True,
}
```

**Events:**
- `test_run_completed` - Test run finished
- `deficiency_detected` - New deficiency
- `coverage_drop` - Coverage regression

### Email

Sends formatted HTML emails to configured recipients.

**Configuration:**
```python
"email_config": {
    "enabled": True,
    "email_enabled": True,
    "email_recipients": ["team@example.com", "qa@example.com"],
}
```

**Templates:**
- Test run summary with statistics
- Deficiency alert with reproduction info
- Coverage drop warning with trend

### Slack

Sends rich formatted messages with color coding and action buttons.

**Configuration:**
```python
"slack_config": {
    "enabled": True,
    "slack_enabled": True,
    "slack_webhook_url": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    "slack_channel": "#testing-alerts",  # Optional channel override
}
```

**Features:**
- Color-coded attachments:
  - Green: All tests passed
  - Yellow: Some failures (< 50%)
  - Red: Most failures (> 50%) or critical deficiency
- Statistics fields (coverage, transitions, duration)
- Action buttons:
  - "View Dashboard" - Link to project dashboard
  - "View Report" - Link to detailed report
  - "View Deficiencies" - Link to deficiency list
- Footer with timestamp

### Generic Webhook

POST JSON payload to any HTTP endpoint.

**Configuration:**
```python
"webhook_config": {
    "enabled": True,
    "webhook_enabled": True,
    "webhook_url": "https://api.example.com/webhooks/qontinui",
    "webhook_headers": {
        "Authorization": "Bearer YOUR_TOKEN",
        "X-Custom-Header": "value",
    },
}
```

**Payload Format:**
```json
{
    "event": "test_run_completed",
    "data": {
        "test_run_id": "uuid",
        "status": "completed",
        "coverage_percentage": 85.5,
        ...
    },
    "timestamp": "2025-12-13T10:30:00Z"
}
```

## Notification Preferences

### Project-Level Settings

Each project has customizable notification preferences:

**Event Preferences:**
- `notify_test_run_completed` - Notify on successful completion
- `notify_test_run_failed` - Notify on failure/timeout
- `notify_critical_deficiency` - Immediate alert for critical bugs
- `notify_high_deficiency` - Alert for high severity bugs
- `notify_medium_deficiency` - Alert for medium severity bugs
- `notify_low_deficiency` - Alert for low severity bugs
- `notify_coverage_drop` - Alert on coverage regression
- `coverage_drop_threshold` - Percentage threshold (0-100)

**Channel Preferences:**

Each channel has its own configuration:
- `enabled` - Master switch for the channel
- Channel-specific settings (webhook URL, recipients, etc.)

### User-Level Settings

Users can control their personal notification preferences via `NotificationPreferences`:

**In-app notifications:**
- `in_app_test_run_completed`
- `in_app_test_run_failed`
- `in_app_deficiency_detected`
- `in_app_coverage_drop`

**Email notifications:**
- `email_test_run_completed`
- `email_test_run_failed`
- `email_deficiency_detected`
- `email_coverage_drop`

## Database Migration

The system requires a database migration to add:

1. `test_notification_preferences` table
2. New notification type enum values
3. User notification preference columns

**Migration SQL:**
```sql
-- Add test notification types to enum
ALTER TYPE notificationtype ADD VALUE 'test_run_completed';
ALTER TYPE notificationtype ADD VALUE 'test_run_failed';
ALTER TYPE notificationtype ADD VALUE 'deficiency_detected';
ALTER TYPE notificationtype ADD VALUE 'coverage_drop';

-- Create test notification preferences table
CREATE TABLE test_notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    notify_test_run_completed BOOLEAN NOT NULL DEFAULT TRUE,
    notify_test_run_failed BOOLEAN NOT NULL DEFAULT TRUE,
    notify_critical_deficiency BOOLEAN NOT NULL DEFAULT TRUE,
    notify_high_deficiency BOOLEAN NOT NULL DEFAULT TRUE,
    notify_medium_deficiency BOOLEAN NOT NULL DEFAULT FALSE,
    notify_low_deficiency BOOLEAN NOT NULL DEFAULT FALSE,
    notify_coverage_drop BOOLEAN NOT NULL DEFAULT TRUE,
    coverage_drop_threshold NUMERIC(5,2) NOT NULL DEFAULT 80.00,
    websocket_config JSONB NOT NULL DEFAULT '{}',
    email_config JSONB NOT NULL DEFAULT '{}',
    slack_config JSONB NOT NULL DEFAULT '{}',
    webhook_config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_notification_preferences_project ON test_notification_preferences(project_id);

-- Add user notification preference columns
ALTER TABLE notification_preferences
ADD COLUMN in_app_test_run_completed BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN in_app_test_run_failed BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN in_app_deficiency_detected BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN in_app_coverage_drop BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN email_test_run_completed BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN email_test_run_failed BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN email_deficiency_detected BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN email_coverage_drop BOOLEAN NOT NULL DEFAULT TRUE;
```

## Integration Points

### Test Run Completion Hook

Add to test execution service:

```python
from app.services.test_notification_service import test_notification_service

async def complete_test_run(db: AsyncSession, test_run_id: UUID):
    # Update test run status
    test_run.status = TestRunStatus.COMPLETED
    test_run.completed_at = datetime.utcnow()
    await db.commit()

    # Send notification
    await test_notification_service.notify_test_run_completed(
        db=db,
        test_run_id=test_run_id,
        project_id=test_run.project_id,
        frontend_url=settings.FRONTEND_URL,
    )
```

### Deficiency Detection Hook

Add to deficiency creation:

```python
async def create_deficiency(db: AsyncSession, deficiency_data: dict):
    # Create deficiency
    deficiency = TestDeficiency(**deficiency_data)
    db.add(deficiency)
    await db.commit()

    # Send immediate notification for critical/high severity
    if deficiency.severity in (DeficiencySeverity.CRITICAL, DeficiencySeverity.HIGH):
        await test_notification_service.notify_critical_deficiency(
            db=db,
            deficiency_id=deficiency.id,
            project_id=project_id,
            frontend_url=settings.FRONTEND_URL,
        )
```

### Coverage Tracking Hook

Add to coverage snapshot service:

```python
async def update_coverage(db: AsyncSession, test_run_id: UUID, coverage: Decimal):
    # Get previous coverage
    previous_coverage = await get_previous_coverage(db, test_run.project_id)

    # Update current coverage
    test_run.coverage_percentage = coverage
    await db.commit()

    # Check if notification needed
    await test_notification_service.notify_coverage_drop(
        db=db,
        test_run_id=test_run_id,
        project_id=test_run.project_id,
        current_coverage=coverage,
        previous_coverage=previous_coverage,
        frontend_url=settings.FRONTEND_URL,
    )
```

## API Endpoints (To Be Implemented)

### Get Project Preferences

```
GET /api/v1/projects/{project_id}/test-notifications/preferences
```

### Update Project Preferences

```
PATCH /api/v1/projects/{project_id}/test-notifications/preferences
```

### Test Notification Delivery

```
POST /api/v1/projects/{project_id}/test-notifications/test
```

Send a test notification to verify channel configuration.

## Environment Variables

Add to `.env`:

```bash
# Slack Integration (optional)
SLACK_DEFAULT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Email settings (reuses existing email config)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your_sendgrid_api_key
SMTP_FROM_EMAIL=noreply@qontinui.io
```

## Testing

### Unit Tests

```python
import pytest
from app.services.test_notification_service import test_notification_service

@pytest.mark.asyncio
async def test_notify_test_run_completed(db_session):
    # Create test run
    test_run = create_test_run(status="completed")

    # Send notification
    success = await test_notification_service.notify_test_run_completed(
        db=db_session,
        test_run_id=test_run.id,
        project_id=test_run.project_id,
        frontend_url="http://localhost:3001",
    )

    assert success
```

### Integration Tests

Test with actual Slack webhook:

```python
@pytest.mark.integration
async def test_slack_integration(db_session, slack_webhook_url):
    # Configure Slack
    preferences = await test_notification_service.update_project_preferences(
        db_session,
        project_id,
        {"slack_config": {"enabled": True, "slack_webhook_url": slack_webhook_url}},
    )

    # Send notification
    success = await test_notification_service.notify_test_run_completed(
        db=db_session,
        test_run_id=test_run.id,
        project_id=project_id,
        frontend_url="http://localhost:3001",
    )

    assert success
```

## Security Considerations

1. **Webhook URLs** - Stored in JSONB, ensure proper access control
2. **Secrets** - Use environment variables for default webhook URLs
3. **Rate Limiting** - Consider rate limiting on notification delivery
4. **Validation** - Validate webhook URLs before saving
5. **HTTPS Only** - Enforce HTTPS for webhook URLs in production

## Future Enhancements

1. **Digest Notifications** - Daily/weekly summaries instead of immediate
2. **Custom Templates** - User-configurable email/Slack templates
3. **Notification History** - Track all sent notifications
4. **Retry Logic** - Automatic retry on delivery failure
5. **Microsoft Teams** - Additional channel integration
6. **PagerDuty** - Integration for critical alerts
7. **Notification Filters** - Advanced filtering by tags, workflow, etc.
8. **Batch Notifications** - Combine multiple deficiencies into one alert
9. **User Mentions** - @mention specific users in Slack
10. **Escalation** - Auto-escalate if not acknowledged

## Troubleshooting

### Notifications Not Sending

1. Check project preferences: `notify_<event_type>` enabled
2. Check channel configuration: `enabled: true`
3. Check user preferences: `in_app_<event_type>` or `email_<event_type>`
4. Review logs: `grep "notification" .dev-logs/web-backend.log`

### Slack Messages Not Appearing

1. Verify webhook URL is correct
2. Test webhook with curl:
   ```bash
   curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Test message"}' \
     YOUR_WEBHOOK_URL
   ```
3. Check Slack workspace settings (webhooks enabled)
4. Review channel permissions

### Email Delivery Issues

1. Verify SMTP settings in environment variables
2. Check email recipients list is not empty
3. Test email service independently
4. Review email service logs

## Support

For issues or questions:
- Review logs in `.dev-logs/web-backend.log`
- Check database migration status
- Verify all dependencies installed
- Review environment variables

## License

Part of the Qontinui project.
