const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'your password',
  database: process.env.DB_NAME || 'restaurant_pro'
};

let pool;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration - FIXED
app.use(session({
  secret: process.env.SESSION_SECRET || 'restaurant-secret-key-2026',
  resave: true,  // Changed to true for better compatibility
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Debug middleware to track sessions
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} - Session ID: ${req.sessionID}, Role: ${req.session?.role || 'none'}`);
  next();
});

// Serve static files
app.use(express.static(__dirname));

// Initialize Database
async function initializeDatabase() {
  try {
    // Connect without database to create it
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password
    });
    
    // Create database if not exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    console.log(`✓ Database '${dbConfig.database}' ready`);
    await connection.end();
    
    // Create connection pool with database
    pool = mysql.createPool(dbConfig);
    
    // Create tables
    await createTables();
    await insertInitialData();
    console.log('✓ Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
}

async function createTables() {
  const tables = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      user_id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Customers table
    `CREATE TABLE IF NOT EXISTS customers (
      customer_id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30) NOT NULL,
      email VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Tables table
    `CREATE TABLE IF NOT EXISTS tables (
      table_id INT AUTO_INCREMENT PRIMARY KEY,
      table_number INT NOT NULL UNIQUE,
      capacity INT NOT NULL,
      view VARCHAR(50) NOT NULL DEFAULT 'inside',
      status VARCHAR(20) NOT NULL DEFAULT 'available',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Menu table
    `CREATE TABLE IF NOT EXISTS menu (
      menu_id INT AUTO_INCREMENT PRIMARY KEY,
      item_name VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      availability TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    // Orders table - with serving_status and served_at
    `CREATE TABLE IF NOT EXISTS orders (
      order_id INT AUTO_INCREMENT PRIMARY KEY,
      order_date DATETIME NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      serving_status VARCHAR(20) DEFAULT 'pending',
      served_at DATETIME NULL,
      customer_id INT NOT NULL,
      table_id INT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
      FOREIGN KEY (table_id) REFERENCES tables(table_id)
    )`,
    // Order details table
    `CREATE TABLE IF NOT EXISTS order_details (
      order_detail_id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      menu_id INT NOT NULL,
      quantity INT NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
      FOREIGN KEY (menu_id) REFERENCES menu(menu_id)
    )`,
    // Payments table
    `CREATE TABLE IF NOT EXISTS payments (
      payment_id INT AUTO_INCREMENT PRIMARY KEY,
      payment_method VARCHAR(30) NOT NULL,
      payment_date DATETIME NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      order_id INT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id)
    )`
  ];
  
  for (const tableSQL of tables) {
    await pool.query(tableSQL);
  }
  console.log('✓ All tables created');
  
  // Add missing columns if they don't exist (for existing databases)
  try {
    await pool.query(`ALTER TABLE orders ADD COLUMN serving_status VARCHAR(20) DEFAULT 'pending'`);
  } catch(e) { /* column already exists */ }
  
  try {
    await pool.query(`ALTER TABLE orders ADD COLUMN served_at DATETIME NULL`);
  } catch(e) { /* column already exists */ }
}

async function insertInitialData() {
  // Check if owner exists
  const [users] = await pool.query('SELECT * FROM users WHERE role = ?', ['owner']);
  
  if (users.length === 0) {
    // Insert default owner
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await pool.query(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      ['owner', hashedPassword, 'owner']
    );
    console.log('✓ Default owner created (username: owner, password: admin123)');
  }
  
  // Check if tables exist
  const [tables] = await pool.query('SELECT * FROM tables');
  
  if (tables.length === 0) {
    // Insert sample tables
    const sampleTables = [
      [1, 2, 'inside'],
      [2, 4, 'inside'],
      [3, 4, 'outside'],
      [4, 6, 'sea side'],
      [5, 2, 'sea side'],
      [6, 8, 'outside'],
      [7, 4, 'sea side']
    ];
    for (const table of sampleTables) {
      await pool.query(
        'INSERT INTO tables (table_number, capacity, view, status) VALUES (?, ?, ?, ?)',
        [...table, 'available']
      );
    }
    console.log('✓ Sample tables inserted');
  }
  
  // Check if menu items exist
  const [menuItems] = await pool.query('SELECT * FROM menu');
  
  if (menuItems.length === 0) {
    // Insert sample menu items
    const sampleMenu = [
      ['Margherita Pizza', 'Main Course', 12.99],
      ['Caesar Salad', 'Appetizer', 8.99],
      ['Grilled Salmon', 'Main Course', 18.99],
      ['Chocolate Cake', 'Dessert', 6.99],
      ['Iced Tea', 'Beverage', 3.99],
      ['Pasta Carbonara', 'Main Course', 14.99],
      ['Garlic Bread', 'Appetizer', 4.99],
      ['Tiramisu', 'Dessert', 7.99],
      ['Fresh Juice', 'Beverage', 4.99],
      ['Beef Burger', 'Main Course', 13.99],
      ['Chicken Wings', 'Appetizer', 9.99],
      ['Mango Lassi', 'Beverage', 4.50]
    ];
    for (const item of sampleMenu) {
      await pool.query(
        'INSERT INTO menu (item_name, category, price, availability) VALUES (?, ?, ?, ?)',
        [...item, 1]
      );
    }
    console.log('✓ Sample menu items inserted');
  }
}

// Middleware to check owner authentication
function requireOwner(req, res, next) {
  if (req.session && req.session.role === 'owner') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Owner access required' });
  }
}

