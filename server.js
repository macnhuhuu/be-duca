require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Cấu hình Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cấu hình CORS chi tiết hơn
app.use(cors({
  origin: ['https://duca-mocha.vercel.app', 'https://menu-duca.vercel.app', 'http://localhost:19006', 'http://localhost:8081', '*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Connect MongoDB Atlas
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas connected!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// User model đơn giản
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['nhan_vien', 'chu'], required: true },
  },
  { timestamps: true }
);

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    nameEn: { type: String, default: '' },
    price: { type: Number, required: true },
    category: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    items: [
      {
        menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
        name: String,
        price: Number,
        quantity: Number,
      },
    ],
    total: { type: Number, required: true },
    createdByEmail: String,
    tableNumber: { type: Number, default: 0 },
    billId: String, // e.g. HD#000001
  },
  { timestamps: true }
);

const counterSchema = new mongoose.Schema({
  id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

const activeCartSchema = new mongoose.Schema({
  tableNumber: { type: Number, unique: true, required: true },
  items: [
    {
      menuItemId: String,
      name: String,
      price: Number,
      quantity: Number,
      imageUrl: String,
    },
  ],
  updatedByEmail: String,
}, { timestamps: true });

const ActiveCart = mongoose.model('ActiveCart', activeCartSchema);

const User = mongoose.model('User', userSchema);
const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Order = mongoose.model('Order', orderSchema);

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// ─── Upload ảnh lên Cloudinary ───────────────────────────────────────────────
// Body: { data: "data:image/jpeg;base64,..." }
// Response: { url: "https://res.cloudinary.com/..." }
app.post('/upload', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ message: 'Thiếu dữ liệu ảnh' });

    // Kiểm tra xem đã config Cloudinary chưa
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ 
        message: 'Lỗi cấu hình Cloudinary trên server (thiếu biến môi trường)',
        missing: {
          name: !process.env.CLOUDINARY_CLOUD_NAME,
          key: !process.env.CLOUDINARY_API_KEY,
          secret: !process.env.CLOUDINARY_API_SECRET
        }
      });
    }

    const result = await cloudinary.uploader.upload(data, {
      folder: 'duca-menu',
      transformation: [{ width: 600, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }],
    });

    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ 
      message: 'Upload ảnh thất bại: ' + (err.message || 'Lỗi không xác định'),
      details: err.error_code || err.name
    });
  }
});

