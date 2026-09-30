import type { Knex } from "knex";

// Stored as 'YYYY-MM-DD' strings to match the existing employees.joinDate column.
const NEW_COLUMNS = ['date_of_birth', 'employment_type', 'probation_end_date', 'contract_end_date', 'exit_date'];

export async function up(knex: Knex): Promise<void> {
  for (const column of NEW_COLUMNS) {
    if (!(await knex.schema.hasColumn('employees', column))) {
      await knex.schema.alterTable('employees', (table) => {
        table.string(column).nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const column of NEW_COLUMNS) {
    if (await knex.schema.hasColumn('employees', column)) {
      await knex.schema.alterTable('employees', (table) => {
        table.dropColumn(column);
      });
    }
  }
}
