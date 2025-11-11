# Annotation System Setup

Simple, no-Alembic setup for the annotation database tables.

## Quick Start

```bash
cd backend
python setup_annotations.py
```

That's it! The script will:
- ✓ Check if tables exist
- ✓ Create them if needed
- ✓ Skip if already present

## Usage

### First Time Setup
```bash
python setup_annotations.py
```

### Reset Tables (Destroys Data!)
```bash
python setup_annotations.py --reset
```

### Drop Tables Only
```bash
python setup_annotations.py --drop
```

## What Tables Are Created

- `annotation_sets` - Contains screenshot info and metadata
- `annotations` - Individual bounding boxes with labels/descriptions

## Why No Alembic?

For this annotation tool, we use a simpler approach:

**Reasons:**
- Admin-only research tool (not production-critical)
- Easy to export/import data as JSON
- Simpler to modify and iterate
- No complex migration history to manage
- Perfect for development and research

**If you need to change the models:**
1. Edit `app/models/annotation.py`
2. Run `python setup_annotations.py --reset`
3. Re-import your JSON exports if needed

## Data Safety

Since annotations can be exported as JSON, you can:
1. Export your annotations via the web UI
2. Reset the tables
3. Re-import the JSON

No data lock-in!

## For Production

If this becomes production-critical with many users:
- Switch to Alembic migrations
- Use `alembic revision --autogenerate`
- This preserves existing data during schema changes

But for now, keep it simple!
