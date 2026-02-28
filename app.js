"[const API = '/api"

function $(sel, el = document) {
  return el.querySelector(sel);
}

function $$(sel, el = document) {
  return [...el.querySelectorAll(sel)];
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

// ----- Tabs -----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(tabId);
    if (panel) panel.classList.add('active');
    if (tabId === 'dashboard') loadDashboard();
    if (tabId === 'inventory') loadInventory();
    if (tabId === 'meals') loadMeals();
    if (tabId === 'prepare') loadPrepareForm();
    if (tabId === 'budget') loadBudget();
    if (tabId === 'alerts') loadAlerts();
  });
});

document.querySelectorAll('.tab-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tabId = link.dataset.tab;
    const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
    if (tab) tab.click();
  });
});

// ----- Dashboard -----
async function loadDashboard() {
  try {
    const [budget, alerts, preps] = await Promise.all([
      api('/budget'),
      api('/alerts'),
      api('/preparations')
    ]);

    const totalAlerts = (alerts.low_stock?.length || 0) + (alerts.surplus?.length || 0);
    $('#dash-alerts-count').textContent = totalAlerts;

    if (budget.budget_amount != null) {
      $('#dash-budget').textContent = `₦${Number(budget.spent).toLocaleString()} / ₦${Number(budget.budget_amount).toLocaleString()}`;
      $('#dash-spent').textContent = `₦${Number(budget.spent).toLocaleString()}`;
      $('#dash-remaining').textContent = `₦${Number(budget.remaining).toLocaleString()}`;
      const pct = budget.usage_percent ?? 0;
      $('#dash-progress').style.width = `${Math.min(100, pct)}%`;
    } else {
      $('#dash-budget').textContent = 'No budget set';
      $('#dash-spent').textContent = '—';
      $('#dash-remaining').textContent = '—';
      $('#dash-progress').style.width = '0%';
    }

    const list = $('#dash-preps');
    list.innerHTML = '';
    (preps.slice(0, 8) || []).forEach(p => {
      const li = document.createElement('li');
      li.textContent = `${p.meal_name} × ${p.quantity_prepared} — ₦${Number(p.total_cost).toLocaleString()} (${new Date(p.prepared_at).toLocaleString()})`;
      list.appendChild(li);
    });
    if (preps.length === 0) list.innerHTML = '<li class="muted">No preparations yet.</li>';
  } catch (e) {
    $('#dash-budget').textContent = 'Error loading';
    $('#dash-preps').innerHTML = '<li class="error">' + e.message + '</li>';
  }
}

// ----- Inventory -----
let units = [];

async function loadUnits() {
  units = await api('/units');
  const sel = $('#ingredient-unit');
  if (!sel) return;
  sel.innerHTML = units.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}

