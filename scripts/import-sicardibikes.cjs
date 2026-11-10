const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL || 'postgres://portal659:%40Javier040484@localhost:5432/portal659';
const pool = new Pool({ connectionString: DB_URL });

function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function categoryFor(grupo, name) {
  if (grupo === 3) return 'Camaras';
  if (grupo === 1) return 'Accesorios';
  return 'Repuestos';
}

async function hasColumn(client, table, col) {
  const r = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1",
    [table, col]
  ).catch(() => ({ rows: [] }));
  return r.rows.length > 0;
}

async function hasTable(client, table) {
  const r = await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", ['public.' + table]).catch(() => ({ rows: [{ ok: false }] }));
  return r.rows[0] && r.rows[0].ok === true;
}

async function main() {
  const client = await pool.connect();
  try {
    let vendorSlug = process.env.VENDOR_SLUG || '';
    let vendorRow;
    if (vendorSlug) {
      const r = await client.query('SELECT * FROM vendors WHERE slug = $1 LIMIT 1', [vendorSlug]);
      vendorRow = r.rows[0];
    } else {
      const r = await client.query("SELECT * FROM vendors WHERE store_name ILIKE '%sicardi%bike%' OR slug ILIKE '%sicardi%bike%' OR store_name ILIKE '%sicardibike%' OR slug ILIKE '%sicardibike%' ORDER BY store_name");
      if (r.rows.length === 1) {
        vendorRow = r.rows[0];
      } else if (r.rows.length === 0) {
        const r2 = await client.query("SELECT * FROM vendors WHERE store_name ILIKE '%bici%' OR slug ILIKE '%bici%' ORDER BY store_name");
        if (r2.rows.length === 1) vendorRow = r2.rows[0];
        else if (r2.rows.length === 0) {
          const r3 = await client.query("SELECT * FROM vendors WHERE store_name ILIKE '%sicardi%' ORDER BY store_name");
          if (r3.rows.length === 1) vendorRow = r3.rows[0];
          else {
            console.log('Vendors candidatos:', r3.rows.map(v => v.store_name + ' (' + v.slug + ')'));
            throw new Error('No se encontro un vendor unico. Defini VENDOR_SLUG.');
          }
        } else {
          console.log('Vendors candidatos:', r2.rows.map(v => v.store_name + ' (' + v.slug + ')'));
          throw new Error('Varios vendors candidatos. Defini VENDOR_SLUG=<slug>.');
        }
      } else {
        console.log('Vendors candidatos:', r.rows.map(v => v.store_name + ' (' + v.slug + ')'));
        throw new Error('Varios vendors candidatos. Defini VENDOR_SLUG=<slug>.');
      }
    }
    if (!vendorRow) throw new Error('Vendor no encontrado');
    console.log('Vendor:', vendorRow.store_name, '(' + vendorRow.slug + ') id=', vendorRow.id);

    const vendorId = vendorRow.id;

    const plans = await client.query('SELECT * FROM plans').then(r => r.rows).catch(() => []);
    const planRow = plans.find(p => p.id === vendorRow.plan_id);
    const maxProducts = planRow ? planRow.max_products : null;

    const existingCount = await client.query('SELECT count(*)::int AS c FROM products WHERE vendor_id = $1', [vendorId]).then(r => r.rows[0].c);
    console.log('Productos existentes:', existingCount, 'max del plan:', maxProducts);

    const hasSupplierCol = await hasColumn(client, 'products', 'supplier_id');
    const hasSkuCol = await hasColumn(client, 'products', 'sku');
    const hasCostCol = await hasColumn(client, 'products', 'cost_last');
    const hasStockCtrlCol = await hasColumn(client, 'products', 'stock_control');
    const hasStockCol = await hasColumn(client, 'products', 'stock');
    const hasDescCol = await hasColumn(client, 'products', 'description');
    const hasCatCol = await hasColumn(client, 'products', 'category');
    console.log('Columnas:', { hasSupplierCol, hasSkuCol, hasCostCol, hasStockCtrlCol, hasStockCol, hasDescCol, hasCatCol });

    const hasSuppliersTable = await hasTable(client, 'suppliers');
    const hasCategoriesTable = await hasTable(client, 'vendor_categories');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.resolve(process.env.XLSX || 'C:/Users/IPS/Downloads/lista sicardibikes.xlsx'));
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow((row) => {
      rows.push(row.values.map(v => (v && typeof v === 'object' && v.text) ? v.text : (v && typeof v === 'object' && v.result !== undefined) ? v.result : v));
    });
    const header = rows[0];
    console.log('Header:', header);

    const idx = {};
    header.forEach((h, i) => { if (h != null) idx[String(h).trim().toLowerCase()] = i; });
    const col = (name) => idx[name];

    const supplierMap = new Map();
    if (hasSuppliersTable) {
      const distinctSup = new Set();
      for (let i = 1; i < rows.length; i++) {
        const v = rows[i][col('idproveedor')];
        if (v != null && v !== '') distinctSup.add(String(v).trim());
      }
      for (const sid of distinctSup) {
        const name = 'Proveedor ' + sid;
        const existing = await client.query('SELECT id FROM suppliers WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1', [vendorId, name]).catch(() => ({ rows: [] }));
        let supId = existing.rows[0] ? existing.rows[0].id : null;
        if (!supId) {
          const r = await client.query('INSERT INTO suppliers (vendor_id, name) VALUES ($1, $2) RETURNING id', [vendorId, name]).catch(() => ({ rows: [] }));
          supId = r.rows[0] ? r.rows[0].id : null;
        }
        if (supId) supplierMap.set(sid, supId);
      }
      console.log('Proveedores creados/vinculados:', supplierMap.size);
    }

    const catNameSet = new Set();
    if (hasCategoriesTable) {
      const existingCats = await client.query('SELECT name FROM vendor_categories WHERE vendor_id = $1', [vendorId]).then(r => r.rows).catch(() => []);
      existingCats.forEach(c => catNameSet.add(String(c.name).trim().toLowerCase()));
    }

    async function ensureCategory(name) {
      if (!hasCategoriesTable) return;
      if (catNameSet.has(name.toLowerCase())) return;
      const pos = await client.query('SELECT count(*)::int AS m FROM vendor_categories WHERE vendor_id = $1', [vendorId]).then(r => r.rows[0].m).catch(() => 0);
      await client.query('INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3)', [vendorId, name, pos]).catch(() => {});
      catNameSet.add(name.toLowerCase());
    }

    const distinctCats = new Set();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[col('descripcion')] || '').trim();
      if (!name) continue;
      const grupo = r[col('grupo')];
      distinctCats.add(categoryFor(grupo, name));
    }
    for (const c of distinctCats) await ensureCategory(c);
    console.log('Categorias:', [...distinctCats]);

    let imported = 0, updated = 0, skipped = 0, errors = 0;
    const errorList = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[col('descripcion')] || '').trim();
      if (!name) { skipped++; continue; }
      const skuRaw = r[col('codigo')];
      const sku = skuRaw != null && String(skuRaw).trim() !== '' ? String(skuRaw).trim().slice(0, 64) : null;
      const price = Number(r[col('l1')]);
      if (!Number.isFinite(price) || price <= 0) {
        errors++; errorList.push({ name, reason: 'precio invalido (' + r[col('l1')] + ')' }); continue;
      }
      const costRaw = r[col('costo')];
      const cost = Number.isFinite(Number(costRaw)) && Number(costRaw) >= 0 ? Number(costRaw) : null;
      const stockRaw = r[col('stock')];
      const stock = Number.isFinite(Number(stockRaw)) ? Math.max(0, Math.floor(Number(stockRaw))) : 0;
      const grupo = r[col('grupo')];
      const category = categoryFor(grupo, name);
      const marca = String(r[col('marcas')] || '').trim();
      const desc = marca || null;
      const idproveedor = r[col('idproveedor')];
      const supplierId = (idproveedor != null && idproveedor !== '') ? (supplierMap.get(String(idproveedor).trim()) || null) : null;

      if (maxProducts != null && (existingCount + imported) >= maxProducts) {
        console.log('Limite de plan alcanzado (' + maxProducts + '). Deteniendo.');
        break;
      }

      let existing = null;
      if (hasSkuCol && sku) {
        const r2 = await client.query('SELECT id FROM products WHERE vendor_id = $1 AND sku = $2 LIMIT 1', [vendorId, sku]).catch(() => ({ rows: [] }));
        existing = r2.rows[0];
      }
      if (!existing) {
        const r2 = await client.query('SELECT id FROM products WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1', [vendorId, name]).catch(() => ({ rows: [] }));
        existing = r2.rows[0];
      }

      if (existing) {
        const updates = [];
        const params = [];
        let p = 1;
        updates.push('price = $' + (p++)); params.push(price);
        if (hasCatCol) { updates.push('category = $' + (p++)); params.push(category); }
        if (hasDescCol) { updates.push('description = $' + (p++)); params.push(desc); }
        if (hasCostCol && cost != null) { updates.push('cost_last = $' + (p++)); params.push(cost); }
        if (hasStockCol) { updates.push('stock = $' + (p++)); params.push(stock); }
        if (hasStockCtrlCol) { updates.push('stock_control = $' + (p++)); params.push(true); }
        if (hasSkuCol && sku) { updates.push('sku = $' + (p++)); params.push(sku); }
        if (hasSupplierCol && supplierId) { updates.push('supplier_id = $' + (p++)); params.push(supplierId); }
        params.push(existing.id, vendorId);
        await client.query(
          'UPDATE products SET ' + updates.join(', ') + ' WHERE id = $' + (params.length - 1) + ' AND vendor_id = $' + params.length,
          params
        ).catch(e => { errors++; errorList.push({ name, reason: 'update: ' + e.message }); });
        updated++;
      } else {
        const colNames = ['vendor_id', 'name', 'price', 'currency', 'category', 'type', 'available'];
        const params = [];
        const push = (v) => { params.push(v); };
        push(vendorId); push(name); push(price); push('ARS');
        push(category); push('food'); push(true);
        if (hasDescCol) { colNames.push('description'); push(desc); }
        if (hasCostCol && cost != null) { colNames.push('cost_last'); push(cost); }
        if (hasStockCol) { colNames.push('stock'); push(stock); }
        if (hasStockCtrlCol) { colNames.push('stock_control'); push(true); }
        const hasOnlineCol = await hasColumn(client, 'products', 'online_available');
        if (hasOnlineCol) { colNames.push('online_available'); push(true); }
        if (hasSkuCol && sku) { colNames.push('sku'); push(sku); }
        if (hasSupplierCol && supplierId) { colNames.push('supplier_id'); push(supplierId); }
        const ph = colNames.map((_, i) => '$' + (i + 1)).join(', ');
        await client.query(
          'INSERT INTO products (' + colNames.join(', ') + ') VALUES (' + ph + ')',
          params
        ).catch(e => { errors++; errorList.push({ name, reason: 'insert: ' + e.message }); });
        imported++;
      }
    }

    console.log('\n=== RESULTADO ===');
    console.log('Importados:', imported);
    console.log('Actualizados:', updated);
    console.log('Salteados (sin nombre):', skipped);
    console.log('Errores:', errors);
    if (errorList.length) {
      console.log('Primeros errores:', errorList.slice(0, 10));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); }); // end