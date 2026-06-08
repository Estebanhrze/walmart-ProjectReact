import { initializeApp } from 'firebase/app'
import { getFirestore, writeBatch, doc, Timestamp } from 'firebase/firestore'
import { readFile } from 'node:fs/promises'

const csvPath = process.argv[2]

if (!csvPath) {
  console.error('Uso: npm run import:csv -- "C:\\\\ruta\\\\Walmart.csv"')
  process.exit(1)
}

const requiredEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const missing = requiredEnv.filter((key) => !process.env[key])

if (missing.length > 0) {
  console.error(`Faltan variables de entorno: ${missing.join(', ')}`)
  console.error('Crea un archivo .env.local o exporta esas variables antes de importar.')
  process.exit(1)
}

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

function parseCsvLine(line) {
  const values = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && nextCharacter === '"') {
      current += '"'
      index += 1
    } else if (character === '"') {
      insideQuotes = !insideQuotes
    } else if (character === ',' && !insideQuotes) {
      values.push(current)
      current = ''
    } else {
      current += character
    }
  }

  values.push(current)
  return values
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean)
  const headers = parseCsvLine(lines[0])

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toBoolean(value) {
  return String(value).toLowerCase() === 'true'
}

function toTimestamp(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? Timestamp.now() : Timestamp.fromDate(date)
}

function normalizeRow(row) {
  const quantitySold = toNumber(row.quantity_sold)
  const unitPrice = toNumber(row.unit_price)

  return {
    transaction_id: toNumber(row.transaction_id),
    customer_id: toNumber(row.customer_id),
    product_id: toNumber(row.product_id),
    product_name: row.product_name,
    category: row.category,
    quantity_sold: quantitySold,
    unit_price: unitPrice,
    revenue: quantitySold * unitPrice,
    transaction_date: toTimestamp(row.transaction_date),
    store_id: toNumber(row.store_id),
    store_location: row.store_location,
    inventory_level: toNumber(row.inventory_level),
    reorder_point: toNumber(row.reorder_point),
    reorder_quantity: toNumber(row.reorder_quantity),
    supplier_id: toNumber(row.supplier_id),
    supplier_lead_time: toNumber(row.supplier_lead_time),
    customer_age: toNumber(row.customer_age),
    customer_gender: row.customer_gender || 'Other',
    customer_income: toNumber(row.customer_income),
    customer_loyalty_level: row.customer_loyalty_level || 'Bronze',
    payment_method: row.payment_method || 'Cash',
    promotion_applied: toBoolean(row.promotion_applied),
    promotion_type: row.promotion_type,
    weather_conditions: row.weather_conditions,
    holiday_indicator: toBoolean(row.holiday_indicator),
    weekday: row.weekday,
    stockout_indicator: toBoolean(row.stockout_indicator),
    forecasted_demand: toNumber(row.forecasted_demand),
    actual_demand: toNumber(row.actual_demand),
  }
}

const csvContent = await readFile(csvPath, 'utf8')
const rows = parseCsv(csvContent).map(normalizeRow)

let batch = writeBatch(db)
let operationCount = 0
let totalWritten = 0

for (const row of rows) {
  const id = String(row.transaction_id)
  batch.set(doc(db, 'sales_transactions', id), row)
  operationCount += 1
  totalWritten += 1

  if (operationCount === 450) {
    await batch.commit()
    batch = writeBatch(db)
    operationCount = 0
  }
}

if (operationCount > 0) {
  await batch.commit()
}

console.log(`Importadas ${totalWritten} transacciones en sales_transactions.`)
