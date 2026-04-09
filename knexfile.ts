import type { Knex } from "knex";

const config: { [key: string]: Knex.Config } = {
  development: {
    client: "postgresql",
    connection: {
      database: "eng",
      user: "postgres",
      password: "Admin",
      host: "localhost",
      port: 5432
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: "knex_migrations",
      directory: "./server/migrations"
    },
    seeds: {
      directory: "./server/seeds"
    }
  }
};

export default config;
