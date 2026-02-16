const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const https = require('https');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected ✅'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Schemas
const PantrySchema = new mongoose.Schema({
    name: { type: String, required: true },
    quantity: { type: Number, default: 0 },
    unit: { type: String, default: 'pcs' }
});
const PantryItem = mongoose.model('PantryItem', PantrySchema);

const RecipeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: String,
    ingredients: [String],
    instructions: String,
    rating: Number
});
const Recipe = mongoose.model('Recipe', RecipeSchema);

const PlanSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // "YYYY-MM-DD"
    recipeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recipe' }
});
const Plan = mongoose.model('Plan', PlanSchema);

const CheckedItemSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }
});
const CheckedItem = mongoose.model('CheckedItem', CheckedItemSchema);

app.use(bodyParser.json());
app.use(express.static('public'));

// --- PANTRY ROUTES ---
app.get('/api/pantry', async (req, res) => {
    try {
        const items = await PantryItem.find();
        res.json(items);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pantry', async (req, res) => {
    const { name, quantity, unit } = req.body;
    if (!name) return res.status(400).send('Item name required');

    try {
        let item = await PantryItem.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
        
        if (item) {
            const newQty = (item.quantity || 0) + (parseFloat(quantity) || 0);
            if (newQty <= 0) {
                await item.deleteOne();
            } else {
                item.quantity = newQty;
                if (unit) item.unit = unit;
                await item.save();
            }
        } else if ((parseFloat(quantity) || 0) > 0) {
            item = new PantryItem({ name, quantity, unit });
            await item.save();
        }
        
        const items = await PantryItem.find();
        res.json({ success: true, pantry: items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pantry/:name', async (req, res) => {
    try {
        await PantryItem.deleteOne({ name: { $regex: new RegExp(`^${req.params.name}$`, 'i') } });
        const items = await PantryItem.find();
        res.json({ success: true, pantry: items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RECIPE ROUTES ---
app.get('/api/recipes', async (req, res) => {
    try {
        const recipes = await Recipe.find();
        const mapped = recipes.map(r => ({ ...r.toObject(), id: r._id }));
        res.json(mapped);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipes', async (req, res) => {
    const { name, url, ingredients, instructions } = req.body;
    if (!name) return res.status(400).send('Recipe name required');

    try {
        const recipe = new Recipe({ name, url, ingredients, instructions });
        await recipe.save();
        const recipes = await Recipe.find();
        res.json({ success: true, recipes: recipes.map(r => ({ ...r.toObject(), id: r._id })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/recipes/:id', async (req, res) => {
    try {
        await Recipe.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SEARCH / FETCH ROUTES ---
app.post('/api/search-recipes', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).send('Query required');
    
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server missing BRAVE_API_KEY" });

    try {
        const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + " recipe")}&count=5`;
        const results = await new Promise((resolve, reject) => {
            https.get(searchUrl, {
                headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
            }, (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => resolve(JSON.parse(data)));
            }).on("error", err => reject(err));
        });

        if (!results.web || !results.web.results) return res.json({ success: true, results: [] });

        const simplified = results.web.results.map(r => ({
            title: r.title,
            url: r.url,
            description: r.description
        }));
        res.json({ success: true, results: simplified });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/fetch-recipe', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).send('URL required');

    try {
        const html = await new Promise((resolve, reject) => {
            https.get(url, (resp) => {
                let data = '';
                resp.on('data', chunk => data += chunk);
                resp.on('end', () => resolve(data));
            }).on("error", err => reject(err));
        });

        const $ = cheerio.load(html);
        let recipeData = null;

        $('script[type="application/ld+json"]').each((i, elem) => {
            try {
                const json = JSON.parse($(elem).html());
                const findRecipe = (obj) => {
                    if (!obj) return null;
                    if (Array.isArray(obj)) return obj.find(findRecipe);
                    if (obj['@graph']) return findRecipe(obj['@graph']);
                    if (obj['@type'] === 'Recipe' || (Array.isArray(obj['@type']) && obj['@type'].includes('Recipe'))) return obj;
                    return null;
                };
                const found = findRecipe(json);
                if (found) { recipeData = found; return false; }
            } catch (e) {}
        });

        if (recipeData) {
            return res.json({
                success: true,
                name: recipeData.name,
                url: url,
                ingredients: recipeData.recipeIngredient || [],
                instructions: Array.isArray(recipeData.recipeInstructions) 
                    ? recipeData.recipeInstructions.map(i => i.text || i.name || i).join('\n') 
                    : recipeData.recipeInstructions
            });
        }
        res.status(404).json({ error: "No structured recipe found." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- PLAN ROUTES ---
app.get('/api/plan', async (req, res) => {
    try {
        const plans = await Plan.find();
        const planObj = {};
        plans.forEach(p => planObj[p.date] = p.recipeId);
        res.json(planObj);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/plan', async (req, res) => {
    const { date, recipeId } = req.body;
    if (!date) return res.status(400).send('Date required');

    try {
        if (recipeId === null) {
            await Plan.deleteOne({ date });
        } else {
            await Plan.findOneAndUpdate(
                { date },
                { recipeId },
                { upsert: true, new: true }
            );
        }
        const plans = await Plan.find();
        const planObj = {};
        plans.forEach(p => planObj[p.date] = p.recipeId);
        res.json({ success: true, plan: planObj });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SHOPPING LIST ROUTES ---
app.get('/api/shopping-list', async (req, res) => {
    try {
        const plans = await Plan.find().populate('recipeId');
        const pantry = await PantryItem.find();
        const checkedItems = await CheckedItem.find();
        const checkedNames = checkedItems.map(c => c.name);

        const needed = {};
        for (const p of plans) {
            if (p.recipeId && p.recipeId.ingredients) {
                p.recipeId.ingredients.forEach(ing => {
                    const parts = ing.trim().split(' ');
                    const first = parseFloat(parts[0]);
                    let name = !isNaN(first) ? parts.slice(1).join(' ').toLowerCase() : ing.toLowerCase();
                    if (name.endsWith('s')) name = name.slice(0, -1);
                    name = name.replace(/^(cup|tbsp|tsp|lb|oz|g|kg|ml|l)\s+/, '');
                    
                    const qty = !isNaN(first) ? first : 1;
                    if (!needed[name]) needed[name] = 0;
                    needed[name] += qty;
                });
            }
        }

        const shoppingList = [];
        Object.keys(needed).forEach(name => {
            const neededQty = needed[name];
            const pantryItem = pantry.find(p => {
                let pName = p.name.toLowerCase();
                if (pName.endsWith('s')) pName = pName.slice(0, -1);
                return pName.includes(name) || name.includes(pName);
            });
            
            const haveQty = pantryItem ? parseFloat(pantryItem.quantity) || 0 : 0;
            const isChecked = checkedNames.includes(name);

            if (haveQty < neededQty || isChecked) {
                shoppingList.push({
                    name,
                    needed: neededQty,
                    have: haveQty,
                    toBuy: Math.max(0, neededQty - haveQty),
                    checked: isChecked
                });
            }
        });
        
        res.json({ success: true, list: shoppingList });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shopping-list/check', async (req, res) => {
    const { name, checked } = req.body;
    try {
        if (checked) {
            await CheckedItem.updateOne({ name }, { name }, { upsert: true });
        } else {
            await CheckedItem.deleteOne({ name });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shopping-list/have', async (req, res) => {
    // Updates pantry to meet need
    try {
        const checkedItems = await CheckedItem.find();
        // Recalc NEED (Complex logic duplication...)
        // For now, assume checkedItems logic matches needed logic
        // Or re-run logic:
        const plans = await Plan.find().populate('recipeId');
        const needed = {};
        for (const p of plans) {
            if (p.recipeId && p.recipeId.ingredients) {
                p.recipeId.ingredients.forEach(ing => {
                    const parts = ing.trim().split(' ');
                    const first = parseFloat(parts[0]);
                    let name = !isNaN(first) ? parts.slice(1).join(' ').toLowerCase() : ing.toLowerCase();
                    if (name.endsWith('s')) name = name.slice(0, -1);
                    name = name.replace(/^(cup|tbsp|tsp|lb|oz|g|kg|ml|l)\s+/, '');
                    
                    const checkedName = checkedItems.find(c => c.name === name || c.name.includes(name) || name.includes(c.name));
                    if (checkedName) {
                        const qty = !isNaN(first) ? first : 1;
                        if (!needed[checkedName.name]) needed[checkedName.name] = 0;
                        needed[checkedName.name] += qty;
                    }
                });
            }
        }
        
        for (const name of Object.keys(needed)) {
            const need = needed[name];
            let item = await PantryItem.findOne({ name: { $regex: new RegExp(name, 'i') } });
            if (item) {
                if (item.quantity < need) { item.quantity = need; await item.save(); }
            } else { await new PantryItem({ name, quantity: need }).save(); }
        }
        
        await CheckedItem.deleteMany({});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shopping-list/buy', async (req, res) => {
    try {
        const checkedItems = await CheckedItem.find();
        const plans = await Plan.find().populate('recipeId');
        const needed = {};
        for (const p of plans) {
            if (p.recipeId && p.recipeId.ingredients) {
                p.recipeId.ingredients.forEach(ing => {
                    const parts = ing.trim().split(' ');
                    const first = parseFloat(parts[0]);
                    let name = !isNaN(first) ? parts.slice(1).join(' ').toLowerCase() : ing.toLowerCase();
                    if (name.endsWith('s')) name = name.slice(0, -1);
                    name = name.replace(/^(cup|tbsp|tsp|lb|oz|g|kg|ml|l)\s+/, '');
                    
                    const checkedName = checkedItems.find(c => c.name === name || c.name.includes(name) || name.includes(c.name));
                    if (checkedName) {
                        const qty = !isNaN(first) ? first : 1;
                        if (!needed[checkedName.name]) needed[checkedName.name] = 0;
                        needed[checkedName.name] += qty;
                    }
                });
            }
        }
        
        for (const name of Object.keys(needed)) {
            const qtyToAdd = needed[name];
            let item = await PantryItem.findOne({ name: { $regex: new RegExp(name, 'i') } });
            if (item) { item.quantity = (item.quantity || 0) + qtyToAdd; await item.save(); }
            else { await new PantryItem({ name, quantity: qtyToAdd }).save(); }
        }
        
        await CheckedItem.deleteMany({});
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
