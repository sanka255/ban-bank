require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const url = process.env.ELLA_PMS_DATABASE_URL;
  // parse mysql://user:pass@host:port/dbname?...
  const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!match) { console.error('Cannot parse ELLA_PMS_DATABASE_URL'); process.exit(1); }
  const [, user, password, host, port, database] = match;
  const conn = await mysql.createConnection({ host, port: Number(port), user, password, database, ssl: { rejectUnauthorized: false } });
  
  const [tables] = await conn.query('SHOW TABLES');
  console.log('Tables in ella_pms:');
  tables.forEach(t => console.log(' ', Object.values(t)[0]));
  
  // Check if guest_charges or similar table exists
  const tableNames = tables.map(t => Object.values(t)[0]);
  const relevant = tableNames.filter(n => n.includes('charge') || n.includes('folio') || n.includes('tax') || n.includes('bill') || n.includes('posting'));
  console.log('\nRelevant tables:', relevant);
  
  if (relevant.length > 0) {
    for (const tbl of relevant) {
      const [cols] = await conn.query(`DESCRIBE \`${tbl}\``);
      console.log(`\n${tbl} columns:`, cols.map(c => `${c.Field} (${c.Type})`).join(', '));
    }
  }
  
  // Also check tax_config if it exists
  if (tableNames.includes('tax_config')) {
    const [rows] = await conn.query('SELECT * FROM tax_config LIMIT 5');
    console.log('\ntax_config rows:', JSON.stringify(rows));
  }
  if (tableNames.includes('tax_configs')) {
    const [rows] = await conn.query('SELECT * FROM tax_configs LIMIT 5');
    console.log('\ntax_configs rows:', JSON.stringify(rows));
  }
  
  await conn.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