// ─── Auth ────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  try {
    const { email, password, role, code } = req.body;

    if (!email || !password || !role || !code) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin' });
    }

    if (role === 'nhan_vien' && code !== '2507') {
      return res.status(400).json({ message: 'Mã xác thực nhân viên không đúng (phải là 2507)' });
    }

    if (role === 'chu' && code !== '250704') {
      return res.status(400).json({ message: 'Mã xác thực chủ không đúng (phải là 250704)' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email đã được sử dụng' });
    }

    const user = await User.create({ email, password, role });

    return res.status(201).json({
      message: 'Đăng ký thành công',
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email, password });
    if (!user) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    return res.json({
      message: 'Đăng nhập thành công',
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Menu ────────────────────────────────────────────────────────────────────
app.get('/menu', async (req, res) => {
  try {
    const { page = 1, limit = 6, q, category } = req.query;
    let query = { isActive: true };

    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { nameEn: { $regex: q, $options: 'i' } }
      ];
    }

    if (category && category !== 'all') {
      const catQuery = {
        $or: [
          { category: category },
          { categoryName: category },
          { categoryTitle: category },
          { type: category }
        ]
      };
      if (query.$or && query.$or.length > 0) {
        query = { $and: [{ $or: query.$or }, catQuery] };
      } else {
        query = catQuery;
      }
    }

    const total = await MenuItem.countDocuments(query);
    const items = await MenuItem.find(query)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .select('-__v'); // bỏ __v để giảm payload

    // Cache 60 giây – giúp browser/CDN cache response
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    res.json({
      items,
      total,
      hasMore: (parseInt(page) * parseInt(limit)) < total,
      page: parseInt(page)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.post('/menu', async (req, res) => {
  try {
    const { name, nameEn, price, imageUrl, category } = req.body;
    if (!name || typeof price !== 'number') {
      return res.status(400).json({ message: 'Tên món và giá là bắt buộc' });
    }
    const item = await MenuItem.create({ name, nameEn, price, imageUrl, category });
    res.set('Cache-Control', 'no-store');
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.put('/menu/:id', async (req, res) => {
  try {
    const { name, nameEn, price, isActive, imageUrl, category } = req.body;
    const item = await MenuItem.findByIdAndUpdate(
      req.params.id,
      { name, nameEn, price, isActive, imageUrl, category },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    res.set('Cache-Control', 'no-store');
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.patch('/menu/:id', async (req, res) => {
  try {
    const updates = req.body;
    const item = await MenuItem.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    res.set('Cache-Control', 'no-store');
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.delete('/menu/:id', async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Categories ──────────────────────────────────────────────────────────────
app.get('/categories', async (req, res) => {
  try {
    const categories = await MenuItem.distinct('category', { isActive: true });
    // Cache 5 phút – danh mục ít thay đổi
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(categories.filter(Boolean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Orders ──────────────────────────────────────────────────────────────────
app.post('/orders', async (req, res) => {
  try {
    const { items, createdByEmail, tableNumber } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Đơn hàng không có món' });
    }

    // Tăng số thứ tự hóa đơn (Atomatic counter)
    const counter = await Counter.findOneAndUpdate(
      { id: 'order_number' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const billSeq = counter.seq.toString().padStart(6, '0');
    const billId = `HD#${billSeq}`;

    const total = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);

    const newOrder = new Order({
      items,
      total,
      createdByEmail: createdByEmail || null,
      tableNumber: tableNumber || 0,
      billId,
    });
    await newOrder.save();

    res.set('Cache-Control', 'no-store');
    return res.status(201).json({ message: 'Tạo order thành công', order: newOrder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Table Management (Shared Status & Carts) ────────────────────────────────
app.get('/tables', async (req, res) => {
  try {
    const activeCarts = await ActiveCart.find();
    const tables = [];
    for (let i = 1; i <= 10; i++) {
      const cart = activeCarts.find(c => c.tableNumber === i);
      tables.push({
        number: i,
        isBusy: !!cart && cart.items.length > 0,
        itemCount: cart ? cart.items.length : 0,
      });
    }
    return res.json(tables);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy trạng thái bàn' });
  }
});

app.get('/tables/:num/cart', async (req, res) => {
  try {
    const tableNum = parseInt(req.params.num);
    const cart = await ActiveCart.findOne({ tableNumber: tableNum });
    return res.json(cart || { tableNumber: tableNum, items: [] });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy giỏ hàng bàn' });
  }
});

app.post('/tables/:num/cart', async (req, res) => {
  try {
    const tableNum = parseInt(req.params.num);
    const { items, updatedByEmail } = req.body;
    const cart = await ActiveCart.findOneAndUpdate(
      { tableNumber: tableNum },
      { items, updatedByEmail, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return res.json(cart);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật giỏ hàng bàn' });
  }
});

app.delete('/tables/:num/cart', async (req, res) => {
  try {
    const tableNum = parseInt(req.params.num);
    await ActiveCart.deleteOne({ tableNumber: tableNum });
    return res.json({ message: 'Đã xóa giỏ hàng bàn ' + tableNum });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa giỏ hàng bàn' });
  }
});

app.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 6 } = req.query;
    const total = await Order.countDocuments();
    const orders = await Order.find()
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    // Orders không cache vì luôn cần mới nhất
    res.set('Cache-Control', 'no-store');
    res.json({
      items: orders,
      total,
      hasMore: (parseInt(page) * parseInt(limit)) < total,
      page: parseInt(page)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Xuất bill ra CSV
app.get('/orders/export-csv', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    let query = {};

    if (type === 'daily') {
      const dateStr = String(req.query.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: 'Ngày không hợp lệ' });
      }
      const start = new Date(`${dateStr}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query = { createdAt: { $gte: start, $lt: end } };
    } else if (type === 'monthly') {
      const monthStr = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(monthStr)) {
        return res.status(400).json({ message: 'Tháng không hợp lệ' });
      }
      const [yearStr, monthPart] = monthStr.split('-');
      const year = Number(yearStr);
      const month = Number(monthPart);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      query = { createdAt: { $gte: start, $lt: end } };
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    const header = ['orderId', 'createdAt', 'nhanVien', 'tenMon', 'soLuong', 'donGia', 'thanhTien'];
    const rows = [header.join(',')];

    orders.forEach(order => {
      const createdAt = order.createdAt ? new Date(order.createdAt).toISOString() : '';
      const nhanVien = order.createdByEmail || '';
      (order.items || []).forEach(it => {
        const soLuong = it.quantity || 0;
        const donGia = it.price || 0;
        rows.push([
          `"${order._id.toString()}"`,
          `"${createdAt}"`,
          `"${nhanVien}"`,
          `"${(it.name || '').replace(/"/g, '""')}"`,
          soLuong,
          donGia,
          soLuong * donGia,
        ].join(','));
      });
    });

    res.set('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Revenue ─────────────────────────────────────────────────────────────────
app.get('/revenue', async (req, res) => {
  try {
    const result = await Order.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } },
    ]);
    const totalRevenue = result.length ? result[0].totalRevenue : 0;
    // Cache 30 giây
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=10');
    res.json({ totalRevenue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.get('/revenue/export-csv', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const orders = [];

    if (type === 'daily') {
      const dateStr = String(req.query.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: 'Ngày không hợp lệ' });
      }
      const start = new Date(`${dateStr}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      orders.push(...(await Order.find({ createdAt: { $gte: start, $lt: end } })));
      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const csv = ['type,date,billsCount,totalRevenue', `daily,${dateStr},${orders.length},${totalRevenue}`].join('\n');
      res.set('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-daily-${dateStr}.csv"`);
      return res.send(csv);
    }

    if (type === 'monthly') {
      const monthStr = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(monthStr)) {
        return res.status(400).json({ message: 'Tháng không hợp lệ' });
      }
      const [yearStr, monthPart] = monthStr.split('-');
      const year = Number(yearStr);
      const month = Number(monthPart);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      orders.push(...(await Order.find({ createdAt: { $gte: start, $lt: end } })));
      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const csv = ['type,month,billsCount,totalRevenue', `monthly,${monthStr},${orders.length},${totalRevenue}`].join('\n');
      res.set('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-monthly-${monthStr}.csv"`);
      return res.send(csv);
    }

    return res.status(400).json({ message: 'type phải là daily hoặc monthly' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
