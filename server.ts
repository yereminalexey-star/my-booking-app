import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("bookings.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    client_name TEXT NOT NULL,
    phone TEXT,
    description TEXT,
    price INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, time)
  )
`);

// Migration to add price if it doesn't exist
try {
  db.prepare("ALTER TABLE bookings ADD COLUMN price INTEGER DEFAULT 0").run();
} catch (e) {}

// Migration to add is_favorite if it doesn't exist
try {
  db.prepare("ALTER TABLE bookings ADD COLUMN is_favorite INTEGER DEFAULT 0").run();
} catch (e) {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/bookings", (req, res) => {
    const { date, favorite } = req.query;
    let query = "SELECT * FROM bookings";
    let params: any[] = [];

    if (date) {
      query += " WHERE date = ?";
      params.push(date);
    } else if (favorite === '1') {
      query += " WHERE is_favorite = 1";
    }

    query += " ORDER BY time ASC";
    const bookings = db.prepare(query).all(...params);
    res.json(bookings);
  });

  app.get("/api/bookings/stats", (req, res) => {
    const { month, year } = req.query; // format: MM, YYYY
    if (!month || !year) return res.status(400).json({ error: "Требуются месяц и год" });

    const monthStr = month.toString().padStart(2, '0');
    const pattern = `${year}-${monthStr}-%`;

    const bookings = db.prepare(`
      SELECT * FROM bookings 
      WHERE date LIKE ? 
      ORDER BY date ASC, time ASC
    `).all(pattern);

    const total = db.prepare(`
      SELECT SUM(price) as total FROM bookings 
      WHERE date LIKE ?
    `).get(pattern) as { total: number };

    res.json({ bookings, total: total?.total || 0 });
  });

  app.post("/api/bookings", (req, res) => {
    const { date, time, client_name, phone, description, price, is_favorite } = req.body;

    if (!date || !time || !client_name) {
      return res.status(400).json({ error: "Отсутствуют обязательные поля" });
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO bookings (date, time, client_name, phone, description, price, is_favorite)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(date, time, client_name, phone, description, price || 0, is_favorite ? 1 : 0);
      res.json({ id: result.lastInsertRowid });
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        const existing = db.prepare("SELECT * FROM bookings WHERE date = ? AND time = ?").get(date, time);
        res.status(409).json({ error: "Это время уже занято", existing });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  app.put("/api/bookings/:id", (req, res) => {
    const { id } = req.params;
    const { date, time, client_name, phone, description, price, is_favorite } = req.body;

    try {
      const stmt = db.prepare(`
        UPDATE bookings 
        SET date = ?, time = ?, client_name = ?, phone = ?, description = ?, price = ?, is_favorite = ?
        WHERE id = ?
      `);
      stmt.run(date, time, client_name, phone, description, price || 0, is_favorite ? 1 : 0, id);
      res.json({ success: true });
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        const existing = db.prepare("SELECT * FROM bookings WHERE date = ? AND time = ?").get(date, time);
        res.status(409).json({ error: "Это время уже занято", existing });
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  app.delete("/api/bookings/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM bookings WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
