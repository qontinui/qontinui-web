# CLAUDE.md - Development Guidelines

## Project Philosophy
This project is in active development. Prioritize clean, simple code over backward compatibility.

## Key Guidelines

### No Backward Compatibility
- Do NOT add migration code for older versions
- Do NOT maintain legacy data structures
- When changing data formats, simply update to the new format
- Users are expected to work with the latest version

### Code Quality Priority
- Write clean, maintainable code
- Keep implementations simple and straightforward
- Remove deprecated code immediately
- Don't add complexity to support old formats

### State Identification System
- States use sanitized names as IDs (e.g., "New_State", "Login_Screen")
- IDs update automatically when state names change
- No support for legacy timestamp-based IDs

## Git Commit Messages

**Joshua Spinak is the sole contributor to this project.**

- DO NOT add "Co-Authored-By: Claude" or similar lines
- DO NOT add "Generated with Claude Code" or similar attribution
- Keep commit messages professional and focused on the changes
- Use conventional commit format (e.g., "feat:", "fix:", "docs:", "refactor:")
