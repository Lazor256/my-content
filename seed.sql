-- Optional seed data (run after schema)

-- Get unit IDs (assuming 1=kg, 2=g, 3=L, 4=ml, 5=pcs)
INSERT INTO ingredients (name, unit_id, cost_per_unit, min_stock, max_stock, current_stock) VALUES
  ('Rice', 1, 2.50, 10, 100, 50),
  ('Vegetable Oil', 3, 4.00, 2, 20, 8),
  ('Salt', 2, 0.50, 1, 10, 5),
  ('Tomatoes', 1, 1.20, 5, 50, 25),
  ('Onions', 1, 0.80, 3, 30, 15)
ON CONFLICT DO NOTHING;

-- Meals and meal_ingredients would be added via the app.
