#!/bin/bash
# Simple text-based fixes for common ESLint errors

cd "$(dirname "$0")"

# Function to fix a file for unescaped entities
fix_unescaped_entities() {
    local file="$1"

    # Fix using perl for more precise replacements (only in JSX content)
    # This targets text between > and < tags
    perl -i -pe '
        # Fix contractions
        s/(\w)n'"'"'t(\s|<|\.)/\1n\&apos;t\2/g;
        s/(\w)'"'"'s(\s|<|\.)/\1\&apos;s\2/g;
        s/(\w)'"'"'re(\s|<|\.)/\1\&apos;re\2/g;
        s/(\w)'"'"'ve(\s|<|\.)/\1\&apos;ve\2/g;
        s/(\w)'"'"'ll(\s|<|\.)/\1\&apos;ll\2/g;
        s/(\w)'"'"'d(\s|<|\.)/\1\&apos;d\2/g;
    ' "$file"
}

# Function to fix unused vars by prefixing with _
fix_unused_vars() {
    local file="$1"
    local varname="$2"

    # Prefix declarations with _
    sed -i "s/\bconst ${varname}\b/const _${varname}/g" "$file"
    sed -i "s/\blet ${varname}\b/let _${varname}/g" "$file"
    sed -i "s/\bvar ${varname}\b/var _${varname}/g" "$file"
}

# Fix any -> unknown
fix_any_types() {
    local file="$1"

    # Common patterns
    sed -i 's/: any\b/: unknown/g' "$file"
    sed -i 's/<any>/<unknown>/g' "$file"
    sed -i 's/<any,/<unknown,/g' "$file"
    sed -i 's/, any>/, unknown>/g' "$file"
    sed -i 's/(any)/(unknown)/g' "$file"
    sed -i 's/catch (error: any)/catch (error: unknown)/g' "$file"
    sed -i 's/Record<string, any>/Record<string, unknown>/g' "$file"
    sed -i 's/Array<any>/Array<unknown>/g' "$file"
    sed -i 's/any\[\]/unknown[]/g' "$file"
}

echo "Finding TypeScript files..."
FILES=$(find src -name "*.ts" -o -name "*.tsx")

echo "Fixing unescaped entities..."
for file in $FILES; do
    if grep -l "react/no-unescaped-entities" <<< "$(npm run lint 2>&1 | grep "$file")" >/dev/null 2>&1; then
        fix_unescaped_entities "$file"
        echo "  Fixed: $file"
    fi
done

echo "Fixing any types..."
count=0
for file in $FILES; do
    fix_any_types "$file"
    count=$((count + 1))
    if [ $((count % 100)) -eq 0 ]; then
        echo "  Processed $count files..."
    fi
done

echo "Done! Processed $count files."
echo "Run 'npm run lint' to check remaining errors."