async function loadInventory() {
  try {
    const list = await api('/ingredients');
    const tbody = $('#inventory-tbody');
    tbody.innerHTML = '';
    list.forEach(ing => {
      const tr = document.createElement('tr');
      const low = parseFloat(ing.current_stock) < parseFloat(ing.min_stock);
      const surplus = ing.max_stock != null && parseFloat(ing.current_stock) > parseFloat(ing.max_stock);
      let stockClass = '';
      if (low) stockClass = 'stock-low';
      else if (surplus) stockClass = 'stock-surplus';
      else stockClass = 'stock-ok';
      tr.innerHTML = `
        <td>${escapeHtml(ing.name)}</td>
        <td>${escapeHtml(ing.unit_name)}</td>
        <td class="${stockClass}">${Number(ing.current_stock)} ${ing.unit_name}</td>
        <td>${Number(ing.min_stock)} / ${ing.max_stock != null ? Number(ing.max_stock) : '—'}</td>
        <td>₦${Number(ing.cost_per_unit).toLocaleString()}</td>
        <td class="actions">
          <button type="button" class="btn btn-sm secondary" data-edit-id="${ing.id}">Edit</button>
          <button type="button" class="btn btn-sm primary" data-adjust-id="${ing.id}">Adjust stock</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => openIngredientModal(parseInt(btn.dataset.editId, 10)));
    });
    tbody.querySelectorAll('[data-adjust-id]').forEach(btn => {
      btn.addEventListener('click', () => openAdjustStock(parseInt(btn.dataset.adjustId, 10)));
    });
  } catch (e) {
    $('#inventory-tbody').innerHTML = '<tr><td colspan="6">' + e.message + '</td></tr>';
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ----- Ingredient modal -----
function openIngredientModal(id) {
  const modal = $('#modal-ingredient');
  const overlay = $('#modal-overlay');
  $('#modal-ingredient-title').textContent = id ? 'Edit ingredient' : 'Add ingredient';
  $('#form-ingredient').reset();
  $('#ingredient-id').value = id || '';

  if (id) {
    api('/ingredients').then(list => {
      const ing = list.find(i => i.id === id);
      if (!ing) return;
      $('#ingredient-name').value = ing.name;
      $('#ingredient-unit').value = ing.unit_id;
      $('#ingredient-cost').value = ing.cost_per_unit;
      $('#ingredient-stock').value = ing.current_stock;
      $('#ingredient-min').value = ing.min_stock;
      $('#ingredient-max').value = ing.max_stock ?? '';
    });
  }

  overlay.classList.add('active');
  modal.classList.add('active');
}

function closeIngredientModal() {
  $('#modal-overlay').classList.remove('active');
  $('#modal-ingredient').classList.remove('active');
}

$('#btn-new-ingredient').addEventListener('click', () => openIngredientModal(null));

$('#form-ingredient').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#ingredient-id').value;
  const payload = {
    name: $('#ingredient-name').value.trim(),
    unit_id: parseInt($('#ingredient-unit').value, 10),
    cost_per_unit: parseFloat($('#ingredient-cost').value) || 0,
    current_stock: parseFloat($('#ingredient-stock').value) || 0,
    min_stock: parseFloat($('#ingredient-min').value) || 0,
    max_stock: $('#ingredient-max').value ? parseFloat($('#ingredient-max').value) : null
  };
  try {
    if (id) {
      await api(`/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/ingredients', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeIngredientModal();
    loadInventory();
    loadDashboard();
  } catch (err) {
    alert(err.message);
  }
});

function openAdjustStock(id) {
  const qty = prompt('Enter new current stock amount:');
  if (qty === null) return;
  const num = parseFloat(qty);
  if (isNaN(num) || num < 0) {
    alert('Invalid number');
    return;
  }
  api(`/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify({ current_stock: num }) })
    .then(() => { loadInventory(); loadAlerts(); loadDashboard(); })
    .catch(e => alert(e.message));
}

$('#modal-ingredient .modal-close').addEventListener('click', closeIngredientModal);
$('#modal-ingredient .modal-cancel').addEventListener('click', closeIngredientModal);
$('#modal-overlay').addEventListener('click', () => {
  closeIngredientModal();
  closeMealModal();
});

// ----- Meals -----
let ingredientsList = [];

async function loadMeals() {
  try {
    ingredientsList = await api('/ingredients');
    const meals = await api('/meals');
    const container = $('#meals-list');
    container.innerHTML = '';
    meals.forEach(meal => {
      const card = document.createElement('div');
      card.className = 'meal-card';
      const ings = (meal.ingredients || []).map(i =>
        `${i.ingredient_name}: ${Number(i.quantity)} ${i.unit_name}`
      ).join(', ') || 'No ingredients';
      card.innerHTML = `
        <h4>${escapeHtml(meal.name)}</h4>
        ${meal.description ? `<p>${escapeHtml(meal.description)}</p>` : ''}
        <ul class="ingredients-list">${(meal.ingredients || []).map(i =>
          `<li>${escapeHtml(i.ingredient_name)}: ${Number(i.quantity)} ${i.unit_name}</li>`
        ).join('')}</ul>
        <div class="card-actions">
          <button type="button" class="btn btn-sm secondary" data-edit-meal="${meal.id}">Edit</button>
          <button type="button" class="btn btn-sm primary" data-prep-meal="${meal.id}">Prepare</button>
        </div>
      `;
      container.appendChild(card);
      card.querySelector(`[data-edit-meal="${meal.id}"]`)?.addEventListener('click', () => openMealModal(meal.id));
      card.querySelector(`[data-prep-meal="${meal.id}"]`)?.addEventListener('click', () => {
        document.querySelector('.tab[data-tab="prepare"]').click();
        setTimeout(() => {
          $('#prepare-meal').value = meal.id;
          updatePrepareCostPreview();
        }, 100);
      });
    });
    if (meals.length === 0) container.innerHTML = '<p class="empty-state">No meals defined. Add a meal and attach ingredients.</p>';
  } catch (e) {
    $('#meals-list').innerHTML = '<p class="empty-state">' + e.message + '</p>';
  }
}

// ----- Meal modal -----
let mealIngredientsRows = [];

async function openMealModal(id) {
  if (!ingredientsList.length) {
    try {
      ingredientsList = await api('/ingredients');
    } catch (_) {
      ingredientsList = [];
    }
  }
  const modal = $('#modal-meal');
  const overlay = $('#modal-overlay');
  $('#modal-meal-title').textContent = id ? 'Edit meal' : 'Add meal';
  $('#form-meal').reset();
  $('#meal-id').value = id || '';
  mealIngredientsRows = [];

  const listEl = $('#meal-ingredients-list');
  listEl.innerHTML = '';

  if (id) {
    api('/meals').then(meals => {
      const meal = meals.find(m => m.id === id);
      if (!meal) return;
      $('#meal-name').value = meal.name;
      $('#meal-description').value = meal.description || '';
      (meal.ingredients || []).forEach(ing => {
        addMealIngredientRow(ing.ingredient_id, ing.quantity);
      });
      if (mealIngredientsRows.length === 0) addMealIngredientRow('', '');
    });
  } else {
    addMealIngredientRow('', '');
  }

  overlay.classList.add('active');
  modal.classList.add('active');
}

function addMealIngredientRow(ingredientId = '', quantity = '') {
  const id = Date.now() + Math.random();
  const row = document.createElement('div');
  row.className = 'meal-ingredient-row';
  row.dataset.rowId = id;
  const options = ingredientsList.map(i =>
    `<option value="${i.id}" ${i.id === parseInt(ingredientId, 10) ? 'selected' : ''}>${escapeHtml(i.name)} (${i.unit_name})</option>`
  ).join('');
  row.innerHTML = `
    <select class="meal-ing-select" data-ingredient>
      <option value="">Select ingredient</option>
      ${options}
    </select>
    <input type="number" step="0.001" min="0" placeholder="Qty" class="meal-ing-qty" data-quantity value="${quantity}" />
    <button type="button" class="btn-remove" data-remove>×</button>
  `;
  $('#meal-ingredients-list').appendChild(row);
  row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
  mealIngredientsRows.push(row);
}

function closeMealModal() {
  $('#modal-overlay').classList.remove('active');
  $('#modal-meal').classList.remove('active');
}

$('#btn-new-meal').addEventListener('click', () => openMealModal(null));

$('#btn-add-meal-ingredient').addEventListener('click', () => addMealIngredientRow('', ''));

$('#form-meal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mealId = $('#meal-id').value;
  const ingredients = [];
  $('#meal-ingredients-list .meal-ingredient-row').forEach(row => {
    const ingId = row.querySelector('[data-ingredient]').value;
    const qty = parseFloat(row.querySelector('[data-quantity]').value);
    if (ingId && !isNaN(qty) && qty > 0) ingredients.push({ ingredient_id: parseInt(ingId, 10), quantity: qty });
  });

  const payload = {
    name: $('#meal-name').value.trim(),
    description: $('#meal-description').value.trim() || null,
    ingredients
  };

  try {
    if (mealId) {
      await api(`/meals/${mealId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/meals', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeMealModal();
    loadMeals();
    loadPrepareForm();
  } catch (err) {
    alert(err.message);
  }
});

$('#modal-meal .modal-close').addEventListener('click', closeMealModal);
$('#modal-meal .modal-cancel').addEventListener('click', closeMealModal);

// ----- Prepare meal -----
async function loadPrepareForm() {
  const meals = await api('/meals').catch(() => []);
  const sel = $('#prepare-meal');
  sel.innerHTML = '<option value="">Select meal</option>' +
    meals.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  $('#prepare-qty').value = 1;
  $('#prepare-cost-preview').textContent = '';
  $('#prepare-message').textContent = '';
  $('#prepare-message').className = 'message';
}

$('#prepare-meal').addEventListener('change', updatePrepareCostPreview);
$('#prepare-qty').addEventListener('input', updatePrepareCostPreview);

async function updatePrepareCostPreview() {
  const mealId = $('#prepare-meal').value;
  const qty = parseInt($('#prepare-qty').value, 10) || 1;
  const el = $('#prepare-cost-preview');
  if (!mealId) {
    el.textContent = '';
    return;
  }
  try {
    const meals = await api('/meals');
    const meal = meals.find(m => m.id === parseInt(mealId, 10));
    if (!meal || !meal.ingredients?.length) {
      el.textContent = 'No ingredients — cost ₦0';
      return;
    }
    let cost = 0;
    meal.ingredients.forEach(ing => {
      cost += (parseFloat(ing.quantity) * qty) * parseFloat(ing.cost_per_unit);
    });
    el.textContent = `Estimated cost: ₦${cost.toLocaleString('en-NG', { minimumFractionDigits: 2 })} (${qty} portion${qty > 1 ? 's' : ''})`;
  } catch {
    el.textContent = 'Could not calculate cost';
  }
}

$('#btn-prepare').addEventListener('click', async () => {
  const mealId = $('#prepare-meal').value;
  const qty = parseInt($('#prepare-qty').value, 10) || 1;
  const msg = $('#prepare-message');
  msg.textContent = '';
  msg.className = 'message';
  if (!mealId) {
    msg.textContent = 'Select a meal.';
    msg.classList.add('error');
    return;
  }
  try {
    const result = await api(`/meals/${mealId}/prepare`, {
      method: 'POST',
      body: JSON.stringify({ quantity: qty })
    });
    msg.textContent = `Prepared! Total cost: ₦${Number(result.total_cost).toLocaleString()}. Inventory updated.`;
    msg.classList.add('success');
    loadPrepareForm();
    loadInventory();
    loadDashboard();
    loadAlerts();
  } catch (e) {
    msg.textContent = e.message;
    msg.classList.add('error');
  }
});

// ----- Budget -----
async function loadBudget() {
  try {
    const budget = await api('/budget');
    const currentEl = $('#budget-current');
    if (budget.period) {
      currentEl.innerHTML = `
        <p><strong>${budget.period.period_start} → ${budget.period.period_end}</strong></p>
        <p>Budget: ₦${Number(budget.budget_amount).toLocaleString()} · Spent: ₦${Number(budget.spent).toLocaleString()} · Remaining: ₦${Number(budget.remaining).toLocaleString()}</p>
        <p>Usage: ${(budget.usage_percent ?? 0).toFixed(1)}%</p>
      `;
    } else {
      currentEl.innerHTML = '<p class="muted">No budget period set. Add one below.</p>';
    }

    const preps = await api('/preparations');
    const tbody = $('#budget-preps-tbody');
    tbody.innerHTML = '';
    preps.slice(0, 50).forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(p.prepared_at).toLocaleDateString()}</td>
        <td>${escapeHtml(p.meal_name)}</td>
        <td>${p.quantity_prepared}</td>
        <td>₦${Number(p.total_cost).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    $('#budget-current').innerHTML = '<p class="error">' + e.message + '</p>';
  }
}

$('#budget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/budget', {
      method: 'POST',
      body: JSON.stringify({
        period_start: $('#budget-start').value,
        period_end: $('#budget-end').value,
        budget_amount: parseFloat($('#budget-amount').value)
      })
    });
    loadBudget();
    loadDashboard();
    $('#budget-form').reset();
  } catch (err) {
    alert(err.message);
  }
});

