import { migratePostgres } from "../src/postgresMigrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL to a direct PostgreSQL connection string");
}

await migratePostgres(connectionString);
console.log("PostgreSQL schema migrations are up to date.");
