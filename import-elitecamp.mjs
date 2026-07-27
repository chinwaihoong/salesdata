import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createConnection } from 'mysql2/promise';
import * as XLSX from 'xlsx';

const ELITECAMP_DIR = '/home/ubuntu/elitecamp_raw/Sales data/Elite Camp';
const SHOP = 'Elite Camp';

function extractBrand(productName) {
  if (!productName) return 'Other';
  const KNOWN_BRANDS = [
    'Uni', 'Zebra', 'Pentel', 'Staedtler', 'Rotring', 'Platinum',
    'DOD', 'Iwatani', 'Olight', 'Kokuyo', 'Pilot', 'Lihit Lab',
    'Tombow', 'Sakura', 'Kuretake', 'Mitsubishi'
  ];
  const upper = productName.toUpperCase();
  if (upper.includes('LIHIT LAB') || upper.includes('LIHITLAB') || upper.includes('LIHIT')) return 'Lihit Lab';
  for (const brand of KNOWN_BRANDS) {
    if (brand === 'Lihit Lab') continue;
    if (upper.includes(brand.toUpperCase())) return brand;
  }
  if (upper.includes('UNI-BALL') || upper.includes('UNIBALL')) return 'Uni';
  if (upper.includes('MITSUBISHI')) return 'Uni';
  return 'Other';
}

function parseShopeeFile(filePath, fileName) {
  const workbook = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  const sheet = workbook.Sheets['orders'];
  if (!sheet) throw new Error(`Shopee file ${fileName} missing "orders" sheet`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows.length < 2) return [];

  const header = rows[0];
  const statusIdx = header.indexOf('Order Status');
  const dateIdx = header.indexOf('Order Creation Date');
  const productIdx = header.indexOf('Product Name');
  const dealPriceIdx = header.indexOf('Deal Price');
  const quantityIdx = header.indexOf('Quantity');
  const subtotalIdx = header.indexOf('Product Subtotal');

  const orders = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[statusIdx]) continue;
    const status = String(row[statusIdx]).trim();
    if (status !== 'Completed') continue;

    const dateStr = String(row[dateIdx] || '').trim();
    const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const productName = String(row[productIdx] || '').trim();
    const brand = extractBrand(productName);
    const unitPrice = parseFloat(row[dealPriceIdx]) || 0;
    const quantity = parseInt(row[quantityIdx], 10) || 1;
    const subtotal = parseFloat(row[subtotalIdx]) || 0;

    if (productName && unitPrice > 0) {
      orders.push({
        platform: 'Shopee',
        shop: SHOP,
        orderDate: dateMatch[1],
        productName,
        brand,
        unitPrice,
        quantity,
        subtotal,
        sourceFile: fileName,
      });
    }
  }
  return orders;
}

function parseLazadaFile(filePath, fileName) {
  const workbook = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Lazada file ${fileName} has no data sheet`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows.length < 2) return [];

  const header = rows[0];
  const createTimeIdx = header.indexOf('createTime');
  const itemNameIdx = header.indexOf('itemName');
  const paidPriceIdx = header.indexOf('paidPrice');
  const statusIdx = header.indexOf('status');

  const orders = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const status = String(row[statusIdx] || '').trim().toLowerCase();
    if (status !== 'confirmed') continue;

    const createTimeStr = String(row[createTimeIdx] || '').trim();
    let orderDate = '';
    const dateMatch = createTimeStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      orderDate = dateMatch[1];
    } else {
      const parts = createTimeStr.split(' ');
      if (parts.length >= 3) {
        const months = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        };
        const day = parts[0].padStart(2, '0');
        const month = months[parts[1].toLowerCase()];
        const year = parts[2];
        if (month && year) orderDate = `${year}-${month}-${day}`;
      }
    }
    if (!orderDate) continue;

    const itemName = String(row[itemNameIdx] || '').trim();
    const brand = extractBrand(itemName);
    const paidPrice = parseFloat(row[paidPriceIdx]) || 0;

    if (itemName && paidPrice > 0) {
      orders.push({
        platform: 'Lazada',
        shop: SHOP,
        orderDate,
        productName: itemName,
        brand,
        unitPrice: paidPrice,
        quantity: 1,
        subtotal: paidPrice,
        sourceFile: fileName,
      });
    }
  }
  return orders;
}

async function main() {
  const files = readdirSync(ELITECAMP_DIR).filter(f => f.endsWith('.xlsx'));
  console.log(`Found ${files.length} Excel files in ${ELITECAMP_DIR}`);

  let allOrders = [];
  for (const file of files) {
    const filePath = join(ELITECAMP_DIR, file);
    const isShopee = file.startsWith('Order.all.');
    console.log(`Parsing ${file}... (${isShopee ? 'Shopee' : 'Lazada'})`);
    const orders = isShopee ? parseShopeeFile(filePath, file) : parseLazadaFile(filePath, file);
    console.log(`  → ${orders.length} orders`);
    allOrders = allOrders.concat(orders);
  }

  console.log(`\nTotal orders to import: ${allOrders.length}`);
  if (allOrders.length === 0) {
    console.log('No orders to import. Exiting.');
    return;
  }

  // Connect to database
  const conn = await createConnection({
    uri: process.env.DATABASE_URL,
    connectTimeout: 30000,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const batchSize = 200;
    for (let i = 0; i < allOrders.length; i += batchSize) {
      const batch = allOrders.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const values = [];
      for (const o of batch) {
        values.push(o.platform, o.shop, o.orderDate, o.productName, o.brand, o.unitPrice, o.quantity, o.subtotal, o.sourceFile);
      }
      await conn.execute(
        `INSERT INTO sales_orders (platform, shop, orderDate, productName, brand, unitPrice, quantity, subtotal, sourceFile) VALUES ${placeholders}`,
        values
      );
      if ((i / batchSize) % 10 === 0) {
        console.log(`  Imported ${Math.min(i + batchSize, allOrders.length)}/${allOrders.length}...`);
      }
    }
    console.log(`\n✓ Successfully imported ${allOrders.length} Elite Camp orders`);
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
