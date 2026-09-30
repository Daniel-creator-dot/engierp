import type { Knex } from "knex";

const NEW_SUPPLIER_CATEGORIES = [
  'Food & Canteen Services',
  'Electrical & Plumbing',
  'Fuel & Lubricants',
  'Professional Services',
  'Transport & Logistics',
  'Office Supplies',
  'Security Services',
  'Cleaning & Janitorial',
  'Building Materials',
  'IT & Communications',
];

// Records store the category name as text; any value already in use gets a
// category row so it stays selectable and manageable.
const IN_USE_SOURCES: { type: string; table: string; column: string }[] = [
  { type: 'supplier', table: 'suppliers', column: 'category' },
  { type: 'inventory', table: 'inventory_items', column: 'category' },
  { type: 'asset', table: 'equipment', column: 'category' },
  { type: 'expense', table: 'bills', column: 'category' },
];

export async function up(knex: Knex): Promise<void> {
  const rows: { type: string; name: string }[] = NEW_SUPPLIER_CATEGORIES.map(name => ({ type: 'supplier', name }));

  for (const source of IN_USE_SOURCES) {
    if (!(await knex.schema.hasTable(source.table))) continue;
    if (!(await knex.schema.hasColumn(source.table, source.column))) continue;
    const used = await knex(source.table).distinct(source.column).whereNotNull(source.column);
    for (const row of used) {
      const name = String(row[source.column] || '').trim();
      if (name) rows.push({ type: source.type, name });
    }
  }

  const existing = await knex('categories').select('type', 'name');
  const taken = new Set(existing.map((c: any) => `${c.type}:${String(c.name).toLowerCase()}`));
  const toInsert: { type: string; name: string }[] = [];
  for (const row of rows) {
    const key = `${row.type}:${row.name.toLowerCase()}`;
    if (taken.has(key)) continue;
    taken.add(key);
    toInsert.push(row);
  }

  if (toInsert.length) {
    await knex('categories').insert(toInsert.map(r => ({ ...r, is_active: true }))).onConflict(['type', 'name']).ignore();
  }
}

export async function down(knex: Knex): Promise<void> {
  const used = await knex('suppliers').distinct('category').whereNotNull('category');
  const usedNames = new Set(used.map((r: any) => r.category));
  const removable = NEW_SUPPLIER_CATEGORIES.filter(name => !usedNames.has(name));
  if (removable.length) {
    await knex('categories').where({ type: 'supplier' }).whereIn('name', removable).del();
  }
}
