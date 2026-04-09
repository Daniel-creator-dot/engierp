import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Constraint already applied. Leaving empty to prevent transaction abortion.
}

export async function down(knex: Knex): Promise<void> {
  // No-op
}