// ==================== Authentication Routes ====================

// Login - FIXED with session save
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, role, customerName } = req.body;
    
    console.log('Login attempt:', { role, username, customerName });
    
    if (role === 'owner') {
      // Owner login
      const [users] = await pool.query(
        'SELECT * FROM users WHERE username = ? AND role = ?',
        [username, 'owner']
      );
      
      if (users.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      
      const user = users[0];
      const passwordMatch = await bcrypt.compare(password, user.password);
      
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      
      req.session.userId = user.user_id;
      req.session.username = user.username;
      req.session.role = 'owner';
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ success: false, message: 'Session error' });
        }
        console.log('✅ Owner logged in:', username);
        res.json({ success: true, role: 'owner', username: user.username });
      });
    } else {
      // Customer login
      if (!customerName) {
        return res.status(400).json({ success: false, message: 'Name is required' });
      }
      
      req.session.customerName = customerName;
      req.session.role = 'customer';
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ success: false, message: 'Session error' });
        }
        console.log('✅ Customer logged in:', customerName);
        res.json({ success: true, role: 'customer', name: customerName });
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check session - FIXED with loggedIn field (required for owner.html)
app.get('/api/check-session', (req, res) => {
  console.log('Check session - Session ID:', req.sessionID, 'Role:', req.session?.role);
  
  if (req.session && req.session.role) {
    res.json({
      success: true,
      loggedIn: true,  // CRITICAL for owner.html
      role: req.session.role,
      username: req.session.username,
      customerName: req.session.customerName
    });
  } else {
    res.json({ 
      success: false, 
      loggedIn: false,  // CRITICAL for owner.html
      message: 'Not authenticated' 
    });
  }
});

// ==================== Customer Routes ====================

// Create customer
app.post('/api/customers', async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)',
      [name, phone, email || null]
    );
    
    res.json({ success: true, customerId: result.insertId });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get available tables
