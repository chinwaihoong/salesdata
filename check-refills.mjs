import mysql from 'mysql2/promise';

const pool = mysql.createPool(process.env.DATABASE_URL);
const [rows] = await pool.execute(
  `SELECT productName, brand, SUM(quantity) as qty, SUM(subtotal) as sales
   FROM sales_orders
   WHERE LOWER(productName) LIKE '%refill%'
   GROUP BY productName, brand
   ORDER BY sales DESC
   LIMIT 30`
);
for (const r of rows) {
  console.log(`Brand: ${r.brand} | Qty: ${r.qty} | Sales: ${r.sales}`);
  console.log(`  Raw: ${r.productName}`);
  console.log();
}
await pool.end();
