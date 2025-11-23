# Backend Integration Tests

## Overview

This directory contains comprehensive integration tests for the software testing system backend.

## Test Files

- `conftest.py` - Fixtures, factories, and test utilities
- `test_testing_api.py` - API endpoint integration tests
- `test_testing_models.py` - Database model CRUD tests
- `test_testing_workflow.py` - Complete workflow tests

## Running Tests

```bash
# Run all integration tests
pytest tests/integration/ -v

# Run specific test file
pytest tests/integration/test_testing_api.py -v

# Run specific test class
pytest tests/integration/test_testing_api.py::TestTestRunAPI -v

# Run specific test method
pytest tests/integration/test_testing_api.py::TestTestRunAPI::test_create_test_run -v

# Run with coverage
pytest tests/integration/ --cov=app.models --cov=app.api.v1.endpoints --cov-report=html

# Run excluding slow tests
pytest tests/integration/ -v -m "not slow"

# Run with debugging on failure
pytest tests/integration/ -v --pdb

# Run in parallel (if pytest-xdist installed)
pytest tests/integration/ -v -n auto
```

## Test Structure

### conftest.py

Provides reusable fixtures and utilities:

**Database Fixtures:**
- `db_session` - Async SQLite in-memory session
- `test_user` - Test user fixture
- `test_project` - Test project fixture
- `test_runner_connection` - Runner connection fixture
- `test_run` - Software test run fixture
- `test_deficiency` - Test deficiency fixture

**Factory Functions:**
- `create_test_runs(count, status)` - Create multiple test runs
- `create_test_deficiencies(count, severity)` - Create multiple deficiencies
- `generate_mock_transition_data(count)` - Generate mock transitions
- `generate_mock_deficiency_data(count)` - Generate mock deficiencies
- `generate_mock_coverage_data()` - Generate mock coverage data

### test_testing_api.py

Tests API endpoints:

**Test Classes:**
- `TestTestRunAPI` - Test run CRUD operations
- `TestTransitionAPI` - Transition reporting
- `TestDeficiencyAPI` - Deficiency management
- `TestCoverageAPI` - Coverage tracking
- `TestAnalyticsAPI` - Analytics endpoints
- `TestBatchOperations` - Bulk operations
- `TestErrorHandling` - Error scenarios

**Coverage:** 25+ tests covering all API endpoints

### test_testing_models.py

Tests database models:

**Test Classes:**
- `TestSoftwareTestRunModel` - Test run model operations
- `TestTestDeficiencyModel` - Deficiency model operations
- `TestModelRelationships` - Relationship tests
- `TestAggregateQueries` - Complex queries and statistics

**Coverage:** 20+ tests covering CRUD, relationships, and queries

### test_testing_workflow.py

Tests complete workflows:

**Test Classes:**
- `TestCompleteTestRunWorkflow` - Full test run lifecycle
- `TestDeficiencyWorkflow` - Deficiency lifecycle
- `TestQueryAndFilterWorkflows` - Complex filtering
- `TestCoverageCalculationWorkflow` - Coverage tracking
- `TestReliabilityStatisticsWorkflow` - Reliability analysis
- `TestBatchOperationsWorkflow` - Bulk operations

**Coverage:** 25+ tests covering end-to-end workflows

## Writing New Tests

### Example: API Test

```python
@pytest.mark.asyncio
async def test_new_api_endpoint(
    db_session: AsyncSession,
    test_project: Project,
):
    """Test description."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/endpoint",
            json={"key": "value"},
            headers={"Authorization": "Bearer test_token"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "expected_field" in data
```

### Example: Model Test

```python
@pytest.mark.asyncio
async def test_model_operation(
    db_session: AsyncSession,
    test_run: SoftwareTestRun,
):
    """Test model operation."""
    # Create
    model = Model(field="value")
    db_session.add(model)
    await db_session.commit()
    await db_session.refresh(model)

    # Verify
    assert model.id is not None
    assert model.field == "value"

    # Query
    result = await db_session.execute(
        select(Model).where(Model.field == "value")
    )
    found = result.scalar_one_or_none()
    assert found is not None
```

