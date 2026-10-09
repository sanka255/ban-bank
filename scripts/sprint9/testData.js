const mysql = require('mysql2/promise');

const LEGACY_TABLES = [
  'config_hall',
  'config_hall_partition',
  'config_hall_rate',
  'travelagentdetails',
  'hall_reservation',
  'hall',
  'grouphallres',
  'guest_bill',
  'guest_bill_tax',
  'hall_deposit',
  'hall_withdrawal',
  'configcancelation',
  'credit_card_info',
];

async function getLegacyConnection() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL || process.env.LEGACY_DB_URL;
  if (!legacyUrl) {
    throw new Error('LEGACY_DATABASE_URL is required to inspect the real legacy MySQL source. No mock data is generated.');
  }

  const url = new URL(legacyUrl);
  return mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    charset: 'utf8mb4',
  });
}

async function inspectLegacySource() {
  const connection = await getLegacyConnection();
  const results = [];

  try {
    for (const table of LEGACY_TABLES) {
      const [rows] = await connection.execute(`SELECT COUNT(*) AS total FROM \`${table}\``);
      results.push({ table, total: Number(rows[0]?.total ?? 0) });
    }

    return results;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  inspectLegacySource()
    .then((results) => {
      console.log('Legacy source inspection results:');
      console.table(results);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  inspectLegacySource,
  LEGACY_TABLES,
};
