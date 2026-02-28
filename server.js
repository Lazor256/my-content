require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: process.env.PG_PORT || 5432,
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'kitchen_db'
      }
);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----- Units -----
app.get('/api/units', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM units ORDER BY name');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Ingredients -----
app.get('/api/ingredients', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, u.name AS unit_name
      FROM ingredients i
      JOIN units u ON i.unit_id = u.id
      ORDER BY i.name
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ingredients', async (req, res) => {
  const { name, unit_id, cost_per_unit, min_stock, max_stock, current_stock } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ingredients (name, unit_id, cost_per_unit, min_stock, max_stock, current_stock)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, unit_id, cost_per_unit ?? 0, min_stock ?? 0, max_stock ?? null, current_stock ?? 0]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/ingredients/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, unit_id, cost_per_unit, min_stock, max_stock, current_stock } = req.body;
  const updates = [];
  const values = [];
  let i = 1;
  if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name); }
  if (unit_id !== undefined) { updates.push(`unit_id = $${i++}`); values.push(unit_id); }
  if (cost_per_unit !== undefined) { updates.push(`cost_per_unit = $${i++}`); values.push(cost_per_unit); }
  if (min_stock !== undefined) { updates.push(`min_stock = $${i++}`); values.push(min_stock); }
  if (max_stock !== undefined) { updates.push(`max_stock = $${i++}`); values.push(max_stock); }
  if (current_stock !== undefined) { updates.push(`current_stock = $${i++}`); values.push(current_stock); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE ingredients SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Ingredient not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/ingredients/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM ingredients WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Meals -----
app.get('/api/meals', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        COALESCE(
          (SELECT json_agg(json_build_object('ingredient_id', mi.ingredient_id, 'quantity', mi.quantity, 'ingredient_name', i.name, 'unit_name', u.name, 'cost_per_unit', i.cost_per_unit))
          FROM meal_ingredients mi
          JOIN ingredients i ON mi.ingredient_id = i.id
          JOIN units u ON i.unit_id = u.id
          WHERE mi.meal_id = m.id),
          '[]'::json
        ) AS ingredients
      FROM meals m
      ORDER BY m.name
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/meals', async (req, res) => {
  const { name, description, ingredients } = req.body;
  const client = await pool.connect();
  try {
    const { rows: mealRows } = await client.query(
      'INSERT INTO meals (name, description) VALUES ($1, $2) RETURNING *',
      [name, description ?? null]
    );
    const meal = mealRows[0];
    if (Array.isArray(ingredients) && ingredients.length) {
      for (const { ingredient_id, quantity } of ingredients) {
        await client.query(
          'INSERT INTO meal_ingredients (meal_id, ingredient_id, quantity) VALUES ($1, $2, $3)',
          [meal.id, ingredient_id, quantity]
        );
      }
    }
    const { rows: full } = await pool.query(`
      SELECT m.*, COALESCE(
        (SELECT json_agg(json_build_object('ingredient_id', mi.ingredient_id, 'quantity', mi.quantity, 'ingredient_name', i.name, 'unit_name', u.name, 'cost_per_unit', i.cost_per_unit))
        FROM meal_ingredients mi JOIN ingredients i ON mi.ingredient_id = i.id JOIN units u ON i.unit_id = u.id WHERE mi.meal_id = m.id),
        '[]'::json
      ) AS ingredients FROM meals m WHERE m.id = $1
    `, [meal.id]);
    res.status(201).json(full[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.patch('/api/meals/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, description, ingredients } = req.body;
  const client = await pool.connect();
  try {
    if (name !== undefined) await client.query('UPDATE meals SET name = $1 WHERE id = $2', [name, id]);
    if (description !== undefined) await client.query('UPDATE meals SET description = $1 WHERE id = $2', [description, id]);
    if (Array.isArray(ingredients)) {
      await client.query('DELETE FROM meal_ingredients WHERE meal_id = $1', [id]);
      for (const { ingredient_id, quantity } of ingredients) {
        await client.query(
          'INSERT INTO meal_ingredients (meal_id, ingredient_id, quantity) VALUES ($1, $2, $3)',
          [id, ingredient_id, quantity]
        );
      }
    }
    const { rows } = await pool.query(`
      SELECT m.*, COALESCE(
        (SELECT json_agg(json_build_object('ingredient_id', mi.ingredient_id, 'quantity', mi.quantity, 'ingredient_name', i.name, 'unit_name', u.name, 'cost_per_unit', i.cost_per_unit))
        FROM meal_ingredients mi JOIN ingredients i ON mi.ingredient_id = i.id JOIN units u ON i.unit_id = u.id WHERE mi.meal_id = m.id),
        '[]'::json
      ) AS ingredients FROM meals m WHERE m.id = $1
    `, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Meal not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/api/meals/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM meals WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Prepare meal: deduct inventory, record cost, create preparation -----
app.post('/api/meals/:id/prepare', async (req, res) => {
  const mealId = parseInt(req.params.id, 10);
  const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
  const client = await pool.connect();
  try {
    const { rows: mealRows } = await client.query(`
      SELECT mi.ingredient_id, mi.quantity, i.current_stock, i.name AS ingredient_name, u.name AS unit_name, i.cost_per_unit
      FROM meal_ingredients mi
      JOIN ingredients i ON mi.ingredient_id = i.id
      JOIN units u ON i.unit_id = u.id
      WHERE mi.meal_id = $1
    `, [mealId]);
    if (mealRows.length === 0) return res.status(404).json({ error: 'Meal not found or has no ingredients' });

    let totalCost = 0;
    for (const row of mealRows) {
      const needed = row.quantity * quantity;
      if (row.current_stock < needed) {
        return res.status(400).json({
          error: 'Insufficient stock',
          detail: `${row.ingredient_name}: need ${needed} ${row.unit_name}, have ${row.current_stock}`
        });
      }
      totalCost += (row.quantity * quantity) * parseFloat(row.cost_per_unit);
    }

    for (const row of mealRows) {
      const deduct = row.quantity * quantity;
      await client.query(
        'UPDATE ingredients SET current_stock = current_stock - $1 WHERE id = $2',
        [deduct, row.ingredient_id]
      );
    }

    const { rows: prep } = await client.query(
      'INSERT INTO preparations (meal_id, quantity_prepared, total_cost) VALUES ($1, $2, $3) RETURNING *',
      [mealId, quantity, totalCost.toFixed(2)]
    );

    res.status(201).json({
      preparation: prep[0],
      total_cost: parseFloat(prep[0].total_cost),
      deducted: mealRows.map(r => ({
        ingredient_id: r.ingredient_id,
        quantity_deducted: r.quantity * quantity,
        unit: r.unit_name
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ----- Preparations history -----
app.get('/api/preparations', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, m.name AS meal_name
      FROM preparations p
      JOIN meals m ON p.meal_id = m.id
      ORDER BY p.prepared_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Budget: current period and usage -----
app.get('/api/budget', async (req, res) => {
  try {
    const { rows: period } = await pool.query(`
      SELECT * FROM budget_settings
      WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE
      ORDER BY period_start DESC LIMIT 1
    `);
    const { rows: usage } = await pool.query(`
      SELECT COALESCE(SUM(total_cost), 0) AS spent
      FROM preparations
      WHERE prepared_at >= (SELECT COALESCE((SELECT period_start FROM budget_settings WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE ORDER BY period_start DESC LIMIT 1), CURRENT_DATE))
        AND prepared_at <= (SELECT COALESCE((SELECT period_end FROM budget_settings WHERE period_start <= CURRENT_DATE AND period_end >= CURRENT_DATE ORDER BY period_start DESC LIMIT 1), CURRENT_DATE))
    `);
    const budget = period[0] ? parseFloat(period[0].budget_amount) : null;
    const spent = parseFloat(usage[0]?.spent || 0);
    res.json({
      period: period[0] || null,
      budget_amount: budget,
      spent,
      remaining: budget != null ? budget - spent : null,
      usage_percent: budget != null && budget > 0 ? Math.min(100, (spent / budget) * 100) : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/budget', async (req, res) => {
  const { period_start, period_end, budget_amount } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO budget_settings (period_start, period_end, budget_amount) VALUES ($1, $2, $3) RETURNING *',
      [period_start, period_end, budget_amount]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----- Alerts: low stock (restock) and surplus -----
app.get('/api/alerts', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.id, i.name, u.name AS unit_name, i.current_stock, i.min_stock, i.max_stock,
        CASE WHEN i.max_stock IS NOT NULL AND i.current_stock > i.max_stock THEN true ELSE false END AS surplus,
        CASE WHEN i.current_stock < i.min_stock THEN true ELSE false END AS low_stock
      FROM ingredients i
      JOIN units u ON i.unit_id = u.id
      WHERE i.current_stock < i.min_stock OR (i.max_stock IS NOT NULL AND i.current_stock > i.max_stock)
      ORDER BY i.current_stock ASC
    `);
    const lowStock = rows.filter(r => r.low_stock);
    const surplus = rows.filter(r => r.surplus);
    res.json({ low_stock: lowStock, surplus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Kitchen Management server running at http://localhost:${PORT}`);
});
