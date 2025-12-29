#!/usr/bin/env tsx

/**
 * OpenAPI TypeScript Type Generation Script
 *
 * This script generates TypeScript types from the backend's OpenAPI schema.
 * It can fetch the schema from a running backend or use a local file.
 *
 * Usage:
 *   npm run generate-api-types          # Fetch from running backend
 *   npm run generate-api-types:local    # Use local schema file
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
const QONTINUI_URL = process.env.NEXT_PUBLIC_QONTINUI_API_URL || 'http://localhost:8000';
const SCHEMA_PATH = path.resolve(__dirname, '../src/lib/api-client/openapi-schema.json');
const OUTPUT_PATH = path.resolve(__dirname, '../src/lib/api-client/generated-types.ts');
const QONTINUI_OUTPUT_PATH = path.resolve(__dirname, '../src/lib/api-client/qontinui-generated-types.ts');

async function downloadSchema(url: string, outputPath: string): Promise<void> {
  console.log(`📥 Downloading OpenAPI schema from ${url}...`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${response.status} ${response.statusText}`);
    }

    const schema = await response.json();
    fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
    console.log(`✅ Schema downloaded to ${outputPath}`);
  } catch (error) {
    console.error(`❌ Failed to download schema from ${url}:`, error);
    throw error;
  }
}

async function generateTypes(schemaPath: string, outputPath: string, serviceName: string): Promise<void> {
  console.log(`🔄 Generating TypeScript types for ${serviceName}...`);

  try {
    // Use the CLI directly via execSync
    execSync(`npx openapi-typescript "${schemaPath}" -o "${outputPath}"`, {
      stdio: 'inherit'
    });
    console.log(`✅ Types generated successfully at ${outputPath}`);
  } catch (error) {
    console.error(`❌ Failed to generate types:`, error);
    throw error;
  }
}

async function main() {
  const useLocal = process.argv.includes('--local');

  console.log('🚀 OpenAPI TypeScript Type Generation');
  console.log('=====================================\n');

  try {
    // Ensure output directory exists
    const apiClientDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(apiClientDir)) {
      fs.mkdirSync(apiClientDir, { recursive: true });
    }

    if (!useLocal) {
      // Download schemas from running backends
      console.log('📡 Fetching schemas from running backends...\n');

      // Try to download backend schema
      try {
        await downloadSchema(`${BACKEND_URL}/api/v1/openapi.json`, SCHEMA_PATH);
      } catch (_error) {
        console.warn('⚠️  Backend schema download failed, trying local file...');
        if (!fs.existsSync(SCHEMA_PATH)) {
          throw new Error('No local schema file found and backend is not accessible');
        }
      }

      // Try to download Qontinui schema
      const qontinuiSchemaPath = path.resolve(__dirname, '../src/lib/api-client/qontinui-openapi-schema.json');
      try {
        await downloadSchema(`${QONTINUI_URL}/api/v1/openapi.json`, qontinuiSchemaPath);

        // Generate Qontinui types if schema was downloaded
        await generateTypes(qontinuiSchemaPath, QONTINUI_OUTPUT_PATH, 'Qontinui API');
      } catch (_error) {
        console.warn('⚠️  Qontinui API not available, skipping type generation for it');
      }
    } else {
      console.log('📁 Using local schema files...\n');
    }

    // Generate types for backend
    if (fs.existsSync(SCHEMA_PATH)) {
      await generateTypes(SCHEMA_PATH, OUTPUT_PATH, 'Backend API');
    } else {
      throw new Error(`Schema file not found at ${SCHEMA_PATH}`);
    }

    console.log('\n✨ All done! Types are ready to use.');
    console.log('\n📚 Import types like this:');
    console.log('   import type { paths, components } from "@/lib/api-client/generated-types"');
    console.log('   type User = components["schemas"]["UserRead"]');
    console.log('   type Projects = paths["/api/v1/projects/"]["get"]["responses"]["200"]["content"]["application/json"]');

  } catch (error) {
    console.error('\n❌ Type generation failed:', error);
    process.exit(1);
  }
}

main();
