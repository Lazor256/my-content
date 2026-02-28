-- Kitchen Management DB Schema
-- Units: kg, g, L, ml, pcs, etc.

CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  name VARCHAR(20) UNIQUE NOT NULL
);

INSERT INTO units (name) VALUES
  ('kg'), ('g'), ('L'), ('ml'), ('pcs'), ('oz'), ('lb')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS ingredients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  unit_id INT NOT NULL REFERENCES units(id),
  cost_per_unit DECIMAL(12,4) NOT NULL DEFAULT 0,
  min_stock DECIMAL(12,4) NOT NULL DEFAULT 0,
  max_stock DECIMAL(12,4),
  current_stock DECIMAL(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meal_ingredients (
  id SERIAL PRIMARY KEY,
  meal_id INT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id INT NOT NULL REFERENCES ingredients(id),
  quantity DECIMAL(12,4) NOT NULL,
  UNIQUE(meal_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS preparations (
  id SERIAL PRIMARY KEY,
  meal_id INT NOT NULL REFERENCES meals(id),
  quantity_prepared INT NOT NULL DEFAULT 1,
  total_cost DECIMAL(12,4) NOT NULL,
  prepared_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_settings (
  id SERIAL PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  budget_amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ingredients_name ON ingredients(name);
CREATE INDEX idx_meals_name ON meals(name);
CREATE INDEX idx_preparations_prepared_at ON preparations(prepared_at);
CREATE INDEX idx_meal_ingredients_meal ON meal_ingredients(meal_id);
CREATE INDEX idx_meal_ingredients_ingredient ON meal_ingredients(ingredient_id);
