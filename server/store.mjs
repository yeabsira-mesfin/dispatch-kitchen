import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const workflow = { received: ['preparing', 'cancelled'], preparing: ['ready'], ready: ['completed'], completed: [], cancelled: [] };
const catalog = [
  ['m1', 'Mac & Cheese', 899, 'Comfort', 'Creamy cheddar, macaroni, crispy breadcrumbs.', 'mac-and-cheese.jpg'],
  ['m2', 'Margherita Pizza', 1299, 'Comfort', 'Fresh mozzarella, tomato, basil, thin crust.', 'margherita-pizza.jpg'],
  ['m3', 'Caesar Salad', 799, 'Fresh', 'Romaine, parmesan, croutons, Caesar dressing.', 'caesar-salad.jpg'],
  ['m5', 'Veggie Burger', 999, 'Fresh', 'Vegetable patty, whole grain bun, tangy sauce.', 'veggie-burger.jpg'],
  ['m6', 'Chicken Curry', 1399, 'Comfort', 'Tender chicken in a fragrant, warming curry.', 'chicken-curry.jpg'],
  ['m7', 'Chocolate Brownie', 599, 'Sweet', 'Rich chocolate with a soft, fudgy center.', 'chocolate-brownie.jpg'],
];
export class Problem extends Error { constructor(status, message) { super(message); this.status = status; } }
export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS meals(id TEXT PRIMARY KEY,name TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>0),category TEXT NOT NULL,description TEXT NOT NULL,image TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0)) STRICT;
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,customer TEXT NOT NULL,status TEXT NOT NULL,total_cents INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS items(order_id TEXT NOT NULL REFERENCES orders(id),meal_id TEXT NOT NULL REFERENCES meals(id),quantity INTEGER NOT NULL,unit_cents INTEGER NOT NULL,PRIMARY KEY(order_id,meal_id)) STRICT;
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),status TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    PRAGMA user_version=1;`);
  const seed = db.prepare('INSERT OR IGNORE INTO meals VALUES(?,?,?,?,?,?,12)');
  for (const row of catalog) seed.run(...row);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function get(id) {
    const row = db.prepare('SELECT id,customer,status,total_cents,version,created_at,updated_at FROM orders WHERE id=?').get(id);
    if (!row) throw new Problem(404, 'Order not found.');
    return { ...row, items: db.prepare('SELECT i.meal_id,m.name,i.quantity,i.unit_cents FROM items i JOIN meals m ON m.id=i.meal_id WHERE i.order_id=? ORDER BY i.meal_id').all(id), events: db.prepare('SELECT status,created_at FROM events WHERE order_id=? ORDER BY id').all(id) };
  }
  return {
    close: () => db.close(), get,
    menu: () => db.prepare('SELECT * FROM meals ORDER BY category,name').all(),
    orders: () => db.prepare('SELECT id FROM orders ORDER BY created_at DESC,id').all().map(row => get(row.id)),
    place(input, key) {
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new Problem(400, 'Include an Idempotency-Key of 8–100 letters, digits, underscores or hyphens.');
      if (!input || typeof input.customer !== 'string' || !input.customer.trim() || input.customer.length > 80) throw new Problem(400, 'Pickup name is required (maximum 80 characters).');
      if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20) throw new Problem(400, 'Choose between 1 and 20 distinct menu items.');
      const seen = new Set();
      const items = input.items.map(item => {
        if (!item || typeof item.meal_id !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 || seen.has(item.meal_id)) throw new Problem(400, 'Items need unique meal IDs and quantities from 1 to 20.');
        seen.add(item.meal_id); return { meal_id: item.meal_id, quantity: item.quantity };
      }).sort((a, b) => a.meal_id.localeCompare(b.meal_id));
      const customer = input.customer.trim();
      const fingerprint = createHash('sha256').update(JSON.stringify({ customer, items })).digest('hex');
      return transaction(() => {
        const previous = db.prepare('SELECT id,fingerprint FROM orders WHERE request_key=?').get(key);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new Problem(409, 'This retry key belongs to a different order.');
          return { order: get(previous.id), replayed: true };
        }
        let total = 0;
        const lines = items.map(item => {
          const meal = db.prepare('SELECT * FROM meals WHERE id=?').get(item.meal_id);
          if (!meal) throw new Problem(400, 'Menu item not found.');
          if (meal.stock < item.quantity) throw new Problem(409, `${meal.name} has only ${meal.stock} remaining.`);
          total += meal.price_cents * item.quantity;
          return { ...item, unit_cents: meal.price_cents };
        });
        const id = randomUUID(), now = new Date().toISOString();
        db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,1,?,?)').run(id, key, fingerprint, customer, 'received', total, now, now);
        for (const line of lines) {
          db.prepare('UPDATE meals SET stock=stock-? WHERE id=?').run(line.quantity, line.meal_id);
          db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id, line.meal_id, line.quantity, line.unit_cents);
        }
        db.prepare('INSERT INTO events(order_id,status,created_at) VALUES(?,?,?)').run(id, 'received', now);
        return { order: get(id), replayed: false };
      });
    },
    transition(id, input) {
      if (!input || !Number.isInteger(input.version) || typeof input.status !== 'string') throw new Problem(400, 'Include status and current integer version.');
      return transaction(() => {
        const order = get(id);
        if (order.version !== input.version) throw new Problem(409, 'Order changed. Refresh the kitchen queue.');
        if (!workflow[order.status].includes(input.status)) throw new Problem(422, `Cannot move ${order.status} to ${input.status}.`);
        const now = new Date().toISOString();
        db.prepare('UPDATE orders SET status=?,version=version+1,updated_at=? WHERE id=?').run(input.status, now, id);
        if (input.status === 'cancelled') for (const item of order.items)
          db.prepare('UPDATE meals SET stock=stock+? WHERE id=?').run(item.quantity, item.meal_id);
        db.prepare('INSERT INTO events(order_id,status,created_at) VALUES(?,?,?)').run(id, input.status, now);
        return get(id);
      });
    },
  };
}