### Example: Workflow Test

```python
@pytest.mark.asyncio
async def test_complete_workflow(
    db_session: AsyncSession,
    test_project: Project,
):
    """Test complete workflow."""
    # Step 1: Create test run
    test_run = SoftwareTestRun(...)
    db_session.add(test_run)
    await db_session.commit()

    # Step 2: Report transitions
    test_run.total_transitions = 50
    db_session.add(test_run)
    await db_session.commit()

    # Step 3: Report deficiencies
    deficiency = TestDeficiency(...)
    db_session.add(deficiency)
    await db_session.commit()

    # Step 4: Complete
    test_run.status = TestRunStatus.COMPLETED
    db_session.add(test_run)
    await db_session.commit()

    # Verify final state
    await db_session.refresh(test_run)
    assert test_run.status == TestRunStatus.COMPLETED
```

## Test Conventions

### Naming
- Test files: `test_*.py`
- Test classes: `Test*`
- Test methods: `test_*`
- Use descriptive names: `test_create_test_run_with_valid_data`

### Structure
- **Arrange:** Set up test data
- **Act:** Execute the operation
- **Assert:** Verify results

### Async
- All database tests must be async
- Use `@pytest.mark.asyncio` decorator
- Use `await` for database operations

### Fixtures
- Use existing fixtures from `conftest.py`
- Create new fixtures if reusable
- Keep fixture scope as narrow as possible

### Assertions
- One logical assertion per test
- Use descriptive assertion messages
- Test both success and error cases

## Debugging Tests

### Failed Tests
```bash
# Run with verbose output
pytest tests/integration/ -v

# Stop on first failure
pytest tests/integration/ -x

# Drop into debugger on failure
pytest tests/integration/ --pdb

# Show local variables on failure
pytest tests/integration/ -l
```

### Database State
```python
# Print query results
result = await db_session.execute(select(Model))
models = result.scalars().all()
print(f"Found {len(models)} models: {models}")

# Verify relationships
await db_session.refresh(model, ["relationship"])
print(f"Related items: {model.relationship}")
```

### API Responses
```python
response = await client.post("/endpoint", json=data)
print(f"Status: {response.status_code}")
print(f"Body: {response.json()}")
```

## Common Issues

### Fixture Not Found
- Check fixture is defined in `conftest.py`
- Verify fixture is in scope
- Check spelling

### Async Issues
- Add `@pytest.mark.asyncio` decorator
- Use `await` for async operations
- Check pytest-asyncio is installed

### Database Errors
- Ensure SQLite in-memory database is used
- Check all foreign keys are valid
- Verify cascade settings

### Import Errors
- Check module paths
- Verify dependencies are installed
- Ensure PYTHONPATH is correct

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

```yaml
test:
  script:
    - pip install -r requirements.txt
    - pytest tests/integration/ -v --cov=app --cov-report=xml
  coverage: '/TOTAL.*\s+(\d+%)$/'
```

## Performance

- **Average Duration:** ~30 seconds for all tests
- **Parallelization:** Can run in parallel with pytest-xdist
- **Database:** SQLite in-memory for speed
- **Isolation:** Each test is independent

## Contributing

When adding new tests:
1. Follow existing patterns
2. Add docstrings
3. Use appropriate fixtures
4. Test both success and error cases
5. Run locally before committing
6. Update this README if needed

## Resources

- [pytest documentation](https://docs.pytest.org/)
- [pytest-asyncio documentation](https://pytest-asyncio.readthedocs.io/)
- [SQLAlchemy async documentation](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [FastAPI testing documentation](https://fastapi.tiangolo.com/tutorial/testing/)

## Questions?

- Review existing tests for patterns
- Check `TESTING_SYSTEM_TEST_SUMMARY.md` in project root
- Run tests with `-v` for verbose output