app.get('/api/tables/available', async (req, res) => {
  try {
    const { capacity, view } = req.query;
    let query = 'SELECT * FROM tables WHERE status = ?';
    let params = ['available'];
    
    if (capacity) {
      query += ' AND capacity >= ?';
      params.push(capacity);
    }
    
    if (view && view !== 'any') {
      query += ' AND view = ?';
      params.push(view);
    }
    
    query += ' ORDER BY table_number';
    
    const [tables] = await pool.query(query, params);
    res.json({ success: true, tables });
  } catch (error) {
    console.error('Get available tables error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create order
app.post('/api/orders', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { customer_id, table_id } = req.body;
    
    if (!customer_id || !table_id) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Customer and table are required' });
    }
    
    // Check if table is available
    const [tables] = await connection.query(
      'SELECT * FROM tables WHERE table_id = ? AND status = ?',
      [table_id, 'available']
    );
    
    if (tables.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Table is not available' });
    }
    
    // Create order with serving_status
    const [result] = await connection.query(
      'INSERT INTO orders (order_date, customer_id, table_id, total_amount, status, serving_status) VALUES (NOW(), ?, ?, 0, ?, "pending")',
      [customer_id, table_id, 'pending']
    );
    
    // Mark table as occupied
    await connection.query(
      'UPDATE tables SET status = ? WHERE table_id = ?',
      ['occupied', table_id]
    );
    
    await connection.commit();
    res.json({ success: true, orderId: result.insertId });
  } catch (error) {
    await connection.rollback();
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
});

// Get menu
app.get('/api/menu', async (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT * FROM menu WHERE availability = 1';
    let params = [];
    
    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY category, item_name';
    
    const [items] = await pool.query(query, params);
    res.json({ success: true, items });
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get menu categories
app.get('/api/menu/categories', async (req, res) => {
  try {
    const [categories] = await pool.query(
      'SELECT DISTINCT category FROM menu WHERE availability = 1 ORDER BY category'
    );
    res.json({ success: true, categories: categories.map(c => c.category) });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add item to order
app.post('/api/order-details', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { order_id, menu_id, quantity } = req.body;
    
    if (!order_id || !menu_id || !quantity) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Get menu item price
    const [menuItems] = await connection.query(
      'SELECT price FROM menu WHERE menu_id = ?',
      [menu_id]
    );
    
    if (menuItems.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Menu item not found' });
    }
    
    const price = menuItems[0].price;
    const subtotal = price * quantity;
    
    // Check if item already exists in order
    const [existing] = await connection.query(
      'SELECT * FROM order_details WHERE order_id = ? AND menu_id = ?',
      [order_id, menu_id]
    );
    
    if (existing.length > 0) {
      // Update existing item
      const newQuantity = existing[0].quantity + quantity;
      const newSubtotal = price * newQuantity;
      await connection.query(
        'UPDATE order_details SET quantity = ?, subtotal = ? WHERE order_detail_id = ?',
        [newQuantity, newSubtotal, existing[0].order_detail_id]
      );
    } else {
      // Insert new item
      await connection.query(
        'INSERT INTO order_details (order_id, menu_id, quantity, subtotal) VALUES (?, ?, ?, ?)',
        [order_id, menu_id, quantity, subtotal]
      );
    }
    
    // Update order total
    const [totals] = await connection.query(
      'SELECT SUM(subtotal) as total FROM order_details WHERE order_id = ?',
      [order_id]
    );
    
    const newTotal = totals[0].total || 0;
    await connection.query(
      'UPDATE orders SET total_amount = ? WHERE order_id = ?',
      [newTotal, order_id]
    );
    
    await connection.commit();
    res.json({ success: true, message: 'Item added to order' });
  } catch (error) {
    await connection.rollback();
    console.error('Add order detail error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
});

// Get order details
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const [orders] = await pool.query(
      `SELECT o.*, c.name as customer_name, t.table_number 
       FROM orders o
       JOIN customers c ON o.customer_id = c.customer_id
       JOIN tables t ON o.table_id = t.table_id
       WHERE o.order_id = ?`,
      [orderId]
    );
    
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    const [items] = await pool.query(
      `SELECT od.*, m.item_name, m.price
       FROM order_details od
       JOIN menu m ON od.menu_id = m.menu_id
       WHERE od.order_id = ?`,
      [orderId]
    );
    
    res.json({ success: true, order: orders[0], items });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Remove item from order
app.delete('/api/order-details/:detailId', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { detailId } = req.params;
    
    // Get order_id before deleting
    const [details] = await connection.query(
      'SELECT order_id FROM order_details WHERE order_detail_id = ?',
      [detailId]
    );
    
    if (details.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    
    const orderId = details[0].order_id;
    
    // Delete item
    await connection.query(
      'DELETE FROM order_details WHERE order_detail_id = ?',
      [detailId]
    );
    
    // Update order total
    const [totals] = await connection.query(
      'SELECT SUM(subtotal) as total FROM order_details WHERE order_id = ?',
      [orderId]
    );
    
    const newTotal = totals[0].total || 0;
    await connection.query(
      'UPDATE orders SET total_amount = ? WHERE order_id = ?',
      [newTotal, orderId]
    );
    
    await connection.commit();
    res.json({ success: true, message: 'Item removed from order' });
  } catch (error) {
    await connection.rollback();
    console.error('Remove order detail error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
});

// Process payment
app.post('/api/payments', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { order_id, amount, method, tax_rate } = req.body;
    
    if (!order_id || !amount || !method) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Get order details
    const [orders] = await connection.query(
      'SELECT * FROM orders WHERE order_id = ? AND status = ?',
      [order_id, 'pending']
    );
    
    if (orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found or already paid' });
    }
    
    const order = orders[0];
    const subtotal = parseFloat(amount);
    const tax = subtotal * (tax_rate || 0.1);
    const total = subtotal + tax;
    
    // Update order total and status (change from 'pending' to 'paid' for serving)
    await connection.query(
      'UPDATE orders SET total_amount = ?, status = ?, serving_status = "pending" WHERE order_id = ?',
      [total, 'paid', order_id]
    );
    
    // Insert payment record
    await connection.query(
      'INSERT INTO payments (payment_method, payment_date, amount, order_id) VALUES (?, NOW(), ?, ?)',
      [method, total, order_id]
    );
    
    // NOTE: Table is NOT freed here - customer still sitting
    // Table will be freed when order is marked as served
    
    await connection.commit();
    res.json({
      success: true,
      message: 'Payment processed successfully',
      breakdown: {
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        total: total.toFixed(2)
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Process payment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
});

// ==================== Owner Serving Routes ====================

// Confirm payment and mark order as ready to serve
app.put('/api/owner/orders/:orderId/confirm-payment', requireOwner, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    await pool.query(
      'UPDATE orders SET status = ?, serving_status = "pending" WHERE order_id = ?',
      [status, orderId]
    );
    
    res.json({ success: true, message: 'Payment confirmed, order ready to serve' });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Mark order as served (food delivered to customer)
app.put('/api/owner/orders/:orderId/serve', requireOwner, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { orderId } = req.params;
    const { serving_status, served_at } = req.body;
    
    // Update order serving status
    await connection.query(
      'UPDATE orders SET serving_status = ?, served_at = ? WHERE order_id = ?',
      [serving_status, served_at || new Date(), orderId]
    );
    
    // Get table_id to free the table
    const [orders] = await connection.query(
      'SELECT table_id FROM orders WHERE order_id = ?',
      [orderId]
    );
    
    if (orders.length > 0) {
      const tableId = orders[0].table_id;
      // Free the table
      await connection.query(
        'UPDATE tables SET status = ? WHERE table_id = ?',
        ['available', tableId]
      );
    }
    
    await connection.commit();
    res.json({ success: true, message: 'Order marked as served, table is now available' });
  } catch (error) {
    await connection.rollback();
    console.error('Mark as served error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
});

// Get order details with items (for owner view)
app.get('/api/owner/orders/:orderId/details', requireOwner, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const [orders] = await pool.query(
      `SELECT o.*, c.name as customer_name, c.phone, t.table_number, t.view
       FROM orders o
       JOIN customers c ON o.customer_id = c.customer_id
       JOIN tables t ON o.table_id = t.table_id
       WHERE o.order_id = ?`,
      [orderId]
    );
    
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    const [items] = await pool.query(
      `SELECT od.*, m.item_name, m.price, m.category
       FROM order_details od
       JOIN menu m ON od.menu_id = m.menu_id
       WHERE od.order_id = ?`,
      [orderId]
    );
    
    res.json({ success: true, order: orders[0], items });
  } catch (error) {
    console.error('Get order details error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== Owner Routes ====================

// Get all menu items (including unavailable)
app.get('/api/owner/menu', requireOwner, async (req, res) => {
  try {
    const [items] = await pool.query('SELECT * FROM menu ORDER BY category, item_name');
    res.json({ success: true, items });
  } catch (error) {
    console.error('Get owner menu error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add menu item
app.post('/api/owner/menu', requireOwner, async (req, res) => {
  try {
    const { item_name, category, price, availability } = req.body;
    
    if (!item_name || !category || !price) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO menu (item_name, category, price, availability) VALUES (?, ?, ?, ?)',
      [item_name, category, parseFloat(price), availability !== undefined ? availability : 1]
    );
    
    res.json({ success: true, menuId: result.insertId, message: 'Menu item added successfully' });
  } catch (error) {
    console.error('Add menu item error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update menu item
app.put('/api/owner/menu/:menuId', requireOwner, async (req, res) => {
  try {
    const { menuId } = req.params;
    const { item_name, category, price, availability } = req.body;
    
    if (!item_name || !category || !price) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    await pool.query(
      'UPDATE menu SET item_name = ?, category = ?, price = ?, availability = ? WHERE menu_id = ?',
      [item_name, category, parseFloat(price), availability !== undefined ? availability : 1, menuId]
    );
    
    res.json({ success: true, message: 'Menu item updated successfully' });
  } catch (error) {
    console.error('Update menu item error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete menu item
app.delete('/api/owner/menu/:menuId', requireOwner, async (req, res) => {
  try {
    const { menuId } = req.params;
    await pool.query('DELETE FROM menu WHERE menu_id = ?', [menuId]);
    res.json({ success: true, message: 'Menu item deleted successfully' });
  } catch (error) {
    console.error('Delete menu item error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all orders (updated with serving_status)
app.get('/api/owner/orders', requireOwner, async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT o.*, c.name as customer_name, c.phone, t.table_number, t.view
       FROM orders o
       JOIN customers c ON o.customer_id = c.customer_id
       JOIN tables t ON o.table_id = t.table_id
       ORDER BY o.order_date DESC`
    );
    res.json({ success: true, orders });
  } catch (error) {
    console.error('Get owner orders error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all tables
app.get('/api/owner/tables', requireOwner, async (req, res) => {
  try {
    const [tables] = await pool.query('SELECT * FROM tables ORDER BY table_number');
    res.json({ success: true, tables });
  } catch (error) {
    console.error('Get owner tables error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update table status
app.put('/api/owner/tables/:tableId', requireOwner, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }
    
    await pool.query(
      'UPDATE tables SET status = ? WHERE table_id = ?',
      [status, tableId]
    );
    
    res.json({ success: true, message: 'Table status updated successfully' });
  } catch (error) {
    console.error('Update table status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get analytics
app.get('/api/owner/analytics', requireOwner, async (req, res) => {
  try {
    // Total sales
    const [salesResult] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total_sales FROM payments'
    );
    const totalSales = parseFloat(salesResult[0].total_sales);
    
    // Total orders
    const [ordersResult] = await pool.query(
      'SELECT COUNT(*) as total_orders FROM orders'
    );
    const totalOrders = ordersResult[0].total_orders;
    
    // Popular items (top 5)
    const [popular] = await pool.query(
      `SELECT m.item_name, m.category, SUM(od.quantity) as total_quantity
       FROM order_details od
       JOIN menu m ON od.menu_id = m.menu_id
       GROUP BY od.menu_id
       ORDER BY total_quantity DESC
       LIMIT 5`
    );
    
    // Sales by category
    const [categories] = await pool.query(
      `SELECT m.category, SUM(od.subtotal) as total_sales
       FROM order_details od
       JOIN menu m ON od.menu_id = m.menu_id
       GROUP BY m.category
       ORDER BY total_sales DESC`
    );
    
    res.json({
      success: true,
      analytics: {
        sales: totalSales,
        orders: totalOrders,
        popular,
        categories
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/customer.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'customer.html'));
});

app.get('/owner.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'owner.html'));
});

// Start server
async function startServer() {
  await initializeDatabase();
  
  app.listen(PORT, () => {
    console.log(`\n🚀 Restaurant Management System`);
    console.log(`📍 Server running on http://localhost:${PORT}`);
    console.log(`🔐 Owner Login - Username: owner, Password: admin123`);
    console.log(`📱 Customer Login - Any name`);
    console.log(`✨ Order serving workflow enabled\n`);
  });
}

startServer();