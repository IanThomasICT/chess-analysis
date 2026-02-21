/**
 * CLI script to seed the database for e2e tests.
 * Run with: bun e2e/seed.ts
 */
import { seedTestDatabase } from "./fixtures";

seedTestDatabase();
console.log("Database seeded with e2e test games.");
