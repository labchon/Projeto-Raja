import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const uploadDir = path.resolve(projectRoot, "backend", "uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const port = process.env.PORT || 3001;
const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-me";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));
app.use(express.static(projectRoot));

let db;

function authRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Nao autenticado." });
  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalido." });
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Acesso restrito a admin." });
  return next();
}

function mapObservation(row, comments, votes, currentUserId) {
  const coherentVotes = votes.filter((v) => v.value === "coherent");
  const incoherentVotes = votes.filter((v) => v.value === "incoherent");
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    photo: `/uploads/${path.basename(row.photo_path)}`,
    popularName: row.popular_name,
    scientificName: row.scientific_name,
    group: row.species_group,
    location: row.location,
    sex: row.sex,
    observedAt: row.observed_at,
    status: row.status,
    createdAt: row.created_at,
    comments: comments.map((c) => ({
      id: c.id,
      userId: c.user_id,
      userName: c.user_name,
      text: c.text,
      status: c.status,
      createdAt: c.created_at,
    })),
    votes: {
      coherent: coherentVotes.map((v) => v.user_id),
      incoherent: incoherentVotes.map((v) => v.user_id),
    },
    myVote: votes.find((v) => v.user_id === currentUserId)?.value || null,
  };
}

async function loadObservationBundle(rows, currentUserId, includeAllComments) {
  const output = [];
  for (const row of rows) {
    const comments = await db.all(
      includeAllComments
        ? "SELECT * FROM comments WHERE observation_id = ? ORDER BY datetime(created_at) DESC"
        : "SELECT * FROM comments WHERE observation_id = ? AND status = 'approved' ORDER BY datetime(created_at) DESC",
      row.id,
    );
    const votes = await db.all("SELECT * FROM votes WHERE observation_id = ?", row.id);
    output.push(mapObservation(row, comments, votes, currentUserId));
  }
  return output;
}

async function seedAdmin() {
  const adminEmail = "admin@observach.org";
  const existing = await db.get("SELECT id FROM users WHERE email = ?", adminEmail);
  if (existing) return;

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash("admin123", 10);
  await db.run(
    "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    "Administrador",
    adminEmail,
    passwordHash,
    "admin",
    new Date().toISOString(),
  );
}

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: "Dados invalidos para cadastro." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await db.get("SELECT id FROM users WHERE email = ?", normalizedEmail);
  if (existing) return res.status(409).json({ error: "Email ja cadastrado." });

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  const createdAt = new Date().toISOString();
  await db.run(
    "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)",
    id,
    name.trim(),
    normalizedEmail,
    passwordHash,
    createdAt,
  );

  const token = jwt.sign({ id, email: normalizedEmail, role: "user" }, jwtSecret, { expiresIn: "7d" });
  return res.json({ token, user: { id, name: name.trim(), email: normalizedEmail, role: "user" } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = await db.get("SELECT * FROM users WHERE email = ?", normalizedEmail);
  if (!user) return res.status(401).json({ error: "Credenciais invalidas." });

  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Credenciais invalidas." });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: "7d" });
  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  const user = await db.get("SELECT id, name, email, role FROM users WHERE id = ?", req.user.id);
  if (!user) return res.status(401).json({ error: "Usuario nao encontrado." });
  return res.json({ user });
});

app.get("/api/observations/public", authRequired, async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM observations WHERE status = 'approved' ORDER BY datetime(created_at) DESC",
  );
  const data = await loadObservationBundle(rows, req.user.id, false);
  return res.json({ items: data });
});

app.get("/api/observations/mine", authRequired, async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM observations WHERE user_id = ? ORDER BY datetime(created_at) DESC",
    req.user.id,
  );
  const data = await loadObservationBundle(rows, req.user.id, req.user.role === "admin");
  return res.json({ items: data });
});

app.get("/api/observations/pending", authRequired, adminRequired, async (req, res) => {
  const rows = await db.all(
    `SELECT DISTINCT o.* FROM observations o
     LEFT JOIN comments c ON c.observation_id = o.id
     WHERE o.status = 'pending' OR c.status = 'pending'
     ORDER BY datetime(o.created_at) DESC`,
  );
  const data = await loadObservationBundle(rows, req.user.id, true);
  return res.json({ items: data });
});

app.post("/api/observations", authRequired, upload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Foto obrigatoria." });
  const { popularName, scientificName, group, location, sex, observedAt } = req.body;
  if (!popularName || !scientificName || !group || !location || !sex || !observedAt) {
    return res.status(400).json({ error: "Campos obrigatorios ausentes." });
  }

  const user = await db.get("SELECT id, name FROM users WHERE id = ?", req.user.id);
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO observations
     (id, user_id, user_name, photo_path, popular_name, scientific_name, species_group, location, sex, observed_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    req.user.id,
    user.name,
    req.file.path,
    popularName.trim(),
    scientificName.trim(),
    group,
    location.trim(),
    sex,
    new Date(observedAt).toISOString(),
    new Date().toISOString(),
  );

  return res.status(201).json({ id });
});

app.post("/api/observations/:id/vote", authRequired, async (req, res) => {
  const { value } = req.body;
  if (!["coherent", "incoherent"].includes(value)) {
    return res.status(400).json({ error: "Voto invalido." });
  }

  const observation = await db.get("SELECT id, status FROM observations WHERE id = ?", req.params.id);
  if (!observation || observation.status !== "approved") {
    return res.status(404).json({ error: "Postagem nao encontrada ou nao aprovada." });
  }

  const existing = await db.get(
    "SELECT id FROM votes WHERE observation_id = ? AND user_id = ?",
    req.params.id,
    req.user.id,
  );
  if (existing) {
    await db.run("UPDATE votes SET value = ?, created_at = ? WHERE id = ?", value, new Date().toISOString(), existing.id);
  } else {
    await db.run(
      "INSERT INTO votes (id, observation_id, user_id, value, created_at) VALUES (?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      req.params.id,
      req.user.id,
      value,
      new Date().toISOString(),
    );
  }

  return res.json({ ok: true });
});

app.post("/api/observations/:id/comments", authRequired, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Comentario vazio." });
  const observation = await db.get("SELECT id, status FROM observations WHERE id = ?", req.params.id);
  if (!observation || observation.status !== "approved") {
    return res.status(404).json({ error: "Postagem nao encontrada ou nao aprovada." });
  }

  const user = await db.get("SELECT name FROM users WHERE id = ?", req.user.id);
  await db.run(
    "INSERT INTO comments (id, observation_id, user_id, user_name, text, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    crypto.randomUUID(),
    req.params.id,
    req.user.id,
    user.name,
    text.trim(),
    new Date().toISOString(),
  );

  return res.status(201).json({ ok: true });
});

app.patch("/api/admin/observations/:id/status", authRequired, adminRequired, async (req, res) => {
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status invalido." });
  }
  await db.run("UPDATE observations SET status = ? WHERE id = ?", status, req.params.id);
  return res.json({ ok: true });
});

app.patch("/api/admin/comments/:id/status", authRequired, adminRequired, async (req, res) => {
  const { status } = req.body;
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status invalido." });
  }
  await db.run("UPDATE comments SET status = ? WHERE id = ?", status, req.params.id);
  return res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.resolve(projectRoot, "index.html"));
});

async function start() {
  db = await getDb();
  await seedAdmin();
  app.listen(port, () => {
    console.log(`API on http://localhost:${port}`);
  });
}

start();
