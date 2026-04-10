import { Knex } from 'knex';

interface TableDefinition {
  tableName: string;
  columns: {
    name: string;
    type: string;
    nullable?: boolean;
    defaultValue?: any;
  }[];
}

const DESIRED_SCHEMA: TableDefinition[] = [
  {
    tableName: 'employees',
    columns: [
      { name: 'ssnit', type: 'string', nullable: true },
      { name: 'ghana_card', type: 'string', nullable: true },
      { name: 'phone', type: 'string', nullable: true },
      { name: 'address', type: 'text', nullable: true },
    ],
  },
  {
    tableName: 'payroll',
    columns: [
      { name: 'detailed_deductions', type: 'text', nullable: true }, // JSON as text
    ],
  },
  {
    tableName: 'sms_configurations',
    columns: [
      { name: 'api_url', type: 'string', nullable: true },
    ],
  },
];

export async function syncSchema(db: Knex) {
  console.log('⏳ Starting dynamic schema sync...');
  
  for (const tableDef of DESIRED_SCHEMA) {
    const hasTable = await db.schema.hasTable(tableDef.tableName);
    
    if (!hasTable) {
      console.log(`ℹ️ Table ${tableDef.tableName} does not exist, skipping auto-alter (should be handled by migrations).`);
      continue;
    }

    for (const column of tableDef.columns) {
      const hasColumn = await db.schema.hasColumn(tableDef.tableName, column.name);
      
      if (!hasColumn) {
        console.log(`➕ Adding missing column [${column.name}] to table [${tableDef.tableName}]...`);
        await db.schema.alterTable(tableDef.tableName, (table) => {
          let col;
          if (column.type === 'string') {
            col = table.string(column.name);
          } else if (column.type === 'text') {
            col = table.text(column.name);
          } else if (column.type === 'integer') {
            col = table.integer(column.name);
          } else if (column.type === 'decimal') {
            col = table.decimal(column.name, 15, 2);
          } else if (column.type === 'boolean') {
            col = table.boolean(column.name);
          } else if (column.type === 'date') {
            col = table.date(column.name);
          }

          if (col) {
            if (column.nullable) col.nullable();
            else col.notNullable();
            
            if (column.defaultValue !== undefined) {
              col.defaultTo(column.defaultValue);
            }
          }
        });
        console.log(`✅ Column [${column.name}] added.`);
      }
    }
  }
  
  console.log('✅ Dynamic schema sync complete.');
}
