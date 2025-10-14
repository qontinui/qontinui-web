# CLAUDE.md - Development Guidelines

## Project Philosophy
This is an open-source project maintained by Joshua Spinak.

## Development Stage

**This project is in active development. Backward compatibility is NOT a priority.**

- Focus on clean, maintainable code over backward compatibility
- Breaking changes are acceptable and expected during development
- Refactor aggressively to improve code quality
- Don't constrain design decisions for compatibility with older versions
- The project will stabilize and version properly when ready for production

## Git Commit Messages

**Joshua Spinak is the sole contributor to this project.**

- DO NOT add "Co-Authored-By: Claude" or similar attribution lines
- DO NOT add "🤖 Generated with [Claude Code]" or similar marketing text
- DO NOT add any Claude/Anthropic attribution or advertising
- Keep commit messages professional and focused on the changes
- Use conventional commit format (e.g., "feat:", "fix:", "docs:", "refactor:")

**Rationale:** Claude is a for-profit company and should not be advertised on this open-source repository. All code contributions should be attributed solely to the human maintainer.

## Important: Do Not Commit CLAUDE.md

**This file (CLAUDE.md) contains personal instructions for Claude and should NEVER be committed to the repository.**

- CLAUDE.md is for local development guidance only
- It should be listed in .gitignore
- Do not add, commit, or push this file to version control

## Code Quality Guidelines

### Clean Code Principles

- **Simplicity over complexity**: Choose the simplest solution that works
- **Readability over cleverness**: Code should be easy to understand
- **Explicit over implicit**: Make intentions clear in the code
- **Delete over deprecate**: Remove old code instead of marking it deprecated
- **Refactor fearlessly**: Improve code structure without worrying about breaking changes

### Frontend-Specific Standards

- Use TypeScript strictly - no \`any\` types without good reason
- Keep components small and focused
- Extract reusable logic into hooks
- Use meaningful component and variable names
- Follow React best practices
- Keep state management simple and predictable
- Avoid prop drilling - use context when appropriate

### Code Standards

- Write clean, maintainable code
- Follow existing code style and conventions
- Add JSDoc comments for complex functions
- Ensure TypeScript types are accurate and complete
- Run linters before committing
- Keep components and functions small
- Use meaningful names for everything

### Testing

- Write tests for new functionality
- Update tests when refactoring
- Don't be afraid to delete obsolete tests
- Focus on testing behavior, not implementation
- Test user interactions, not implementation details

### Refactoring

- Refactor to improve code quality, even if it breaks existing code
- Remove dead code immediately
- Simplify complex component hierarchies
- Improve naming and organization
- Update documentation to match code changes
- Extract common patterns into reusable components

## Development Workflow

1. **Make changes freely** - Don't worry about backward compatibility
2. **Refactor as needed** - Improve code structure when you see opportunities
3. **Test thoroughly** - Ensure new code works correctly
4. **Document changes** - Update docs to reflect new behavior
5. **Commit clearly** - Write descriptive commit messages

## Breaking Changes Are Welcome

- Change component props if it improves the API
- Rename components for better clarity
- Restructure directories for better organization
- Remove features that don't add value
- Simplify complex state management

## Frontend Architecture

- Keep business logic separate from UI components
- Use TypeScript interfaces for all data structures
- Maintain consistency in component patterns
- Keep the component tree shallow when possible
- Use composition over inheritance

## Questions to Ask

Before writing code:
- Is this the simplest solution?
- Is the intent clear from reading the code?
- Does this fit well with the existing architecture?
- Can this be tested easily?
- Will future developers understand this?

When refactoring:
- Does this make the code clearer?
- Does this simplify the design?
- Is this worth the effort?
- What tests need to be updated?

## Remember

**Clean, maintainable code is the priority. Backward compatibility will matter when the project is ready for stable releases, but not during active development.**