// ----- Alerts -----
async function loadAlerts() {
  try {
    const { low_stock, surplus } = await api('/alerts');
    const lowEl = $('#alerts-low');
    const surplusEl = $('#alerts-surplus');
    lowEl.innerHTML = '';
    surplusEl.innerHTML = '';
    (low_stock || []).forEach(item => {
      const li = document.createElement('li');
      li.textContent = `${item.name}: ${Number(item.current_stock)} ${item.unit_name} (min: ${Number(item.min_stock)}) — restock needed`;
      lowEl.appendChild(li);
    });
    (surplus || []).forEach(item => {
      const li = document.createElement('li');
      li.textContent = `${item.name}: ${Number(item.current_stock)} ${item.unit_name} (max: ${Number(item.max_stock)}) — above max`;
      surplusEl.appendChild(li);
    });
    if (low_stock?.length === 0) lowEl.innerHTML = '<li class="muted">None</li>';
    if (surplus?.length === 0) surplusEl.innerHTML = '<li class="muted">None</li>';
  } catch (e) {
    $('#alerts-low').innerHTML = '<li class="error">' + e.message + '</li>';
  }
}

// ----- Init -----
(async function init() {
  await loadUnits();
  loadDashboard();
  loadInventory();
  loadMeals();
  loadPrepareForm();
  loadBudget();
  loadAlerts();
})();
