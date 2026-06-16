import knex from 'knex';
import config from './knexfile';
const db = knex((config as any).development);

async function checkBankCOA() {
  try {
    console.log('=== BANK ACCOUNT AND COA MAPPING ===\n');

    // Get bank accounts
    const bankAccounts = await db('bank_accounts').select('*');
    console.log('Bank Accounts:');
    for (const bank of bankAccounts) {
      console.log(`  ID: ${bank.id}, Name: ${bank.account_name}, Bank: ${bank.bank_name}`);
      
      // Try to find matching COA
      const matchingCOA = await db('chart_of_accounts')
        .where('name', 'ilike', `%${bank.account_name}%`)
        .orWhere('name', 'ilike', `%${bank.bank_name}%`)
        .select('*');
      
      if (matchingCOA.length > 0) {
        console.log(`    → Matching COA found:`);
        for (const coa of matchingCOA) {
          console.log(`      - ${coa.code} ${coa.name} (ID: ${coa.id})`);
        }
      } else {
        console.log(`    → No matching COA found`);
      }
    }

    // Get all Asset type COA that might be bank accounts
    console.log('\nAll Asset-type COA:');
    const assetCOA = await db('chart_of_accounts')
      .where('type', 'Asset')
      .select('*');
    
    for (const coa of assetCOA) {
      console.log(`  ${coa.code} ${coa.name} (ID: ${coa.id}, Balance: ${coa.balance})`);
    }

  } catch(e) {
    console.error("Error:", e);
  } finally {
    process.exit(0);
  }
}

checkBankCOA();
